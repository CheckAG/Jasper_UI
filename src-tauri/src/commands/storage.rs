use tauri::State;
use crate::state::AppState;
use crate::storage::db::{
    self, SessionRow, CaptureRow, AuditRow,
};

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

#[tauri::command]
pub fn cmd_save_capture(
    state: State<'_, AppState>,
    capture: CaptureRow,
) -> Result<(), String> {
    let conn = open(&state)?;
    db::insert_capture(&conn, &capture).map_err(|e| e.to_string())
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
    db::delete_capture(&conn, &id).map_err(|e| e.to_string())
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
