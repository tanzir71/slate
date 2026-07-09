use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use std::fmt::{Display, Formatter};

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
