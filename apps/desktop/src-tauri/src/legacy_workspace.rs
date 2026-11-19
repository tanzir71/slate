use crate::workspace::{self, FileError, SaveResponse, Scope};
use slate_core::StorageError;
use std::path::Path;

fn markdown_path(path: &str) -> Result<(), FileError> {
    if path.to_ascii_lowercase().ends_with(".md") {
        Ok(())
    } else {
        Err(StorageError::InvalidSheetPath.into())
    }
}

fn read_markdown_at(root: &Path, path: &str) -> Result<String, FileError> {
    markdown_path(path)?;
    let bytes = slate_core::read_workspace_file(root, path)?
        .ok_or_else(|| FileError::io("The Markdown file no longer exists"))?;
    String::from_utf8(bytes).map_err(FileError::io)
}

#[tauri::command]
pub async fn write_sheet(
    app: tauri::AppHandle,
    path: String,
    content: String,
    base_content: Option<String>,
) -> Result<SaveResponse, FileError> {
    markdown_path(&path)?;
    workspace::save_workspace_file(
        app,
        Scope::Space,
        path,
        content.into_bytes(),
        base_content.map(String::into_bytes),
    )
    .await
}

#[tauri::command]
pub async fn list_markdown_files(app: tauri::AppHandle) -> Result<Vec<String>, FileError> {
    Ok(workspace::list_workspace_files(app, Scope::Space, false)
        .await?
        .into_iter()
        .filter(|path| path.to_ascii_lowercase().ends_with(".md"))
        .collect())
}

#[tauri::command]
pub async fn read_markdown_file(app: tauri::AppHandle, path: String) -> Result<String, FileError> {
    workspace::blocking(app, Scope::Space, move |root| {
        read_markdown_at(&root, &path)
    })
    .await
}

#[tauri::command]
pub async fn write_numbered_asset(
    app: tauri::AppHandle,
    path: String,
    bytes: Vec<u8>,
) -> Result<String, FileError> {
    workspace::blocking(app, Scope::Space, move |root| {
        Ok(slate_core::write_numbered_asset_to_space(
            root, &path, &bytes,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn read_tidy_settings(app: tauri::AppHandle) -> Result<Option<Vec<u8>>, FileError> {
    workspace::read_workspace_file(app, Scope::Space, ".slate/tidy.json".into()).await
}

#[tauri::command]
pub async fn write_tidy_settings(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    base_bytes: Option<Vec<u8>>,
) -> Result<SaveResponse, FileError> {
    workspace::save_workspace_file(
        app,
        Scope::Space,
        ".slate/tidy.json".into(),
        bytes,
        base_bytes,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};
    struct Space(PathBuf);
    impl Space {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "slate-legacy-scope-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
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
    fn legacy_reads_preserve_raw_text_and_reject_escapes_with_typed_errors() {
        let space = Space::new();
        let root = space.0.join("space");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("note.md"), b"\xef\xbb\xbf# Words\r\n").unwrap();
        fs::write(space.0.join("outside.md"), b"External").unwrap();
        assert_eq!(
            read_markdown_at(&root, "note.md").unwrap(),
            "\u{feff}# Words\r\n"
        );
        for path in ["../outside.md", "/outside.md", "note.json"] {
            let error = read_markdown_at(&root, path).unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap()["kind"], "invalid-path");
        }
    }

    #[test]
    fn legacy_reads_cannot_follow_a_link_outside_the_space() {
        let space = Space::new();
        let root = space.0.join("space");
        let outside = space.0.join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("outside.md"), b"External").unwrap();
        let link = root.join("linked");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let result = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:SLATE_TEST_LINK -Target $env:SLATE_TEST_TARGET -ErrorAction Stop | Out-Null"])
                .env("SLATE_TEST_LINK", &link).env("SLATE_TEST_TARGET", &outside)
                .creation_flags(0x08000000).output().unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        let result = read_markdown_at(&root, "linked/outside.md");
        #[cfg(unix)]
        fs::remove_file(&link).unwrap();
        #[cfg(windows)]
        fs::remove_dir(&link).unwrap();
        let error = result.unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap()["kind"], "invalid-path");
        assert_eq!(fs::read(outside.join("outside.md")).unwrap(), b"External");
    }
}
