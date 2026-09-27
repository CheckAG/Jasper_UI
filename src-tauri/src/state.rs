use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};
use std::sync::Arc;
use crate::instrument::tcd1304::Tcd1304Driver;
use crate::instrument::driver::SpectrumDriver;
use crate::commands::sidecar::SidecarHolder;

pub struct AppState {
    /// Arc so the streaming acquisition thread can hold the driver and call
    /// scan() through the trait (mock and real device alike).
    pub driver:          Arc<Mutex<Box<dyn SpectrumDriver + Send>>>,
    pub db_path:         String,
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
}

impl AppState {
    pub fn new(data_dir: &std::path::Path) -> Self {
        let db_path = data_dir.join("jasper.db").to_string_lossy().to_string();

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
        let mut driver = Tcd1304Driver::new(String::new());
        if let Ok(port) = std::env::var("JASPER_PORT") {
            let port = port.trim().to_string();
            if !port.is_empty() {
                match driver.connect(&port) {
                    Ok(()) => eprintln!("[AppState] TCD1304 connected on {port}"),
                    // Not fatal: the workspace can connect once the device is
                    // there, and refusing to launch over a missing cable is worse.
                    Err(e) => eprintln!("[AppState] JASPER_PORT={port} did not connect: {e}"),
                }
            }
        }
        let driver: Box<dyn SpectrumDriver + Send> = Box::new(driver);

        Self {
            driver:         Arc::new(Mutex::new(driver)),
            db_path,
            acq_generation: Arc::new(AtomicU64::new(0)),
            frame_in_flight: Arc::new(AtomicU64::new(0)),
            last_raw: Arc::new(Mutex::new(None)),
            calibration:    Arc::new(Mutex::new(Default::default())),
            sidecar:        SidecarHolder::new(script_path),
        }
    }

    /// Retire any running acquisition thread by advancing the generation.
    pub fn stop_acquisition(&self) {
        self.acq_generation.fetch_add(1, Ordering::SeqCst);
        // Clear the backpressure gate: whatever frame was awaiting a render
        // belongs to a stream that no longer exists, and leaving the gate set
        // would make the next stream wait out its stale timeout for nothing.
        self.frame_in_flight.store(0, Ordering::SeqCst);
    }
}
