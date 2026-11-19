use slate_core::{read_tidy_settings_from_space, write_tidy_settings_to_space, WriteSheetStatus};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static COUNTER: AtomicUsize = AtomicUsize::new(0);
struct Space(PathBuf);
impl Space {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "slate-tidy-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn files(&self) -> Vec<Vec<u8>> {
        fs::read_dir(self.0.join(".slate"))
            .unwrap()
            .map(|entry| fs::read(entry.unwrap().path()).unwrap())
            .collect()
    }
}
impl Drop for Space {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn reading_missing_settings_does_not_create_a_space_or_file() {
    let space = Space::new();
    assert_eq!(read_tidy_settings_from_space(&space.0).unwrap(), None);
    assert_eq!(fs::read_dir(&space.0).unwrap().count(), 0);
    assert_eq!(
        read_tidy_settings_from_space(space.0.join("missing")).unwrap(),
        None
    );
    assert!(!space.0.join("missing").exists());
}

#[test]
fn creates_and_reads_exact_bytes_including_bom_crlf_and_unknown_numeric_spelling() {
    let space = Space::new();
    let source = b"\xef\xbb\xbf{\r\n \"version\":1, \"future\":9007199254740993\r\n}\r\n";
    let saved = write_tidy_settings_to_space(&space.0, source, None).unwrap();
    assert_eq!(saved.status, WriteSheetStatus::Written);
    assert_eq!(saved.path, ".slate/tidy.json");
    assert_eq!(
        read_tidy_settings_from_space(&space.0).unwrap().as_deref(),
        Some(source.as_slice())
    );
    assert_eq!(space.files(), vec![source.to_vec()]);
}

#[test]
fn successful_replacement_retains_the_previous_file_without_changing_other_files() {
    let space = Space::new();
    let old = b"{\"version\":1}";
    let next = b"{\"version\":1,\"onSave\":true}";
    write_tidy_settings_to_space(&space.0, old, None).unwrap();
    fs::write(space.0.join("note.md"), "My words").unwrap();
    let saved = write_tidy_settings_to_space(&space.0, next, Some(old)).unwrap();
    assert_eq!(saved.status, WriteSheetStatus::Written);
    assert_eq!(
        read_tidy_settings_from_space(&space.0).unwrap().as_deref(),
        Some(next.as_slice())
    );
    let versions = space.files();
    assert_eq!(versions.len(), 2);
    assert!(versions.contains(&old.to_vec()));
    assert!(versions.contains(&next.to_vec()));
    assert_eq!(
        fs::read_to_string(space.0.join("note.md")).unwrap(),
        "My words"
    );
}

#[test]
fn stale_and_missing_snapshots_keep_external_bytes_and_distinct_proposals() {
    let space = Space::new();
    let external = b"\xef\xbb\xbf{\"version\":1}";
    write_tidy_settings_to_space(&space.0, external, None).unwrap();
    for base in [None, Some(b"{\"version\":1}".as_slice())] {
        let saved = write_tidy_settings_to_space(&space.0, b"proposal", base).unwrap();
        assert_eq!(saved.status, WriteSheetStatus::ConflictCopy);
        assert_ne!(saved.path, ".slate/tidy.json");
        assert_eq!(fs::read(space.0.join(saved.path)).unwrap(), b"proposal");
        assert_eq!(
            read_tidy_settings_from_space(&space.0).unwrap().as_deref(),
            Some(external.as_slice())
        );
    }
    assert_eq!(space.files().len(), 3);
}

#[test]
fn an_externally_deleted_file_is_not_recreated_from_a_stale_snapshot() {
    let space = Space::new();
    let saved = write_tidy_settings_to_space(&space.0, b"proposal", Some(b"old")).unwrap();
    assert_eq!(saved.status, WriteSheetStatus::ConflictCopy);
    assert_eq!(read_tidy_settings_from_space(&space.0).unwrap(), None);
    assert_eq!(fs::read(space.0.join(saved.path)).unwrap(), b"proposal");
}

#[test]
fn raw_invalid_utf8_is_read_without_replacement_or_normalization() {
    let space = Space::new();
    fs::create_dir(space.0.join(".slate")).unwrap();
    fs::write(space.0.join(".slate/tidy.json"), [0xff, 0x00, 0xef]).unwrap();
    assert_eq!(
        read_tidy_settings_from_space(&space.0).unwrap(),
        Some(vec![0xff, 0x00, 0xef])
    );
}

#[test]
fn interrupted_handoffs_report_the_retained_file_instead_of_silently_loading_defaults() {
    let space = Space::new();
    fs::create_dir(space.0.join(".slate")).unwrap();
    let previous = space.0.join(".slate/tidy (pending copy 1-1).json");
    let source = b"\xef\xbb\xbf{\"version\":1,\"onSave\":true}";
    fs::write(&previous, source).unwrap();
    let error = read_tidy_settings_from_space(&space.0)
        .unwrap_err()
        .to_string();
    assert!(error.contains("interrupted"));
    assert!(error.contains("pending copy 1-1"));
    assert!(write_tidy_settings_to_space(&space.0, b"proposal", None).is_err());
    assert_eq!(fs::read(&previous).unwrap(), source);
    assert!(!space.0.join(".slate/tidy.json").exists());
    fs::rename(&previous, space.0.join(".slate/tidy.json")).unwrap();
    assert_eq!(
        read_tidy_settings_from_space(&space.0).unwrap().as_deref(),
        Some(source.as_slice())
    );
}

#[test]
fn removing_a_completed_settings_file_honors_absence_despite_retained_previous_versions() {
    let space = Space::new();
    write_tidy_settings_to_space(&space.0, b"first", None).unwrap();
    write_tidy_settings_to_space(&space.0, b"second", Some(b"first")).unwrap();
    fs::remove_file(space.0.join(".slate/tidy.json")).unwrap();
    assert_eq!(read_tidy_settings_from_space(&space.0).unwrap(), None);
    assert_eq!(space.files(), vec![b"first".to_vec()]);
}

#[test]
fn simultaneous_saves_keep_one_canonical_result_and_both_proposals() {
    let space = Space::new();
    write_tidy_settings_to_space(&space.0, b"base", None).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let writers: Vec<_> = [b"one".as_slice(), b"two".as_slice()]
        .into_iter()
        .map(|source| {
            let root = space.0.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                write_tidy_settings_to_space(root, source, Some(b"base")).unwrap()
            })
        })
        .collect();
    barrier.wait();
    let outcomes: Vec<_> = writers
        .into_iter()
        .map(|writer| writer.join().unwrap().status)
        .collect();
    assert_eq!(
        outcomes
            .iter()
            .filter(|status| **status == WriteSheetStatus::Written)
            .count(),
        1
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|status| **status == WriteSheetStatus::ConflictCopy)
            .count(),
        1
    );
    let versions = space.files();
    for source in [b"base".as_slice(), b"one".as_slice(), b"two".as_slice()] {
        assert!(versions.contains(&source.to_vec()));
    }
}

#[test]
fn directories_at_the_fixed_settings_path_are_rejected_without_changing_contents() {
    let space = Space::new();
    fs::create_dir_all(space.0.join(".slate/tidy.json")).unwrap();
    fs::write(space.0.join(".slate/tidy.json/keep"), "Kept").unwrap();
    assert!(read_tidy_settings_from_space(&space.0).is_err());
    assert!(write_tidy_settings_to_space(&space.0, b"proposal", None).is_err());
    assert_eq!(
        fs::read_to_string(space.0.join(".slate/tidy.json/keep")).unwrap(),
        "Kept"
    );
}

#[cfg(unix)]
#[test]
fn linked_private_directory_and_settings_files_are_rejected_without_following_them() {
    use std::os::unix::fs::symlink;
    let space = Space::new();
    let outside = Space::new();
    fs::write(outside.0.join("tidy.json"), "External words").unwrap();
    symlink(&outside.0, space.0.join(".slate")).unwrap();
    assert!(read_tidy_settings_from_space(&space.0).is_err());
    assert!(write_tidy_settings_to_space(&space.0, b"proposal", None).is_err());
    fs::remove_file(space.0.join(".slate")).unwrap();
    fs::create_dir(space.0.join(".slate")).unwrap();
    symlink(
        outside.0.join("tidy.json"),
        space.0.join(".slate/tidy.json"),
    )
    .unwrap();
    assert!(read_tidy_settings_from_space(&space.0).is_err());
    assert!(write_tidy_settings_to_space(&space.0, b"proposal", None).is_err());
    assert_eq!(
        fs::read_to_string(outside.0.join("tidy.json")).unwrap(),
        "External words"
    );
}

#[test]
fn read_only_settings_are_not_replaced_and_keep_their_original_bytes() {
    let space = Space::new();
    write_tidy_settings_to_space(&space.0, b"original", None).unwrap();
    let path = space.0.join(".slate/tidy.json");
    let original = fs::metadata(&path).unwrap().permissions();
    let mut read_only = original.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&path, read_only).unwrap();
    let saved = write_tidy_settings_to_space(&space.0, b"proposal", Some(b"original"));
    let bytes = fs::read(&path).unwrap();
    fs::set_permissions(&path, original).unwrap();
    assert!(saved.is_err());
    assert_eq!(bytes, b"original");
    assert_eq!(space.files(), vec![b"original".to_vec()]);
}

#[cfg(windows)]
#[test]
fn a_windows_private_directory_junction_cannot_redirect_settings_io() {
    use std::os::windows::process::CommandExt;
    let space = Space::new();
    let outside = Space::new();
    fs::write(outside.0.join("tidy.json"), "External words").unwrap();
    let junction = space.0.join(".slate");
    assert_eq!(junction.parent(), Some(space.0.as_path()));
    assert_eq!(outside.0.parent(), Some(std::env::temp_dir().as_path()));
    let result = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:SLATE_TEST_JUNCTION -Target $env:SLATE_TEST_TARGET -ErrorAction Stop | Out-Null"])
        .env("SLATE_TEST_JUNCTION", &junction)
        .env("SLATE_TEST_TARGET", &outside.0)
        .creation_flags(0x08000000) // CREATE_NO_WINDOW: the test never opens an interactive console.
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let read = read_tidy_settings_from_space(&space.0);
    let write = write_tidy_settings_to_space(&space.0, b"proposal", None);
    // Remove the junction itself before either owned test directory is cleaned up.
    fs::remove_dir(&junction).unwrap();
    assert!(read.is_err());
    assert!(write.is_err());
    assert_eq!(
        fs::read_to_string(outside.0.join("tidy.json")).unwrap(),
        "External words"
    );
}
