use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use slate_core::{StorageError, WriteSheetOutcome, WriteSheetStatus};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    Space,
    Global,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileError {
    kind: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_path: Option<String>,
}
impl FileError {
    pub(crate) fn io(error: impl ToString) -> Self {
        Self {
            kind: "io",
            message: error.to_string(),
            recovery_path: None,
        }
    }
}
impl std::fmt::Display for FileError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}
impl std::error::Error for FileError {}
impl From<StorageError> for FileError {
    fn from(error: StorageError) -> Self {
        Self {
            kind: match &error {
                StorageError::PathEscapesRoot | StorageError::InvalidSheetPath => "invalid-path",
                StorageError::InterruptedWrite { .. } => "interrupted-write",
                StorageError::Io(_) => "io",
            },
            recovery_path: match &error {
                StorageError::InterruptedWrite { recovery, .. } => Some(recovery.clone()),
                _ => None,
            },
            message: error.to_string(),
        }
    }
}

fn scoped_root(data: &Path, scope: Scope) -> PathBuf {
    match scope {
        Scope::Space => data.join("spaces/default"),
        Scope::Global => data.to_path_buf(),
    }
}
fn check_scope(scope: Scope, path: &str) -> Result<(), FileError> {
    if scope == Scope::Global && !path.starts_with("global/") {
        return Err(StorageError::PathEscapesRoot.into());
    }
    Ok(())
}
pub(crate) async fn blocking<T: Send + 'static>(
    app: tauri::AppHandle,
    scope: Scope,
    space_id: Option<String>,
    work: impl FnOnce(PathBuf) -> Result<T, FileError> + Send + 'static,
) -> Result<T, FileError> {
    let root = match scope {
        Scope::Space => crate::spaces::resolve(&app, space_id.as_deref())?,
        Scope::Global => app.path().app_data_dir().map_err(FileError::io)?,
    };
    tauri::async_runtime::spawn_blocking(move || work(root))
        .await
        .map_err(FileError::io)?
}

#[derive(Serialize)]
pub struct SaveResponse {
    status: &'static str,
    path: String,
}
impl From<WriteSheetOutcome> for SaveResponse {
    fn from(value: WriteSheetOutcome) -> Self {
        Self {
            status: match value.status {
                WriteSheetStatus::Written => "written",
                WriteSheetStatus::ConflictCopy => "conflict-copy",
            },
            path: value.path,
        }
    }
}

#[tauri::command]
pub async fn list_workspace_files(
    app: tauri::AppHandle,
    scope: Scope,
    space_id: Option<String>,
    include_private: bool,
) -> Result<Vec<String>, FileError> {
    blocking(app, scope, space_id, move |root| {
        if scope == Scope::Global {
            Ok(
                slate_core::list_workspace_files(root.join("global"), include_private)?
                    .into_iter()
                    .map(|path| format!("global/{path}"))
                    .collect(),
            )
        } else {
            Ok(slate_core::list_workspace_files(root, include_private)?)
        }
    })
    .await
}
#[tauri::command]
pub async fn read_workspace_file(
    app: tauri::AppHandle,
    scope: Scope,
    space_id: Option<String>,
    path: String,
) -> Result<Option<Vec<u8>>, FileError> {
    check_scope(scope, &path)?;
    blocking(app, scope, space_id, move |root| {
        Ok(slate_core::read_workspace_file(root, &path)?)
    })
    .await
}
#[tauri::command]
pub async fn create_workspace_file(
    app: tauri::AppHandle,
    scope: Scope,
    space_id: Option<String>,
    path: String,
    bytes: Vec<u8>,
) -> Result<bool, FileError> {
    check_scope(scope, &path)?;
    blocking(app, scope, space_id, move |root| {
        Ok(slate_core::create_workspace_file(root, &path, &bytes)?)
    })
    .await
}
#[tauri::command]
pub async fn save_workspace_file(
    app: tauri::AppHandle,
    scope: Scope,
    space_id: Option<String>,
    path: String,
    bytes: Vec<u8>,
    base_bytes: Option<Vec<u8>>,
) -> Result<SaveResponse, FileError> {
    check_scope(scope, &path)?;
    blocking(app, scope, space_id, move |root| {
        Ok(slate_core::save_workspace_file(root, &path, &bytes, base_bytes.as_deref())?.into())
    })
    .await
}
#[tauri::command]
pub async fn move_workspace_file(
    app: tauri::AppHandle,
    scope: Scope,
    space_id: Option<String>,
    from: String,
    to: String,
    base_bytes: Vec<u8>,
) -> Result<(), FileError> {
    check_scope(scope, &from)?;
    check_scope(scope, &to)?;
    blocking(app, scope, space_id, move |root| {
        Ok(slate_core::move_workspace_file(
            root,
            &from,
            &to,
            &base_bytes,
        )?)
    })
    .await
}
#[tauri::command]
pub async fn trash_workspace_file(
    app: tauri::AppHandle,
    scope: Scope,
    space_id: Option<String>,
    path: String,
    base_bytes: Vec<u8>,
) -> Result<String, FileError> {
    check_scope(scope, &path)?;
    // Global snippets are edited in place; only Space files have a trash UI.
    if scope == Scope::Global {
        return Err(StorageError::InvalidSheetPath.into());
    }
    blocking(app, scope, space_id, move |root| {
        Ok(slate_core::trash_workspace_file(root, &path, &base_bytes)?)
    })
    .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    scope: Scope,
    space_id: Option<String>,
    error: Option<String>,
}
pub struct WorkspaceWatches {
    inner: std::sync::Mutex<WatchSet>,
}
#[derive(Default)]
struct WatchSet {
    watchers: std::collections::BTreeMap<String, RecommendedWatcher>,
    errors: std::collections::BTreeMap<String, String>,
}
fn watch_root(
    root: &Path,
    handler: impl notify::EventHandler,
) -> Result<RecommendedWatcher, FileError> {
    std::fs::create_dir_all(root).map_err(FileError::io)?;
    let mut watcher = notify::recommended_watcher(handler).map_err(FileError::io)?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(FileError::io)?;
    Ok(watcher)
}
pub fn start_watches(app: &tauri::AppHandle) -> Result<WorkspaceWatches, FileError> {
    let data = app.path().app_data_dir().map_err(FileError::io)?;
    let state = WorkspaceWatches {
        inner: std::sync::Mutex::new(WatchSet::default()),
    };
    {
        let mut set = state.inner.lock().map_err(FileError::io)?;
        add_watch(app, &mut set, Scope::Global, None, &data.join("global"));
        add_watch(
            app,
            &mut set,
            Scope::Space,
            Some(crate::spaces::DEFAULT_ID),
            &scoped_root(&data, Scope::Space),
        );
    }
    Ok(state)
}
fn add_watch(
    app: &tauri::AppHandle,
    state: &mut WatchSet,
    scope: Scope,
    space_id: Option<&str>,
    root: &Path,
) {
    let key = space_id.unwrap_or("global").to_owned();
    if state.watchers.contains_key(&key) {
        return;
    }
    let handle = app.clone();
    let space_id = space_id.map(str::to_owned);
    let watch = watch_root(
        root,
        move |event: notify::Result<notify::Event>| match event {
            Ok(event) if !event.kind.is_access() => {
                let _ = handle.emit(
                    "slate://workspace-changed",
                    Change {
                        scope,
                        space_id: space_id.clone(),
                        error: None,
                    },
                );
            }
            Err(error) => {
                let _ = handle.emit(
                    "slate://workspace-changed",
                    Change {
                        scope,
                        space_id: space_id.clone(),
                        error: Some(error.to_string()),
                    },
                );
            }
            _ => {}
        },
    );
    match watch {
        Ok(watcher) => {
            state.watchers.insert(key.clone(), watcher);
            state.errors.remove(&key);
        }
        Err(error) => {
            state.errors.insert(key, error.message);
        }
    }
}
#[tauri::command]
pub async fn workspace_watch_status(
    app: tauri::AppHandle,
    space_id: Option<String>,
) -> Result<Vec<String>, FileError> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = space_id.as_deref().unwrap_or(crate::spaces::DEFAULT_ID);
        let root = crate::spaces::resolve(&app, Some(id))?;
        let state = app.state::<WorkspaceWatches>();
        let mut set = state.inner.lock().map_err(FileError::io)?;
        add_watch(&app, &mut set, Scope::Space, Some(id), &root);
        Ok(["global", id]
            .iter()
            .filter_map(|key| set.errors.get(*key).cloned())
            .collect())
    })
    .await
    .map_err(FileError::io)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roots_are_fixed_and_global_calls_cannot_access_space_paths() {
        let data = Path::new("slate-data");
        assert_eq!(scoped_root(data, Scope::Space), data.join("spaces/default"));
        assert_eq!(scoped_root(data, Scope::Global), data);
        assert!(check_scope(Scope::Global, "spaces/default/note.md").is_err());
        assert!(check_scope(Scope::Global, "global/snippets.json").is_ok());
        assert!(serde_json::from_str::<Scope>("\"C:/arbitrary/root\"").is_err());
    }

    #[test]
    fn a_real_external_write_is_observed_within_500_ms() {
        let root = std::env::temp_dir().join(format!(
            "slate-watch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("external.md");
        let observed = path.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let watcher = watch_root(&root, move |event: notify::Result<notify::Event>| {
            if matches!(event, Ok(event) if !event.kind.is_access())
                && std::fs::read(&observed).ok().as_deref() == Some(b"External words".as_slice())
            {
                let _ = sent.send(());
            }
        })
        .unwrap();
        std::fs::write(&path, b"External words").unwrap();
        let result = received.recv_timeout(std::time::Duration::from_millis(500));
        drop(watcher);
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        std::fs::remove_dir_all(root).unwrap();
        result.expect("the native reference watcher must deliver external changes within 500ms");
    }
}
