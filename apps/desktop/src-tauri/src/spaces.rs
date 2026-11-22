use crate::workspace::FileError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
mod associations;
mod selection;
pub(crate) use associations::{markdown, AssociatedFile};

pub const DEFAULT_ID: &str = "native-default";
const CATALOG_PATH: &str = "desktop-spaces.json";

#[derive(Clone, Serialize)]
pub struct SpaceRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    path: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Folder {
    id: String,
    name: String,
    path: PathBuf,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    version: u8,
    folders: Vec<Folder>,
}
#[derive(Default)]
struct Roots {
    // Once admitted, an ID cannot be redirected while this process has pending IO.
    pinned: BTreeMap<String, PathBuf>,
}
pub struct NativeSpaces {
    data: PathBuf,
    roots: Mutex<Roots>,
    selection: Mutex<()>,
}
fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id)
}
fn record(folder: &Folder) -> SpaceRecord {
    SpaceRecord {
        id: folder.id.clone(),
        name: folder.name.clone(),
        path: folder.path.to_str().map(str::to_owned),
    }
}
fn changed_catalog() -> FileError {
    FileError::io("The Spaces list changed or is invalid. Your folders were kept. Restart Slate and check desktop-spaces.json before trying again.")
}
impl NativeSpaces {
    pub fn new(data: PathBuf) -> Result<Self, FileError> {
        std::fs::create_dir_all(&data).map_err(FileError::io)?;
        Ok(Self {
            data: std::fs::canonicalize(data).map_err(FileError::io)?,
            roots: Mutex::new(Roots::default()),
            selection: Mutex::new(()),
        })
    }
    fn read(&self, roots: &mut Roots) -> Result<(Catalog, Option<Vec<u8>>), FileError> {
        let bytes = slate_core::read_workspace_file(&self.data, CATALOG_PATH)?;
        let catalog: Catalog = match bytes.as_deref() {
            Some(bytes) => serde_json::from_slice(bytes).map_err(|_| changed_catalog())?,
            None => Catalog {
                version: 1,
                folders: vec![],
            },
        };
        let mut ids = BTreeSet::new();
        let mut paths = BTreeSet::new();
        if catalog.version != 1 {
            return Err(changed_catalog());
        }
        for folder in &catalog.folders {
            if !valid_id(&folder.id)
                || !ids.insert(folder.id.clone())
                || !folder.path.is_absolute()
                || folder.path.to_str().is_none()
                || folder.path.starts_with(&self.data)
                || !paths.insert(folder.path.clone())
                || folder.name.trim().is_empty()
                || roots
                    .pinned
                    .get(&folder.id)
                    .is_some_and(|path| path != &folder.path)
            {
                return Err(changed_catalog());
            }
        }
        for folder in &catalog.folders {
            roots.pinned.insert(folder.id.clone(), folder.path.clone());
        }
        Ok((catalog, bytes))
    }
    pub fn list(&self) -> Result<Vec<SpaceRecord>, FileError> {
        let mut roots = self.roots.lock().map_err(FileError::io)?;
        let (catalog, _) = self.read(&mut roots)?;
        let mut list = vec![SpaceRecord {
            id: DEFAULT_ID.into(),
            name: "Slate".into(),
            path: None,
        }];
        list.extend(catalog.folders.iter().map(record));
        Ok(list)
    }
    pub fn resolve(&self, id: Option<&str>) -> Result<PathBuf, FileError> {
        let id = id.unwrap_or(DEFAULT_ID);
        if id == DEFAULT_ID {
            return Ok(self.data.join("spaces/default"));
        }
        if !valid_id(id) {
            return Err(FileError::io("Unknown Space. Choose a folder from Spaces."));
        }
        let mut roots = self.roots.lock().map_err(FileError::io)?;
        if !roots.pinned.contains_key(id) {
            self.read(&mut roots)?;
        }
        let path = roots
            .pinned
            .get(id)
            .ok_or_else(|| FileError::io("Unknown Space. Choose a folder from Spaces."))?;
        // A disconnected or replaced folder must never become a new empty Space.
        let actual = std::fs::canonicalize(path).map_err(FileError::io)?;
        if &actual != path || !actual.is_dir() || actual.starts_with(&self.data) {
            return Err(FileError::io("This Space moved or is unavailable. Choose its folder again; existing files were kept."));
        }
        Ok(actual)
    }
    pub(crate) fn register(&self, selected: &Path) -> Result<SpaceRecord, FileError> {
        let path = std::fs::canonicalize(selected).map_err(FileError::io)?;
        if !path.is_dir() || path.to_str().is_none() || path.starts_with(&self.data) {
            return Err(FileError::io(
                "Choose a notes folder outside Slate's application data.",
            ));
        }
        let mut roots = self.roots.lock().map_err(FileError::io)?;
        let (mut catalog, base) = self.read(&mut roots)?;
        if let Some(existing) = catalog.folders.iter().find(|folder| folder.path == path) {
            return Ok(record(existing));
        }
        let folder = Folder {
            id: uuid::Uuid::new_v4().to_string(),
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.trim().is_empty())
                .unwrap_or("Folder")
                .to_owned(),
            path,
        };
        catalog.folders.push(folder.clone());
        let bytes = serde_json::to_vec_pretty(&catalog).map_err(FileError::io)?;
        if let Some(base) = base {
            let saved =
                slate_core::save_workspace_file(&self.data, CATALOG_PATH, &bytes, Some(&base))?;
            if saved.status != slate_core::WriteSheetStatus::Written {
                return Err(changed_catalog());
            }
        } else if !slate_core::create_workspace_file(&self.data, CATALOG_PATH, &bytes)? {
            return Err(changed_catalog());
        }
        roots.pinned.insert(folder.id.clone(), folder.path.clone());
        Ok(record(&folder))
    }
}

pub fn resolve(app: &tauri::AppHandle, id: Option<&str>) -> Result<PathBuf, FileError> {
    app.state::<NativeSpaces>().resolve(id)
}
#[tauri::command]
pub async fn list_native_spaces(app: tauri::AppHandle) -> Result<Vec<SpaceRecord>, FileError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeSpaces>().list())
        .await
        .map_err(FileError::io)?
}
#[tauri::command]
pub async fn pick_native_space(app: tauri::AppHandle) -> Result<Option<SpaceRecord>, FileError> {
    // The renderer supplies no filesystem root. Only this OS picker grants one.
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = handle
            .dialog()
            .file()
            .set_title("Open a notes folder")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = folder.into_path().map_err(FileError::io)?;
        handle.state::<NativeSpaces>().register(&path).map(Some)
    })
    .await
    .map_err(FileError::io)?
}

#[tauri::command]
pub async fn startup_native_space(app: tauri::AppHandle) -> Result<Option<SpaceRecord>, FileError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeSpaces>().startup())
        .await
        .map_err(FileError::io)?
}
#[tauri::command]
pub async fn remember_native_space(
    app: tauri::AppHandle,
    id: String,
) -> Result<SpaceRecord, FileError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<NativeSpaces>().remember(&id))
        .await
        .map_err(FileError::io)?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("slate-spaces-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(path.join("data")).unwrap();
            std::fs::create_dir_all(path.join("notes")).unwrap();
            std::fs::create_dir_all(path.join("other")).unwrap();
            Self(path)
        }
        fn registry(&self) -> NativeSpaces {
            NativeSpaces::new(self.0.join("data")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("slate-spaces-"));
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }
    #[test]
    fn selected_folders_have_persistent_deduplicated_ids_without_note_writes() {
        let fixture = Fixture::new();
        let registry = fixture.registry();
        std::fs::write(fixture.0.join("notes/kept.md"), [0xef, 0xbb, 0xbf, 0xff]).unwrap();
        let first = registry.register(&fixture.0.join("notes")).unwrap();
        let again = registry.register(&fixture.0.join("notes/.")).unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(registry.list().unwrap().len(), 2);
        let reopened = fixture.registry();
        assert_eq!(reopened.list().unwrap()[1].id, first.id);
        assert_eq!(
            reopened.resolve(Some(&first.id)).unwrap(),
            std::fs::canonicalize(fixture.0.join("notes")).unwrap()
        );
        assert_eq!(
            std::fs::read(fixture.0.join("notes/kept.md")).unwrap(),
            [0xef, 0xbb, 0xbf, 0xff]
        );
        assert_eq!(
            std::fs::read_dir(fixture.0.join("notes")).unwrap().count(),
            1
        );
    }
    #[test]
    fn captured_roots_keep_pending_writes_in_the_original_space() {
        let fixture = Fixture::new();
        let registry = fixture.registry();
        let first = registry.register(&fixture.0.join("notes")).unwrap();
        let captured = registry.resolve(Some(&first.id)).unwrap();
        let second = registry.register(&fixture.0.join("other")).unwrap();
        let other = registry.resolve(Some(&second.id)).unwrap();
        slate_core::create_workspace_file(&captured, "same.md", b"First draft").unwrap();
        slate_core::create_workspace_file(&other, "same.md", b"Second draft").unwrap();
        slate_core::save_workspace_file(
            &captured,
            "same.md",
            b"Pending first save",
            Some(b"First draft"),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(other.join("same.md")).unwrap(),
            b"Second draft"
        );
        assert_eq!(
            std::fs::read(captured.join("same.md")).unwrap(),
            b"Pending first save"
        );
    }
    #[test]
    fn corrupt_catalog_is_preserved_and_never_replaced_by_picker_registration() {
        let fixture = Fixture::new();
        let registry = fixture.registry();
        let bytes = b"{broken\xff";
        std::fs::write(fixture.0.join("data").join(CATALOG_PATH), bytes).unwrap();
        assert!(registry.list().is_err());
        assert!(registry.register(&fixture.0.join("notes")).is_err());
        assert_eq!(
            std::fs::read(fixture.0.join("data").join(CATALOG_PATH)).unwrap(),
            bytes
        );
        assert!(registry.resolve(None).unwrap().ends_with("spaces/default"));
    }
    #[test]
    fn unknown_ids_and_missing_folders_never_fall_back_to_default_or_create_folders() {
        let fixture = Fixture::new();
        let registry = fixture.registry();
        let first = registry.register(&fixture.0.join("notes")).unwrap();
        std::fs::rename(fixture.0.join("notes"), fixture.0.join("moved")).unwrap();
        assert!(registry.resolve(Some(&first.id)).is_err());
        for id in [
            "../notes",
            "C:/notes",
            "unknown",
            &uuid::Uuid::new_v4().to_string(),
        ] {
            assert!(registry.resolve(Some(id)).is_err());
        }
        assert!(!fixture.0.join("notes").exists());
        assert!(registry.register(&fixture.0.join("data")).is_err());
    }
    #[test]
    fn external_catalog_cannot_redirect_a_pinned_id() {
        let fixture = Fixture::new();
        let registry = fixture.registry();
        let first = registry.register(&fixture.0.join("notes")).unwrap();
        let path = fixture.0.join("data").join(CATALOG_PATH);
        let mut catalog: Catalog = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        catalog.folders[0].path = std::fs::canonicalize(fixture.0.join("other")).unwrap();
        let altered = serde_json::to_vec(&catalog).unwrap();
        std::fs::write(&path, &altered).unwrap();
        assert!(registry.list().is_err());
        assert!(registry.register(&fixture.0.join("other")).is_err());
        assert!(registry
            .resolve(Some(&first.id))
            .unwrap()
            .ends_with("notes"));
        assert_eq!(std::fs::read(path).unwrap(), altered);
    }
}
