use percent_encoding::percent_decode_str;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_fs::FsExt;

const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 2_000;

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

/// Only files or folders selected, dropped, or launched by the user are in the
/// plugin's dynamic scope. Body is raw bytes; the path is percent-encoded.
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

/// Windows junctions and other reparse points are deliberately not treated as
/// ordinary files or folders. This does not close races in parent directories.
fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_type().is_symlink() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    { metadata.file_type().is_symlink() }
}

/// Read at most one extra entry to detect truncation; do not materialize an
/// arbitrarily large native directory listing in Rust or the webview.
fn bounded_directory(path: &Path) -> Result<serde_json::Value, String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| format!("Cannot inspect folder: {err}"))?;
    if is_link_or_reparse(&metadata) || !metadata.is_dir() { return Err("This is not a regular folder, or it is a link/reparse point.".into()); }
    let mut source = fs::read_dir(path).map_err(|err| format!("Cannot read folder: {err}"))?;
    let mut entries = Vec::new();
    let mut skipped = 0usize;
    for _ in 0..MAX_DIRECTORY_ENTRIES {
        let entry = match source.next() {
            Some(Ok(entry)) => entry,
            Some(Err(_)) => { skipped += 1; continue; }
            None => return Ok(serde_json::json!({ "entries": entries, "skippedLinks": skipped, "truncated": false })),
        };
        // Do not use a lossy filename: it could accidentally refer to another path.
        let name = match entry.file_name().into_string() { Ok(name) => name, Err(_) => { skipped += 1; continue; } };
        let metadata = match fs::symlink_metadata(entry.path()) { Ok(value) => value, Err(_) => { skipped += 1; continue; } };
        if is_link_or_reparse(&metadata) || (!metadata.is_file() && !metadata.is_dir()) { skipped += 1; continue; }
        entries.push(serde_json::json!({ "name": name, "isFile": metadata.is_file(), "isDirectory": metadata.is_dir() }));
    }
    Ok(serde_json::json!({ "entries": entries, "skippedLinks": skipped, "truncated": source.next().is_some() }))
}

/// Bound native reads even if the file grows after the metadata check. The final
/// component is opened without following links; parent-directory races remain.
fn bounded_read(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    if max_bytes == 0 || max_bytes > MAX_FILE_BYTES { return Err("Invalid file size limit.".into()); }
    let metadata = fs::symlink_metadata(path).map_err(|err| format!("Cannot inspect file: {err}"))?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() { return Err("Symbolic links, reparse points and non-regular files are skipped.".into()); }
    if metadata.len() > max_bytes as u64 { return Err(format!("File exceeds the {} MiB limit for this operation.", max_bytes / 1024 / 1024)); }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(|err| format!("Cannot open file: {err}"))?;
    let opened = file.metadata().map_err(|err| format!("Cannot inspect open file: {err}"))?;
    if is_link_or_reparse(&opened) || !opened.is_file() { return Err("The opened item is not a regular file.".into()); }
    let mut bytes = Vec::new();
    file.take(max_bytes as u64 + 1).read_to_end(&mut bytes).map_err(|err| format!("Cannot read file: {err}"))?;
    if bytes.len() > max_bytes { return Err("File grew beyond the size limit while reading.".into()); }
    Ok(bytes)
}

#[tauri::command]
async fn workspace_list_directory(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let path = PathBuf::from(path);
    if !app.fs_scope().is_allowed(&path) { return Err("This folder has not been selected for access in Morrow.".into()); }
    tauri::async_runtime::spawn_blocking(move || bounded_directory(&path)).await.map_err(|err| format!("Folder task failed: {err}"))?
}

#[tauri::command]
async fn workspace_read_file(app: tauri::AppHandle, path: String, max_bytes: usize) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    if !app.fs_scope().is_allowed(&path) { return Err("This file has not been selected for access in Morrow.".into()); }
    let bytes = tauri::async_runtime::spawn_blocking(move || bounded_read(&path, max_bytes)).await.map_err(|err| format!("File task failed: {err}"))??;
    Ok(tauri::ipc::Response::new(bytes))
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().to_string();
            collect_launch_files(app.handle(), std::env::args().collect(), &cwd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![safe_write, take_launch_files, workspace_list_directory, workspace_read_file])
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
    fn workspace_file_read_is_bounded_and_rejects_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.txt");
        fs::write(&path, b"123456").unwrap();
        assert_eq!(bounded_read(&path, 6).unwrap(), b"123456");
        assert!(bounded_read(&path, 5).is_err());
        assert!(bounded_read(dir.path(), 10).is_err());
        assert!(bounded_read(&path, MAX_FILE_BYTES + 1).is_err());
    }
    #[test]
    fn workspace_listing_is_bounded_before_serialization() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..(MAX_DIRECTORY_ENTRIES + 1) {
            fs::write(dir.path().join(format!("{n}.txt")), b"").unwrap();
        }
        let listing = bounded_directory(dir.path()).unwrap();
        assert_eq!(listing["entries"].as_array().unwrap().len(), MAX_DIRECTORY_ENTRIES);
        assert_eq!(listing["truncated"], true);
    }
    #[cfg(unix)]
    #[test]
    fn workspace_skips_links_in_listings_and_reads() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("real.txt"), b"real").unwrap();
        symlink(dir.path().join("real.txt"), dir.path().join("link.txt")).unwrap();
        let listing = bounded_directory(dir.path()).unwrap();
        assert_eq!(listing["entries"].as_array().unwrap().len(), 1);
        assert_eq!(listing["skippedLinks"], 1);
        assert!(bounded_read(&dir.path().join("link.txt"), 20).is_err());
    }
    #[test]
    fn safe_write_creates_file_in_selected_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hello.txt");
        atomic_write(&path, b"hello", "", false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }
}
