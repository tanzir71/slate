use serde::Serialize;
use slate_core::{
    list_markdown_files_in_space, read_markdown_file_from_space, write_sheet_to_space,
    WriteSheetStatus,
};
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

#[tauri::command]
fn list_markdown_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = default_space_root(&app)?;
    list_markdown_files_in_space(&root).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_markdown_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = default_space_root(&app)?;
    read_markdown_file_from_space(&root, &path).map_err(|error| error.to_string())
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
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            write_sheet,
            list_markdown_files,
            read_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Slate desktop shell");
}
