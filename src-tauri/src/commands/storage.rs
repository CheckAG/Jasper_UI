use tauri::State;
use crate::state::AppState;
use crate::storage::db::{
    self, SessionRow, CaptureRow, AuditRow,
};
use crate::storage::files;

fn open(state: &AppState) -> Result<rusqlite::Connection, String> {
    db::open(&state.db_path).map_err(|e| e.to_string())
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
