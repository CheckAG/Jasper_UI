use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Open a native save dialog, then write `content` to the chosen path.
/// Returns the written path, or None if the user cancelled.
///
/// Async command (runs off the main thread) + callback-based dialog so the GTK
/// file picker runs on the main loop without deadlocking.
#[tauri::command]
pub async fn cmd_save_export(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .set_file_name(&default_name)
        .save_file(move |chosen| {
            let _ = tx.send(chosen);
        });

    let chosen = rx.recv().map_err(|e| e.to_string())?;

    match chosen {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|e| format!("invalid path: {e}"))?;
            std::fs::write(&path, content)
                .map_err(|e| format!("write failed: {e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}
