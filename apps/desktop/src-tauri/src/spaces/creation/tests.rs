use crate::spaces::{tests::Fixture, DEFAULT_ID};
use std::sync::Arc;

#[test]
fn new_documents_space_contains_exact_welcome_bytes_and_a_persistent_id() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    registry.remember(DEFAULT_ID).unwrap();
    let selection = std::fs::read(fixture.0.join("data/desktop-session.json")).unwrap();
    let documents = fixture.0.join("Documents");
    let welcome = "# Welcome\r\n\r\nবাংলা writing.\n";
    let created = registry
        .create_in_documents(&documents, "Personal", welcome)
        .unwrap();
    let path = std::fs::canonicalize(documents.join("Slate/Personal")).unwrap();
    assert_eq!(created.name, "Personal");
    assert_eq!(created.path.as_deref(), path.to_str());
    assert_ne!(created.id, DEFAULT_ID);
    assert_eq!(
        std::fs::read(path.join("Welcome.md")).unwrap(),
        welcome.as_bytes()
    );
    assert_eq!(std::fs::read_dir(&path).unwrap().count(), 1);
    assert_eq!(fixture.registry().resolve(Some(&created.id)).unwrap(), path);
    assert_eq!(
        std::fs::read(fixture.0.join("data/desktop-session.json")).unwrap(),
        selection
    );
    registry.remember(&created.id).unwrap();
    assert_eq!(
        fixture.registry().startup().unwrap().unwrap().id,
        created.id
    );
}

#[test]
fn an_existing_folder_is_never_reused_or_modified() {
    let fixture = Fixture::new();
    let documents = fixture.0.join("Documents");
    let path = documents.join("Slate/Personal");
    std::fs::create_dir_all(&path).unwrap();
    let kept = [0xef, 0xbb, 0xbf, 0xff, b'\r', b'\n'];
    std::fs::write(path.join("original.md"), kept).unwrap();
    let registry = fixture.registry();
    let error = registry
        .create_in_documents(&documents, "Personal", "New words")
        .err()
        .unwrap();
    assert!(error.to_string().contains("already exists"));
    assert_eq!(std::fs::read(path.join("original.md")).unwrap(), kept);
    assert_eq!(std::fs::read_dir(&path).unwrap().count(), 1);
    assert_eq!(registry.list().unwrap().len(), 1);
}

#[test]
fn unsafe_or_nonportable_names_fail_before_any_documents_writes() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let documents = fixture.0.join("Documents");
    for name in [
        "",
        " ",
        ".",
        "..",
        ".slate",
        "../outside",
        "a/b",
        "a\\b",
        "C:notes",
        " leading",
        "trailing ",
        "trailing.",
        "bad\nname",
        "NUL",
        "con.txt",
        "COM1",
        "LPT³",
        "a?b",
        "a|b",
        "a*b",
        "a<b",
        "a>b",
        "a\"b",
    ] {
        assert!(
            registry
                .create_in_documents(&documents, name, "Welcome")
                .is_err(),
            "{name:?}"
        );
    }
    for name in ["a".repeat(81), "বাংলা".repeat(20)] {
        assert!(registry
            .create_in_documents(&documents, &name, "Welcome")
            .is_err());
    }
    assert!(!documents.exists());
    assert!(!fixture.0.join("data/desktop-spaces.json").exists());
}

#[test]
fn unicode_names_are_preserved_without_trimming_or_rewriting() {
    let fixture = Fixture::new();
    let documents = fixture.0.join("Documents");
    let created = fixture
        .registry()
        .create_in_documents(&documents, "বাংলা Notes", "Welcome")
        .unwrap();
    assert_eq!(created.name, "বাংলা Notes");
    assert!(documents.join("Slate/বাংলা Notes/Welcome.md").is_file());
}

#[test]
fn invalid_welcome_or_catalog_does_not_create_a_partial_space() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let documents = fixture.0.join("Documents");
    for welcome in [String::new(), "a".repeat(65537)] {
        assert!(registry
            .create_in_documents(&documents, "Personal", &welcome)
            .is_err());
    }
    std::fs::write(
        fixture.0.join("data/desktop-spaces.json"),
        b"broken metadata",
    )
    .unwrap();
    assert!(registry
        .create_in_documents(&documents, "Personal", "Welcome")
        .is_err());
    assert!(!documents.exists());
    assert_eq!(
        std::fs::read(fixture.0.join("data/desktop-spaces.json")).unwrap(),
        b"broken metadata"
    );
}

#[test]
fn a_file_at_documents_slate_is_kept_and_application_data_is_not_a_documents_root() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    let documents = fixture.0.join("Documents");
    std::fs::create_dir(&documents).unwrap();
    std::fs::write(documents.join("Slate"), b"kept").unwrap();
    assert!(registry
        .create_in_documents(&documents, "Personal", "Welcome")
        .is_err());
    assert_eq!(std::fs::read(documents.join("Slate")).unwrap(), b"kept");
    assert!(registry
        .create_in_documents(&registry.data, "Personal", "Welcome")
        .is_err());
    assert!(!registry.data.join("Slate").exists());
}

#[test]
fn simultaneous_creation_of_the_same_name_has_one_winner_and_no_overwrite() {
    let fixture = Fixture::new();
    let registry = Arc::new(fixture.registry());
    let documents = fixture.0.join("Documents");
    let handles: Vec<_> = ["First welcome", "Second welcome"]
        .into_iter()
        .map(|welcome| {
            let registry = registry.clone();
            let documents = documents.clone();
            std::thread::spawn(move || {
                registry.create_in_documents(&documents, "Personal", welcome)
            })
        })
        .collect();
    let outcomes: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    let bytes = std::fs::read(documents.join("Slate/Personal/Welcome.md")).unwrap();
    assert!(bytes == b"First welcome" || bytes == b"Second welcome");
    assert_eq!(registry.list().unwrap().len(), 2);
}

#[test]
fn a_late_catalog_failure_keeps_the_new_folder_and_every_created_or_external_file() {
    let fixture = Fixture::new();
    let registry = fixture.registry();
    registry.remember(DEFAULT_ID).unwrap();
    let selection = std::fs::read(fixture.0.join("data/desktop-session.json")).unwrap();
    // Simulate the catalog becoming invalid after the directory was reserved.
    let path = fixture.0.join("Documents/Slate/Personal");
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("external.md"), [0xff, b'\r', b'\n']).unwrap();
    std::fs::write(
        fixture.0.join("data/desktop-spaces.json"),
        b"changed externally",
    )
    .unwrap();
    let error = registry
        .finish_creation(&path, "Exact welcome\r\n")
        .err()
        .unwrap()
        .to_string();
    assert!(error.contains(&path.display().to_string()));
    assert!(error.contains("Use Open a folder to recover"));
    assert_eq!(
        std::fs::read(path.join("Welcome.md")).unwrap(),
        b"Exact welcome\r\n"
    );
    assert_eq!(
        std::fs::read(path.join("external.md")).unwrap(),
        [0xff, b'\r', b'\n']
    );
    assert_eq!(
        std::fs::read(fixture.0.join("data/desktop-spaces.json")).unwrap(),
        b"changed externally"
    );
    assert_eq!(
        std::fs::read(fixture.0.join("data/desktop-session.json")).unwrap(),
        selection
    );
}

#[cfg(unix)]
#[test]
fn a_redirected_slate_directory_cannot_create_files_outside_documents() {
    let fixture = Fixture::new();
    let documents = fixture.0.join("Documents");
    std::fs::create_dir(&documents).unwrap();
    std::os::unix::fs::symlink(fixture.0.join("other"), documents.join("Slate")).unwrap();
    assert!(fixture
        .registry()
        .create_in_documents(&documents, "Personal", "Welcome")
        .is_err());
    assert_eq!(
        std::fs::read_dir(fixture.0.join("other")).unwrap().count(),
        0
    );
}
