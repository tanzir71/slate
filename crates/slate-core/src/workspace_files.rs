use crate::{workspace_relative_path, StorageError, WriteSheetOutcome, WriteSheetStatus};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

static FILE_IO: Mutex<()> = Mutex::new(());
static NEXT_COPY: AtomicU64 = AtomicU64::new(0);
const PENDING: &str = ".slate-pending-";
mod capture;
pub use capture::append_capture;

fn validate(path: &str) -> Result<Vec<&str>, StorageError> {
    if path.is_empty()
        || path.contains(['\\', ':', '<', '>', '"', '|', '?', '*'])
        || path.chars().any(char::is_control)
    {
        return Err(StorageError::PathEscapesRoot);
    }
    let parts: Vec<_> = path.split('/').collect();
    for part in &parts {
        if part.is_empty() || *part == "." || *part == ".." || part.ends_with(['.', ' ']) {
            return Err(StorageError::PathEscapesRoot);
        }
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let device = matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
        if device {
            return Err(StorageError::InvalidSheetPath);
        }
    }
    Ok(parts)
}

/// Check a portable workspace path without reading or creating anything on disk.
pub fn validate_workspace_path(path: &str) -> Result<(), StorageError> {
    validate(path).map(|_| ())
}

fn root_path(root: &Path, create: bool) -> Result<Option<PathBuf>, StorageError> {
    if create {
        fs::create_dir_all(root)?;
    }
    match fs::canonicalize(root) {
        Ok(path) if path.is_dir() => Ok(Some(path)),
        Ok(_) => Err(StorageError::InvalidSheetPath),
        Err(error) if !create && error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn target_path(
    root: &Path,
    path: &str,
    create: bool,
) -> Result<Option<(PathBuf, PathBuf)>, StorageError> {
    let parts = validate(path)?;
    let Some(root) = root_path(root, create)? else {
        return Ok(None);
    };
    let mut parent = root.clone();
    for part in &parts[..parts.len() - 1] {
        parent.push(part);
        if create {
            match fs::create_dir(&parent) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.into()),
            }
        }
        let metadata = match fs::symlink_metadata(&parent) {
            Ok(metadata) => metadata,
            Err(error) if !create && error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || !fs::canonicalize(&parent)?.starts_with(&root)
        {
            return Err(StorageError::PathEscapesRoot);
        }
    }
    Ok(Some((root, parent.join(parts[parts.len() - 1]))))
}

fn regular(path: &Path) -> Result<Option<fs::Metadata>, StorageError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_file() => {
            Ok(Some(metadata))
        }
        Ok(_) => Err(StorageError::PathEscapesRoot),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn raw(path: &Path) -> Result<Option<Vec<u8>>, StorageError> {
    if regular(path)?.is_none() {
        return Ok(None);
    }
    Ok(Some(fs::read(path)?))
}

fn pending_original(name: &str) -> Option<&str> {
    staged_original(name, PENDING)
}

fn staged_original<'a>(name: &'a str, marker: &str) -> Option<&'a str> {
    let (original, suffix) = name.strip_prefix('.')?.rsplit_once(marker)?;
    let (pid, id) = suffix.split_once('-')?;
    if !pid.is_empty()
        && !id.is_empty()
        && pid.chars().all(|c| c.is_ascii_digit())
        && id.chars().all(|c| c.is_ascii_digit())
    {
        Some(original)
    } else {
        None
    }
}

fn read_checked(root: &Path, target: &Path) -> Result<Option<Vec<u8>>, StorageError> {
    if let Some(bytes) = raw(target)? {
        return Ok(Some(bytes));
    }
    let parent = target.parent().ok_or(StorageError::InvalidSheetPath)?;
    let original = target.file_name().ok_or(StorageError::InvalidSheetPath)?;
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && pending_original(&entry.file_name().to_string_lossy())
                .is_some_and(|name| name == original)
        {
            return Err(StorageError::InterruptedWrite {
                path: workspace_relative_path(root, target)?,
                recovery: workspace_relative_path(root, &entry.path())?,
            });
        }
    }
    Ok(None)
}

pub fn read_workspace_file(
    root: impl AsRef<Path>,
    path: &str,
) -> Result<Option<Vec<u8>>, StorageError> {
    validate(path)?;
    if path == ".slate/tidy.json" {
        return crate::read_tidy_settings_from_space(root);
    }
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match target_path(root.as_ref(), path, false)? {
        Some((root, target)) => read_checked(&root, &target),
        None => Ok(None),
    }
}

#[derive(Debug, Clone)]
pub struct WorkspaceFileInfo {
    pub path: PathBuf,
    pub bytes: u64,
    pub modified: Option<std::time::SystemTime>,
}

/// Inspect a real regular file under the same path/symlink rules as reads and saves.
/// This does not decode its content, create a root or change any bytes.
pub fn workspace_file_info(
    root: impl AsRef<Path>,
    path: &str,
) -> Result<Option<WorkspaceFileInfo>, StorageError> {
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some((root, target)) = target_path(root.as_ref(), path, false)? else {
        return Ok(None);
    };
    let Some(metadata) = regular(&target)? else {
        // Preserve the existing interrupted-save recovery error if a staged original exists.
        let _ = read_checked(&root, &target)?;
        return Ok(None);
    };
    let canonical = fs::canonicalize(&target)?;
    if !canonical.starts_with(&root) {
        return Err(StorageError::PathEscapesRoot);
    }
    Ok(Some(WorkspaceFileInfo {
        path: canonical,
        bytes: metadata.len(),
        modified: metadata.modified().ok(),
    }))
}

fn collect(
    root: &Path,
    directory: &Path,
    private: bool,
    output: &mut BTreeSet<String>,
    visited: &mut BTreeSet<PathBuf>,
) -> Result<(), StorageError> {
    if !visited.insert(fs::canonicalize(directory)?) {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !private && name == ".slate" {
            continue;
        }
        if kind.is_dir() {
            if !fs::canonicalize(&path)?.starts_with(root) {
                continue;
            }
            collect(root, &path, private, output, visited)?;
        } else if kind.is_file() {
            if let Some(original) = pending_original(&name) {
                output.insert(workspace_relative_path(
                    root,
                    &path.with_file_name(original),
                )?);
            }
            if !private
                && [
                    PENDING,
                    ".slate-proposal-",
                    ".slate-probe-",
                    ".slate-previous-",
                ]
                .iter()
                .any(|marker| staged_original(&name, marker).is_some())
            {
                continue;
            }
            output.insert(workspace_relative_path(root, &path)?);
        }
    }
    Ok(())
}

pub fn list_workspace_files(
    root: impl AsRef<Path>,
    include_private: bool,
) -> Result<Vec<String>, StorageError> {
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(root) = root_path(root.as_ref(), false)? else {
        return Ok(Vec::new());
    };
    let mut paths = BTreeSet::new();
    collect(
        &root,
        &root,
        include_private,
        &mut paths,
        &mut BTreeSet::new(),
    )?;
    Ok(paths.into_iter().collect())
}

fn next_id() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        NEXT_COPY.fetch_add(1, Ordering::Relaxed)
    )
}

fn stage(target: &Path, label: &str, bytes: &[u8]) -> Result<PathBuf, StorageError> {
    let name = target
        .file_name()
        .ok_or(StorageError::InvalidSheetPath)?
        .to_string_lossy();
    for _ in 0..10_000 {
        let path = target.with_file_name(format!(".{name}.slate-{label}-{}", next_id()));
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(mut file) => {
                file.write_all(bytes)?;
                file.sync_all()?;
                return Ok(path);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(StorageError::Io(
        "No free native recovery filename remains".into(),
    ))
}

fn publish(proposal: &Path, target: &Path) -> Result<bool, StorageError> {
    match fs::hard_link(proposal, target) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn restore(previous: &Path, target: &Path) -> Result<(), StorageError> {
    publish(previous, target).map(|_| ())
}

// A completed handoff must not look interrupted if the user later deletes the
// canonical file. Keep retained bytes under a completed-copy name, without replacement.
fn archive_previous(target: &Path, previous: &Path) {
    let Some(name) = target.file_name() else {
        return;
    };
    for _ in 0..10_000 {
        let archive = target.with_file_name(format!(
            ".{}.slate-previous-{}",
            name.to_string_lossy(),
            next_id()
        ));
        match publish(previous, &archive) {
            Ok(true) => {
                let _ = fs::remove_file(previous);
                return;
            }
            Ok(false) => continue,
            Err(_) => return, // Leave the pending bytes recoverable when archival is unavailable.
        }
    }
}

fn retain_conflict(
    root: &Path,
    target: &Path,
    proposal: &Path,
) -> Result<WriteSheetOutcome, StorageError> {
    let stem = target
        .file_stem()
        .ok_or(StorageError::InvalidSheetPath)?
        .to_string_lossy();
    let extension = target
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for _ in 0..10_000 {
        let copy =
            target.with_file_name(format!("{stem} (conflicted copy {}){extension}", next_id()));
        if publish(proposal, &copy)? {
            let _ = fs::remove_file(proposal);
            return Ok(WriteSheetOutcome {
                status: WriteSheetStatus::ConflictCopy,
                path: workspace_relative_path(root, &copy)?,
            });
        }
    }
    Err(StorageError::Io(
        "No free native conflict filename remains".into(),
    ))
}

pub fn create_workspace_file(
    root: impl AsRef<Path>,
    path: &str,
    bytes: &[u8],
) -> Result<bool, StorageError> {
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (root, target) =
        target_path(root.as_ref(), path, true)?.ok_or(StorageError::InvalidSheetPath)?;
    if read_checked(&root, &target)?.is_some() {
        return Ok(false);
    }
    let proposal = stage(&target, "proposal", bytes)?;
    let created = publish(&proposal, &target)?;
    let _ = fs::remove_file(proposal);
    Ok(created)
}

pub fn save_workspace_file(
    root: impl AsRef<Path>,
    path: &str,
    bytes: &[u8],
    base: Option<&[u8]>,
) -> Result<WriteSheetOutcome, StorageError> {
    validate(path)?;
    if path == ".slate/tidy.json" {
        return crate::write_tidy_settings_to_space(root, bytes, base);
    }
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    save_checked(root.as_ref(), path, bytes, base, &retain_conflict)
}

fn save_checked(
    root: &Path,
    path: &str,
    bytes: &[u8],
    base: Option<&[u8]>,
    conflict: &dyn Fn(&Path, &Path, &Path) -> Result<WriteSheetOutcome, StorageError>,
) -> Result<WriteSheetOutcome, StorageError> {
    let (root, target) = target_path(root, path, true)?.ok_or(StorageError::InvalidSheetPath)?;
    let current = read_checked(&root, &target)?;
    if current.is_some() && fs::metadata(&target)?.permissions().readonly() {
        return Err(StorageError::Io(
            "The file is read-only. Its original bytes were kept.".into(),
        ));
    }
    let proposal = stage(&target, "proposal", bytes)?;
    if current.as_deref() != base {
        return conflict(&root, &target, &proposal);
    }
    if current.is_none() {
        if publish(&proposal, &target)? {
            let _ = fs::remove_file(proposal);
            return Ok(WriteSheetOutcome {
                status: WriteSheetStatus::Written,
                path: path.into(),
            });
        }
        return conflict(&root, &target, &proposal);
    }
    fs::set_permissions(&proposal, fs::metadata(&target)?.permissions())?;
    let probe = stage(&target, "probe", &[])?;
    fs::remove_file(&probe)?;
    if !publish(&proposal, &probe)? {
        return Err(StorageError::Io(
            "Native publication probe was occupied".into(),
        ));
    }
    fs::remove_file(probe)?;
    let previous = stage(&target, "pending", base.unwrap_or_default())?;
    match fs::rename(&target, &previous) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let _ = fs::remove_file(previous);
            return conflict(&root, &target, &proposal);
        }
        Err(error) => return Err(error.into()),
    }
    finish_save_with(&root, &target, &proposal, &previous, bytes, base, conflict)
}

#[cfg(test)]
fn finish_save(
    root: &Path,
    target: &Path,
    proposal: &Path,
    previous: &Path,
    bytes: &[u8],
    base: Option<&[u8]>,
) -> Result<WriteSheetOutcome, StorageError> {
    finish_save_with(
        root,
        target,
        proposal,
        previous,
        bytes,
        base,
        &retain_conflict,
    )
}

fn finish_save_with(
    root: &Path,
    target: &Path,
    proposal: &Path,
    previous: &Path,
    bytes: &[u8],
    base: Option<&[u8]>,
    conflict: &dyn Fn(&Path, &Path, &Path) -> Result<WriteSheetOutcome, StorageError>,
) -> Result<WriteSheetOutcome, StorageError> {
    let captured = match raw(previous) {
        Ok(bytes) => bytes,
        Err(error) => {
            restore(previous, target)?;
            return Err(error);
        }
    };
    if captured.as_deref() != base {
        restore(previous, target)?;
        let outcome = conflict(root, target, proposal)?;
        archive_previous(target, previous);
        return Ok(outcome);
    }
    match publish(proposal, target) {
        Ok(true) => {
            let _ = fs::remove_file(proposal);
            // Cleanup is optional after publication: a failed inspection must not
            // turn a completed save into Unsaved or discard the retained copy.
            if matches!(raw(previous), Ok(value) if value.as_deref() == base)
                && matches!(raw(target), Ok(value) if value.as_deref() == Some(bytes))
            {
                let _ = fs::remove_file(previous);
            }
            if previous.exists() {
                archive_previous(target, previous);
            }
            Ok(WriteSheetOutcome {
                status: WriteSheetStatus::Written,
                path: workspace_relative_path(root, target)?,
            })
        }
        Ok(false) => {
            restore(previous, target)?;
            let outcome = conflict(root, target, proposal)?;
            archive_previous(target, previous);
            Ok(outcome)
        }
        Err(error) => {
            restore(previous, target)?;
            archive_previous(target, previous);
            Err(error)
        }
    }
}

fn move_checked(root: &Path, from: &str, to: &str, base: &[u8]) -> Result<(), StorageError> {
    let Some((root, source)) = target_path(root, from, false)? else {
        return Err(StorageError::Io("Source file no longer exists".into()));
    };
    if read_checked(&root, &source)?.as_deref() != Some(base) {
        return Err(StorageError::Io(
            "Source changed outside Slate. Refresh before moving it.".into(),
        ));
    }
    let (_, target) = target_path(&root, to, true)?.ok_or(StorageError::InvalidSheetPath)?;
    if source == target {
        return Ok(());
    }
    if regular(&target)?.is_some() && fs::canonicalize(&source)? != fs::canonicalize(&target)? {
        return Err(StorageError::Io(
            "A file already exists at the destination.".into(),
        ));
    }
    let previous = stage(&source, "pending", base)?;
    fs::rename(&source, &previous)?;
    if raw(&previous)?.as_deref() != Some(base) {
        restore(&previous, &source)?;
        archive_previous(&source, &previous);
        return Err(StorageError::Io(
            "Source changed during the move. Its bytes were kept.".into(),
        ));
    }
    match publish(&previous, &target) {
        Ok(true) => {
            let _ = fs::remove_file(previous);
            Ok(())
        }
        Ok(false) => {
            restore(&previous, &source)?;
            archive_previous(&source, &previous);
            Err(StorageError::Io(
                "Destination changed during the move. Both files were kept.".into(),
            ))
        }
        Err(error) => {
            restore(&previous, &source)?;
            archive_previous(&source, &previous);
            Err(error)
        }
    }
}

pub fn move_workspace_file(
    root: impl AsRef<Path>,
    from: &str,
    to: &str,
    base: &[u8],
) -> Result<(), StorageError> {
    validate(from)?;
    validate(to)?;
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    move_checked(root.as_ref(), from, to, base)
}

pub fn trash_workspace_file(
    root: impl AsRef<Path>,
    path: &str,
    base: &[u8],
) -> Result<String, StorageError> {
    validate(path)?;
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let destination = format!(".slate/trash/{}/{path}", next_id());
    move_checked(root.as_ref(), path, &destination, base)?;
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Space(PathBuf);
    impl Space {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("slate-file-race-{}", next_id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Space {
        fn drop(&mut self) {
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn workspace_file_info_reports_real_raw_bytes_without_creating_or_rewriting_files() {
        let space = Space::new();
        let missing = space.0.join("missing");
        assert!(workspace_file_info(&missing, "note.md").unwrap().is_none());
        assert!(!missing.exists());
        let path = space.0.join("বাংলা note.md");
        let bytes = [0xef, 0xbb, 0xbf, b'#', 0xff, b'\r', b'\n'];
        fs::write(&path, bytes).unwrap();
        let info = workspace_file_info(&space.0, "বাংলা note.md")
            .unwrap()
            .unwrap();
        assert_eq!(info.path, fs::canonicalize(&path).unwrap());
        assert_eq!(info.bytes, bytes.len() as u64);
        assert!(info.modified.is_some());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read_dir(&space.0).unwrap().count(), 1);
    }

    #[test]
    fn workspace_file_info_refuses_unsafe_paths_and_non_files() {
        let space = Space::new();
        for path in [
            "../outside.md",
            "C:/note.md",
            "a\\note.md",
            "./note.md",
            "a//note.md",
            "note.md:stream",
            "CON.md",
            "a/../note.md",
        ] {
            assert!(workspace_file_info(&space.0, path).is_err(), "{path}");
        }
        fs::create_dir(space.0.join("folder.md")).unwrap();
        assert!(workspace_file_info(&space.0, "folder.md").is_err());
        assert!(workspace_file_info(&space.0, "absent.md")
            .unwrap()
            .is_none());
    }

    #[cfg(unix)]
    #[test]
    fn workspace_file_info_rejects_leaf_and_parent_symlinks() {
        use std::os::unix::fs::symlink;
        let space = Space::new();
        let outside = Space::new();
        fs::write(outside.0.join("note.md"), b"Private outside words").unwrap();
        symlink(outside.0.join("note.md"), space.0.join("leaf.md")).unwrap();
        symlink(&outside.0, space.0.join("parent")).unwrap();
        assert!(workspace_file_info(&space.0, "leaf.md").is_err());
        assert!(workspace_file_info(&space.0, "parent/note.md").is_err());
    }

    #[test]
    fn a_late_canonical_winner_keeps_the_winner_previous_and_proposal() {
        let space = Space::new();
        let target = space.0.join("note.md");
        let previous = stage(&target, "pending", b"base").unwrap();
        let proposal = stage(&target, "proposal", b"my draft").unwrap();
        fs::write(&target, b"external winner").unwrap();
        let outcome = finish_save(
            &space.0,
            &target,
            &proposal,
            &previous,
            b"my draft",
            Some(b"base"),
        )
        .unwrap();
        assert_eq!(outcome.status, WriteSheetStatus::ConflictCopy);
        assert_eq!(fs::read(&target).unwrap(), b"external winner");
        let archive = fs::read_dir(&space.0)
            .unwrap()
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".slate-previous-")
            })
            .unwrap()
            .path();
        assert_eq!(fs::read(archive).unwrap(), b"base");
        assert_eq!(fs::read(space.0.join(outcome.path)).unwrap(), b"my draft");
        fs::remove_file(&target).unwrap();
        assert_eq!(read_workspace_file(&space.0, "note.md").unwrap(), None);
    }

    #[test]
    fn a_change_captured_during_detach_is_restored_without_replacement() {
        let space = Space::new();
        let target = space.0.join("note.md");
        let previous = stage(&target, "pending", b"external change").unwrap();
        let proposal = stage(&target, "proposal", b"my draft").unwrap();
        let outcome = finish_save(
            &space.0,
            &target,
            &proposal,
            &previous,
            b"my draft",
            Some(b"base"),
        )
        .unwrap();
        assert_eq!(outcome.status, WriteSheetStatus::ConflictCopy);
        assert_eq!(fs::read(&target).unwrap(), b"external change");
        let archive = fs::read_dir(&space.0)
            .unwrap()
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".slate-previous-")
            })
            .unwrap()
            .path();
        assert_eq!(fs::read(archive).unwrap(), b"external change");
        assert_eq!(fs::read(space.0.join(outcome.path)).unwrap(), b"my draft");
        fs::remove_file(&target).unwrap();
        assert_eq!(read_workspace_file(&space.0, "note.md").unwrap(), None);
    }
}
