use crate::{workspace_relative_path, StorageError, WriteSheetOutcome, WriteSheetStatus};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const SETTINGS: &str = "tidy.json";
static COPY_ID: AtomicU64 = AtomicU64::new(0);
// Readers in this process must not observe the recoverable publication handoff.
static SETTINGS_IO: Mutex<()> = Mutex::new(());

fn settings_parent(root: &Path, create: bool) -> Result<Option<PathBuf>, StorageError> {
    if create {
        fs::create_dir_all(root)?;
    }
    let root = match fs::canonicalize(root) {
        Ok(root) => root,
        Err(error) if error.kind() == ErrorKind::NotFound && !create => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let parent = root.join(".slate");
    if create {
        match fs::create_dir(&parent) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
    let metadata = match fs::symlink_metadata(&parent) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound && !create => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || fs::canonicalize(&parent)?.parent() != Some(root.as_path())
    {
        return Err(StorageError::PathEscapesRoot);
    }
    Ok(Some(parent))
}

fn read_regular(path: &Path) -> Result<Option<Vec<u8>>, StorageError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(StorageError::PathEscapesRoot);
    }
    Ok(Some(fs::read(path)?))
}

fn read_settings(parent: &Path) -> Result<Option<Vec<u8>>, StorageError> {
    if let Some(bytes) = read_regular(&parent.join(SETTINGS))? {
        return Ok(Some(bytes));
    }
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("tidy (pending copy ")
            && name.ends_with(").json")
            && entry.file_type()?.is_file()
        {
            return Err(StorageError::Io(format!("A Tidy settings save was interrupted. Previous bytes remain in .slate/{name}; restore that file before saving settings again.")));
        }
    }
    Ok(None)
}

/// Read only the fixed settings file, preserving undecodable bytes for the UI.
pub fn read_tidy_settings_from_space(
    root: impl AsRef<Path>,
) -> Result<Option<Vec<u8>>, StorageError> {
    let _guard = SETTINGS_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match settings_parent(root.as_ref(), false)? {
        Some(parent) => read_settings(&parent),
        None => Ok(None),
    }
}

fn candidate(parent: &Path, label: &str) -> PathBuf {
    parent.join(format!(
        "tidy ({label} {}-{}).json",
        std::process::id(),
        COPY_ID.fetch_add(1, Ordering::Relaxed)
    ))
}

fn reserve_copy(parent: &Path, label: &str, bytes: &[u8]) -> Result<PathBuf, StorageError> {
    reserve_with(bytes, || candidate(parent, label))
}

fn reserve_with(
    bytes: &[u8],
    mut next_path: impl FnMut() -> PathBuf,
) -> Result<PathBuf, StorageError> {
    for _ in 0..10_000 {
        let path = next_path();
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(mut file) => {
                // Keep a partial copy on an IO error; never truncate the canonical file.
                file.write_all(bytes)?;
                file.sync_all()?;
                return Ok(path);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(StorageError::Io(
        "No free Tidy recovery filename remains".into(),
    ))
}

fn probe_publication(parent: &Path, proposal: &Path) -> Result<(), StorageError> {
    for _ in 0..10_000 {
        let probe = candidate(parent, "publication probe");
        match fs::hard_link(proposal, &probe) {
            Ok(()) => {
                fs::remove_file(probe)?;
                return Ok(());
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(StorageError::Io(
        "No free Tidy publication filename remains".into(),
    ))
}

fn restore_previous(previous: &Path, target: &Path) -> Result<(), StorageError> {
    match fs::hard_link(previous, target) {
        Ok(()) => Ok(()),
        // Another writer's current file wins; the previous file is retained too.
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(StorageError::Io(format!(
            "Could not restore Tidy settings: {error}. Previous bytes remain in {}.",
            previous.display()
        ))),
    }
}

fn publish(root: &Path, proposal: &Path, target: &Path) -> Result<WriteSheetOutcome, StorageError> {
    match fs::hard_link(proposal, target) {
        Ok(()) => {
            // Once published, a cleanup failure must not turn the completed save into a failure.
            let _ = fs::remove_file(proposal);
            Ok(WriteSheetOutcome {
                status: WriteSheetStatus::Written,
                path: ".slate/tidy.json".into(),
            })
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => conflict(root, proposal),
        Err(error) => Err(error.into()),
    }
}

fn conflict(root: &Path, proposal: &Path) -> Result<WriteSheetOutcome, StorageError> {
    Ok(WriteSheetOutcome {
        status: WriteSheetStatus::ConflictCopy,
        path: workspace_relative_path(root, proposal)?,
    })
}

fn archive_previous(parent: &Path, previous: &Path) {
    if let Ok(archived) = reserve_copy(parent, "previous copy", &[]) {
        if fs::rename(previous, &archived).is_err() {
            // Keep the pending file on failure. A successful canonical save remains successful.
            let _ = fs::remove_file(archived);
        }
    }
}

/// Preserve the previous file and publish without replacing any newly appeared canonical file.
/// Copies are intentionally retained for recovery; neither arbitrary paths nor overwrite flags enter this API.
pub fn write_tidy_settings_to_space(
    root: impl AsRef<Path>,
    bytes: &[u8],
    base: Option<&[u8]>,
) -> Result<WriteSheetOutcome, StorageError> {
    let _guard = SETTINGS_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let parent = settings_parent(root.as_ref(), true)?.ok_or(StorageError::InvalidSheetPath)?;
    let root = parent.parent().ok_or(StorageError::PathEscapesRoot)?;
    let target = parent.join(SETTINGS);
    let current = read_settings(&parent)?;
    if current.is_some() && fs::metadata(&target)?.permissions().readonly() {
        return Err(StorageError::Io(
            "Tidy settings are read-only. Their original bytes were kept.".into(),
        ));
    }
    let proposal = reserve_copy(&parent, "conflicted copy", bytes)?;
    if current.as_deref() != base {
        return conflict(root, &proposal);
    }
    if current.is_some() {
        fs::set_permissions(&proposal, fs::metadata(&target)?.permissions())?;
    }
    probe_publication(&parent, &proposal)?;
    if current.is_none() {
        return publish(root, &proposal, &target);
    }

    let previous = reserve_copy(&parent, "pending copy", &[])?;
    match fs::rename(&target, &previous) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let _ = fs::remove_file(&previous);
            return conflict(root, &proposal);
        }
        Err(error) => return Err(error.into()),
    }
    let result = finish_replacement(root, &proposal, &previous, &target, base);
    if result.is_ok() {
        archive_previous(&parent, &previous);
    }
    result
}

fn finish_replacement(
    root: &Path,
    proposal: &Path,
    previous: &Path,
    target: &Path,
    base: Option<&[u8]>,
) -> Result<WriteSheetOutcome, StorageError> {
    // The rename captures the actual previous inode even if an external edit raced the read.
    // Keep that inode instead of copying old snapshot bytes over somebody else's work.
    let captured = read_regular(previous);
    if captured.as_ref().map(|source| source.as_deref()) != Ok(base) {
        restore_previous(previous, target)?;
        captured?;
        return conflict(root, proposal);
    }
    match publish(root, proposal, target) {
        Ok(outcome) => Ok(outcome),
        Err(error) => {
            restore_previous(previous, target)?;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publication_and_restore_never_replace_a_new_canonical_file() {
        let root = std::env::temp_dir().join(format!(
            "slate-tidy-handoff-{}-{}",
            std::process::id(),
            COPY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let proposal = reserve_copy(&root, "conflicted copy", b"proposal").unwrap();
        let previous = reserve_copy(&root, "previous copy", b"previous").unwrap();
        let target = root.join(SETTINGS);
        fs::write(&target, b"external winner").unwrap();
        let outcome = publish(&root, &proposal, &target).unwrap();
        assert_eq!(outcome.status, WriteSheetStatus::ConflictCopy);
        restore_previous(&previous, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"external winner");
        assert_eq!(fs::read(&proposal).unwrap(), b"proposal");
        assert_eq!(fs::read(&previous).unwrap(), b"previous");
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_change_captured_during_handoff_is_restored_and_the_proposal_stays_separate() {
        let root = std::env::temp_dir().join(format!(
            "slate-tidy-raced-{}-{}",
            std::process::id(),
            COPY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let proposal = reserve_copy(&root, "conflicted copy", b"proposal").unwrap();
        let previous =
            reserve_copy(&root, "previous copy", b"external change after snapshot").unwrap();
        let target = root.join(SETTINGS);
        let outcome = finish_replacement(
            &root,
            &proposal,
            &previous,
            &target,
            Some(b"opening snapshot"),
        )
        .unwrap();
        assert_eq!(outcome.status, WriteSheetStatus::ConflictCopy);
        assert_eq!(
            fs::read(&target).unwrap(),
            b"external change after snapshot"
        );
        assert_eq!(
            fs::read(&previous).unwrap(),
            b"external change after snapshot"
        );
        assert_eq!(fs::read(&proposal).unwrap(), b"proposal");
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_copy_name_collision_never_overwrites_the_existing_file() {
        let root = std::env::temp_dir().join(format!(
            "slate-tidy-collision-{}-{}",
            std::process::id(),
            COPY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let occupied = root.join("occupied.json");
        fs::write(&occupied, b"existing bytes").unwrap();
        let free = root.join("free.json");
        let mut names = [occupied.clone(), free.clone()].into_iter();
        assert_eq!(
            reserve_with(b"proposal", || names.next().unwrap()).unwrap(),
            free
        );
        assert_eq!(fs::read(occupied).unwrap(), b"existing bytes");
        assert_eq!(fs::read(free).unwrap(), b"proposal");
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(root).unwrap();
    }
}
