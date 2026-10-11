use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Open a native save dialog. Returns the chosen path, or None if cancelled.
///
/// Callback-based dialog, awaited from an async command (off the main thread),
/// so the GTK file picker runs on the main loop without deadlocking.
fn pick_save_path(app: &AppHandle, default_name: &str) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .set_file_name(default_name)
        .save_file(move |chosen| {
            let _ = tx.send(chosen);
        });

    match rx.recv().map_err(|e| e.to_string())? {
        Some(file_path) => file_path
            .into_path()
            .map(Some)
            .map_err(|e| format!("invalid path: {e}")),
        None => Ok(None),
    }
}

/// Open a native save dialog, then write `content` to the chosen path.
/// Returns the written path, or None if the user cancelled.
#[tauri::command]
pub async fn cmd_save_export(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let Some(path) = pick_save_path(&app, &default_name)? else { return Ok(None) };
    std::fs::write(&path, content).map_err(|e| format!("write failed: {e}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// One worksheet: rows of cells, each a number, a string, or null (left empty).
#[derive(Deserialize)]
pub struct Sheet {
    name: String,
    rows: Vec<Vec<Value>>,
}

/// Open a native save dialog, then write `sheets` as an .xlsx workbook.
/// Returns the written path, or None if the user cancelled.
#[tauri::command]
pub async fn cmd_save_xlsx(
    app: AppHandle,
    default_name: String,
    sheets: Vec<Sheet>,
) -> Result<Option<String>, String> {
    let Some(path) = pick_save_path(&app, &default_name)? else { return Ok(None) };
    write_xlsx(&path, &sheets)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

fn write_xlsx(path: &std::path::Path, sheets: &[Sheet]) -> Result<(), String> {
    let mut book = rust_xlsxwriter::Workbook::new();
    let err = |e: rust_xlsxwriter::XlsxError| format!("xlsx: {e}");
    for sheet in sheets {
        let ws = book.add_worksheet();
        ws.set_name(&sheet.name).map_err(err)?;
        for (r, row) in sheet.rows.iter().enumerate() {
            for (c, cell) in row.iter().enumerate() {
                let (r, c) = (r as u32, c as u16);
                match cell {
                    Value::Number(n) => { ws.write_number(r, c, n.as_f64().unwrap_or(f64::NAN)).map_err(err)?; }
                    Value::String(s) => { ws.write_string(r, c, s).map_err(err)?; }
                    Value::Null => {}
                    other => { ws.write_string(r, c, other.to_string()).map_err(err)?; }
                }
            }
        }
    }
    book.save(path).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_readable_workbook() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.xlsx");
        let sheets = vec![Sheet {
            name: "Spectra".into(),
            rows: vec![
                vec![Value::from("wavelength_nm"), Value::from("cap 1")],
                vec![Value::from(400.5), Value::from(1234)],
                vec![Value::from(401.0), Value::Null],
            ],
        }];
        write_xlsx(&path, &sheets).unwrap();
        // An .xlsx is a zip: check the magic bytes and that it is not empty.
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.len() > 1000 && bytes.starts_with(b"PK"));
    }
}
