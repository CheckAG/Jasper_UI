//! The Device API for clients outside the app: scripts, the CLI, agents.
//!
//! Plain TCP on 127.0.0.1, one JSON object per line each way, JSON-RPC 2.0
//! shaped (Phase F5; the user chose this over WebSocket so both sides need
//! nothing beyond their standard library):
//!
//!   → {"id": 1, "caller": "script", "method": "read", "params": {"name": "device.state"}}
//!   ← {"jsonrpc": "2.0", "id": 1, "result": "idle"}
//!   ← {"jsonrpc": "2.0", "id": 1, "error": {"code": 4001, "message": "NOT_CONNECTED", ...}}
//!
//! Requests go to the same `dispatch` the GUI uses, so limits, audit log and
//! numbers are identical. Localhost only: there is no authentication.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

use serde_json::{json, Value};

use super::{ApiError, Caller, Request};

pub const PORT: u16 = 8765;

/// What a request is handed to: `dispatch` with the app's state and events.
pub type Handler = Arc<dyn Fn(Caller, Request) -> Result<Value, ApiError> + Send + Sync>;

/// Accept clients on `listener` until the process exits, one thread each.
pub fn serve(listener: TcpListener, handler: Handler) {
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let handler = handler.clone();
            std::thread::spawn(move || {
                if let Err(e) = client(stream, handler) { eprintln!("[api] client: {e}"); }
            });
        }
    });
}

fn client(stream: TcpStream, handler: Handler) -> std::io::Result<()> {
    let mut out = stream.try_clone()?;
    for line in BufReader::new(stream).lines() {
        let line = line?;
        if line.trim().is_empty() { continue; }
        let reply = answer(&line, &handler);
        writeln!(out, "{reply}")?;
    }
    Ok(())
}

fn answer(line: &str, handler: &Handler) -> Value {
    let bad = |id: &Value, detail: String| json!({ "jsonrpc": "2.0", "id": id,
        "error": ApiError::new(4011, "INVALID_VALUE", detail) });
    let msg: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return bad(&Value::Null, format!("not JSON: {e}")),
    };
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    // A client says who it is, but never gets the GUI's clamping: outside the
    // app, an out-of-range value is an error to report, not to fix silently.
    let caller = match msg.get("caller").and_then(Value::as_str) {
        Some("cli") => Caller::Cli,
        Some("agent") => Caller::Agent,
        _ => Caller::Script,
    };
    let req: Request = match serde_json::from_value(msg) {
        Ok(r) => r,
        Err(e) => return bad(&id, e.to_string()),
    };
    match handler(caller, req) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_and_errors_round_trip_over_the_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(std::sync::Mutex::new(vec![]));
        let log = seen.clone();
        serve(listener, Arc::new(move |caller, req| {
            log.lock().unwrap().push(caller);
            match req {
                Request::Read(_) => Ok(json!("idle")),
                _ => Err(ApiError::new(4001, "NOT_CONNECTED", "no device")),
            }
        }));

        let stream = TcpStream::connect(addr).unwrap();
        let mut lines = BufReader::new(stream.try_clone().unwrap()).lines();
        let mut ask = |s: &str| -> Value {
            writeln!(&stream, "{s}").unwrap();
            serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap()
        };

        let r = ask(r#"{"id":1,"caller":"cli","method":"read","params":{"name":"device.state"}}"#);
        assert_eq!(r, json!({"jsonrpc":"2.0","id":1,"result":"idle"}));
        let r = ask(r#"{"id":2,"caller":"gui","method":"invoke","params":{"command":"capture"}}"#);
        assert_eq!(r["error"]["message"], "NOT_CONNECTED");
        assert_eq!(ask("not json")["error"]["message"], "INVALID_VALUE");
        assert_eq!(ask(r#"{"id":3,"method":"nope"}"#)["id"], 3);
        // "gui" from outside is demoted: only the app itself is the GUI.
        assert_eq!(*seen.lock().unwrap(), vec![Caller::Cli, Caller::Script]);
    }

    /// The Python CLI against the real dispatcher and the protocol simulator:
    /// connect, a refused out-of-range write, a capture, all audited as "cli".
    #[test]
    fn python_cli_drives_the_simulator() {
        struct Quiet;
        impl super::super::Events for Quiet { fn emit(&self, _: &str, _: Value) {} }

        let root = env!("CARGO_MANIFEST_DIR");
        let mut sim = std::process::Command::new("python3").arg(format!("{root}/../tools/tcd1304-sim.py"))
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().unwrap();
        let mut pty = String::new();
        BufReader::new(sim.stdout.take().unwrap()).read_line(&mut pty).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(crate::state::AppState::new(dir.path(), dir.path().join("spectra")));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        let st = state.clone();
        serve(listener, Arc::new(move |caller, req| super::super::dispatch(&st, Arc::new(Quiet), caller, req)));

        let cli = |args: &[&str]| {
            let out = std::process::Command::new("python3").args(["-m", "jasper", "--port", &port])
                .args(args).current_dir(format!("{root}/../clients/python")).output().unwrap();
            (out.status.success(), String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr))
        };
        let (ok, text) = cli(&["invoke", "connect", &format!("port={}", pty.trim())]);
        assert!(ok, "{text}");
        let (ok, text) = cli(&["write", "acquisition.averages", "500"]);
        assert!(!ok && text.contains("LIMIT_EXCEEDED"), "{text}");
        assert!(cli(&["write", "acquisition.averages", "1"]).0);
        let (ok, text) = cli(&["invoke", "capture"]);
        assert!(ok && text.contains("\"peak\""), "{text}");

        let log = std::fs::read_to_string(&state.audit_path).unwrap();
        assert!(log.lines().any(|l| l.contains("\"caller\":\"cli\"") && l.contains("\"command\":\"capture\"")), "{log}");
        sim.kill().ok();
    }
}
