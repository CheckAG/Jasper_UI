use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};

// ── Serializable row types ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionRow {
    pub id:               String,
    pub name:             String,
    pub operator:         Option<String>,
    pub device:           Option<String>,
    pub method_id:        Option<String>,
    pub created_at:       i64,
    pub status:           String,
    pub signed_at:        Option<i64>,
    pub signed_by:        Option<String>,
    pub params_json:      Option<String>,
    pub calibration_json: Option<String>,
    pub notes:            Option<String>,
    // Derived on load via subquery; ignored on insert.
    #[serde(default)]
    pub capture_count:    i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CaptureRow {
    pub id:          String,
    pub session_id:  String,
    pub label:       Option<String>,
    pub timestamp:   i64,
    pub tag:         String,
    pub params_json: String,
    pub xs:          Vec<f32>,
    pub ys:          Vec<f32>,
    pub color:       Option<String>,
    pub position:    Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditRow {
    pub id:         String,
    pub session_id: Option<String>,
    pub action:     String,
    pub actor:      String,
    pub timestamp:  i64,
    pub detail:     Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn f32s_to_bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn bytes_to_f32s(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

// ── Database init ─────────────────────────────────────────────────────────────

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(include_str!("schema.sql"))?;
    Ok(conn)
}

// ── Sessions ──────────────────────────────────────────────────────────────────

pub fn insert_session(conn: &Connection, row: &SessionRow) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO sessions
         (id, name, operator, device, method_id, created_at, status, params_json, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            row.id, row.name, row.operator, row.device, row.method_id,
            row.created_at, row.status, row.params_json, row.notes
        ],
    )?;
    Ok(())
}

pub fn load_sessions(conn: &Connection) -> Result<Vec<SessionRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.operator, s.device, s.method_id, s.created_at, s.status,
                s.signed_at, s.signed_by, s.params_json, s.calibration_json, s.notes,
                (SELECT COUNT(*) FROM captures c WHERE c.session_id = s.id) AS capture_count
         FROM sessions s ORDER BY s.created_at DESC"
    )?;
    let rows = stmt.query_map([], |r| Ok(SessionRow {
        id:               r.get(0)?,
        name:             r.get(1)?,
        operator:         r.get(2)?,
        device:           r.get(3)?,
        method_id:        r.get(4)?,
        created_at:       r.get(5)?,
        status:           r.get(6)?,
        signed_at:        r.get(7)?,
        signed_by:        r.get(8)?,
        params_json:      r.get(9)?,
        calibration_json: r.get(10)?,
        notes:            r.get(11)?,
        capture_count:    r.get(12)?,
    }))?;
    rows.collect()
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    Ok(())
}

// ── Captures ──────────────────────────────────────────────────────────────────

pub fn insert_capture(conn: &Connection, row: &CaptureRow) -> Result<()> {
    let xs_blob = f32s_to_bytes(&row.xs);
    let ys_blob = f32s_to_bytes(&row.ys);
    conn.execute(
        "INSERT OR REPLACE INTO captures
         (id, session_id, label, timestamp, tag, params_json, xs, ys, color, position)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            row.id, row.session_id, row.label, row.timestamp, row.tag,
            row.params_json, xs_blob, ys_blob, row.color, row.position
        ],
    )?;
    Ok(())
}

pub fn load_captures(conn: &Connection, session_id: &str) -> Result<Vec<CaptureRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, label, timestamp, tag, params_json, xs, ys, color, position
         FROM captures WHERE session_id=?1 ORDER BY timestamp ASC"
    )?;
    let rows = stmt.query_map([session_id], |r| {
        let xs_blob: Vec<u8> = r.get(6)?;
        let ys_blob: Vec<u8> = r.get(7)?;
        Ok(CaptureRow {
            id:          r.get(0)?,
            session_id:  r.get(1)?,
            label:       r.get(2)?,
            timestamp:   r.get(3)?,
            tag:         r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            params_json: r.get(5)?,
            xs:          bytes_to_f32s(&xs_blob),
            ys:          bytes_to_f32s(&ys_blob),
            color:       r.get(8)?,
            position:    r.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn delete_capture(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM captures WHERE id=?1", [id])?;
    Ok(())
}

pub fn count_captures(conn: &Connection, session_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM captures WHERE session_id=?1",
        [session_id],
        |r| r.get(0),
    )
}

// ── Audit ─────────────────────────────────────────────────────────────────────

pub fn insert_audit(conn: &Connection, row: &AuditRow) -> Result<()> {
    conn.execute(
        "INSERT INTO audit (id, session_id, action, actor, timestamp, detail)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![row.id, row.session_id, row.action, row.actor, row.timestamp, row.detail],
    )?;
    Ok(())
}
