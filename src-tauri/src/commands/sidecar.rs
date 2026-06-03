use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use serde_json::Value;

// ── Sidecar process handle ────────────────────────────────────────────────────

pub struct Sidecar {
    _child:  Child,
    stdin:   std::io::BufWriter<ChildStdin>,
    reader:  BufReader<ChildStdout>,
    next_id: u64,
}

impl Sidecar {
    pub fn spawn(script: &str) -> Result<Self, String> {
        let python = Self::find_python()?;
        eprintln!("[sidecar] spawning: {python} {script}");

        let mut child = Command::new(&python)
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("spawn sidecar: {e}"))?;

        let stdin  = std::io::BufWriter::new(
            child.stdin.take().ok_or("no stdin")?
        );
        let reader = BufReader::new(
            child.stdout.take().ok_or("no stdout")?
        );

        let mut s = Sidecar { _child: child, stdin, reader, next_id: 1 };

        // Read the ready message
        let mut ready_line = String::new();
        s.reader.read_line(&mut ready_line)
            .map_err(|e| format!("sidecar ready: {e}"))?;
        eprintln!("[sidecar] ready: {}", ready_line.trim());

        Ok(s)
    }

    fn find_python() -> Result<String, String> {
        // Check env override first, then try common python3 names
        if let Ok(py) = std::env::var("JASPER_PYTHON") {
            return Ok(py);
        }
        for candidate in &["python3", "python"] {
            if Command::new(candidate).arg("--version")
                .stdout(Stdio::null()).stderr(Stdio::null())
                .status().map(|s| s.success()).unwrap_or(false)
            {
                return Ok(candidate.to_string());
            }
        }
        Err("python3 not found — set JASPER_PYTHON env var".into())
    }

    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = serde_json::json!({
            "id":     id,
            "method": method,
            "params": params,
        });
        let line = serde_json::to_string(&request)
            .map_err(|e| e.to_string())?;

        writeln!(self.stdin, "{line}")
            .map_err(|e| format!("sidecar write: {e}"))?;
        self.stdin.flush()
            .map_err(|e| format!("sidecar flush: {e}"))?;

        let mut response_line = String::new();
        self.reader.read_line(&mut response_line)
            .map_err(|e| format!("sidecar read: {e}"))?;

        let response: Value = serde_json::from_str(response_line.trim())
            .map_err(|e| format!("sidecar parse: {e} — line: {response_line}"))?;

        if let Some(err) = response.get("error") {
            return Err(format!("sidecar error: {err}"));
        }
        Ok(response["result"].clone())
    }
}

// ── Global lazy sidecar holder (stored in AppState) ───────────────────────────

pub struct SidecarHolder {
    pub inner:       Mutex<Option<Sidecar>>,
    pub script_path: String,
}

impl SidecarHolder {
    pub fn new(script_path: String) -> Self {
        Self {
            inner: Mutex::new(None),
            script_path,
        }
    }

    /// Get or spawn the sidecar, then call method with params.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let mut guard = self.inner.lock()
            .map_err(|e| e.to_string())?;

        if guard.is_none() {
            *guard = Some(Sidecar::spawn(&self.script_path)?);
        }

        guard.as_mut().unwrap().call(method, params)
    }
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_sidecar_request(
    state: tauri::State<'_, crate::state::AppState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    state.sidecar.call(&method, params)
}
