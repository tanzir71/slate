use super::{record, FileError, NativeSpaces, SpaceRecord, DEFAULT_ID};
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub(crate) struct AssociatedFile {
    pub space: SpaceRecord,
    pub root: PathBuf,
    pub path: String,
}

pub(crate) fn markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
}

fn relative(root: &Path, file: &Path) -> Result<String, FileError> {
    let path = file
        .strip_prefix(root)
        .map_err(FileError::io)?
        .components()
        .map(|part| {
            part.as_os_str().to_str().ok_or_else(|| {
                FileError::io(
                    "This file name cannot be displayed as UTF-8. The original file was kept.",
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?
        .join("/");
    if path
        .split('/')
        .any(|part| part.eq_ignore_ascii_case(".slate") || part.eq_ignore_ascii_case(".git"))
    {
        return Err(FileError::io(
            "Open Slate configuration and templates from Settings. This file was kept.",
        ));
    }
    slate_core::workspace_file_info(root, &path)?.ok_or_else(|| {
        FileError::io("The opened file is no longer available. Its original folder was kept.")
    })?;
    Ok(path)
}

impl NativeSpaces {
    /// Only native OS launch paths reach here. Renderers supply a queue ID, never a root.
    pub(crate) fn associate_file(&self, file: &Path) -> Result<AssociatedFile, FileError> {
        if !file.is_absolute() || !markdown(file) {
            return Err(FileError::io(
                "Open an absolute Markdown file ending in .md.",
            ));
        }
        let file = std::fs::canonicalize(file).map_err(FileError::io)?;
        if !file.is_file() || !markdown(&file) {
            return Err(FileError::io(
                "This is not a Markdown file. Existing files were kept.",
            ));
        }
        let mut roots = self.roots.lock().map_err(FileError::io)?;
        let (catalog, _) = self.read(&mut roots)?;
        let selected = catalog
            .folders
            .iter()
            .filter(|folder| file.starts_with(&folder.path))
            .max_by_key(|folder| folder.path.components().count())
            .cloned();
        drop(roots);
        if let Some(folder) = selected {
            let root = self.resolve(Some(&folder.id))?;
            return Ok(AssociatedFile {
                path: relative(&root, &file)?,
                space: record(&folder),
                root,
            });
        }
        if let Ok(root) = std::fs::canonicalize(self.resolve(Some(DEFAULT_ID))?) {
            if file.starts_with(&root) {
                return Ok(AssociatedFile {
                    path: relative(&root, &file)?,
                    space: SpaceRecord {
                        id: DEFAULT_ID.into(),
                        name: "Slate".into(),
                        path: None,
                    },
                    root,
                });
            }
        }
        let root = file
            .parent()
            .ok_or_else(|| FileError::io("This file has no notes folder."))?
            .to_path_buf();
        // Check scope/name before recording a new Space. No note is copied or rewritten.
        let path = relative(&root, &file)?;
        let space = self.register(&root)?;
        Ok(AssociatedFile { space, root, path })
    }
}

#[cfg(test)]
mod tests;
