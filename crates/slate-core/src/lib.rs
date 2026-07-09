use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use std::fmt::{Display, Formatter};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    InvalidSalt,
    InvalidNonce,
    KeyDerivation,
    Encrypt,
    Decrypt,
}

impl Display for CryptoError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::InvalidSalt => "salt must be at least 8 bytes",
            Self::InvalidNonce => "nonce must be exactly 12 bytes",
            Self::KeyDerivation => "failed to derive key",
            Self::Encrypt => "failed to encrypt payload",
            Self::Decrypt => "failed to decrypt payload",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for CryptoError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    PathEscapesRoot,
    InvalidSheetPath,
    Io(String),
}

impl Display for StorageError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::PathEscapesRoot => "sheet path escapes the Slate space root",
            Self::InvalidSheetPath => "sheet path must point to a file inside the Slate space root",
            Self::Io(error) => error,
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteSheetStatus {
    Written,
    ConflictCopy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteSheetOutcome {
    pub status: WriteSheetStatus,
    pub path: String,
}

pub fn derive_space_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], CryptoError> {
    if salt.len() < 8 {
        return Err(CryptoError::InvalidSalt);
    }

    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|_| CryptoError::KeyDerivation)?;
    Ok(key)
}

pub fn encrypt_space_payload(
    key: &[u8; 32],
    nonce: &[u8; 12],
    plaintext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .encrypt(Nonce::from_slice(nonce), plaintext)
        .map_err(|_| CryptoError::Encrypt)
}

pub fn decrypt_space_payload(
    key: &[u8; 32],
    nonce: &[u8; 12],
    ciphertext: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| CryptoError::Decrypt)
}

pub fn write_sheet_to_space(
    root: impl AsRef<Path>,
    path: &str,
    content: &str,
    base_content: Option<&str>,
    conflict_stamp: &str,
) -> Result<WriteSheetOutcome, StorageError> {
    let root = root.as_ref();
    let target = safe_space_path(root, path)?;
    let parent = target.parent().ok_or(StorageError::InvalidSheetPath)?;
    fs::create_dir_all(parent)?;

    if let Some(base) = base_content {
        if target.exists() {
            let current = fs::read_to_string(&target)?;
            if current != base {
                let conflict = conflict_copy_path(&target, conflict_stamp)?;
                fs::write(&conflict, content)?;
                return Ok(WriteSheetOutcome {
                    status: WriteSheetStatus::ConflictCopy,
                    path: workspace_relative_path(root, &conflict)?,
                });
            }
        }
    }

    fs::write(&target, content)?;
    Ok(WriteSheetOutcome {
        status: WriteSheetStatus::Written,
        path: workspace_relative_path(root, &target)?,
    })
}

fn safe_space_path(root: &Path, path: &str) -> Result<PathBuf, StorageError> {
    let requested = Path::new(path);
    if requested.is_absolute() {
        return Err(StorageError::PathEscapesRoot);
    }

    let mut normalized = PathBuf::new();
    for component in requested.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(StorageError::PathEscapesRoot);
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err(StorageError::InvalidSheetPath);
    }

    Ok(root.join(normalized))
}

fn conflict_copy_path(target: &Path, stamp: &str) -> Result<PathBuf, StorageError> {
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(StorageError::InvalidSheetPath)?;
    let extension = target.extension().and_then(|value| value.to_str());
    let stem = match extension {
        Some(extension) => file_name
            .strip_suffix(&format!(".{extension}"))
            .ok_or(StorageError::InvalidSheetPath)?,
        None => file_name,
    };
    let suffix = extension.map_or(String::new(), |extension| format!(".{extension}"));

    Ok(target.with_file_name(format!(
        "{stem} (conflicted copy {stamp}){suffix}"
    )))
}

fn workspace_relative_path(root: &Path, target: &Path) -> Result<String, StorageError> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| StorageError::PathEscapesRoot)?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn encrypts_and_decrypts_space_payloads() {
        let key = derive_space_key("correct horse battery staple", b"space-salt").unwrap();
        let nonce = *b"unique nonce";
        let plaintext = b"# Private Note\n\nLocal first, encrypted when synced.";

        let sealed = encrypt_space_payload(&key, &nonce, plaintext).unwrap();
        let opened = decrypt_space_payload(&key, &nonce, &sealed).unwrap();

        assert_eq!(opened, plaintext);
        assert_ne!(sealed, plaintext);
    }

    #[test]
    fn decrypt_fails_with_the_wrong_key() {
        let key = derive_space_key("one passphrase", b"space-salt").unwrap();
        let wrong_key = derive_space_key("another passphrase", b"space-salt").unwrap();
        let nonce = *b"unique nonce";
        let sealed = encrypt_space_payload(&key, &nonce, b"secret").unwrap();

        assert!(decrypt_space_payload(&wrong_key, &nonce, &sealed).is_err());
    }

    #[test]
    fn writes_sheet_inside_space_root() {
        let root = temp_root("write-sheet");

        let outcome = write_sheet_to_space(
            &root,
            "Drafts/note.md",
            "# Draft\n\nLocal first.",
            None,
            "2026-07-10 00-00-00",
        )
        .unwrap();

        assert_eq!(outcome.status, WriteSheetStatus::Written);
        assert_eq!(outcome.path, "Drafts/note.md");
        assert_eq!(
            fs::read_to_string(root.join("Drafts").join("note.md")).unwrap(),
            "# Draft\n\nLocal first."
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_conflict_copy_without_overwriting_existing_sheet() {
        let root = temp_root("conflict-copy");
        let sheet_path = root.join("Drafts").join("note.md");
        fs::create_dir_all(sheet_path.parent().unwrap()).unwrap();
        fs::write(&sheet_path, "existing edit").unwrap();

        let outcome = write_sheet_to_space(
            &root,
            "Drafts/note.md",
            "incoming edit",
            Some("old base"),
            "2026-07-10 00-00-00",
        )
        .unwrap();

        assert_eq!(outcome.status, WriteSheetStatus::ConflictCopy);
        assert_eq!(
            outcome.path,
            "Drafts/note (conflicted copy 2026-07-10 00-00-00).md"
        );
        assert_eq!(fs::read_to_string(&sheet_path).unwrap(), "existing edit");
        assert_eq!(
            fs::read_to_string(root.join("Drafts").join("note (conflicted copy 2026-07-10 00-00-00).md"))
                .unwrap(),
            "incoming edit"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_sheet_paths_that_escape_the_space_root() {
        let root = temp_root("escape-path");

        let error = write_sheet_to_space(
            &root,
            "../outside.md",
            "not allowed",
            None,
            "2026-07-10 00-00-00",
        )
        .unwrap_err();

        assert_eq!(error, StorageError::PathEscapesRoot);
        assert!(!root.parent().unwrap().join("outside.md").exists());

        fs::remove_dir_all(root).unwrap();
    }

    fn temp_root(name: &str) -> PathBuf {
        let count = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "slate-core-test-{}-{}-{}",
            name,
            std::process::id(),
            count
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }
}
