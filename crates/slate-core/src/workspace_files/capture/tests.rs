use super::*;
use std::path::PathBuf;

const ID: &str = "12345678-1234-4321-9876-123456789abc";
const SECOND: &str = "22345678-1234-4321-9876-123456789abc";

struct Space(PathBuf);
impl Space {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("slate-capture-{}", super::super::next_id()));
        fs::create_dir_all(path.join("Inbox")).unwrap();
        Self(path)
    }
    fn note(&self) -> Vec<u8> {
        fs::read(self.0.join(CAPTURE)).unwrap()
    }
    fn journal(&self) -> PathBuf {
        self.0.join(format!(".slate/captures/{ID}.json"))
    }
    fn interrupted(
        &self,
        text: &str,
        mut action: impl FnMut(Checkpoint) -> Result<(), StorageError>,
    ) -> Result<WriteSheetOutcome, StorageError> {
        let _guard = FILE_IO
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        append_inner(&self.0, ID, text, &mut action)
    }
}
impl Drop for Space {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("slate-capture-"));
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn retries_one_capture_without_reappending_and_compacts_its_receipt() {
    let space = Space::new();
    let first = append_capture(&space.0, ID, "বাংলা thought").unwrap();
    assert_eq!(first.status, WriteSheetStatus::Written);
    assert_eq!(space.note(), "বাংলা thought\n".as_bytes());
    assert_eq!(append_capture(&space.0, ID, "বাংলা thought").unwrap(), first);
    assert_eq!(space.note(), "বাংলা thought\n".as_bytes());
    let journal: serde_json::Value =
        serde_json::from_slice(&fs::read(space.journal()).unwrap()).unwrap();
    assert_eq!(journal["phase"], "done");
    assert!(journal.get("base").is_none());
}

#[test]
fn different_ids_keep_repeated_thoughts_as_distinct_appends() {
    let space = Space::new();
    append_capture(&space.0, ID, "Same words.").unwrap();
    append_capture(&space.0, SECOND, "Same words.").unwrap();
    assert_eq!(space.note(), b"Same words.\n\nSame words.\n");
    assert!(append_capture(&space.0, ID, "Changed text").is_err());
    assert_eq!(space.note(), b"Same words.\n\nSame words.\n");
}

#[test]
fn retains_bom_existing_bytes_and_physical_line_endings() {
    for eol in ["\n", "\r\n", "\r"] {
        for ending in [0, 1, 2, 4] {
            let space = Space::new();
            let before = format!("\u{feff}# Original{eol}{eol}Words.{}", eol.repeat(ending));
            fs::write(space.0.join(CAPTURE), before.as_bytes()).unwrap();
            append_capture(&space.0, ID, "Next\nবাংলা\r\nthought\rlast").unwrap();
            let separator = eol.repeat(2usize.saturating_sub(ending));
            let after = format!("{before}{separator}Next{eol}বাংলা{eol}thought{eol}last{eol}");
            assert_eq!(space.note(), after.as_bytes());
            assert!(space.note().starts_with(before.as_bytes()));
        }
    }
}

#[test]
fn resumes_an_intent_that_stopped_before_publication() {
    let space = Space::new();
    fs::write(space.0.join(CAPTURE), b"Original.").unwrap();
    assert!(space
        .interrupted("Next", |stage| if stage == Checkpoint::Prepared {
            Err(error("interrupted"))
        } else {
            Ok(())
        })
        .is_err());
    assert_eq!(space.note(), b"Original.");
    append_capture(&space.0, ID, "Next").unwrap();
    assert_eq!(space.note(), b"Original.\n\nNext\n");
}

#[test]
fn recognizes_a_published_prefix_after_a_lost_reply_and_later_append() {
    let space = Space::new();
    assert!(space
        .interrupted("Keep once", |stage| if stage == Checkpoint::Published {
            Err(error("lost reply"))
        } else {
            Ok(())
        })
        .is_err());
    fs::write(
        space.0.join(CAPTURE),
        b"Keep once\n\nLater external words.\n",
    )
    .unwrap();
    append_capture(&space.0, ID, "Keep once").unwrap();
    assert_eq!(space.note(), b"Keep once\n\nLater external words.\n");
}

#[test]
fn retains_concurrent_writing_and_retries_the_same_named_conflict_copy() {
    let space = Space::new();
    fs::write(space.0.join(CAPTURE), b"Original").unwrap();
    assert!(space
        .interrupted("Captured", |stage| {
            if stage == Checkpoint::Prepared {
                fs::write(space.0.join(CAPTURE), b"External words").unwrap();
            }
            if stage == Checkpoint::Published {
                return Err(error("lost reply"));
            }
            Ok(())
        })
        .is_err());
    let saved = append_capture(&space.0, ID, "Captured").unwrap();
    assert_eq!(saved.status, WriteSheetStatus::ConflictCopy);
    assert_eq!(saved.path, format!("Inbox/Capture (capture {ID}).md"));
    assert_eq!(space.note(), b"External words");
    assert_eq!(
        fs::read(space.0.join(&saved.path)).unwrap(),
        b"Original\n\nCaptured\n"
    );
    assert_eq!(append_capture(&space.0, ID, "Captured").unwrap(), saved);
}

#[test]
fn a_new_intent_does_not_claim_an_identical_external_append_as_its_own() {
    let space = Space::new();
    let saved = space
        .interrupted("Same", |stage| {
            if stage == Checkpoint::Prepared {
                fs::write(space.0.join(CAPTURE), b"Same\n").unwrap();
            }
            Ok(())
        })
        .unwrap();
    assert_eq!(saved.status, WriteSheetStatus::ConflictCopy);
    assert_eq!(space.note(), b"Same\n");
    assert_eq!(fs::read(space.0.join(saved.path)).unwrap(), b"Same\n");
}

#[test]
fn changed_recovery_copies_and_future_journals_are_never_overwritten() {
    let space = Space::new();
    fs::write(space.0.join(CAPTURE), b"Base").unwrap();
    assert!(space
        .interrupted("Capture", |stage| {
            if stage == Checkpoint::Prepared {
                fs::write(space.0.join(CAPTURE), b"External").unwrap();
            }
            if stage == Checkpoint::Published {
                return Err(error("interrupted"));
            }
            Ok(())
        })
        .is_err());
    let copy = space.0.join(format!("Inbox/Capture (capture {ID}).md"));
    fs::write(&copy, b"User changed recovery copy").unwrap();
    assert!(append_capture(&space.0, ID, "Capture").is_err());
    assert_eq!(fs::read(&copy).unwrap(), b"User changed recovery copy");
    assert_eq!(space.note(), b"External");
    let future =
        br#"{"phase":"prepared","version":2,"text":"Future words","base":null,"future":true}"#;
    fs::write(space.journal(), future).unwrap();
    assert!(append_capture(&space.0, ID, "Capture").is_err());
    assert_eq!(fs::read(space.journal()).unwrap(), future);
}

#[test]
fn unsupported_note_bytes_and_invalid_inputs_do_not_change_notes() {
    let space = Space::new();
    fs::write(space.0.join(CAPTURE), [0xff, 0xfe, 65, 0]).unwrap();
    assert!(append_capture(&space.0, ID, "Kept draft").is_err());
    assert_eq!(space.note(), [0xff, 0xfe, 65, 0]);
    assert!(!space.journal().exists());
    for id in ["../escape", "12345678-1234-4321-9876-123456789abC", ""] {
        assert!(append_capture(&space.0, id, "Kept").is_err());
    }
    for text in ["".to_owned(), " \t\n".to_owned(), "X".repeat(MAX_TEXT + 1)] {
        assert!(append_capture(&space.0, ID, &text).is_err());
    }
}

#[test]
fn a_read_only_note_keeps_the_intent_and_can_be_retried_after_access_returns() {
    let space = Space::new();
    let path = space.0.join(CAPTURE);
    fs::write(&path, b"Original.").unwrap();
    let original = fs::metadata(&path).unwrap().permissions();
    let mut locked = original.clone();
    locked.set_readonly(true);
    fs::set_permissions(&path, locked).unwrap();
    let result = append_capture(&space.0, ID, "Kept draft");
    fs::set_permissions(&path, original).unwrap();
    assert!(result.is_err());
    assert_eq!(space.note(), b"Original.");
    assert!(space.journal().exists());
    append_capture(&space.0, ID, "Kept draft").unwrap();
    assert_eq!(space.note(), b"Original.\n\nKept draft\n");
}

#[test]
fn a_failed_receipt_write_never_reappends_the_already_published_capture() {
    let space = Space::new();
    let mut original = None;
    let result = space.interrupted("Keep once", |stage| {
        if stage == Checkpoint::Published {
            let permissions = fs::metadata(space.journal()).unwrap().permissions();
            let mut locked = permissions.clone();
            locked.set_readonly(true);
            fs::set_permissions(space.journal(), locked).unwrap();
            original = Some(permissions);
        }
        Ok(())
    });
    fs::set_permissions(space.journal(), original.unwrap()).unwrap();
    assert!(result.is_err());
    assert_eq!(space.note(), b"Keep once\n");
    append_capture(&space.0, ID, "Keep once").unwrap();
    assert_eq!(space.note(), b"Keep once\n");
}

#[cfg(unix)]
#[test]
fn rejects_an_inbox_symlink_without_touching_the_other_space() {
    let space = Space::new();
    let other = Space::new();
    fs::remove_dir(space.0.join("Inbox")).unwrap();
    std::os::unix::fs::symlink(other.0.join("Inbox"), space.0.join("Inbox")).unwrap();
    assert!(append_capture(&space.0, ID, "Kept draft").is_err());
    assert!(!other.0.join(CAPTURE).exists());
}
