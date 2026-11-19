fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "write_sheet",
            "write_numbered_asset",
            "list_markdown_files",
            "read_markdown_file",
            "read_tidy_settings",
            "write_tidy_settings",
            "list_workspace_files",
            "read_workspace_file",
            "create_workspace_file",
            "save_workspace_file",
            "move_workspace_file",
            "trash_workspace_file",
            "workspace_watch_status",
            "replace_workspace_index",
            "search_workspace_index",
        ]),
    ))
    .expect("failed to generate Slate's command permissions");
}
