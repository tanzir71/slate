use super::*;

#[test]
fn native_cli_accepts_absolute_markdown_batches_and_encoded_file_urls_without_guessing_roots() {
    let first = std::env::temp_dir().join("বাংলা # 100%.MD");
    let second = std::env::temp_dir().join("second.md");
    let url = Url::from_file_path(&first).unwrap().to_string();
    assert_eq!(
        cli_files(&[
            "slate".into(),
            first.clone().into_os_string(),
            second.clone().into_os_string()
        ]),
        [first.clone(), second]
    );
    assert_eq!(
        cli_files(&["slate".into(), url.into()]).as_slice(),
        std::slice::from_ref(&first)
    );
    for args in [
        vec!["slate".into()],
        vec!["slate".into(), "relative.md".into()],
        vec!["slate".into(), "--flag".into(), first.into_os_string()],
        vec!["slate".into(), "slate://open?path=note.md".into()],
    ] {
        assert!(cli_files(&args).is_empty());
    }
}

#[test]
fn urls_and_files_share_one_fifo_and_only_native_file_requests_can_admit_folders() {
    let path = std::env::temp_dir().join("associated.md");
    let mut inbox = Inbox::default();
    inbox.push("slate", "slate://new?text=keep".parse().unwrap());
    let uri = inbox.current.clone().unwrap();
    assert!(inbox.push_file(path.clone()));
    assert!(inbox.file_input(&uri.id).is_err());
    assert_eq!(inbox.waiting.len(), 1);
    assert_eq!(inbox.current.as_ref().unwrap().url, uri.url);
    inbox.complete(&uri.id).unwrap();
    inbox.next().unwrap();
    let request = inbox.current.clone().unwrap();
    assert_eq!(request.file_name.as_deref(), Some("associated.md"));
    assert!(inbox.bind(&request.id, "native-default").is_err());
    let serialized = serde_json::to_value(inbox.snapshot()).unwrap();
    assert!(serialized["current"].get("file").is_none());
    assert!(serialized["current"].get("root").is_none());
    assert!(inbox.push_file(path));
    assert_ne!(inbox.waiting[0].id, request.id);
    assert!(inbox.file_input(&inbox.waiting[0].id).is_err());
}

#[test]
fn a_bound_file_retries_the_same_admitted_root_and_rejects_a_disconnected_folder() {
    let path = std::env::temp_dir().join(format!("slate-file-launch-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(path.join("notes")).unwrap();
    let file = path.join("notes/ actual # note.md");
    std::fs::write(&file, b"\xef\xbb\xbforiginal\r\n").unwrap();
    let spaces = NativeSpaces::new(path.join("data")).unwrap();
    let mut inbox = Inbox::default();
    inbox.push_file(file.clone());
    let id = inbox.current.as_ref().unwrap().id.clone();
    let first = target(&spaces, inbox.file_input(&id).unwrap()).unwrap();
    let prepared = inbox
        .bind_file(&id, first.clone(), "slate-preview")
        .unwrap();
    let url = Url::parse(&prepared.url).unwrap();
    assert_eq!(url.scheme(), "slate-preview");
    assert_eq!(
        url.query_pairs().find(|(key, _)| key == "path").unwrap().1,
        " actual # note.md"
    );
    assert_eq!(prepared.path, " actual # note.md");
    assert_eq!(serde_json::to_value(&prepared).unwrap()["path"], prepared.path);
    let revision = inbox.revision;
    let again = target(&spaces, inbox.file_input(&id).unwrap()).unwrap();
    assert_eq!(
        inbox.bind_file(&id, again, "slate-preview").unwrap().url,
        prepared.url
    );
    assert_eq!(inbox.revision, revision);
    std::fs::rename(path.join("notes"), path.join("moved")).unwrap();
    assert!(target(&spaces, inbox.file_input(&id).unwrap()).is_err());
    assert!(!path.join("notes").exists());
    assert!(!path.join("data/spaces/default").exists());
    assert_eq!(
        std::fs::read(path.join("moved/ actual # note.md")).unwrap(),
        b"\xef\xbb\xbforiginal\r\n"
    );
    assert_eq!(path.parent(), Some(std::env::temp_dir().as_path()));
    assert!(path
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("slate-file-launch-"));
    std::fs::remove_dir_all(path).unwrap();
}
