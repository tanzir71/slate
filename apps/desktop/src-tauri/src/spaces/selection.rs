use super::{record, FileError, NativeSpaces, SpaceRecord, DEFAULT_ID};
use serde::{Deserialize, Serialize};

const SESSION_PATH: &str = "desktop-session.json";
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    version: u8,
    space_id: String,
}
fn invalid_selection() -> FileError {
    FileError::io(
        "The saved Space selection is invalid. Choose a Space to continue. Your notes were kept.",
    )
}
fn changed_selection() -> FileError {
    FileError::io("The Space selection changed on disk. Your notes and the other selection were kept. Choose this Space again.")
}
impl NativeSpaces {
    fn selected_record(&self, id: &str) -> Result<SpaceRecord, FileError> {
        if id == DEFAULT_ID {
            return Ok(SpaceRecord {
                id: DEFAULT_ID.into(),
                name: "Slate".into(),
                path: None,
            });
        }
        let mut roots = self.roots.lock().map_err(FileError::io)?;
        let (catalog, _) = self.read(&mut roots)?;
        let folder = catalog
            .folders
            .iter()
            .find(|folder| folder.id == id)
            .ok_or_else(invalid_selection)?;
        let selected = record(folder);
        drop(roots);
        self.resolve(Some(id))?;
        Ok(selected)
    }
    pub(crate) fn startup(&self) -> Result<Option<SpaceRecord>, FileError> {
        let _guard = self.selection.lock().map_err(FileError::io)?;
        let Some(bytes) = slate_core::read_workspace_file(&self.data, SESSION_PATH)? else {
            return Ok(None);
        };
        let saved: Selection = serde_json::from_slice(&bytes).map_err(|_| invalid_selection())?;
        if saved.version != 1 {
            return Err(invalid_selection());
        }
        self.selected_record(&saved.space_id).map(Some)
    }
    /// This records an already-opened Space ID, never a renderer-provided path.
    pub(crate) fn remember(&self, id: &str) -> Result<SpaceRecord, FileError> {
        let _guard = self.selection.lock().map_err(FileError::io)?;
        let selected = self.selected_record(id)?;
        let base = slate_core::read_workspace_file(&self.data, SESSION_PATH)?;
        if base
            .as_deref()
            .and_then(|bytes| serde_json::from_slice::<Selection>(bytes).ok())
            .is_some_and(|saved| saved.version == 1 && saved.space_id == id)
        {
            return Ok(selected);
        }
        let bytes = serde_json::to_vec_pretty(&Selection {
            version: 1,
            space_id: id.into(),
        })
        .map_err(FileError::io)?;
        if let Some(base) = base {
            if slate_core::save_workspace_file(&self.data, SESSION_PATH, &bytes, Some(&base))?
                .status
                != slate_core::WriteSheetStatus::Written
            {
                return Err(changed_selection());
            }
        } else if !slate_core::create_workspace_file(&self.data, SESSION_PATH, &bytes)? {
            return Err(changed_selection());
        }
        Ok(selected)
    }
}
#[cfg(test)]
mod tests;
