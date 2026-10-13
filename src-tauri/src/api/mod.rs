//! The JASPER Device API: the one path from any client to the instrument.
//!
//! The GUI reaches it through the `cmd_api` Tauri command; scripts, the CLI and
//! agents reach the same `dispatch` over a local socket (`server.rs`, Phase F5). Every
//! caller gets the same variables, the same limits and the same numbers.
//!
//! Requests follow the Device API reference (docs: JASPER_Device_API.md):
//!   read   {name} or {names: [..]}  → value, or {name: value, ..}
//!   write  {name, value}            → {name, value} as applied
//!   invoke {command, args}          → command result
//! on top of the existing protocol v1 driver — nothing here talks to the port.

use std::io::Write as _;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::instrument::driver::{AcqParams, SpectrumDriver, SpectrumFrame};
use crate::instrument::process::{self, CalFrame};
use crate::state::AppState;
use crate::storage::{db, files};

pub mod server;

/// Acquisition settings the backend owns.
#[derive(Debug, Clone)]
pub struct Settings {
    pub integration_ms: u32,
    pub averages:       u32,
    /// Workspace (session id) that captures are filed in. Set by the GUI.
    pub workspace:      Option<String>,
}
impl Default for Settings {
    fn default() -> Self { Self { integration_ms: 120, averages: 4, workspace: None } }
}

pub const AVERAGES_MAX: u32 = 64;
/// Fractions of the device's full scale (`DeviceMetadata.max_intensity`), so
/// they hold for any sensor. SATURATION_WARN matches the GUI's banner.
const SATURATION_WARN: f32 = 0.98;
/// A dark whose mean is this high has light on it. A TCD1304 dark sits near 10%.
const DARK_WARN: f32 = 0.15;

/// Who made a call. Scripts and agents get errors where the GUI gets clamping.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Caller { Gui, Cli, Script, Agent }

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code:    i32,
    pub message: &'static str,
    pub detail:  String,
    #[serde(skip_serializing_if = "Value::is_null")]
    pub data:    Value,
}
impl ApiError {
    fn new(code: i32, message: &'static str, detail: impl Into<String>) -> Self {
        Self { code, message, detail: detail.into(), data: Value::Null }
    }
    fn with(mut self, data: Value) -> Self { self.data = data; self }
}
fn not_connected() -> ApiError { ApiError::new(4001, "NOT_CONNECTED", "No instrument is connected.") }
fn device(e: String) -> ApiError { ApiError::new(5001, "DEVICE_ERROR", e) }
fn internal(e: impl std::fmt::Display) -> ApiError { ApiError::new(5000, "INTERNAL", e.to_string()) }

/// Where the API sends asynchronous output: live frames and capture progress.
pub trait Events: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}
impl<R: tauri::Runtime> Events for tauri::AppHandle<R> {
    fn emit(&self, event: &str, payload: Value) {
        // Every emit, whoever started it, also reaches subscribed socket clients.
        if let Some(state) = tauri::Manager::try_state::<AppState>(self) {
            state.subscribers.publish(event, &payload);
        }
        if let Err(e) = tauri::Emitter::emit(self, event, payload) {
            eprintln!("emit {event}: {e}");
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "lowercase")]
pub enum Request {
    Read(ReadParams),
    Write { name: String, value: Value },
    Invoke { command: String, #[serde(default)] args: Value },
}
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ReadParams { One { name: String }, Many { names: Vec<String> } }

/// Run one request. Blocking: it may wait on the device for a capture.
pub fn dispatch(state: &AppState, events: Arc<dyn Events>, caller: Caller, req: Request) -> Result<Value, ApiError> {
    let summary = match &req {
        Request::Read(_) => None,   // polled every 2 s; not worth a log line each
        Request::Write { name, value } => Some(json!({ "method": "write", "name": name, "value": value })),
        Request::Invoke { command, args } => Some(json!({ "method": "invoke", "command": command, "args": args })),
    };
    let result = match req {
        Request::Read(ReadParams::One { name }) => read(state, &name),
        Request::Read(ReadParams::Many { names }) => names.iter()
            .map(|n| read(state, n).map(|v| (n.clone(), v)))
            .collect::<Result<serde_json::Map<_, _>, _>>().map(Value::Object),
        Request::Write { name, value } => write(state, &events, caller, &name, value),
        Request::Invoke { command, args } => invoke(state, &events, &command, args),
    };
    if let Some(mut entry) = summary {
        entry["ts"] = json!(now_ms());
        entry["caller"] = json!(caller);
        entry["result"] = match &result { Ok(_) => json!("ok"), Err(e) => json!(e.message) };
        audit(state, &entry);
    }
    result
}

fn audit(state: &AppState, entry: &Value) {
    let line = format!("{entry}\n");
    let ok = std::fs::OpenOptions::new().create(true).append(true).open(&state.audit_path)
        .and_then(|mut f| f.write_all(line.as_bytes()));
    if let Err(e) = ok { eprintln!("[api] audit log {}: {e}", state.audit_path.display()); }
}

// ── Variables ────────────────────────────────────────────────────────────────

fn lock<T>(m: &std::sync::Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, ApiError> {
    m.lock().map_err(internal)
}

fn read(state: &AppState, name: &str) -> Result<Value, ApiError> {
    Ok(match name {
        "device.state" => {
            let connected = lock(&state.driver)?.is_connected();
            json!(if !connected { "disconnected" } else if state.live.load(Ordering::SeqCst) { "acquiring" } else { "idle" })
        }
        "device.info" => json!(lock(&state.driver)?.device_metadata()),
        "device.diagnostics" => json!(lock(&state.driver)?.diagnostics()),
        "acquisition.integration_time_ms" => json!(lock(&state.settings)?.integration_ms),
        "acquisition.averages" => json!(lock(&state.settings)?.averages),
        "acquisition.live" => json!(state.live.load(Ordering::SeqCst)),
        "reference.dark" => json!(lock(&state.calibration)?.dark.is_some()),
        "reference.white" => json!(lock(&state.calibration)?.reference.is_some()),
        // Held dark taken at other settings than now: it no longer cancels the offset.
        "reference.dark_stale" => {
            let s = lock(&state.settings)?.clone();
            json!(lock(&state.calibration)?.dark.as_ref()
                .is_some_and(|d| d.requested_ms != s.integration_ms || d.averages != s.averages))
        }
        "processing.mode" => json!(mode(state)?),
        "workspace.active" => json!(lock(&state.settings)?.workspace),
        _ => return Err(ApiError::new(4004, "UNKNOWN_VARIABLE", format!("no variable {name:?}"))),
    })
}

/// What the pipeline computes follows from what has been measured:
/// dark + reference → absorbance; otherwise counts, dark-subtracted if a dark is held.
fn mode(state: &AppState) -> Result<&'static str, ApiError> {
    let cal = lock(&state.calibration)?;
    Ok(if cal.dark.is_some() && cal.reference.is_some() { "absorbance" } else { "intensity" })
}

fn write(state: &AppState, events: &Arc<dyn Events>, caller: Caller, name: &str, value: Value) -> Result<Value, ApiError> {
    let invalid = |want: &str| ApiError::new(4011, "INVALID_VALUE", format!("{name} takes {want}"));
    match name {
        "acquisition.integration_time_ms" | "acquisition.averages" => {
            let v = value.as_f64().ok_or_else(|| invalid("a number"))?.round();
            let (min, max) = if name == "acquisition.averages" {
                (1, AVERAGES_MAX)
            } else {
                // Limits come from the device; without one, anything positive.
                lock(&state.driver)?.device_metadata()
                    .map(|m| (m.integ_min_ms, m.integ_max_ms)).unwrap_or((1, 60_000))
            };
            let applied = if v < min as f64 || v > max as f64 {
                // The GUI may clamp its own control; scripts and agents are told.
                if caller != Caller::Gui {
                    return Err(ApiError::new(4010, "LIMIT_EXCEEDED", format!("{name} must be {min}–{max}"))
                        .with(json!({ "min": min, "max": max })));
                }
                v.clamp(min as f64, max as f64) as u32
            } else { v as u32 };
            {
                let mut s = lock(&state.settings)?;
                if name == "acquisition.averages" { s.averages = applied } else { s.integration_ms = applied }
            }
            // The stream runs on the settings it started with; restart it.
            if state.live.load(Ordering::SeqCst) { start_live(state, events.clone())?; }
            Ok(json!({ "name": name, "value": applied }))
        }
        "workspace.active" => {
            let id = value.as_str().ok_or_else(|| invalid("a workspace id"))?.to_string();
            lock(&state.settings)?.workspace = Some(id.clone());
            Ok(json!({ "name": name, "value": id }))
        }
        _ => match read(state, name) {
            Ok(_) => Err(ApiError::new(4005, "READ_ONLY", format!("{name} is read-only"))),
            Err(e) => Err(e),
        },
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

fn invoke(state: &AppState, events: &Arc<dyn Events>, command: &str, args: Value) -> Result<Value, ApiError> {
    let arg = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string);
    match command {
        "discover" => {
            // The connected device comes from the live driver, which knows its
            // own identity; everything else is found by probing ports.
            let mine = lock(&state.driver)?.device_list();
            let connected = mine.first().map(|d| d.id.clone());
            let mut all = mine;
            all.extend(crate::instrument::discover(connected.as_deref()));
            Ok(json!(all))
        }
        "connect" => {
            let port = arg("port").ok_or_else(|| ApiError::new(4011, "INVALID_VALUE", "connect needs a port"))?;
            state.stop_acquisition();
            connect_port(&state.driver, &port).map_err(device)?;
            Ok(json!(lock(&state.driver)?.device_metadata()))
        }
        "disconnect" => {
            state.stop_acquisition();
            lock(&state.driver)?.disconnect();
            Ok(json!("ok"))
        }
        "start_live" => { start_live(state, events.clone())?; Ok(json!("ok")) }
        "stop_live" => { state.stop_acquisition(); Ok(json!("ok")) }
        "capture" => capture(state, events, &args),
        "capture_dark" | "capture_reference" => tag_last_frame(state, if command == "capture_dark" { "dark" } else { "reference" }),
        "clear_dark" | "clear_reference" => {
            let mut cal = lock(&state.calibration)?;
            if command == "clear_dark" { cal.dark = None } else { cal.reference = None }
            Ok(json!("ok"))
        }
        _ => Err(ApiError::new(4004, "UNKNOWN_COMMAND", format!("no command {command:?}"))),
    }
}

type DriverSlot = std::sync::Mutex<Box<dyn SpectrumDriver + Send>>;

/// Swap in a driver for `port`. Handshake first: a failed connect leaves the
/// previous driver in place rather than one that cannot talk.
pub fn connect_port(driver: &DriverSlot, port: &str) -> Result<(), String> {
    let mut slot = driver.lock().map_err(|e| e.to_string())?;
    slot.disconnect();
    *slot = crate::instrument::connect(port)?;
    Ok(())
}

fn params(state: &AppState) -> Result<AcqParams, ApiError> {
    let s = lock(&state.settings)?.clone();
    Ok(AcqParams {
        mode: mode(state)?.into(), integration: s.integration_ms, averaging: s.averages,
        ..AcqParams::default()
    })
}

/// Store the frame on the plot as the dark or the reference. Tags what was
/// already measured rather than measuring again: freeze a good trace, then
/// designate it — so it inherits the averaging that produced it.
fn tag_last_frame(state: &AppState, which: &str) -> Result<Value, ApiError> {
    let frame = lock(&state.last_raw)?.as_ref()
        .map(|f| CalFrame { ys: f.ys.clone(), integration_ms: f.integration_ms, averages: f.averages, requested_ms: f.requested_ms })
        .ok_or_else(|| ApiError::new(4020, "PRECONDITION_FAILED", "No spectrum on the plot yet — start the stream first."))?;
    // Judged against the connected sensor's own full scale, not fixed counts.
    let full = lock(&state.driver)?.device_metadata().map_or(f32::MAX, |m| m.max_intensity.max(1) as f32);
    let mean = frame.ys.iter().sum::<f32>() / frame.ys.len().max(1) as f32;
    let max = frame.ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let warn = match which {
        "dark" if mean > DARK_WARN * full => Some(format!("dark level high ({mean:.0} counts, {:.0}% of full scale) — is the light off?", 100.0 * mean / full)),
        "reference" if max >= SATURATION_WARN * full => Some("reference is near saturation — reduce integration".to_string()),
        _ => None,
    };
    let mut cal = lock(&state.calibration)?;
    if which == "dark" { cal.dark = Some(frame) } else { cal.reference = Some(frame) }
    Ok(json!({ "status": "ok", "warn": warn }))
}

/// One deliberate measurement of `averages` scans, meaned. Stops the stream
/// first: the device does one thing at a time. With a workspace set it is
/// saved — a database row and a .jdx file — so every caller files it the same way.
///
/// args: tag, label, color, id (all optional; the GUI passes its own).
fn capture(state: &AppState, events: &Arc<dyn Events>, args: &Value) -> Result<Value, ApiError> {
    state.stop_acquisition();
    let params = params(state)?;
    let frame = {
        let driver = lock(&state.driver)?;
        if !driver.is_connected() { return Err(not_connected()); }
        process::average_scans_with(driver.as_ref(), &params, params.averaging.max(1) as usize, |done, total| {
            events.emit("capture-progress", json!({ "done": done, "total": total }));
        }).map_err(device)?
    };
    // A capture is as taggable as a streamed frame.
    *lock(&state.last_raw)? = Some(CalFrame { ys: frame.ys.clone(), integration_ms: frame.integration_ms, averages: params.averaging, requested_ms: params.integration });
    let raw = frame.ys.clone();
    let frame = process::process(frame, &*lock(&state.calibration)?);

    let workspace = lock(&state.settings)?.workspace.clone();
    let Some(session_id) = workspace else {
        return Ok(json!({ "frame": frame, "saved": null }));
    };
    let saved = save_capture(state, &session_id, &frame, &raw, &params, args).map_err(internal)?;
    // Whoever captured, the GUI shows it: a script's capture lands in its Captures panel too.
    events.emit("capture-saved", json!({ "session_id": session_id, "id": saved["id"] }));
    Ok(json!({ "frame": frame, "saved": saved }))
}

fn save_capture(state: &AppState, session_id: &str, frame: &SpectrumFrame, raw: &[f32], params: &AcqParams, args: &Value) -> Result<Value, String> {
    let conn = db::open(&state.db_path).map_err(|e| e.to_string())?;
    let s = |k: &str| args.get(k).and_then(Value::as_str).map(str::to_string);
    // The user's name if they gave one, else spectra_001, spectra_002, ... per workspace.
    let label = match s("label").map(|l| l.trim().to_string()).filter(|l| !l.is_empty()) {
        Some(l) => l,
        None => format!("spectra_{:03}", db::next_spectrum_number(&conn, session_id).map_err(|e| e.to_string())?),
    };
    let mut row = db::CaptureRow {
        id: s("id").unwrap_or_else(|| format!("cap-{}", now_ms())),
        session_id: session_id.to_string(),
        label: Some(label),
        timestamp: frame.timestamp as i64,
        tag: s("tag").unwrap_or_default(),
        params_json: serde_json::to_string(params).map_err(|e| e.to_string())?,
        xs: frame.xs.clone(), ys: frame.ys.clone(),
        color: s("color"), position: None, file_path: None,
    };
    db::insert_capture(&conn, &row).map_err(|e| e.to_string())?;
    // The row is in; a failed file write is reported, never fatal.
    // The file carries what the spectrum was computed from: the raw sample when
    // processing changed it, and whichever dark and reference are held.
    let cal = state.calibration.lock().map_err(|e| e.to_string())?;
    let mut parts = Vec::new();
    if frame.units != "counts" {
        parts.push(files::Part { title: "raw sample", ys: raw, integration_ms: frame.integration_ms, averages: params.averaging });
    }
    for (title, f) in [("dark", &cal.dark), ("reference", &cal.reference)] {
        if let Some(f) = f.as_ref().filter(|f| f.ys.len() == raw.len()) {
            parts.push(files::Part { title, ys: &f.ys, integration_ms: f.integration_ms, averages: f.averages });
        }
    }
    let written = files::write_capture(&conn, &state.spectra_root, &row, &frame.units, &parts);
    drop(cal);
    let file_error = match written {
        Ok(path) => {
            let path = path.to_string_lossy().to_string();
            db::set_capture_file(&conn, &row.id, &path).map_err(|e| e.to_string())?;
            row.file_path = Some(path);
            None
        }
        Err(e) => Some(e),
    };
    Ok(json!({ "id": row.id, "label": row.label, "timestamp": row.timestamp, "tag": row.tag,
               "params": params, "file": row.file_path, "file_error": file_error }))
}

// ── Live stream ──────────────────────────────────────────────────────────────

/// How long to honour the backpressure gate before assuming the frontend is
/// never going to report back.
pub const STALE_FRAME_MS: u64 = 1_000;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// (Re)start the stream on the current settings; frames go out as
/// "spectrum-frame". A previous stream retires on its next iteration.
fn start_live(state: &AppState, events: Arc<dyn Events>) -> Result<(), ApiError> {
    if !lock(&state.driver)?.is_connected() { return Err(not_connected()); }
    let params = params(state)?;
    let my_gen = state.acq_generation.fetch_add(1, Ordering::SeqCst) + 1;
    state.frame_in_flight.store(0, Ordering::SeqCst);
    state.live.store(true, Ordering::SeqCst);

    let generation = Arc::clone(&state.acq_generation);
    let driver = Arc::clone(&state.driver);
    let calibration = Arc::clone(&state.calibration);
    let in_flight = Arc::clone(&state.frame_in_flight);
    let last_raw = Arc::clone(&state.last_raw);
    let live = Arc::clone(&state.live);

    // A capture costs about 2x the integration time: the firmware discards the
    // in-progress frame and sends the next one.
    let interval_ms = (2 * params.integration * params.averaging.max(1)).max(16) as u64;

    std::thread::spawn(move || {
        while generation.load(Ordering::SeqCst) == my_gen {
            let started = std::time::Instant::now();

            // Backpressure: skip a capture while the last frame awaits a render,
            // so the plot shows the newest data rather than a growing backlog.
            // Reopened by cmd_frame_consumed, or after STALE_FRAME_MS.
            let waiting_since = in_flight.load(Ordering::SeqCst);
            if waiting_since != 0 && now_ms().saturating_sub(waiting_since) < STALE_FRAME_MS {
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            }

            let frame = {
                let Ok(drv) = driver.lock() else { break };
                match process::average_scans(drv.as_ref(), &params, params.averaging.max(1) as usize) {
                    Ok(f) => f,
                    Err(e) => {
                        eprintln!("acquisition scan error, stopping stream: {e}");
                        if generation.load(Ordering::SeqCst) == my_gen { live.store(false, Ordering::SeqCst); }
                        break;
                    }
                }
            };
            // The frame as the device gave it, before dark/reference maths, so it can be tagged.
            if let Ok(mut slot) = last_raw.lock() {
                *slot = Some(CalFrame { ys: frame.ys.clone(), integration_ms: frame.integration_ms, averages: params.averaging, requested_ms: params.integration });
            }
            let frame = match calibration.lock() {
                Ok(cal) => process::process(frame, &cal),
                Err(_) => break,
            };
            // A just-retired thread must not push a stale frame.
            if generation.load(Ordering::SeqCst) != my_gen { break; }
            in_flight.store(now_ms(), Ordering::SeqCst);
            events.emit("spectrum-frame", json!(frame));

            // Leave a minimum gap so this loop does not hold the driver mutex
            // essentially all the time and starve every other command.
            let elapsed_ms = started.elapsed().as_millis() as u64;
            std::thread::sleep(std::time::Duration::from_millis(interval_ms.saturating_sub(elapsed_ms).max(15)));
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::sync::Mutex;

    struct Sink(Mutex<Vec<String>>);
    impl Events for Sink {
        fn emit(&self, event: &str, _: Value) { self.0.lock().unwrap().push(event.into()); }
    }

    fn req(v: Value) -> Request { serde_json::from_value(v).unwrap() }

    /// The whole API against the protocol simulator: connect, limits, live,
    /// dark/reference, a stored capture with its .jdx, and the audit log.
    #[test]
    fn device_api_end_to_end_against_the_simulator() {
        let sim = format!("{}/../tools/tcd1304-sim.py", env!("CARGO_MANIFEST_DIR"));
        let mut child = std::process::Command::new("python3").arg(&sim)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().unwrap();
        let mut pty = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap()).read_line(&mut pty).unwrap();
        let pty = pty.trim().to_string();

        let dir = tempfile::tempdir().unwrap();
        let state = AppState::new(dir.path(), dir.path().join("spectra"));
        let sink = Arc::new(Sink(Mutex::new(vec![])));
        let ev: Arc<dyn Events> = sink.clone();
        let call = |c: Caller, v: Value| dispatch(&state, ev.clone(), c, req(v));

        // Nothing connected: commands that need a device say so.
        assert_eq!(call(Caller::Script, json!({"method":"invoke","params":{"command":"start_live"}})).unwrap_err().message, "NOT_CONNECTED");
        call(Caller::Gui, json!({"method":"invoke","params":{"command":"connect","args":{"port":pty}}})).unwrap();
        assert_eq!(call(Caller::Gui, json!({"method":"read","params":{"name":"device.state"}})).unwrap(), json!("idle"));

        // Limits: a script is refused, the GUI is clamped.
        let e = call(Caller::Script, json!({"method":"write","params":{"name":"acquisition.averages","value":500}})).unwrap_err();
        assert_eq!((e.message, e.data["max"].clone()), ("LIMIT_EXCEEDED", json!(AVERAGES_MAX)));
        assert_eq!(call(Caller::Gui, json!({"method":"write","params":{"name":"acquisition.averages","value":500}})).unwrap()["value"], json!(AVERAGES_MAX));
        call(Caller::Gui, json!({"method":"write","params":{"name":"acquisition.averages","value":1}})).unwrap();
        assert_eq!(call(Caller::Gui, json!({"method":"write","params":{"name":"device.state","value":1}})).unwrap_err().message, "READ_ONLY");

        // Live produces frames; a dark and a reference can then be tagged.
        call(Caller::Gui, json!({"method":"invoke","params":{"command":"start_live"}})).unwrap();
        for _ in 0..100 {
            if sink.0.lock().unwrap().iter().any(|e| e == "spectrum-frame") { break; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        call(Caller::Gui, json!({"method":"invoke","params":{"command":"stop_live"}})).unwrap();
        assert!(sink.0.lock().unwrap().iter().any(|e| e == "spectrum-frame"), "no live frame arrived");
        call(Caller::Gui, json!({"method":"invoke","params":{"command":"capture_dark"}})).unwrap();
        call(Caller::Gui, json!({"method":"invoke","params":{"command":"capture_reference"}})).unwrap();
        let r = call(Caller::Gui, json!({"method":"read","params":{"names":["reference.dark","reference.white","processing.mode"]}})).unwrap();
        assert_eq!(r, json!({"reference.dark": true, "reference.white": true, "processing.mode": "absorbance"}));

        // The dark goes stale when the settings move away from the ones it was taken at.
        let stale = || call(Caller::Gui, json!({"method":"read","params":{"name":"reference.dark_stale"}})).unwrap();
        assert_eq!(stale(), json!(false));
        call(Caller::Gui, json!({"method":"write","params":{"name":"acquisition.averages","value":2}})).unwrap();
        assert_eq!(stale(), json!(true));
        call(Caller::Gui, json!({"method":"write","params":{"name":"acquisition.averages","value":1}})).unwrap();
        assert_eq!(stale(), json!(false));

        // A script's capture is filed exactly like the GUI's: row + .jdx.
        let conn = db::open(&state.db_path).unwrap();
        conn.execute("INSERT INTO sessions (id, name, created_at) VALUES ('s1','Neon check',0)", []).unwrap();
        call(Caller::Gui, json!({"method":"write","params":{"name":"workspace.active","value":"s1"}})).unwrap();
        let out = call(Caller::Script, json!({"method":"invoke","params":{"command":"capture","args":{"tag":"NE-01"}}})).unwrap();
        let file = out["saved"]["file"].as_str().unwrap();
        assert_eq!(out["saved"]["label"], "spectra_001");
        let named = call(Caller::Script, json!({"method":"invoke","params":{"command":"capture","args":{"label":"Leaf A"}}})).unwrap();
        assert_eq!(named["saved"]["label"], "Leaf A");
        let next = call(Caller::Script, json!({"method":"invoke","params":{"command":"capture"}})).unwrap();
        assert_eq!(next["saved"]["label"], "spectra_002");
        let peak = out["frame"]["peak"].as_f64().unwrap();
        assert!(peak > 0.0 && peak <= 1.0, "peak {peak} outside the full scale");
        assert!(file.contains("neon-check") && std::path::Path::new(file).exists());
        // Absorbance with a dark and a reference: processed, raw, dark, reference in one compound file.
        let jdx = std::fs::read_to_string(file).unwrap();
        assert!(jdx.contains("##DATA TYPE=LINK\n##BLOCKS=4\n") && jdx.contains("##TITLE=reference\n##BLOCK_ID=4\n"));
        assert_eq!(db::count_captures(&conn, "s1").unwrap(), 3);
        assert!(sink.0.lock().unwrap().iter().any(|e| e == "capture-progress"));
        assert!(sink.0.lock().unwrap().iter().any(|e| e == "capture-saved"));

        // Writes and commands are in the audit log with their caller; reads are not.
        let log = std::fs::read_to_string(&state.audit_path).unwrap();
        assert!(log.lines().any(|l| l.contains("\"caller\":\"script\"") && l.contains("LIMIT_EXCEEDED")));
        assert!(log.lines().any(|l| l.contains("\"command\":\"capture\"") && l.contains("\"result\":\"ok\"")));
        assert!(!log.contains("\"method\":\"read\""));

        let _ = child.kill();
    }
}
