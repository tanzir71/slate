use tauri::Manager;
mod file_info;
mod launches;
mod legacy_workspace;
mod spaces;
mod workspace;
mod workspace_index;

fn main() {
    let context = tauri::generate_context!();
    let launches = launches::NativeLaunches::initial(
        &context.config().identifier,
        std::env::args_os().collect(),
    );
    tauri::Builder::default()
        .manage(launches)
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            launches::secondary(app, args)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace_index::WorkspaceIndex::default())
        .setup(|app| {
            app.manage(spaces::NativeSpaces::new(app.path().app_data_dir()?)?);
            app.manage(workspace::start_watches(app.handle())?);
            launches::start(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launches::pending_native_launches,
            launches::bind_native_launch,
            launches::begin_native_launch,
            launches::apply_native_launch,
            launches::review_native_launch,
            launches::complete_native_launch,
            launches::next_native_launch,
            spaces::list_native_spaces,
            spaces::pick_native_space,
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
        .run(context)
        .expect("failed to run Slate desktop shell");
}
