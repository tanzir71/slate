use slate_core::write_numbered_asset_to_space;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Barrier};
use std::time::{SystemTime, UNIX_EPOCH};

struct Space(PathBuf);
impl Space {
    fn new() -> Self {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("slate-asset-test-{}-{stamp}", std::process::id()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Space {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn keeps_numbered_assets_and_uses_the_first_free_name() {
    let space = Space::new();
    let directory = space.0.join("Drafts/assets");
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("photo-1.png"), b"original").unwrap();
    fs::write(directory.join("photo-3.png"), []).unwrap();
    let saved =
        write_numbered_asset_to_space(&space.0, "Drafts/assets/photo.png", &[0, 255, 12]).unwrap();
    assert_eq!(saved, "Drafts/assets/photo-2.png");
    assert_eq!(
        fs::read(directory.join("photo-2.png")).unwrap(),
        [0, 255, 12]
    );
    assert_eq!(
        fs::read(directory.join("photo-1.png")).unwrap(),
        b"original"
    );
    assert_eq!(
        write_numbered_asset_to_space(&space.0, "Drafts/assets/photo.png", b"next").unwrap(),
        "Drafts/assets/photo-4.png"
    );
    assert!(fs::read(directory.join("photo-3.png")).unwrap().is_empty());
}

#[test]
fn concurrent_writers_reserve_distinct_files_without_losing_bytes() {
    let space = Space::new();
    let barrier = Arc::new(Barrier::new(8));
    let threads: Vec<_> = (0_u8..8)
        .map(|byte| {
            let root = space.0.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                (
                    write_numbered_asset_to_space(&root, "assets/image.png", &[byte; 100]).unwrap(),
                    byte,
                )
            })
        })
        .collect();
    let mut names = std::collections::HashSet::new();
    for thread in threads {
        let (name, byte) = thread.join().unwrap();
        assert!(names.insert(name.clone()));
        assert_eq!(fs::read(space.0.join(name)).unwrap(), vec![byte; 100]);
    }
}

#[test]
fn rejects_unsafe_or_non_png_paths_before_creating_directories() {
    let space = Space::new();
    for path in [
        "../out.png",
        "/out.png",
        "C:/out.png",
        "Drafts/../out.png",
        "Drafts\\out.png",
        "assets//out.png",
        "assets/.png",
        "assets/out.png:stream",
        "assets/out.jpg",
        "assets/new\nline.png",
        "assets/tab\tname.png",
        "",
    ] {
        assert!(
            write_numbered_asset_to_space(&space.0, path, b"pixels").is_err(),
            "{path}"
        );
    }
    assert_eq!(fs::read_dir(&space.0).unwrap().count(), 0);
}

#[test]
fn reports_parent_io_errors_without_changing_existing_bytes() {
    let space = Space::new();
    fs::write(space.0.join("assets"), b"keep").unwrap();
    assert!(write_numbered_asset_to_space(&space.0, "assets/image.png", b"incoming").is_err());
    assert_eq!(fs::read(space.0.join("assets")).unwrap(), b"keep");
}

#[cfg(unix)]
#[test]
fn refuses_symlink_parents_and_preserves_symlink_leaf_targets() {
    use std::os::unix::fs::symlink;
    let space = Space::new();
    let outside = Space::new();
    symlink(&outside.0, space.0.join("assets")).unwrap();
    assert!(write_numbered_asset_to_space(&space.0, "assets/image.png", b"incoming").is_err());
    assert_eq!(fs::read_dir(&outside.0).unwrap().count(), 0);
    fs::remove_file(space.0.join("assets")).unwrap();
    fs::create_dir(space.0.join("assets")).unwrap();
    fs::write(outside.0.join("original.png"), b"keep").unwrap();
    symlink(
        outside.0.join("original.png"),
        space.0.join("assets/image-1.png"),
    )
    .unwrap();
    assert_eq!(
        write_numbered_asset_to_space(&space.0, "assets/image.png", b"incoming").unwrap(),
        "assets/image-2.png"
    );
    assert_eq!(fs::read(outside.0.join("original.png")).unwrap(), b"keep");
}
