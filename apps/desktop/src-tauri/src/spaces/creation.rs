use super::{FileError, NativeSpaces, SpaceRecord};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

fn validate(name: &str, welcome: &str) -> Result<(), FileError> {
    if name.trim() != name
        || name.starts_with('.')
        || name.contains('/')
        || name.chars().count() > 80
        || name.len() > 240
        || slate_core::validate_workspace_path(name).is_err()
    {
        return Err(FileError::io(
            "Choose a short folder name without slashes, reserved names, or leading or trailing spaces.",
        ));
    }
    if welcome.is_empty() || welcome.len() > 64 * 1024 {
        return Err(FileError::io(
            "The welcome note must be between 1 and 65536 bytes.",
        ));
    }
    Ok(())
}

fn slate_directory(documents: &Path) -> Result<PathBuf, FileError> {
    let path = documents.join("Slate");
    match std::fs::create_dir(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
        Err(error) => return Err(FileError::io(error)),
    }
    let actual = std::fs::canonicalize(&path).map_err(FileError::io)?;
    if actual != path || !actual.is_dir() {
        return Err(FileError::io(
            "Documents/Slate must be an ordinary folder. Choose an existing notes folder instead.",
        ));
    }
    Ok(actual)
}

impl NativeSpaces {
    pub(crate) fn create_in_documents(
        &self,
        documents: &Path,
        name: &str,
        welcome: &str,
    ) -> Result<SpaceRecord, FileError> {
        validate(name, welcome)?;
        // Refuse a known invalid registry before creating a folder that could not be listed.
        self.list()?;
        if !documents.is_absolute() || documents.starts_with(&self.data) {
            return Err(FileError::io(
                "A Documents folder outside application data is required.",
            ));
        }
        std::fs::create_dir_all(documents).map_err(FileError::io)?;
        let documents = std::fs::canonicalize(documents).map_err(FileError::io)?;
        if documents.starts_with(&self.data) {
            return Err(FileError::io(
                "A Documents folder outside application data is required.",
            ));
        }
        let path = slate_directory(&documents)?.join(name);
        match std::fs::create_dir(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                return Err(FileError::io(
                    "That folder already exists in Documents/Slate. Choose another name or use Open a folder.",
                ));
            }
            Err(error) => return Err(FileError::io(error)),
        }
        self.finish_creation(&path, welcome)
    }

    fn finish_creation(&self, path: &Path, welcome: &str) -> Result<SpaceRecord, FileError> {
        let finish = || {
            if !slate_core::create_workspace_file(path, "Welcome.md", welcome.as_bytes())? {
                return Err(FileError::io("A welcome note already exists."));
            }
            self.register(path)
        };
        // Never delete a partially created folder: it may already contain somebody's files.
        finish().map_err(|error| {
            FileError::io(format!(
                "The new Space could not be completed. Files already created were kept at {}. Use Open a folder to recover them. {error}",
                path.display()
            ))
        })
    }
}

#[cfg(test)]
mod tests;
