use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("slate-capture-{}", uuid::Uuid::new_v4()));
        for dir in ["data", "notes", "other"] {
            std::fs::create_dir_all(path.join(dir)).unwrap();
        }
        Self(path)
    }
    fn spaces(&self) -> NativeSpaces {
        NativeSpaces::new(self.0.join("data")).unwrap()
    }
    fn store(&self) -> Store {
        Store::new(self.0.join("data"))
    }
    fn draft(&self, store: &Store) -> DraftView {
        store.snapshot().unwrap().active_draft.unwrap()
    }
    fn state(&self) -> Vec<u8> {
        std::fs::read(self.0.join("data").join(STATE)).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("slate-capture-"));
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn skeleton_and_words_survive_restart_without_creating_an_inbox_note() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let space = spaces.register(&fixture.0.join("notes")).unwrap();
    let store = fixture.store();
    store.prepare(&spaces, Some(&space.id)).unwrap();
    let draft = fixture.draft(&store);
    assert!(draft.text.is_empty());
    store.stash(&draft.id, "retained\r\nবাংলা", false, 1).unwrap();
    let reopened = fixture.store();
    reopened.prepare(&fixture.spaces(), None).unwrap();
    let restored = fixture.draft(&reopened);
    assert_eq!(restored.id, draft.id);
    assert_eq!(restored.space_id, space.id);
    assert_eq!(restored.text, "retained\r\nবাংলা");
    assert!(!fixture.0.join("notes/Inbox").exists());
}

#[test]
fn main_space_switch_never_retargets_a_retained_capture() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let first = spaces.register(&fixture.0.join("notes")).unwrap();
    let other = spaces.register(&fixture.0.join("other")).unwrap();
    let mut store = fixture.store();
    store.active_space = first.id.clone();
    store.prepare(&spaces, None).unwrap();
    let draft = fixture.draft(&store);
    store
        .stash(&draft.id, "First Space only", false, 1)
        .unwrap();
    store.active_space = other.id.clone();
    store.prepare(&spaces, Some(&other.id)).unwrap();
    let done = store
        .save(&spaces, &draft.id, "First Space only", 2)
        .unwrap();
    assert_eq!(done.space_id, first.id);
    assert_eq!(
        std::fs::read(fixture.0.join("notes/Inbox/Capture.md")).unwrap(),
        b"First Space only\n"
    );
    assert!(!fixture.0.join("other/Inbox").exists());
    store.prepare(&spaces, None).unwrap();
    assert_eq!(fixture.draft(&store).space_id, other.id);
}

#[test]
fn failed_completion_after_note_publication_is_idempotent_across_restart() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let first = spaces.register(&fixture.0.join("notes")).unwrap();
    let store = fixture.store();
    store.prepare(&spaces, Some(&first.id)).unwrap();
    let draft = fixture.draft(&store);
    assert!(store
        .save_with(&spaces, &draft.id, "once", 1, || Err(FileError::io(
            "lost before receipt"
        )))
        .is_err());
    assert!(fixture.draft(&store).pending);
    let reopened = fixture.store();
    let done = reopened
        .save(&fixture.spaces(), &draft.id, "once", 1)
        .unwrap();
    assert_eq!(done.id, draft.id);
    assert!(reopened.snapshot().unwrap().active_draft.is_none());
    reopened.save(&spaces, &draft.id, "once", 1).unwrap();
    assert_eq!(
        std::fs::read(fixture.0.join("notes/Inbox/Capture.md")).unwrap(),
        b"once\n"
    );
}

#[test]
fn restarted_catalog_cannot_redirect_a_capture_to_another_root() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let first = spaces.register(&fixture.0.join("notes")).unwrap();
    let store = fixture.store();
    store.prepare(&spaces, Some(&first.id)).unwrap();
    let draft = fixture.draft(&store);
    let catalog = fixture.0.join("data/desktop-spaces.json");
    let mut state: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&catalog).unwrap()).unwrap();
    state["folders"][0]["path"] =
        serde_json::json!(std::fs::canonicalize(fixture.0.join("other")).unwrap());
    std::fs::write(catalog, serde_json::to_vec(&state).unwrap()).unwrap();
    assert!(fixture
        .store()
        .save(&fixture.spaces(), &draft.id, "kept", 1)
        .is_err());
    assert_eq!(fixture.draft(&fixture.store()).text, "kept");
    assert!(!fixture.0.join("other/Inbox").exists());
    assert!(!fixture.0.join("notes/Inbox").exists());
}

#[test]
fn disconnected_selected_root_is_not_recreated_or_replaced_by_default() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let first = spaces.register(&fixture.0.join("notes")).unwrap();
    let store = fixture.store();
    store.prepare(&spaces, Some(&first.id)).unwrap();
    let draft = fixture.draft(&store);
    std::fs::rename(fixture.0.join("notes"), fixture.0.join("moved")).unwrap();
    assert!(store.save(&spaces, &draft.id, "pending", 1).is_err());
    assert!(!fixture.0.join("notes").exists());
    assert!(!fixture.0.join("data/spaces/default").exists());
    assert!(fixture.draft(&store).pending);
    std::fs::rename(fixture.0.join("moved"), fixture.0.join("notes")).unwrap();
    store.save(&spaces, &draft.id, "pending", 1).unwrap();
}

#[test]
fn unknown_metadata_and_external_changes_are_preserved() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let path = fixture.0.join("data").join(STATE);
    for bytes in [
        b"{corrupt".as_slice(),
        b"{\"version\":99,\"activeDraft\":null,\"lastCompleted\":null}",
        b"{\"version\":1,\"activeDraft\":null,\"lastCompleted\":null,\"future\":true}",
    ] {
        std::fs::write(&path, bytes).unwrap();
        assert!(store.snapshot().is_err());
        assert!(store.prepare(&fixture.spaces(), None).is_err());
        assert_eq!(fixture.state(), bytes);
    }
    let original = b"{\"version\":1,\"activeDraft\":null,\"lastCompleted\":null}";
    std::fs::write(&path, original).unwrap();
    let (state, base) = store.read().unwrap();
    std::fs::write(&path, b"future external words").unwrap();
    assert!(store.write(&state, base.as_deref()).is_err());
    assert_eq!(fixture.state(), b"future external words");
}

#[test]
fn pending_payload_is_immutable_and_late_stash_cannot_resurrect_saved_words() {
    let fixture = Fixture::new();
    let store = fixture.store();
    let spaces = fixture.spaces();
    store.prepare(&spaces, None).unwrap();
    let draft = fixture.draft(&store);
    store.stash(&draft.id, "same", true, 1).unwrap();
    let before = fixture.state();
    assert!(store.stash(&draft.id, "different", true, 2).is_err());
    assert!(store.stash(&draft.id, "same", false, 2).is_err());
    assert!(store.save(&spaces, &draft.id, "different", 2).is_err());
    assert_eq!(fixture.state(), before);
    store.save(&spaces, &draft.id, "same", 1).unwrap();
    store.prepare(&spaces, None).unwrap();
    let next = fixture.draft(&store);
    store.stash(&draft.id, "same", true, 1).unwrap();
    assert_eq!(fixture.draft(&store).id, next.id);
    assert_ne!(next.id, draft.id);
    store.save(&spaces, &next.id, "same", 1).unwrap();
    assert_eq!(
        std::fs::read(fixture.0.join("data/spaces/default/Inbox/Capture.md")).unwrap(),
        b"same\n\nsame\n"
    );
}

#[test]
fn old_renderer_revisions_cannot_replace_a_newer_durable_draft_after_restart() {
    let fixture = Fixture::new();
    let store = fixture.store();
    store.prepare(&fixture.spaces(), None).unwrap();
    let draft = fixture.draft(&store);
    store
        .stash(&draft.id, "latest durable words", false, 2)
        .unwrap();
    let reopened = fixture.store();
    let before = fixture.state();
    assert!(reopened.stash(&draft.id, "older words", false, 1).is_err());
    assert!(reopened
        .stash(&draft.id, "different words", false, 2)
        .is_err());
    assert!(reopened
        .save(&fixture.spaces(), &draft.id, "older words", 1)
        .is_err());
    assert_eq!(fixture.state(), before);
    assert_eq!(fixture.draft(&reopened).revision, 2);
    assert_eq!(fixture.draft(&reopened).text, "latest durable words");
    reopened
        .save(&fixture.spaces(), &draft.id, "latest durable words", 3)
        .unwrap();
}
