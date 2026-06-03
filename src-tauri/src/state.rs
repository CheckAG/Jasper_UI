use std::sync::{Mutex, atomic::{AtomicU64, Ordering}};
use std::sync::Arc;
use crate::instrument::mock::MockDriver;
use crate::instrument::driver::SpectrumDriver;
use crate::commands::sidecar::SidecarHolder;

pub struct AppState {
    pub driver:          Mutex<Box<dyn SpectrumDriver + Send>>,
    pub db_path:         String,
    /// Monotonic acquisition generation. Each start bumps it; a streaming thread
    /// runs only while its captured generation still matches — so a restart
    /// (e.g. on mode change) cleanly retires the previous thread.
    pub acq_generation:  Arc<AtomicU64>,
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

        Self {
            driver:         Mutex::new(Box::new(MockDriver::new())),
            db_path,
            acq_generation: Arc::new(AtomicU64::new(0)),
            sidecar:        SidecarHolder::new(script_path),
        }
    }

    /// Retire any running acquisition thread by advancing the generation.
    pub fn stop_acquisition(&self) {
        self.acq_generation.fetch_add(1, Ordering::SeqCst);
    }
}
