// Sessions survive a write and a read.
//
// There were no storage tests at all, and a session that fails to save is
// invisible: the store updates React state first and only warns if the write
// throws, so the app looks right while the database stays empty.

use jasper_lib::storage::db::{self, SessionRow};

fn temp_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("jasper.db");
    let conn = db::open(path.to_str().unwrap()).expect("open creates the schema");
    (dir, conn)
}

fn session(id: &str, name: &str) -> SessionRow {
    SessionRow {
        id: id.into(),
        name: name.into(),
        operator: None,
        device: None,
        method_id: None,
        created_at: 1_700_000_000_000,
        status: "active".into(),
        signed_at: None,
        signed_by: None,
        params_json: None,
        calibration_json: None,
        notes: None,
        capture_count: 0,
    }
}

#[test]
fn a_saved_session_comes_back() {
    let (_dir, conn) = temp_db();
    assert!(db::load_sessions(&conn).expect("load").is_empty(), "a fresh database is empty");

    // The default session the app creates on first run: no device, no method,
    // no operator — every optional column null.
    db::insert_session(&conn, &session("s-default", "Default session")).expect("insert");

    let back = db::load_sessions(&conn).expect("load");
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].id, "s-default");
    assert_eq!(back[0].name, "Default session");
    assert_eq!(back[0].capture_count, 0, "no captures yet");
}

#[test]
fn saving_the_same_id_twice_replaces_rather_than_failing() {
    let (_dir, conn) = temp_db();
    db::insert_session(&conn, &session("s1", "First name")).expect("insert");
    db::insert_session(&conn, &session("s1", "Renamed")).expect("second insert");
    let back = db::load_sessions(&conn).expect("load");
    assert_eq!(back.len(), 1, "INSERT OR REPLACE, not a duplicate");
    assert_eq!(back[0].name, "Renamed");
}
