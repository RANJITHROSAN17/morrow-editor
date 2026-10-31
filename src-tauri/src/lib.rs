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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExpectedVersion<'a> { Absent, Hash(&'a str) }

/// Empty or arbitrary metadata never grants overwrite permission. The explicit
/// "absent" sentinel also survives WebView2 transports that drop empty headers.
fn parse_expected(value: &str) -> Result<ExpectedVersion<'_>, String> {
    if value == "absent" { return Ok(ExpectedVersion::Absent); }
    if value.len() == 64 && value.bytes().all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)) {
        return Ok(ExpectedVersion::Hash(value));
    }
    Err("Invalid expected file version.".into())
}
fn parse_force(value: &str) -> Result<bool, String> {
    match value { "0" => Ok(false), "1" => Ok(true), _ => Err("Invalid overwrite confirmation.".into()) }
}

fn atomic_write(path: &Path, data: &[u8], expected: &str, force: bool) -> Result<(), String> {
    let expected = parse_expected(expected)?;
    if data.len() > MAX_FILE_BYTES { return Err("This file exceeds the 20 MiB safety limit.".into()); }
    let metadata = match fs::symlink_metadata(path) {
        Ok(meta) => {
            if is_link_or_reparse(&meta) { return Err("Saving through a link or reparse point is not supported. Open the real file instead.".into()); }
            if !meta.is_file() { return Err("The selected destination is not a regular file.".into()); }
            if meta.permissions().readonly() { return Err("The selected file is read-only.".into()); }
            Some(meta)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("Cannot inspect destination: {err}")),
    };
    if !force {
        match expected {
            ExpectedVersion::Absent if metadata.is_some() => return Err("MORROW_FILE_CHANGED: destination already exists".into()),
            ExpectedVersion::Absent => {},
            ExpectedVersion::Hash(hash) => {
                if metadata.is_none() { return Err("MORROW_FILE_CHANGED: file no longer exists".into()); }
                if metadata.as_ref().is_some_and(|meta| meta.len() > MAX_FILE_BYTES as u64) {
                    return Err("MORROW_FILE_CHANGED: the file grew beyond the safety limit".into());
                }
                // Bounded and no-follow read, including if the file grows after stat.
                let bytes = bounded_read(path, MAX_FILE_BYTES)
                    .map_err(|_| "MORROW_FILE_CHANGED: cannot verify the file on disk".to_string())?;
                let current = format!("{:x}", Sha256::digest(&bytes));
                if current != hash { return Err("MORROW_FILE_CHANGED: file differs from the version you opened".into()); }
            }
        }
    }
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).ok_or("No parent directory for the selected file.")?;
    let mut temporary = tempfile::Builder::new().prefix(".morrow-").tempfile_in(parent)
        .map_err(|err| format!("Cannot create a temporary file beside the destination: {err}"))?;
    temporary.write_all(data).map_err(|err| format!("Cannot write file: {err}"))?;
    temporary.as_file().sync_all().map_err(|err| format!("Cannot flush file to disk: {err}"))?;
    if let Some(meta) = metadata {
        temporary.as_file().set_permissions(meta.permissions()).map_err(|err| format!("Cannot preserve file permissions: {err}"))?;
    }
    if !force && expected == ExpectedVersion::Absent {
        // Also refuse to overwrite a file created after the first existence check.
        temporary.persist_noclobber(path).map_err(|err| {
            if err.error.kind() == std::io::ErrorKind::AlreadyExists { "MORROW_FILE_CHANGED: destination now exists".to_string() }
            else { format!("Cannot create the selected file: {}", err.error) }
        })?;
    } else {
        // Existing-file conflict detection is best-effort: another process can
        // still race between the check and replacement. It is not a file lock.
        temporary.persist(path).map_err(|err| format!("Cannot replace the original file: {}", err.error))?;
    }
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
    if !path.is_absolute() || path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Invalid file path.".into());
    }
    let expected = header("x-morrow-expected")?;
    parse_expected(&expected)?;
    let force = parse_force(&header("x-morrow-force")?)?;
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

/// A conservative, cross-platform single component; rejects Windows device names
/// and alternate data streams even when running tests on another operating system.
fn valid_new_entry_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." || name.encode_utf16().count() > 180
        || name.ends_with(' ') || name.ends_with('.')
        || name.chars().any(|ch| ch <= '\u{1f}' || "<>:\"/\\|?*".contains(ch)) { return false; }
    let stem = name.split(['.', ' ']).next().unwrap_or("").to_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        || ["COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³"].contains(&stem.as_str());
    !device
}

/// Recheck each existing component and its canonical containment. This avoids
/// intentionally following links/junctions but cannot eliminate parent-directory
/// races with another local process between the checks and the create syscall.
fn checked_workspace_parent(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !root.is_absolute() || root.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Invalid workspace root.".into());
    }
    let meta = fs::symlink_metadata(root).map_err(|err| format!("Cannot inspect workspace root: {err}"))?;
    if is_link_or_reparse(&meta) || !meta.is_dir() { return Err("Choose a regular folder, not a link or reparse point.".into()); }
    let canonical_root = fs::canonicalize(root).map_err(|err| format!("Cannot resolve workspace root: {err}"))?;
    let mut parent = root.to_path_buf();
    if !relative.is_empty() {
        for component in relative.split('/') {
            if component.is_empty() || component == "." || component == ".." || component.contains(['\\', '\0']) {
                return Err("Invalid folder path.".into());
            }
            parent.push(component);
            let meta = fs::symlink_metadata(&parent).map_err(|err| format!("Cannot inspect target folder: {err}"))?;
            if is_link_or_reparse(&meta) || !meta.is_dir() { return Err("Links and reparse points are not supported in workspace paths.".into()); }
            let resolved = fs::canonicalize(&parent).map_err(|err| format!("Cannot resolve target folder: {err}"))?;
            if !resolved.starts_with(&canonical_root) { return Err("The target folder is outside the selected workspace.".into()); }
        }
    }
    Ok(parent)
}

fn create_workspace_child(root: &Path, relative: &str, name: &str, kind: &str) -> Result<(), String> {
    if !valid_new_entry_name(name) { return Err("Invalid file or folder name.".into()); }
    if kind != "file" && kind != "directory" { return Err("Invalid entry type.".into()); }
    let parent = checked_workspace_parent(root, relative)?;
    let target = parent.join(name);
    let result = if kind == "directory" {
        fs::create_dir(target)
    } else {
        fs::OpenOptions::new().write(true).create_new(true).open(target).map(|_| ())
    };
    result.map_err(|err| if err.kind() == std::io::ErrorKind::AlreadyExists {
        "An item with that name already exists. Nothing was overwritten.".to_string()
    } else { format!("Cannot create this item: {err}") })
}

#[tauri::command]
async fn workspace_create_entry(app: tauri::AppHandle, root: String, parent_relative: String, name: String, kind: String) -> Result<(), String> {
    let root = PathBuf::from(root);
    if !app.fs_scope().is_allowed(&root) { return Err("This folder has not been selected for access in Morrow.".into()); }
    // Scope check is on both the selected root and its verified descendant.
    tauri::async_runtime::spawn_blocking(move || {
        let parent = checked_workspace_parent(&root, &parent_relative)?;
        if !app.fs_scope().is_allowed(&parent) { return Err("This target folder is outside the selected file-access scope.".into()); }
        create_workspace_child(&root, &parent_relative, &name, &kind)
    }).await.map_err(|err| format!("Create task failed: {err}"))?
}

/// Fit an oversized/off-screen initial window to the selected monitor work area.
/// Sizes are physical pixels. This is best effort when the work area is smaller
/// than the configured minimum window size or changes after startup.
fn fit_initial_geometry(
    outer: (u32, u32), inner: (u32, u32), position: (i32, i32), area: (i32, i32, u32, u32),
) -> Option<((u32, u32), (i32, i32))> {
    if area.2 == 0 || area.3 == 0 { return None; }
    let right = i64::from(position.0) + i64::from(outer.0);
    let bottom = i64::from(position.1) + i64::from(outer.1);
    if position.0 >= area.0 && position.1 >= area.1
        && right <= i64::from(area.0) + i64::from(area.2)
        && bottom <= i64::from(area.1) + i64::from(area.3) { return None; }
    let target_outer = (outer.0.min(area.2.saturating_sub(16).max(1)), outer.1.min(area.3.saturating_sub(16).max(1)));
    let target_inner = (inner.0.saturating_sub(outer.0.saturating_sub(target_outer.0)).max(1), inner.1.saturating_sub(outer.1.saturating_sub(target_outer.1)).max(1));
    let x = i64::from(area.0) + i64::from(area.2.saturating_sub(target_outer.0) / 2);
    let y = i64::from(area.1) + i64::from(area.3.saturating_sub(target_outer.1) / 2);
    Some((target_inner, (x.clamp(i32::MIN as i64, i32::MAX as i64) as i32, y.clamp(i32::MIN as i64, i32::MAX as i64) as i32)))
}

fn fit_initial_window(window: &tauri::WebviewWindow) {
    let monitor = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten());
    if let (Some(monitor), Ok(outer), Ok(inner), Ok(position)) = (monitor, window.outer_size(), window.inner_size(), window.outer_position()) {
        let work = monitor.work_area();
        if let Some((size, pos)) = fit_initial_geometry((outer.width, outer.height), (inner.width, inner.height), (position.x, position.y), (work.position.x, work.position.y, work.size.width, work.size.height)) {
            let _ = window.set_size(tauri::PhysicalSize::new(size.0, size.1));
            let _ = window.set_position(tauri::PhysicalPosition::new(pos.0, pos.1));
        }
    }
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
            if let Some(window) = app.get_webview_window("main") { fit_initial_window(&window); }
            let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().to_string();
            collect_launch_files(app.handle(), std::env::args().collect(), &cwd);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![safe_write, take_launch_files, workspace_list_directory, workspace_read_file, workspace_create_entry])
        .run(tauri::generate_context!())
        .expect("error while running Morrow");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_geometry_uses_monitor_work_area_and_decorations() {
        // The saved Windows VM case: outer window 1044x788, work area 1024x720.
        let (inner, position) = fit_initial_geometry((1044, 788), (1024, 720), (0, 0), (0, 0, 1024, 720)).unwrap();
        assert_eq!(inner, (988, 636));
        assert_eq!(position, (8, 8));
        assert!(fit_initial_geometry((900, 650), (880, 600), (20, 20), (0, 0, 1024, 720)).is_none());
        let (_, negative_monitor) = fit_initial_geometry((1200, 900), (1180, 850), (0, 0), (-1920, -100, 1600, 900)).unwrap();
        assert!(negative_monitor.0 >= -1920 && negative_monitor.0 < 0);
        assert!(negative_monitor.1 >= -100);
    }
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
    fn workspace_create_is_single_component_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        for name in ["", ".", "..", "../escape", "a/b", "a\\b", "C:stream", "bad?name", "file.", "file ", "CON.txt", "aux", "COM9.md", "LPT¹"] {
            assert!(!valid_new_entry_name(name), "accepted unsafe name: {name:?}");
            assert!(create_workspace_child(dir.path(), "src", name, "file").is_err());
        }
        assert!(valid_new_entry_name("report 📝.md"));
        create_workspace_child(dir.path(), "src", "report 📝.md", "file").unwrap();
        let created = dir.path().join("src").join("report 📝.md");
        fs::write(&created, b"must survive").unwrap();
        assert!(create_workspace_child(dir.path(), "src", "report 📝.md", "file").is_err());
        assert!(create_workspace_child(dir.path(), "src", "report 📝.md", "directory").is_err());
        assert_eq!(fs::read(&created).unwrap(), b"must survive");
        create_workspace_child(dir.path(), "src", "notes", "directory").unwrap();
        assert!(dir.path().join("src").join("notes").is_dir());
        for parent in ["../other", "/absolute", "src/../other", "src\\..", "src//child"] {
            assert!(create_workspace_child(dir.path(), parent, "escape.txt", "file").is_err());
        }
        assert!(create_workspace_child(dir.path(), "src", "no.txt", "arbitrary").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn workspace_create_refuses_symlink_parents_and_targets() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("valuable.txt"), b"valuable").unwrap();
        symlink(outside.path(), dir.path().join("escape")).unwrap();
        symlink(outside.path().join("valuable.txt"), dir.path().join("existing.txt")).unwrap();
        assert!(create_workspace_child(dir.path(), "escape", "not-allowed.txt", "file").is_err());
        assert!(create_workspace_child(dir.path(), "", "existing.txt", "file").is_err());
        assert!(!outside.path().join("not-allowed.txt").exists());
        assert_eq!(fs::read(outside.path().join("valuable.txt")).unwrap(), b"valuable");
    }
    #[test]
    fn safe_write_creates_file_in_selected_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hello.txt");
        atomic_write(&path, b"hello", "absent", false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }
    #[test]
    fn save_metadata_must_be_explicit_and_valid() {
        assert_eq!(parse_expected("absent").unwrap(), ExpectedVersion::Absent);
        assert!(matches!(parse_expected(&"a".repeat(64)).unwrap(), ExpectedVersion::Hash(_)));
        for invalid in ["", "none", "0", "absent ", "zzzz", &"A".repeat(64), &"g".repeat(64)] {
            assert!(parse_expected(invalid).is_err(), "accepted invalid expected value: {invalid:?}");
        }
        assert_eq!(parse_force("0").unwrap(), false);
        assert_eq!(parse_force("1").unwrap(), true);
        for invalid in ["", "true", "2", "01"] { assert!(parse_force(invalid).is_err()); }
    }
    #[test]
    fn new_destination_does_not_silently_overwrite_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new file-📝.txt");
        fs::write(&path, b"valuable original").unwrap();
        assert!(atomic_write(&path, b"replacement", "absent", false).unwrap_err().contains("MORROW_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), b"valuable original");
        assert!(atomic_write(&path, b"replacement", "", true).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"valuable original");
        atomic_write(&path, b"replacement", "absent", true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement");
    }
    #[test]
    fn existing_file_requires_matching_hash_or_explicit_force() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.txt");
        let original = b"first\r\nline\n";
        fs::write(&path, original).unwrap();
        let hash = format!("{:x}", Sha256::digest(original));
        atomic_write(&path, "updated 🦉".as_bytes(), &hash, false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), "updated 🦉".as_bytes());
        assert!(atomic_write(&path, b"stale", &hash, false).unwrap_err().contains("MORROW_FILE_CHANGED"));
        assert_eq!(fs::read(&path).unwrap(), "updated 🦉".as_bytes());
        fs::remove_file(&path).unwrap();
        assert!(atomic_write(&path, b"stale", &hash, false).unwrap_err().contains("MORROW_FILE_CHANGED"));
        assert!(!path.exists());
    }
}
