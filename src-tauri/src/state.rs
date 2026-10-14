use std::sync::{Mutex, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::sync::Arc;
use crate::instrument::driver::SpectrumDriver;
use crate::commands::sidecar::SidecarHolder;

pub struct AppState {
    /// Arc so the streaming acquisition thread can hold the driver and call
    /// scan() through the trait (mock and real device alike).
    pub driver:          Arc<Mutex<Box<dyn SpectrumDriver + Send>>>,
    pub db_path:         String,
    /// Root of the per-workspace spectra folders (storage::files).
    pub spectra_root:    std::path::PathBuf,
    /// Monotonic acquisition generation. Each start bumps it; a streaming thread
    /// runs only while its captured generation still matches — so a restart
    /// (e.g. on mode change) cleanly retires the previous thread.
    pub acq_generation:  Arc<AtomicU64>,
    /// Milliseconds-since-epoch when a frame was emitted and has not yet been
    /// reported as rendered; 0 when the frontend is idle. The acquisition loop
    /// skips a capture while this is set, so a slow renderer sees the newest
    /// frame rather than a growing backlog. See `cmd_frame_consumed`.
    pub frame_in_flight: Arc<AtomicU64>,
    /// The most recent frame as it came off the device, before dark/reference
    /// maths. This is what the plot is showing, and what gets stored when a
    /// frame is tagged as the dark or the reference.
    ///
    /// It has to be the raw frame: once a dark is held the displayed trace is
    /// already dark-subtracted, and tagging that as the reference would store
    /// S-D, making the pipeline compute (S-D)/((S-D)-D).
    pub last_raw:        Arc<Mutex<Option<crate::instrument::process::CalFrame>>>,
    /// Dark/reference frames for the host-side measurement pipeline
    /// (instrument::process). Arc: the streaming thread reads it per frame.
    pub calibration:     Arc<Mutex<crate::instrument::process::Calibration>>,
    pub sidecar:         SidecarHolder,
    /// Acquisition settings. The backend owns them: the GUI, scripts and agents
    /// all read and write them through the Device API (crate::api).
    pub settings:        Mutex<crate::api::Settings>,
    /// True while the live stream runs. Cleared by stop_acquisition and by a
    /// stream that stops on a device error.
    pub live:            Arc<AtomicBool>,
    /// Device API audit log, one JSON object per line.
    pub audit_path:      std::path::PathBuf,
    /// App data folder: settings.json (last integration/averaging) and profiles.json.
    pub data_dir:        std::path::PathBuf,
    /// Socket clients that asked for events (`subscribe`). Arc: the server holds it too.
    pub subscribers:     Arc<crate::api::server::Hub>,
    /// Privileged requests from outside the app waiting for a person.
    pub confirmations:   crate::api::Confirmations,
    /// The board to keep connected: set by connect, cleared by disconnect.
    /// `api::watch_tick` uses it to find the board again after an unplug.
    pub wanted:          Mutex<Option<crate::api::Wanted>>,
}

impl AppState {
    pub fn new(data_dir: &std::path::Path, spectra_root: std::path::PathBuf) -> Self {
        let db_path = data_dir.join("jasper.db").to_string_lossy().to_string();
        // Worth logging: launched from a snap-confined terminal (VS Code),
        // XDG_DATA_HOME points inside the snap, so the app uses a different
        // database than it does from a plain shell. Sessions "disappearing"
        // between launches is this, not data loss.
        eprintln!("[AppState] database: {db_path}");
        eprintln!("[AppState] spectra:  {}", spectra_root.display());

        if let Ok(conn) = crate::storage::db::open(&db_path) {
            drop(conn);
        }

        // Resolve sidecar script path:
        // JASPER_SIDECAR env var → CARGO_MANIFEST_DIR/../python-sidecar/main.py → fallback
        let script_path = std::env::var("JASPER_SIDECAR").unwrap_or_else(|_| {
            let manifest = env!("CARGO_MANIFEST_DIR");
            let path = std::path::Path::new(manifest)
                .join("..").join("python-sidecar").join("main.py");
            path.canonicalize()
                .unwrap_or(path)
                .to_string_lossy()
                .to_string()
        });

        eprintln!("[AppState] sidecar script: {script_path}");

        // JASPER_PORT=/dev/ttyACM0 connects that port at startup — an explicit
        // opt-in. It is also the only way to reach a tools/tcd1304-sim.py pty,
        // which carries no VID/PID and so never turns up in a port scan.
        //
        // Unset, the app starts with no instrument. A driver with no port is
        // already exactly that: it lists nothing, reports not connected, and
        // refuses every operation — so there is no separate "no device" type,
        // and nothing synthesises a spectrum to fill the gap.
        let mut driver = crate::instrument::disconnected();
        if let Ok(port) = std::env::var("JASPER_PORT") {
            let port = port.trim().to_string();
            if !port.is_empty() {
                match crate::instrument::connect(&port) {
                    Ok(d) => { driver = d; eprintln!("[AppState] instrument connected on {port}") }
                    // Not fatal: the workspace can connect once the device is
                    // there, and refusing to launch over a missing cable is worse.
                    Err(e) => eprintln!("[AppState] JASPER_PORT={port} did not connect: {e}"),
                }
            }
        }

        let wanted = driver.device_metadata().map(|m| crate::api::Wanted { serial: m.serial, ..Default::default() });
        Self {
            driver:         Arc::new(Mutex::new(driver)),
            db_path,
            spectra_root,
            acq_generation: Arc::new(AtomicU64::new(0)),
            frame_in_flight: Arc::new(AtomicU64::new(0)),
            last_raw: Arc::new(Mutex::new(None)),
            calibration:    Arc::new(Mutex::new(Default::default())),
            sidecar:        SidecarHolder::new(script_path),
            settings:       Mutex::new(crate::api::Settings::load(data_dir)),
            live:           Arc::new(AtomicBool::new(false)),
            audit_path:     data_dir.join("api-audit.jsonl"),
            data_dir:       data_dir.to_path_buf(),
            subscribers:    Default::default(),
            confirmations:  Default::default(),
            wanted:         Mutex::new(wanted),
        }
    }

    /// Retire any running acquisition thread by advancing the generation.
    pub fn stop_acquisition(&self) {
        self.acq_generation.fetch_add(1, Ordering::SeqCst);
        self.live.store(false, Ordering::SeqCst);
        // Clear the backpressure gate: whatever frame was awaiting a render
        // belongs to a stream that no longer exists, and leaving the gate set
        // would make the next stream wait out its stale timeout for nothing.
        self.frame_in_flight.store(0, Ordering::SeqCst);
    }
}
