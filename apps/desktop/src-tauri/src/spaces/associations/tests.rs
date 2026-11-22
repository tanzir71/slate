use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("slate-associations-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(path.join("notes/Notebook")).unwrap();
        Self(path)
    }
    fn spaces(&self) -> NativeSpaces {
        NativeSpaces::new(self.0.join("data")).unwrap()
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
            .starts_with("slate-associations-"));
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn an_os_file_admits_only_its_parent_and_preserves_all_original_bytes() {
    let fixture = Fixture::new();
    let file = fixture.0.join("notes/Notebook/ বাংলা # 100%.MD");
    let bytes = [0xef, 0xbb, 0xbf, 0xff, 0x0d, 0x0a];
    std::fs::write(&file, bytes).unwrap();
    let spaces = fixture.spaces();
    let opened = spaces.associate_file(&file).unwrap();
    assert_eq!(opened.path, " বাংলা # 100%.MD");
    assert_eq!(
        opened.root,
        std::fs::canonicalize(file.parent().unwrap()).unwrap()
    );
    assert_eq!(spaces.list().unwrap().len(), 2);
    assert_eq!(
        fixture.spaces().associate_file(&file).unwrap().space.id,
        opened.space.id
    );
    assert_eq!(std::fs::read(file).unwrap(), bytes);
    assert_eq!(std::fs::read_dir(&opened.root).unwrap().count(), 1);
}

#[test]
fn existing_spaces_keep_notebook_paths_and_the_most_specific_scope_wins() {
    let fixture = Fixture::new();
    let file = fixture.0.join("notes/Notebook/note.md");
    std::fs::write(&file, "kept").unwrap();
    let spaces = fixture.spaces();
    let parent = spaces.register(&fixture.0.join("notes")).unwrap();
    let opened = spaces.associate_file(&file).unwrap();
    assert_eq!(opened.space.id, parent.id);
    assert_eq!(opened.path, "Notebook/note.md");
    let specific = spaces.register(&fixture.0.join("notes/Notebook")).unwrap();
    assert_eq!(spaces.associate_file(&file).unwrap().space.id, specific.id);
    assert_eq!(spaces.list().unwrap().len(), 3);
}

#[test]
fn default_files_reuse_default_and_private_or_invalid_inputs_never_create_a_space() {
    let fixture = Fixture::new();
    let spaces = fixture.spaces();
    let root = spaces.resolve(None).unwrap();
    std::fs::create_dir_all(root.join(".slate/templates")).unwrap();
    let note = root.join("default.md");
    std::fs::write(&note, "default").unwrap();
    assert_eq!(spaces.associate_file(&note).unwrap().space.id, DEFAULT_ID);
    let private = root.join(".slate/templates/note.md");
    std::fs::write(&private, "template").unwrap();
    assert!(spaces.associate_file(&private).is_err());
    assert!(spaces.associate_file(Path::new("relative.md")).is_err());
    assert!(spaces.associate_file(&fixture.0.join("absent.md")).is_err());
    std::fs::create_dir(fixture.0.join("directory.md")).unwrap();
    assert!(spaces
        .associate_file(&fixture.0.join("directory.md"))
        .is_err());
    assert_eq!(spaces.list().unwrap().len(), 1);
    assert_eq!(std::fs::read_to_string(private).unwrap(), "template");
}

#[test]
fn a_corrupt_catalog_is_kept_without_admitting_a_fallback() {
    let fixture = Fixture::new();
    let file = fixture.0.join("notes/Notebook/note.md");
    std::fs::write(&file, "original").unwrap();
    let spaces = fixture.spaces();
    spaces.register(&fixture.0.join("notes")).unwrap();
    let catalog = fixture.0.join("data/desktop-spaces.json");
    std::fs::write(&catalog, b"{broken\xff").unwrap();
    assert!(spaces.associate_file(&file).is_err());
    assert_eq!(std::fs::read(&catalog).unwrap(), b"{broken\xff");
    assert_eq!(std::fs::read_to_string(file).unwrap(), "original");
}
