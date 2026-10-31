fn main() {
    // Generate per-command permissions; the capability grants them only to
    // the bundled main webview. Remote content has no custom-command grants.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "safe_write",
        "take_launch_files",
        "workspace_list_directory",
        "workspace_read_file",
        "workspace_create_entry",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to build the Tauri permission manifest");
}
