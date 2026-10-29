use percent_encoding::percent_decode_str;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;

#[derive(Default)]
struct LaunchQueue(Mutex<Vec<String>>);

fn collect_launch_files(app: &tauri::AppHandle, args: Vec<String>, cwd: &str) {
    let mut accepted = Vec::new();
    for arg in args.into_iter().skip(1) {
        let path = PathBuf::from(arg);
        let path = if path.is_absolute() { path } else { Path::new(cwd).join(path) };
        if path.is_file() && app.fs_scope().allow_file(&path).is_ok() {
            accepted.push(path.to_string_lossy().to_string());
        }
    }
    if !accepted.is_empty() {
        if let Some(queue) = app.try_state::<LaunchQueue>() {
            if let Ok(mut files) = queue.0.lock() { files.extend(accepted); }
        }
        let _ = app.emit("morrow-open-files", ());
    }
}

#[tauri::command]
fn take_launch_files(queue: State<'_, LaunchQueue>) -> Vec<String> {
    match queue.0.lock() { Ok(mut files) => std::mem::take(&mut *files), Err(_) => Vec::new() }
}

fn atomic_write(path: &Path, data: &[u8], expected: &str, force: bool) -> Result<(), String> {
    if data.len() > MAX_FILE_BYTES { return Err("This file exceeds the 20 MiB safety limit.".into()); }
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() { return Err("Saving through a symbolic link is not supported. Open the real file instead.".into()); }
            if !meta.is_file() { return Err("The selected destination is not a regular file.".into()); }
            if meta.permissions().readonly() { return Err("The selected file is read-only.".into()); }
            Some(meta)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("Cannot inspect destination: {err}")),
    };
    if !force && !expected.is_empty() {
        if metadata.as_ref().is_some_and(|meta| meta.len() > MAX_FILE_BYTES as u64) {
            return Err("MORROW_FILE_CHANGED: the file grew beyond the safety limit".into());
        }
        let bytes = fs::read(path).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound { "MORROW_FILE_CHANGED: file no longer exists".to_string() }
            else { format!("Cannot check the file on disk: {err}") }
        })?;
        let current = format!("{:x}", Sha256::digest(&bytes));
        if current != expected { return Err("MORROW_FILE_CHANGED: file differs from the version you opened".into()); }
    }
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).ok_or("No parent directory for the selected file.")?;
    let mut temporary = tempfile::Builder::new().prefix(".morrow-").tempfile_in(parent)
        .map_err(|err| format!("Cannot create a temporary file beside the destination: {err}"))?;
    temporary.write_all(data).map_err(|err| format!("Cannot write file: {err}"))?;
    temporary.as_file().sync_all().map_err(|err| format!("Cannot flush file to disk: {err}"))?;
    if let Some(meta) = metadata {
        temporary.as_file().set_permissions(meta.permissions()).map_err(|err| format!("Cannot preserve file permissions: {err}"))?;
    }
    temporary.persist(path).map_err(|err| format!("Cannot replace the original file: {}", err.error))?;
    Ok(())
}

/// Only files explicitly selected in a native dialog, dropped, or launched as arguments
/// are in the plugin's dynamic scope. Body is raw bytes; the path is percent-encoded.
#[tauri::command]
async fn safe_write(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        _ => return Err("Expected raw file data.".into()),
    };
    if data.len() > MAX_FILE_BYTES { return Err("This file exceeds the 20 MiB safety limit.".into()); }
    let header = |key: &str| -> Result<String, String> {
        request.headers().get(key).and_then(|h| h.to_str().ok()).map(str::to_owned).ok_or_else(|| format!("Missing {key} header."))
    };
    let encoded = header("x-morrow-path")?;
    let path = PathBuf::from(percent_decode_str(&encoded).decode_utf8().map_err(|_| "Invalid file path encoding.")?.into_owned());
    let expected = header("x-morrow-expected")?;
    let force = header("x-morrow-force")? == "1";
    if !app.fs_scope().is_allowed(&path) { return Err("This file has not been selected for access in Morrow.".into()); }
    tauri::async_runtime::spawn_blocking(move || atomic_write(&path, &data, &expected, force))
        .await.map_err(|err| format!("Save task failed: {err}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LaunchQueue::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            collect_launch_files(app, args, &cwd);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().to_string();
            collect_launch_files(app.handle(), std::env::args().collect(), &cwd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![safe_write, take_launch_files])
        .run(tauri::generate_context!())
        .expect("error while running Morrow");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn safe_write_detects_external_changes_and_preserves_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let old_hash = format!("{:x}", Sha256::digest(b"original"));
        fs::write(&path, b"changed by another app").unwrap();
        assert!(atomic_write(&path, b"new", &old_hash, false).unwrap_err().contains("MORROW_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), b"changed by another app");
        atomic_write(&path, b"new", &old_hash, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
    }
    #[test]
    fn safe_write_creates_file_in_selected_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hello.txt");
        atomic_write(&path, b"hello", "", false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }
}
