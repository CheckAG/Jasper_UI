//! Spectra on disk: every capture is also written as one JCAMP-DX file in its
//! workspace's folder, `<spectra root>/<slug of workspace name>/`. The database
//! stays the source the app reads from; the files are for people and other tools.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::Value;

use super::db::CaptureRow;

/// Where workspace folders live: `JASPER_DATA_DIR`, else `~/JASPER`.
pub fn spectra_root(home: &Path) -> PathBuf {
    std::env::var_os("JASPER_DATA_DIR").map(PathBuf::from).unwrap_or_else(|| home.join("JASPER"))
}

/// Lowercase ASCII words joined by '-'. Never empty.
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "untitled".into() } else { out }
}

/// As `slug`, but keeps '_' so a capture named `spectra_001` keeps that name on disk.
fn file_slug(s: &str) -> String {
    let parts: Vec<String> = s.split('_')
        .filter(|p| p.chars().any(|c| c.is_ascii_alphanumeric()))
        .map(slug).collect();
    if parts.is_empty() { "untitled".into() } else { parts.join("_") }
}

/// The folder for a workspace. Two workspaces with the same name share it —
/// file names carry the time, so nothing is overwritten.
pub fn workspace_dir(root: &Path, workspace_name: &str) -> PathBuf {
    root.join(slug(workspace_name))
}

/// One spectrum as JCAMP-DX 5.01, `##XYPOINTS=(XY..XY)` so x need not be
/// evenly spaced (a fitted wavelength axis is not).
pub fn jcamp(title: &str, meta: &[(&str, String)], x_units: &str, y_units: &str, xs: &[f32], ys: &[f32]) -> String {
    let n = xs.len().min(ys.len());
    let mut s = String::new();
    let mut tag = |k: &str, v: &str| { s.push_str("##"); s.push_str(k); s.push('='); s.push_str(v); s.push('\n'); };
    tag("TITLE", title);
    tag("JCAMP-DX", "5.01");
    tag("DATA TYPE", "UV/VIS SPECTRUM");
    tag("ORIGIN", "JASPER by CheckAg");
    for (k, v) in meta { tag(k, v); }
    tag("XUNITS", x_units);
    tag("YUNITS", y_units);
    tag("NPOINTS", &n.to_string());
    if n > 0 {
        tag("FIRSTX", &xs[0].to_string());
        tag("LASTX", &xs[n - 1].to_string());
    }
    tag("XYPOINTS", "(XY..XY)");
    for i in 0..n {
        s.push_str(&format!("{}, {}\n", xs[i], ys[i]));
    }
    s.push_str("##END=\n");
    s
}

/// A spectrum filed with a capture so it can be recomputed later: the raw
/// sample, and the dark and reference it was processed against.
pub struct Part<'a> {
    pub title: &'a str,
    pub ys: &'a [f32],
    pub integration_ms: u32,
    pub averages: u32,
}

/// JCAMP-DX YUNITS for the pipeline's `units` (driver.rs `SpectrumFrame.units`).
fn y_units(units: &str) -> &'static str {
    match units { "abs" => "ABSORBANCE", "ratio" => "TRANSMITTANCE", _ => "ARBITRARY UNITS" }
}

/// Number a block for a compound file: `##BLOCK_ID` goes right after its `##TITLE`.
fn with_block_id(block: String, id: usize) -> String {
    let (title, rest) = block.split_once('\n').unwrap_or((&block, ""));
    format!("{title}\n##BLOCK_ID={id}\n{rest}")
}

/// Write `row` as `<name>_<YYYYMMDD-HHMMSS>.jdx` in its workspace folder.
///
/// With `parts`, the file is a JCAMP-DX compound file (`##DATA TYPE=LINK`): the
/// processed spectrum is block 1, so a reader that only takes the first block
/// still gets it, and each part follows as its own block.
pub fn write_capture(conn: &Connection, root: &Path, row: &CaptureRow, units: &str, parts: &[Part]) -> Result<PathBuf, String> {
    let (ws_name, operator): (String, Option<String>) = conn
        .query_row("SELECT name, operator FROM sessions WHERE id=?1", [&row.session_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| format!("workspace not found: {e}"))?;
    let dir = workspace_dir(root, &ws_name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;

    let when = chrono::DateTime::from_timestamp_millis(row.timestamp)
        .ok_or("bad timestamp")?
        .with_timezone(&chrono::Local);
    let label = row.label.clone().unwrap_or_default();
    let stem = format!("{}_{}", file_slug(&label), when.format("%Y%m%d-%H%M%S"));
    let mut path = dir.join(format!("{stem}.jdx"));
    if path.exists() {
        path = dir.join(format!("{stem}-{}.jdx", &row.id[..row.id.len().min(6)]));
    }

    let p: Value = serde_json::from_str(&row.params_json).unwrap_or(Value::Null);
    let mode = p["mode"].as_str().unwrap_or("intensity");
    let common = vec![
        ("OWNER", operator.unwrap_or_default()),
        ("LONGDATE", when.format("%Y/%m/%d %H:%M:%S%:z").to_string()),
        ("$WORKSPACE", ws_name),
        ("$SAMPLE TAG", row.tag.clone()),
    ];
    let mut meta = common.clone();
    meta.push(("$MODE", mode.to_string()));
    // What the numbers are: counts, counts_d (dark-subtracted), ratio or abs.
    meta.push(("$UNITS", units.to_string()));
    if let Some(v) = p["integration"].as_u64() { meta.push(("$INTEGRATION TIME MS", v.to_string())); }
    if let Some(v) = p["averaging"].as_u64()   { meta.push(("$AVERAGES", v.to_string())); }

    // ponytail: xs are detector pixel indices until a wavelength calibration
    // exists (#7, #13); switch to NANOMETERS when the axis comes from one.
    let main = jcamp(&label, &meta, "PIXEL", y_units(units), &row.xs, &row.ys);
    let text = if parts.is_empty() { main } else {
        let mut s = format!("##TITLE={label}\n##JCAMP-DX=5.01\n##DATA TYPE=LINK\n##BLOCKS={}\n", parts.len() + 1);
        s.push_str(&with_block_id(main, 1));
        for (i, part) in parts.iter().enumerate() {
            let mut m = common.clone();
            m.push(("$UNITS", "counts".to_string()));
            m.push(("$INTEGRATION TIME MS", part.integration_ms.to_string()));
            m.push(("$AVERAGES", part.averages.to_string()));
            s.push_str(&with_block_id(jcamp(part.title, &m, "PIXEL", "ARBITRARY UNITS", &row.xs, part.ys), i + 2));
        }
        s.push_str("##END=\n");
        s
    };
    std::fs::write(&path, text).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path)
}

/// Move a deleted capture's file into `.trash/` beside it, never delete it.
pub fn trash(path: &Path) -> Result<(), String> {
    if !path.exists() { return Ok(()); }
    let dir = path.parent().ok_or("no parent folder")?.join(".trash");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::rename(path, dir.join(path.file_name().ok_or("no file name")?)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(slug("Mango ripeness · Oct"), "mango-ripeness-oct");
        assert_eq!(slug("  --  "), "untitled");
    }

    #[test]
    fn capture_round_trips_through_a_jdx_file() {
        let dir = tempfile::tempdir().unwrap();
        let conn = super::super::db::open(dir.path().join("t.db").to_str().unwrap()).unwrap();
        conn.execute("INSERT INTO sessions (id, name, operator, created_at) VALUES ('s1','Soil P · batch 4','tony',0)", []).unwrap();
        let row = CaptureRow {
            id: "c1abcdef".into(), session_id: "s1".into(), label: Some("spectra_001".into()),
            timestamp: 1_791_700_000_000, tag: "SOIL-P-014".into(),
            params_json: r#"{"mode":"absorbance","integration":25,"averaging":16}"#.into(),
            xs: vec![0.0, 1.0, 2.0], ys: vec![0.5, 0.25, -0.125], color: None, position: None, file_path: None,
        };
        let path = write_capture(&conn, dir.path(), &row, "abs", &[]).unwrap();
        assert!(path.starts_with(dir.path().join("soil-p-batch-4")));
        assert!(path.file_name().unwrap().to_str().unwrap().starts_with("spectra_001_"));
        assert_eq!(file_slug("Leaf · stress_B"), "leaf-stress_b");

        // Read the points back: they must equal what was stored.
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("##YUNITS=ABSORBANCE") && text.contains("##$AVERAGES=16"));
        let pts: Vec<(f32, f32)> = text.lines()
            .skip_while(|l| !l.starts_with("##XYPOINTS")).skip(1)
            .take_while(|l| !l.starts_with("##"))
            .map(|l| { let (a, b) = l.split_once(", ").unwrap(); (a.parse().unwrap(), b.parse().unwrap()) })
            .collect();
        assert_eq!(pts, vec![(0.0, 0.5), (1.0, 0.25), (2.0, -0.125)]);

        // A second capture in the same second gets a distinct name.
        let again = write_capture(&conn, dir.path(), &CaptureRow { id: "c2zzzzzz".into(), ..row.clone() }, "abs", &[]).unwrap();
        assert_ne!(again, path);

        // With parts it is a compound file: processed first, then each part as its own block.
        let dark = [9.0, 8.0, 7.0];
        let parts = [Part { title: "dark", ys: &dark, integration_ms: 25, averages: 4 }];
        let both = write_capture(&conn, dir.path(), &CaptureRow { id: "c3yyyyyy".into(), ..row }, "abs", &parts).unwrap();
        let text = std::fs::read_to_string(&both).unwrap();
        assert!(text.starts_with("##TITLE=spectra_001\n##JCAMP-DX=5.01\n##DATA TYPE=LINK\n##BLOCKS=2\n##TITLE=spectra_001\n##BLOCK_ID=1\n"));
        assert!(text.contains("##TITLE=dark\n##BLOCK_ID=2\n") && text.contains("2, 7\n##END=\n##END=\n"));
        assert_eq!(text.matches("##END=").count(), 3);

        trash(&path).unwrap();
        assert!(!path.exists() && path.parent().unwrap().join(".trash").join(path.file_name().unwrap()).exists());
    }
}
