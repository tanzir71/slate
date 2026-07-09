use serde::Serialize;
use slate_core::{write_sheet_to_space, WriteSheetStatus};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[derive(Serialize)]
struct WriteSheetResponse {
    status: &'static str,
    path: String,
}

#[tauri::command]
fn write_sheet(
    app: tauri::AppHandle,
    path: String,
    content: String,
    base_content: Option<String>,
) -> Result<WriteSheetResponse, String> {
    let root = default_space_root(&app)?;
    let stamp = conflict_stamp()?;
    let outcome = write_sheet_to_space(&root, &path, &content, base_content.as_deref(), &stamp)
        .map_err(|error| error.to_string())?;

    Ok(WriteSheetResponse {
        status: match outcome.status {
            WriteSheetStatus::Written => "written",
            WriteSheetStatus::ConflictCopy => "conflict-copy",
        },
        path: outcome.path,
    })
}

fn default_space_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("spaces")
        .join("default"))
}

fn conflict_stamp() -> Result<String, String> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    Ok(format!("unix-{seconds}"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![write_sheet])
        .run(tauri::generate_context!())
        .expect("failed to run Slate desktop shell");
}
