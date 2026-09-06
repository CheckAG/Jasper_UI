use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};
use std::sync::Arc;
use crate::instrument::mock::MockDriver;
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

        // JASPER_PORT=/dev/ttyACM0 (or a tcd1304-sim pty) selects the real
        // TCD1304 driver; unset → mock. A pty carries no VID/PID, so the
        // simulator is only reachable through this override.
        let driver: Box<dyn SpectrumDriver + Send> = match std::env::var("JASPER_PORT") {
            Ok(port) if !port.trim().is_empty() => {
                eprintln!("[AppState] instrument driver: TCD1304 on {port}");
                Box::new(Tcd1304Driver::new(port.trim().to_string()))
            }
            _ => {
                eprintln!("[AppState] instrument driver: mock (set JASPER_PORT for hardware)");
                Box::new(MockDriver::new())
            }
        };

        Self {
            driver:         Arc::new(Mutex::new(driver)),
            db_path,
            acq_generation: Arc::new(AtomicU64::new(0)),
            calibration:    Arc::new(Mutex::new(Default::default())),
            sidecar:        SidecarHolder::new(script_path),
        }
    }

    /// Retire any running acquisition thread by advancing the generation.
    pub fn stop_acquisition(&self) {
        self.acq_generation.fetch_add(1, Ordering::SeqCst);
    }
}
