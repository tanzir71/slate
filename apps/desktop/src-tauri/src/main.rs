use tauri::Manager;
mod file_info;
mod legacy_workspace;
mod workspace;
mod workspace_index;

fn main() {
    tauri::Builder::default()
        .manage(workspace_index::WorkspaceIndex::default())
        .setup(|app| {
            app.manage(workspace::start_watches(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            legacy_workspace::write_sheet,
            legacy_workspace::write_numbered_asset,
            legacy_workspace::list_markdown_files,
            legacy_workspace::read_markdown_file,
            legacy_workspace::read_tidy_settings,
            legacy_workspace::write_tidy_settings,
            workspace::list_workspace_files,
            workspace::read_workspace_file,
            file_info::read_workspace_file_info,
            file_info::reveal_workspace_file,
            workspace::create_workspace_file,
            workspace::save_workspace_file,
            workspace::move_workspace_file,
            workspace::trash_workspace_file,
            workspace::workspace_watch_status,
            workspace_index::replace_workspace_index,
            workspace_index::search_workspace_index
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Slate desktop shell");
}
