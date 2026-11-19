use slate_core::{
    create_workspace_file, list_workspace_files, move_workspace_file, read_workspace_file,
    save_workspace_file, trash_workspace_file, WriteSheetStatus,
};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Space(PathBuf);
impl Space {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "slate-native-files-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Space {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn missing_reads_and_lists_do_not_create_directories() {
    let space = Space::new();
    let root = space.0.join("missing");
    assert_eq!(
        list_workspace_files(&root, false).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(read_workspace_file(&root, "Inbox/note.md").unwrap(), None);
    assert!(!root.exists());
}

#[test]
fn create_is_atomic_create_only_and_keeps_raw_bytes_and_unicode_paths() {
    let space = Space::new();
    let path = "কাজ/নোট.md";
    let bytes = b"\xef\xbb\xbf# Note\r\n\r\nWords\r\n";
    assert!(create_workspace_file(&space.0, path, bytes).unwrap());
    assert!(!create_workspace_file(&space.0, path, b"overwrite").unwrap());
    assert_eq!(
        read_workspace_file(&space.0, path).unwrap().as_deref(),
        Some(bytes.as_slice())
    );
    assert_eq!(list_workspace_files(&space.0, false).unwrap(), vec![path]);
    assert_eq!(fs::read_dir(space.0.join("কাজ")).unwrap().count(), 1);
}

#[test]
fn public_lists_exclude_private_data_and_private_lists_keep_it() {
    let space = Space::new();
    for (path, bytes) in [
        ("Book/note.md", b"note".as_slice()),
        ("Book/image.png", &[0xff]),
        (".slate/view.json", b"{}".as_slice()),
    ] {
        create_workspace_file(&space.0, path, bytes).unwrap();
    }
    assert_eq!(
        list_workspace_files(&space.0, false).unwrap(),
        vec!["Book/image.png", "Book/note.md"]
    );
    assert_eq!(
        list_workspace_files(&space.0, true).unwrap(),
        vec![".slate/view.json", "Book/image.png", "Book/note.md"]
    );
}

#[test]
fn checked_saves_preserve_new_input_without_leaving_unbounded_successful_write_copies() {
    let space = Space::new();
    let path = "note.md";
    create_workspace_file(&space.0, path, b"base").unwrap();
    let mut base = b"base".to_vec();
    for index in 0..20 {
        let next = format!("revision {index}\r\n").into_bytes();
        let outcome = save_workspace_file(&space.0, path, &next, Some(&base)).unwrap();
        assert_eq!(outcome.status, WriteSheetStatus::Written);
        assert_eq!(outcome.path, path);
        base = next;
    }
    assert_eq!(read_workspace_file(&space.0, path).unwrap().unwrap(), base);
    assert_eq!(fs::read_dir(&space.0).unwrap().count(), 1);
}

#[test]
fn a_stale_missing_or_bom_changed_snapshot_never_overwrites_the_canonical_file() {
    let space = Space::new();
    let source = b"\xef\xbb\xbfWords\r\n";
    create_workspace_file(&space.0, "note.md", source).unwrap();
    for base in [None, Some(b"Words\r\n".as_slice())] {
        let outcome = save_workspace_file(&space.0, "note.md", b"proposal", base).unwrap();
        assert_eq!(outcome.status, WriteSheetStatus::ConflictCopy);
        assert_ne!(outcome.path, "note.md");
        assert_eq!(
            read_workspace_file(&space.0, &outcome.path).unwrap(),
            Some(b"proposal".to_vec())
        );
        assert_eq!(
            read_workspace_file(&space.0, "note.md").unwrap().as_deref(),
            Some(source.as_slice())
        );
    }
    let deleted = save_workspace_file(&space.0, "deleted.md", b"kept", Some(b"previous")).unwrap();
    assert_eq!(deleted.status, WriteSheetStatus::ConflictCopy);
    assert_eq!(read_workspace_file(&space.0, "deleted.md").unwrap(), None);
}

#[test]
fn concurrent_creators_cannot_replace_one_anothers_files() {
    let space = Space::new();
    let threads: Vec<_> = [b"one".as_slice(), b"two".as_slice()]
        .into_iter()
        .map(|bytes| {
            let root = space.0.clone();
            std::thread::spawn(move || create_workspace_file(root, "note.md", bytes).unwrap())
        })
        .collect();
    let outcomes: Vec<_> = threads
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(outcomes.iter().filter(|created| **created).count(), 1);
    assert!([b"one".to_vec(), b"two".to_vec()]
        .contains(&read_workspace_file(&space.0, "note.md").unwrap().unwrap()));
}

#[test]
fn rename_move_and_trash_keep_bytes_and_refuse_stale_source_or_existing_destinations() {
    let space = Space::new();
    let bytes = b"\xef\xbb\xbfWords\r\n";
    create_workspace_file(&space.0, "note.md", bytes).unwrap();
    move_workspace_file(&space.0, "note.md", "renamed.md", bytes).unwrap();
    move_workspace_file(&space.0, "renamed.md", "Book/note.md", bytes).unwrap();
    assert_eq!(read_workspace_file(&space.0, "note.md").unwrap(), None);
    assert_eq!(
        read_workspace_file(&space.0, "Book/note.md")
            .unwrap()
            .as_deref(),
        Some(bytes.as_slice())
    );
    create_workspace_file(&space.0, "existing.md", b"external").unwrap();
    assert!(move_workspace_file(&space.0, "Book/note.md", "existing.md", bytes).is_err());
    assert!(move_workspace_file(&space.0, "Book/note.md", "wrong.md", b"stale").is_err());
    assert!(trash_workspace_file(&space.0, "Book/note.md", b"stale").is_err());
    let trashed = trash_workspace_file(&space.0, "Book/note.md", bytes).unwrap();
    assert!(trashed.starts_with(".slate/trash/"));
    assert_eq!(read_workspace_file(&space.0, "Book/note.md").unwrap(), None);
    assert_eq!(
        read_workspace_file(&space.0, &trashed).unwrap().as_deref(),
        Some(bytes.as_slice())
    );
    assert_eq!(
        read_workspace_file(&space.0, "existing.md").unwrap(),
        Some(b"external".to_vec())
    );
}

#[test]
fn invalid_portable_paths_are_rejected_before_creating_any_child() {
    let space = Space::new();
    for path in [
        "../escape.md",
        "/outside.md",
        "C:/outside.md",
        "a\\b.md",
        "a//b.md",
        "a/./b.md",
        "a/../b.md",
        "a/CON.md",
        "a/COM¹.txt",
        "a/LPT²",
        "a/trailing.",
        "a/trailing ",
        "a/name:stream",
        "a/a?b.md",
        "a/nul\0.md",
    ] {
        assert!(
            create_workspace_file(&space.0, path, b"bad").is_err(),
            "{path}"
        );
        assert!(read_workspace_file(&space.0, path).is_err(), "{path}");
        assert!(
            save_workspace_file(&space.0, path, b"bad", None).is_err(),
            "{path}"
        );
    }
    assert_eq!(fs::read_dir(&space.0).unwrap().count(), 0);
}

#[test]
fn interrupted_writes_are_visible_and_cannot_be_replaced_by_a_new_default() {
    let space = Space::new();
    fs::write(
        space.0.join(".note.md.slate-pending-123-1"),
        b"previous words",
    )
    .unwrap();
    fs::write(space.0.join(".note.md.slate-proposal-123-2"), b"new words").unwrap();
    fs::write(space.0.join(".my.slate-notes.md"), b"a real note").unwrap();
    assert_eq!(
        list_workspace_files(&space.0, false).unwrap(),
        vec![".my.slate-notes.md", "note.md"]
    );
    let error = read_workspace_file(&space.0, "note.md").unwrap_err();
    assert!(matches!(
        error,
        slate_core::StorageError::InterruptedWrite { .. }
    ));
    assert!(create_workspace_file(&space.0, "note.md", b"default").is_err());
    assert!(save_workspace_file(&space.0, "note.md", b"default", None).is_err());
    assert!(!space.0.join("note.md").exists());
    assert_eq!(
        fs::read(space.0.join(".note.md.slate-pending-123-1")).unwrap(),
        b"previous words"
    );
}

#[test]
fn read_only_files_are_kept_and_case_only_renames_preserve_bytes() {
    let space = Space::new();
    create_workspace_file(&space.0, "note.md", b"words").unwrap();
    move_workspace_file(&space.0, "note.md", "Note.md", b"words").unwrap();
    assert_eq!(
        list_workspace_files(&space.0, false).unwrap(),
        vec!["Note.md"]
    );
    let path = space.0.join("Note.md");
    let original = fs::metadata(&path).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&path, readonly).unwrap();
    let result = save_workspace_file(&space.0, "Note.md", b"replacement", Some(b"words"));
    fs::set_permissions(&path, original).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read(path).unwrap(), b"words");
}

#[cfg(unix)]
#[test]
fn symlinks_are_not_followed_by_reads_or_mutations() {
    use std::os::unix::fs::symlink;
    let space = Space::new();
    let outside = Space::new();
    fs::write(outside.0.join("note.md"), "external").unwrap();
    symlink(&outside.0, space.0.join("linked")).unwrap();
    symlink(outside.0.join("note.md"), space.0.join("note.md")).unwrap();
    for path in ["linked/note.md", "note.md"] {
        assert!(read_workspace_file(&space.0, path).is_err());
        assert!(save_workspace_file(&space.0, path, b"bad", None).is_err());
        assert!(create_workspace_file(&space.0, path, b"bad").is_err());
    }
    assert_eq!(fs::read(outside.0.join("note.md")).unwrap(), b"external");
    assert_eq!(
        list_workspace_files(&space.0, false).unwrap(),
        Vec::<String>::new()
    );
}

#[cfg(windows)]
#[test]
fn directory_junctions_cannot_redirect_workspace_operations() {
    use std::os::windows::process::CommandExt;
    let space = Space::new();
    let outside = Space::new();
    fs::write(outside.0.join("note.md"), b"external").unwrap();
    let junction = space.0.join("linked");
    assert_eq!(junction.parent(), Some(space.0.as_path()));
    let result = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:SLATE_TEST_JUNCTION -Target $env:SLATE_TEST_TARGET -ErrorAction Stop | Out-Null"])
        .env("SLATE_TEST_JUNCTION", &junction).env("SLATE_TEST_TARGET", &outside.0)
        .creation_flags(0x08000000).output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let read = read_workspace_file(&space.0, "linked/note.md");
    let create = create_workspace_file(&space.0, "linked/new.md", b"bad");
    let save = save_workspace_file(&space.0, "linked/note.md", b"bad", Some(b"external"));
    let list = list_workspace_files(&space.0, true);
    fs::remove_dir(&junction).unwrap();
    assert!(read.is_err());
    assert!(create.is_err());
    assert!(save.is_err());
    assert_eq!(list.unwrap(), Vec::<String>::new());
    assert_eq!(fs::read(outside.0.join("note.md")).unwrap(), b"external");
    assert!(!outside.0.join("new.md").exists());
}
