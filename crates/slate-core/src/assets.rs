use crate::{workspace_relative_path, StorageError};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

fn asset_parent(root: &Path, path: &str) -> Result<(PathBuf, String), StorageError> {
    // Use the same portable path grammar on every native platform.
    if path.contains(['\\', ':'])
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(StorageError::PathEscapesRoot);
    }
    let mut parts: Vec<_> = path.split('/').collect();
    let stem = parts
        .pop()
        .and_then(|name| name.strip_suffix(".png"))
        .filter(|name| !name.is_empty())
        .ok_or(StorageError::InvalidSheetPath)?;
    let mut parent = root.to_path_buf();
    for part in parts {
        parent.push(part);
        match fs::create_dir(&parent) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let metadata = fs::symlink_metadata(&parent)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || !fs::canonicalize(&parent)?.starts_with(root)
        {
            return Err(StorageError::PathEscapesRoot);
        }
    }
    Ok((parent, stem.to_owned()))
}

/// Reserve a new numbered PNG without opening or overwriting an existing file.
pub fn write_numbered_asset_to_space(
    root: impl AsRef<Path>,
    path: &str,
    bytes: &[u8],
) -> Result<String, StorageError> {
    fs::create_dir_all(root.as_ref())?;
    let root = fs::canonicalize(root)?;
    let (parent, stem) = asset_parent(&root, path)?;
    for number in 1_u64..u64::MAX {
        let target = parent.join(format!("{stem}-{number}.png"));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut file) => {
                // Keep a reserved partial file on error; a retry must use a fresh name.
                file.write_all(bytes)?;
                file.sync_all()?;
                return workspace_relative_path(&root, &target);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(StorageError::Io("No free asset filename remains".into()))
}
