use crate::workspace::{blocking, FileError, Scope};
use serde::Serialize;
use slate_core::{StorageError, WorkspaceFileInfo};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    absolute_path: String,
    bytes: u64,
    modified_at: Option<u64>,
    reveal_label: &'static str,
}

fn checked_file(root: &Path, path: &str) -> Result<WorkspaceFileInfo, FileError> {
    if !path.to_ascii_lowercase().ends_with(".md")
        || path
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(".slate") || part.eq_ignore_ascii_case(".git"))
    {
        return Err(StorageError::InvalidSheetPath.into());
    }
    slate_core::workspace_file_info(root, path)?.ok_or_else(|| {
        FileError::io(
            "This sheet no longer exists. Refresh the Space to find its current location.",
        )
    })
}

fn display_path(path: &Path) -> Result<String, FileError> {
    let text = path
        .to_str()
        .ok_or_else(|| FileError::io("This file path cannot be displayed as Unicode."))?;
    if let Some(tail) = text.strip_prefix(r"\\?\UNC\") {
        return Ok(format!(r"\\{tail}"));
    }
    if let Some(tail) = text.strip_prefix(r"\\?\") {
        if tail.as_bytes().get(1) == Some(&b':') {
            return Ok(tail.to_owned());
        }
    }
    Ok(text.to_owned())
}
fn reveal_label() -> &'static str {
    if cfg!(target_os = "windows") {
        "Show in Explorer"
    } else if cfg!(target_os = "macos") {
        "Show in Finder"
    } else {
        "Show in file manager"
    }
}
fn read_info(root: &Path, path: &str) -> Result<FileInfo, FileError> {
    let file = checked_file(root, path)?;
    Ok(FileInfo {
        absolute_path: display_path(&file.path)?,
        bytes: file.bytes,
        modified_at: file
            .modified
            .and_then(|date| date.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok()),
        reveal_label: reveal_label(),
    })
}
fn reveal_checked(
    root: &Path,
    path: &str,
    reveal: impl FnOnce(&Path) -> Result<(), FileError>,
) -> Result<(), FileError> {
    let file = checked_file(root, path)?;
    reveal(&file.path)
}

#[tauri::command]
pub async fn read_workspace_file_info(
    app: tauri::AppHandle,
    path: String,
) -> Result<FileInfo, FileError> {
    blocking(app, Scope::Space, move |root| read_info(&root, &path)).await
}
#[tauri::command]
pub async fn reveal_workspace_file(app: tauri::AppHandle, path: String) -> Result<(), FileError> {
    blocking(app, Scope::Space, move |root| {
        reveal_checked(&root, &path, |file| {
            // Only this checked Space path reaches the native API. No generic opener
            // plugin commands or URL/path-opening permissions are exposed to JS.
            tauri_plugin_opener::reveal_item_in_dir(file).map_err(FileError::io)
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_file_metadata_and_reveal_keep_the_canonical_path_and_original_bytes() {
        let root = std::env::temp_dir().join(format!(
            "slate-file-info-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("বাংলা note.md");
        let bytes = [0xef, 0xbb, 0xbf, 0xff, b'\n'];
        std::fs::write(&path, bytes).unwrap();
        let info = read_info(&root, "বাংলা note.md").unwrap();
        assert_eq!(info.bytes, bytes.len() as u64);
        assert!(info.modified_at.is_some());
        let mut shown = None;
        reveal_checked(&root, "বাংলা note.md", |file| {
            shown = Some(file.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert_eq!(shown, Some(std::fs::canonicalize(&path).unwrap()));
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let serialized = serde_json::to_value(info).unwrap();
        assert!(serialized.get("absolutePath").unwrap().is_string());
        assert!(serialized.get("revealLabel").unwrap().is_string());
        let absolute = std::fs::canonicalize(&root).unwrap();
        assert_eq!(
            absolute.parent(),
            Some(
                std::fs::canonicalize(std::env::temp_dir())
                    .unwrap()
                    .as_path()
            )
        );
        assert!(absolute
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("slate-file-info-"));
        std::fs::remove_dir_all(absolute).unwrap();
    }
    #[test]
    fn display_paths_keep_real_locations_without_windows_verbatim_noise() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\Notes\file.md")).unwrap(),
            r"C:\Notes\file.md"
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share\file.md")).unwrap(),
            r"\\server\share\file.md"
        );
        assert_eq!(
            display_path(Path::new("/home/notes/file.md")).unwrap(),
            "/home/notes/file.md"
        );
    }
    #[test]
    fn unsafe_or_missing_items_never_reach_the_system_revealer() {
        for path in [
            "../outside.md",
            "C:/outside.md",
            ".slate/history/x.md",
            ".git/config.md",
            "asset.png",
            "missing.md",
        ] {
            let result = reveal_checked(
                &std::env::temp_dir().join("slate-absent-file-info-root"),
                path,
                |_| panic!("Unsafe reveal: {path}"),
            );
            assert!(result.is_err());
        }
    }
}
