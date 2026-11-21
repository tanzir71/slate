use super::{publish, raw, read_checked, root_path, save_checked, target_path, FILE_IO};
use crate::{StorageError, WriteSheetOutcome, WriteSheetStatus};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const CAPTURE: &str = "Inbox/Capture.md";
const MAX_TEXT: usize = 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase", deny_unknown_fields)]
enum Journal {
    Prepared {
        version: u8,
        base: Option<String>,
        text: String,
    },
    Done {
        version: u8,
        text: String,
        path: String,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Checkpoint {
    Prepared,
    Published,
}

fn error(message: &str) -> StorageError {
    StorageError::Io(message.into())
}

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

fn read_at(root: &Path, path: &str) -> Result<Option<Vec<u8>>, StorageError> {
    match target_path(root, path, false)? {
        Some((root, target)) => read_checked(&root, &target),
        None => Ok(None),
    }
}

fn paragraph(before: &str, text: &str) -> String {
    let bytes = before.as_bytes();
    let eol = match bytes.iter().position(|byte| matches!(byte, b'\r' | b'\n')) {
        Some(index) if bytes[index] == b'\r' && bytes.get(index + 1) == Some(&b'\n') => "\r\n",
        Some(index) if bytes[index] == b'\r' => "\r",
        _ => "\n",
    };
    let mut end = bytes.len();
    let mut breaks = 0;
    while end > 0 && breaks < 2 {
        match bytes[end - 1] {
            b'\n' => {
                end -= 1;
                if end > 0 && bytes[end - 1] == b'\r' {
                    end -= 1;
                }
            }
            b'\r' => end -= 1,
            _ => break,
        }
        breaks += 1;
    }
    let separator = if before.is_empty() || before == "\u{feff}" {
        String::new()
    } else {
        eol.repeat(2 - breaks)
    };
    let text = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', eol);
    format!("{before}{separator}{text}{eol}")
}

fn write_journal(
    root: &Path,
    path: &str,
    journal: &Journal,
    base: Option<&[u8]>,
) -> Result<Vec<u8>, StorageError> {
    let bytes = serde_json::to_vec(journal).map_err(|cause| error(&cause.to_string()))?;
    save_checked(root, path, &bytes, base, &|_, _, _| {
        Err(error(
            "Capture recovery data changed. Existing notes and recovery bytes were kept.",
        ))
    })?;
    Ok(bytes)
}

fn retain_named(
    root: &Path,
    proposal: &Path,
    path: &str,
) -> Result<WriteSheetOutcome, StorageError> {
    let (_, target) = target_path(root, path, true)?.ok_or(StorageError::InvalidSheetPath)?;
    let bytes = raw(proposal)?.ok_or_else(|| error("Capture proposal is unavailable."))?;
    let published = read_checked(root, &target)?.is_none() && publish(proposal, &target)?;
    if !published && read_checked(root, &target)?.as_deref() != Some(bytes.as_slice()) {
        return Err(error(
            "The capture recovery copy changed. Its bytes and the new proposal were kept.",
        ));
    }
    let _ = fs::remove_file(proposal);
    Ok(WriteSheetOutcome {
        status: WriteSheetStatus::ConflictCopy,
        path: path.into(),
    })
}

fn resumed_outcome(
    root: &Path,
    copy: &str,
    after: &[u8],
) -> Result<Option<WriteSheetOutcome>, StorageError> {
    if let Some(bytes) = read_at(root, copy)? {
        if bytes != after {
            return Err(error("The capture recovery copy changed. Review it before retrying; no notes were overwritten."));
        }
        return Ok(Some(WriteSheetOutcome {
            status: WriteSheetStatus::ConflictCopy,
            path: copy.into(),
        }));
    }
    // A later append may extend our committed prefix before its receipt is durable.
    if read_at(root, CAPTURE)?.is_some_and(|bytes| bytes.starts_with(after)) {
        return Ok(Some(WriteSheetOutcome {
            status: WriteSheetStatus::Written,
            path: CAPTURE.into(),
        }));
    }
    Ok(None)
}

fn append_inner(
    root: &Path,
    id: &str,
    text: &str,
    checkpoint: &mut dyn FnMut(Checkpoint) -> Result<(), StorageError>,
) -> Result<WriteSheetOutcome, StorageError> {
    let root = root_path(root, true)?.ok_or(StorageError::InvalidSheetPath)?;
    let journal_path = format!(".slate/captures/{id}.json");
    let copy = format!("Inbox/Capture (capture {id}).md");
    let original = read_at(&root, &journal_path)?;
    let (journal, journal_bytes, resumed) = match original {
        Some(bytes) => {
            let journal: Journal = serde_json::from_slice(&bytes)
                .map_err(|_| error("Capture recovery data is invalid or needs a newer Slate. Existing files were kept."))?;
            (journal, bytes, true)
        }
        None => {
            let base = read_at(&root, CAPTURE)?
                .map(String::from_utf8)
                .transpose()
                .map_err(|_| {
                    error(
                        "Inbox/Capture.md needs UTF-8. The original file and your draft were kept.",
                    )
                })?;
            let journal = Journal::Prepared {
                version: 1,
                base,
                text: text.into(),
            };
            let bytes = write_journal(&root, &journal_path, &journal, None)?;
            (journal, bytes, false)
        }
    };
    let base = match journal {
        Journal::Done { version: 1, text: captured, path } if captured == text && (path == CAPTURE || path == copy) => {
            return Ok(WriteSheetOutcome {
                status: if path == CAPTURE { WriteSheetStatus::Written } else { WriteSheetStatus::ConflictCopy }, path,
            });
        }
        Journal::Prepared { version: 1, text: captured, base } if captured == text => base,
        _ => return Err(error("This capture already has different recovery data. Your words were kept; review the original capture before changing it.")),
    };
    let after = paragraph(base.as_deref().unwrap_or_default(), text);
    checkpoint(Checkpoint::Prepared)?;
    let saved = if resumed {
        resumed_outcome(&root, &copy, after.as_bytes())?
    } else {
        None
    };
    let outcome = match saved {
        Some(outcome) => outcome,
        None => save_checked(
            &root,
            CAPTURE,
            after.as_bytes(),
            base.as_deref().map(str::as_bytes),
            &|root, _, proposal| retain_named(root, proposal, &copy),
        )?,
    };
    checkpoint(Checkpoint::Published)?;
    write_journal(
        &root,
        &journal_path,
        &Journal::Done {
            version: 1,
            text: text.into(),
            path: outcome.path.clone(),
        },
        Some(&journal_bytes),
    )?;
    Ok(outcome)
}

/// Append one confirmed capture, retaining an on-disk intent and idempotent receipt.
/// A caller must reuse the ID and exact submitted text after a lost reply.
pub fn append_capture(
    root: impl AsRef<Path>,
    id: &str,
    text: &str,
) -> Result<WriteSheetOutcome, StorageError> {
    if !valid_id(id) {
        return Err(StorageError::InvalidSheetPath);
    }
    if text.trim().is_empty() || text.len() > MAX_TEXT {
        return Err(error(
            "A capture needs nonempty text of at most 1 MiB. Your draft was kept.",
        ));
    }
    let _guard = FILE_IO
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    append_inner(root.as_ref(), id, text, &mut |_| Ok(()))
}

#[cfg(test)]
mod tests;
