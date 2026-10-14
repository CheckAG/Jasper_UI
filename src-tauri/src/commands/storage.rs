use tauri::State;
use crate::state::AppState;
use crate::storage::db::{
    self, SessionRow, CaptureRow, AuditRow,
};
use crate::storage::files;

fn open(state: &AppState) -> Result<rusqlite::Connection, String> {
    db::open(&state.db_path).map_err(|e| e.to_string())
}

// ── Small JSON stores ─────────────────────────────────────────────────────────
// profiles.json (named settings profiles) and recent.json (recent workspaces
// and exports). The frontend owns their shape; the backend only keeps them in
// the app data folder. Null when the file does not exist yet.

const STORES: [&str; 2] = ["profiles", "recent"];

fn store_path(state: &AppState, name: &str) -> Result<std::path::PathBuf, String> {
    if !STORES.contains(&name) { return Err(format!("no store {name:?}")); }
    Ok(state.data_dir.join(format!("{name}.json")))
}

#[tauri::command]
pub fn cmd_load_store(state: State<'_, AppState>, name: String) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(store_path(&state, &name)?) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{name}.json is unreadable: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn cmd_save_store(state: State<'_, AppState>, name: String, value: serde_json::Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(store_path(&state, &name)?, text).map_err(|e| e.to_string())
}

/// Show a file in the system file manager (its folder, selected where the
/// platform can), e.g. a recent export.
#[tauri::command]
pub fn cmd_reveal(path: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if !path.exists() { return Err(format!("{} no longer exists", path.display())); }
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{}", path.display()));
        c
    } else if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(path);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(if path.is_dir() { path } else { path.parent().unwrap_or(path) });
        c
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not open the file manager: {e}"))
}

// ── Sessions ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_save_session(
    state: State<'_, AppState>,
    session: SessionRow,
) -> Result<(), String> {
    let conn = open(&state)?;
    db::insert_session(&conn, &session).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_load_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionRow>, String> {
    let conn = open(&state)?;
    db::load_sessions(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_delete_session(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = open(&state)?;
    db::delete_session(&conn, &id).map_err(|e| e.to_string())
}

// ── Captures ──────────────────────────────────────────────────────────────────

/// The folder a workspace's .jdx files go in (it may not exist yet).
#[tauri::command]
pub fn cmd_workspace_dir(state: State<'_, AppState>, name: String) -> String {
    files::workspace_dir(&state.spectra_root, &name).to_string_lossy().to_string()
}

#[tauri::command]
pub fn cmd_load_captures(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<CaptureRow>, String> {
    let conn = open(&state)?;
    db::load_captures(&conn, &session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_delete_capture(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn = open(&state)?;
    if let Some(path) = db::delete_capture(&conn, &id).map_err(|e| e.to_string())? {
        // The row is gone either way; a file that cannot be moved stays put.
        if let Err(e) = files::trash(std::path::Path::new(&path)) {
            eprintln!("[storage] could not move {path} to .trash: {e}");
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_count_captures(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<i64, String> {
    let conn = open(&state)?;
    db::count_captures(&conn, &session_id).map_err(|e| e.to_string())
}

// ── Audit ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_save_audit(
    state: State<'_, AppState>,
    entry: AuditRow,
) -> Result<(), String> {
    let conn = open(&state)?;
    db::insert_audit(&conn, &entry).map_err(|e| e.to_string())
}
