use super::*;
use std::path::PathBuf;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("slate-native-selection-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(path.join("notes")).unwrap();
        Self(path)
    }
    fn spaces(&self) -> NativeSpaces {
        NativeSpaces::new(self.0.join("data")).unwrap()
    }
    fn session(&self) -> PathBuf {
        self.0.join("data").join(SESSION_PATH)
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
            .starts_with("slate-native-selection-"));
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
#[test]
fn the_last_successfully_opened_space_survives_restart_without_changing_note_bytes() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    assert!(spaces.startup().unwrap().is_none());
    let note = fixture.0.join("notes/exact.md");
    std::fs::write(&note, b"\xef\xbb\xbforiginal\r\n").unwrap();
    let folder = spaces.register(&fixture.0.join("notes")).unwrap();
    spaces.remember(&folder.id).unwrap();
    let saved = std::fs::read(fixture.session()).unwrap();
    assert_eq!(fixture.spaces().startup().unwrap().unwrap().id, folder.id);
    spaces.remember(&folder.id).unwrap();
    assert_eq!(std::fs::read(fixture.session()).unwrap(), saved);
    assert_eq!(std::fs::read(note).unwrap(), b"\xef\xbb\xbforiginal\r\n");
    assert!(!fixture.0.join("data/spaces/default").exists());
}
#[test]
fn a_disconnected_last_folder_does_not_become_an_empty_default_or_retarget_a_choice() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let folder = spaces.register(&fixture.0.join("notes")).unwrap();
    spaces.remember(&folder.id).unwrap();
    let saved = std::fs::read(fixture.session()).unwrap();
    std::fs::rename(fixture.0.join("notes"), fixture.0.join("moved")).unwrap();
    assert!(fixture.spaces().startup().is_err());
    assert!(spaces.remember(&folder.id).is_err());
    assert_eq!(std::fs::read(fixture.session()).unwrap(), saved);
    assert!(!fixture.0.join("notes").exists());
    assert!(!fixture.0.join("data/spaces/default").exists());
    spaces.remember(DEFAULT_ID).unwrap();
    assert_eq!(fixture.spaces().startup().unwrap().unwrap().id, DEFAULT_ID);
    assert!(fixture.0.join("moved").exists());
}
#[test]
fn malformed_or_unknown_saved_choices_are_kept_until_an_explicit_valid_selection() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    for bytes in [
        b"{broken\xff".as_slice(),
        b"{\"version\":2,\"spaceId\":\"native-default\"}",
        b"{\"version\":1,\"spaceId\":\"../outside\"}",
        b"{\"version\":1,\"spaceId\":\"12345678-1234-4321-9876-123456789abc\"}",
    ] {
        std::fs::write(fixture.session(), bytes).unwrap();
        assert!(spaces.startup().is_err());
        assert_eq!(std::fs::read(fixture.session()).unwrap(), bytes);
        assert!(spaces.remember("../outside").is_err());
        assert_eq!(std::fs::read(fixture.session()).unwrap(), bytes);
    }
    spaces.remember(DEFAULT_ID).unwrap();
    assert_eq!(spaces.startup().unwrap().unwrap().id, DEFAULT_ID);
}
#[test]
fn invalid_catalogs_and_failed_metadata_io_do_not_change_the_previous_selection() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let folder = spaces.register(&fixture.0.join("notes")).unwrap();
    spaces.remember(&folder.id).unwrap();
    let saved = std::fs::read(fixture.session()).unwrap();
    std::fs::write(fixture.0.join("data/desktop-spaces.json"), b"{invalid").unwrap();
    assert!(spaces.startup().is_err());
    assert!(spaces.remember(&folder.id).is_err());
    assert_eq!(std::fs::read(fixture.session()).unwrap(), saved);
    std::fs::remove_file(fixture.session()).unwrap();
    std::fs::create_dir(fixture.session()).unwrap();
    assert!(spaces.remember(DEFAULT_ID).is_err());
    assert!(fixture.0.join("notes").is_dir());
}
