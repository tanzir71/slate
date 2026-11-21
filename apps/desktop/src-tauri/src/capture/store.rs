use crate::{spaces::NativeSpaces, workspace::FileError};
use serde::{Deserialize, Serialize};
use slate_core::WriteSheetStatus;
use std::path::PathBuf;

const STATE: &str = "desktop-capture.json";
const MAX_TEXT: usize = 1024 * 1024;
const MAX_REVISION: u64 = 9_007_199_254_740_990;

fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id)
}
fn valid_space(id: &str) -> bool {
    id == crate::spaces::DEFAULT_ID || valid_id(id)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Draft {
    id: String,
    space_id: String,
    space_name: String,
    root: PathBuf,
    text: String,
    pending: bool,
    revision: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftView {
    pub id: String,
    pub space_id: String,
    pub space_name: String,
    pub text: String,
    pub pending: bool,
    pub revision: u64,
}

impl Draft {
    fn view(&self) -> DraftView {
        DraftView {
            id: self.id.clone(),
            space_id: self.space_id.clone(),
            space_name: self.space_name.clone(),
            text: self.text.clone(),
            pending: self.pending,
            revision: self.revision,
        }
    }
    fn valid(&self) -> bool {
        valid_id(&self.id)
            && valid_space(&self.space_id)
            && !self.space_name.trim().is_empty()
            && self.root.is_absolute()
            && self.root.to_str().is_some()
            && self.text.len() <= MAX_TEXT
            && (!self.pending || !self.text.trim().is_empty())
            && self.revision <= MAX_REVISION
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Completed {
    pub id: String,
    pub space_id: String,
    pub text: String,
    pub path: String,
    pub conflict: bool,
}
impl Completed {
    fn valid(&self) -> bool {
        valid_id(&self.id)
            && valid_space(&self.space_id)
            && !self.text.trim().is_empty()
            && self.text.len() <= MAX_TEXT
            && self.path
                == if self.conflict {
                    format!("Inbox/Capture (capture {}).md", self.id)
                } else {
                    "Inbox/Capture.md".into()
                }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedState {
    version: u8,
    active_draft: Option<Draft>,
    last_completed: Option<Completed>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub active_draft: Option<DraftView>,
    pub last_completed: Option<Completed>,
}

fn changed() -> FileError {
    FileError::io("Quick Capture recovery data changed or needs a newer Slate. Your draft and existing files were kept.")
}

pub struct Store {
    data: PathBuf,
    pub active_space: String,
    pub shortcut_error: Option<String>,
    pub last_error: Option<String>,
}

impl Store {
    pub fn new(data: PathBuf) -> Self {
        Self {
            data,
            active_space: crate::spaces::DEFAULT_ID.into(),
            shortcut_error: None,
            last_error: None,
        }
    }

    fn read(&self) -> Result<(SavedState, Option<Vec<u8>>), FileError> {
        let base = slate_core::read_workspace_file(&self.data, STATE)?;
        let state: SavedState = match base.as_deref() {
            Some(bytes) if bytes.len() <= 16 * MAX_TEXT => {
                serde_json::from_slice(bytes).map_err(|_| changed())?
            }
            Some(_) => return Err(changed()),
            None => SavedState {
                version: 1,
                active_draft: None,
                last_completed: None,
            },
        };
        if state.version != 1
            || state
                .active_draft
                .as_ref()
                .is_some_and(|draft| !draft.valid())
            || state.last_completed.as_ref().is_some_and(|done| {
                !done.valid()
                    || state
                        .active_draft
                        .as_ref()
                        .is_some_and(|draft| draft.id == done.id)
            })
        {
            return Err(changed());
        }
        Ok((state, base))
    }

    fn write(&self, state: &SavedState, base: Option<&[u8]>) -> Result<(), FileError> {
        let bytes = serde_json::to_vec(state).map_err(FileError::io)?;
        let result = slate_core::save_workspace_file(&self.data, STATE, &bytes, base)?;
        if result.status != WriteSheetStatus::Written {
            return Err(changed());
        }
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Snapshot, FileError> {
        let (state, _) = self.read()?;
        Ok(Snapshot {
            active_draft: state.active_draft.as_ref().map(Draft::view),
            last_completed: state.last_completed,
        })
    }

    /// Persist the binding before the renderer can accept the first character.
    pub fn prepare(&self, spaces: &NativeSpaces, selected: Option<&str>) -> Result<(), FileError> {
        let (mut state, base) = self.read()?;
        if state.active_draft.is_some() {
            return Ok(());
        }
        let id = selected.unwrap_or(&self.active_space);
        let space = spaces
            .list()?
            .into_iter()
            .find(|space| space.id == id)
            .ok_or_else(|| FileError::io("Choose a Space before capturing."))?;
        let root = spaces.resolve(Some(id))?;
        if id == crate::spaces::DEFAULT_ID {
            std::fs::create_dir_all(&root).map_err(FileError::io)?;
        }
        let root = std::fs::canonicalize(root).map_err(FileError::io)?;
        state.active_draft = Some(Draft {
            id: uuid::Uuid::new_v4().to_string(),
            space_id: space.id,
            space_name: space.name,
            root,
            text: String::new(),
            pending: false,
            revision: 0,
        });
        self.write(&state, base.as_deref())
    }

    pub fn stash(
        &self,
        id: &str,
        text: &str,
        pending: bool,
        revision: u64,
    ) -> Result<(), FileError> {
        if text.len() > MAX_TEXT || revision > MAX_REVISION {
            return Err(FileError::io(
                "Keep captures within 1 MiB. Copy these words before closing.",
            ));
        }
        let (mut state, base) = self.read()?;
        // A delayed close after a successful save must never resurrect its draft.
        if state
            .last_completed
            .as_ref()
            .is_some_and(|done| done.id == id && done.text == text)
        {
            return Ok(());
        }
        let draft = state
            .active_draft
            .as_mut()
            .filter(|draft| draft.id == id)
            .ok_or_else(changed)?;
        if revision < draft.revision
            || revision == draft.revision && (draft.text != text || draft.pending != pending)
            || draft.pending && (draft.text != text || !pending)
        {
            return Err(changed());
        }
        if pending && text.trim().is_empty() {
            return Err(FileError::io("Write something before saving."));
        }
        draft.text = text.into();
        draft.pending = pending;
        draft.revision = revision;
        self.write(&state, base.as_deref())
    }

    pub fn save(
        &self,
        spaces: &NativeSpaces,
        id: &str,
        text: &str,
        revision: u64,
    ) -> Result<Completed, FileError> {
        self.save_with(spaces, id, text, revision, || Ok(()))
    }

    fn save_with(
        &self,
        spaces: &NativeSpaces,
        id: &str,
        text: &str,
        revision: u64,
        after_append: impl FnOnce() -> Result<(), FileError>,
    ) -> Result<Completed, FileError> {
        let (state, _) = self.read()?;
        if let Some(done) = state
            .last_completed
            .filter(|done| done.id == id && done.text == text)
        {
            return Ok(done);
        }
        self.stash(id, text, true, revision)?;
        let (mut state, base) = self.read()?;
        let draft = state
            .active_draft
            .as_ref()
            .filter(|draft| draft.id == id)
            .ok_or_else(changed)?;
        let resolved = spaces.resolve(Some(&draft.space_id))?;
        // resolve never recreates selected folders. Check again after each restart;
        // neither a new catalog nor the main window may redirect retained words.
        let actual = std::fs::canonicalize(resolved).map_err(FileError::io)?;
        if actual != draft.root {
            return Err(FileError::io("This capture belongs to its original Space. Reconnect that folder; your draft was kept."));
        }
        let outcome = slate_core::append_capture(&actual, id, text)?;
        after_append()?;
        let done = Completed {
            id: id.into(),
            space_id: draft.space_id.clone(),
            text: text.into(),
            path: outcome.path,
            conflict: outcome.status == WriteSheetStatus::ConflictCopy,
        };
        state.active_draft = None;
        state.last_completed = Some(done.clone());
        self.write(&state, base.as_deref())?;
        Ok(done)
    }
}

#[cfg(test)]
mod tests;
