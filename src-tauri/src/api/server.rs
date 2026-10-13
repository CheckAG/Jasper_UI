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
//!
//! `subscribe` is answered here, not by `dispatch`: it belongs to the connection.
//! It replaces the connection's event list (an empty list stops them); events
//! then arrive as JSON-RPC notifications, with no id, between replies:
//!
//!   → {"id": 2, "method": "subscribe", "params": {"events": ["spectrum-frame"]}}
//!   ← {"jsonrpc": "2.0", "id": 2, "result": ["spectrum-frame"]}
//!   ← {"jsonrpc": "2.0", "method": "spectrum-frame", "params": {"xs": [..], "ys": [..], ..}}

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::{ApiError, Caller, Request};

pub const PORT: u16 = 8765;

/// What a client may subscribe to: everything the API emits.
/// Not "confirm-request": what waits for approval is the app's business.
pub const EVENTS: [&str; 6] = ["spectrum-frame", "capture-progress", "capture-saved", "burst-progress", "firmware-progress", "device-state"];

/// Lines queued per client. A client this far behind loses events rather than
/// stalling the live stream.
const QUEUE: usize = 8;

/// What a request is handed to: `dispatch` with the app's state and events.
pub type Handler = Arc<dyn Fn(Caller, Request) -> Result<Value, ApiError> + Send + Sync>;

/// The subscribed connections: id, event names, the queue to its writer.
#[derive(Default)]
pub struct Hub(Mutex<Vec<(u64, Vec<String>, SyncSender<String>)>>);

impl Hub {
    /// Hand `event` to every connection that asked for it. Never blocks.
    pub fn publish(&self, event: &str, payload: &Value) {
        let Ok(mut subs) = self.0.lock() else { return };
        if !subs.iter().any(|(_, names, _)| names.iter().any(|n| n == event)) { return; }
        let line = json!({ "jsonrpc": "2.0", "method": event, "params": payload }).to_string();
        // ponytail: a full queue drops this event; a gap counter if clients need to know.
        subs.retain(|(_, names, tx)| !names.iter().any(|n| n == event)
            || !matches!(tx.try_send(line.clone()), Err(TrySendError::Disconnected(_))));
    }

    fn set(&self, id: u64, names: Vec<String>, tx: SyncSender<String>) {
        let mut subs = self.0.lock().unwrap_or_else(|e| e.into_inner());
        subs.retain(|(i, ..)| *i != id);
        if !names.is_empty() { subs.push((id, names, tx)); }
    }
}

/// Accept clients on `listener` until the process exits, one thread each.
pub fn serve(listener: TcpListener, handler: Handler, hub: Arc<Hub>) {
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (handler, hub) = (handler.clone(), hub.clone());
            std::thread::spawn(move || {
                if let Err(e) = client(stream, handler, &hub) { eprintln!("[api] client: {e}"); }
            });
        }
    });
}

fn client(stream: TcpStream, handler: Handler, hub: &Hub) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    // One writer per connection, so replies and events never interleave mid-line.
    let mut out = stream.try_clone()?;
    let (tx, rx) = sync_channel::<String>(QUEUE);
    std::thread::spawn(move || {
        for line in rx { if writeln!(out, "{line}").is_err() { break; } }
    });
    let result = (|| {
        for line in BufReader::new(stream).lines() {
            let line = line?;
            if line.trim().is_empty() { continue; }
            let reply = match subscribe_request(&line) {
                Some((rid, Ok(names))) => {
                    hub.set(id, names.clone(), tx.clone());
                    json!({ "jsonrpc": "2.0", "id": rid, "result": names })
                }
                Some((rid, Err(error))) => json!({ "jsonrpc": "2.0", "id": rid, "error": error }),
                None => answer(&line, &handler),
            };
            if tx.send(reply.to_string()).is_err() { break; }
        }
        Ok(())
    })();
    hub.set(id, vec![], tx);   // unsubscribe; the writer ends with the last sender
    result
}

/// `Some` when `line` is a subscribe call: its id and the event names, checked.
fn subscribe_request(line: &str) -> Option<(Value, Result<Vec<String>, ApiError>)> {
    let msg: Value = serde_json::from_str(line).ok()?;
    if msg.get("method")?.as_str()? != "subscribe" { return None; }
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let names: Option<Vec<String>> = msg.pointer("/params/events").cloned()
        .and_then(|v| serde_json::from_value(v).ok());
    let Some(names) = names else {
        return Some((id, Err(ApiError::new(4011, "INVALID_VALUE", "subscribe takes {\"events\": [names]}"))));
    };
    if let Some(bad) = names.iter().find(|n| !EVENTS.contains(&n.as_str())) {
        return Some((id, Err(ApiError::new(4004, "UNKNOWN_EVENT", format!("no event {bad:?}"))
            .with(json!({ "events": EVENTS })))));
    }
    Some((id, Ok(names)))
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
        }), Arc::new(Hub::default()));

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

    #[test]
    fn subscribers_get_only_their_events_until_they_stop() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let hub = Arc::new(Hub::default());
        serve(listener, Arc::new(|_, _| Ok(json!("idle"))), hub.clone());

        let stream = TcpStream::connect(addr).unwrap();
        let mut lines = BufReader::new(stream.try_clone().unwrap()).lines();
        let mut next = || -> Value { serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap() };
        let send = |s: &str| writeln!(&stream, "{s}").unwrap();

        send(r#"{"id":1,"method":"subscribe","params":{"events":["nope"]}}"#);
        assert_eq!(next()["error"]["message"], "UNKNOWN_EVENT");
        send(r#"{"id":2,"method":"subscribe","params":{"events":["spectrum-frame"]}}"#);
        assert_eq!(next()["result"], json!(["spectrum-frame"]));

        hub.publish("capture-saved", &json!({"id": "x"}));   // not asked for
        hub.publish("spectrum-frame", &json!({"peak": 0.5}));
        let ev = next();
        assert_eq!((ev["method"].clone(), ev["params"]["peak"].clone(), ev.get("id")), (json!("spectrum-frame"), json!(0.5), None));
        // Requests still work between events.
        send(r#"{"id":3,"method":"read","params":{"name":"device.state"}}"#);
        assert_eq!(next()["id"], 3);

        // A slow client loses events; it never blocks the publisher.
        for _ in 0..QUEUE * 4 { hub.publish("spectrum-frame", &json!({})); }
        send(r#"{"id":4,"method":"subscribe","params":{"events":[]}}"#);
        while next().get("id").is_none() {}
        assert!(hub.0.lock().unwrap().is_empty());
        drop(stream);
    }

    /// The Python CLI against the real dispatcher and the protocol simulator:
    /// connect, a refused out-of-range write, a capture, all audited as "cli".
    #[test]
    fn python_cli_drives_the_simulator() {
        // Stands in for the app handle: every emit goes to the subscribers.
        struct ToHub(Arc<Hub>);
        impl super::super::Events for ToHub { fn emit(&self, e: &str, p: Value) { self.0.publish(e, &p) } }

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
        let hub = state.subscribers.clone();
        let events: Arc<dyn super::super::Events> = Arc::new(ToHub(hub.clone()));
        serve(listener, Arc::new(move |caller, req| super::super::dispatch(&st, events.clone(), caller, req)), hub);

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

        // A script sees the live stream: subscribe, start, one full frame.
        let script = format!("from jasper import Client\n\
            with Client(port={port}) as j:\n\
            \x20   j.subscribe('spectrum-frame'); j.invoke('start_live')\n\
            \x20   name, frame = next(j.events()); j.invoke('stop_live')\n\
            \x20   print(name, len(frame['ys']))\n");
        let out = std::process::Command::new("python3").args(["-c", &script])
            .current_dir(format!("{root}/../clients/python")).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "spectrum-frame 3694", "{}", String::from_utf8_lossy(&out.stderr));

        let log = std::fs::read_to_string(&state.audit_path).unwrap();
        assert!(log.lines().any(|l| l.contains("\"caller\":\"cli\"") && l.contains("\"command\":\"capture\"")), "{log}");
        sim.kill().ok();
    }
}
