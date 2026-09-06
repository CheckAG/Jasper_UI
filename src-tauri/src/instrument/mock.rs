use std::time::{SystemTime, UNIX_EPOCH};
use crate::instrument::driver::*;

const N: usize = 320;
const X_MIN: f32 = 400.0;
const X_MAX: f32 = 2000.0;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// Animation time in seconds. Wall-clock based so repeated `scan()` calls
/// (the streaming loop goes through the driver trait) produce a moving
/// spectrum. Wrapped at one day to stay within f32 precision.
fn anim_t() -> f32 {
    (now_ms() % 86_400_000) as f32 / 1000.0
}

/// Gaussian band: Σ h · exp(-(x-c)² / w²)
fn gaussian(x: f32, center: f32, width: f32, height: f32) -> f32 {
    height * (-(x - center).powi(2) / width.powi(2)).exp()
}

fn bands_for(mode: &str) -> Vec<(f32, f32, f32)> {
    match mode {
        "reflectance" => vec![
            (950.0, 80.0, -0.22), (1200.0, 100.0, -0.28),
            (1450.0, 130.0, -0.40), (1900.0, 130.0, -0.38), (1680.0, 60.0, -0.10),
        ],
        "transmittance" => vec![
            (950.0, 80.0, -0.18), (1200.0, 100.0, -0.25),
            (1450.0, 130.0, -0.35), (1900.0, 130.0, -0.35),
        ],
        "intensity" | "counts" | "irradiance" => vec![
            (800.0, 220.0, 0.18), (950.0, 80.0, -0.16),
            (1200.0, 100.0, -0.22), (1450.0, 130.0, -0.30), (1900.0, 130.0, -0.30),
        ],
        _ => vec![  // absorbance
            (950.0, 70.0, 0.18), (1200.0, 90.0, 0.30),
            (1450.0, 120.0, 0.48), (1680.0, 60.0, 0.12), (1900.0, 110.0, 0.40),
        ],
    }
}

fn baseline_for(mode: &str) -> f32 {
    match mode {
        "reflectance"   => 0.92,
        "transmittance" => 0.95,
        "intensity" | "counts" | "irradiance" => 0.55,
        _ => 0.04,
    }
}

/// The wavelength grid (stable for a given instrument).
pub fn synth_xs() -> Vec<f32> {
    (0..N).map(|i| X_MIN + (X_MAX - X_MIN) * i as f32 / (N as f32 - 1.0)).collect()
}

/// Single source of truth for the synthetic NIR spectrum.
/// Both `MockDriver::scan` and the streaming acquisition thread call this, so
/// the band math lives in exactly one place.
pub fn synth_ys(params: &AcqParams, t: f32, xs: &[f32], seed_offset: f32) -> Vec<f32> {
    let bands = bands_for(&params.mode);
    let base  = baseline_for(&params.mode);
    let noise = 0.012
        * (50.0 / params.integration.max(5) as f32).sqrt()
        / (params.averaging.max(1) as f32).sqrt();

    // Deterministic LCG seeded by time + ghost offset
    let mut rng = seed_offset * 137.5 + t * 31.7 + 0.5;

    xs.iter().map(|&x| {
        let mut y = base;
        for &(c, w, h) in &bands {
            y += gaussian(x, c, w, h);
        }
        y += 0.006 * ((x + t * 40.0 + seed_offset * 137.0) / 70.0).sin();
        y += 0.004 * ((x - t * 25.0) / 31.0 + seed_offset).sin();
        rng = (rng * 1664525.0 + 1013904223.0) % 4_294_967_296.0;
        y += (rng / 4_294_967_296.0 - 0.5) * noise;
        y
    }).collect()
}

pub struct MockDriver {
    pub connected: bool,
    pub device_id: String,
}

impl MockDriver {
    pub fn new() -> Self {
        Self { connected: false, device_id: String::new() }
    }

    fn generate(&self, params: &AcqParams, seed_offset: f32) -> (Vec<f32>, Vec<f32>) {
        let xs = synth_xs();
        let ys = synth_ys(params, anim_t(), &xs, seed_offset);
        (xs, ys)
    }
}

impl SpectrumDriver for MockDriver {
    fn device_list(&self) -> Vec<DeviceInfo> {
        vec![
            DeviceInfo {
                id: "SPEC-A4".into(), name: "SPEC-A4".into(),
                model: "JASPER-NIR-1".into(),
                status: if self.connected && self.device_id == "SPEC-A4" {
                    "connected".into()
                } else {
                    "disconnected".into()
                },
                temp_c: 42.1,
            },
            DeviceInfo {
                id: "SPEC-B2".into(), name: "SPEC-B2".into(),
                model: "JASPER-NIR-1".into(),
                status: "disconnected".into(),
                temp_c: 38.4,
            },
        ]
    }

    fn connect(&mut self, device_id: &str) -> Result<(), String> {
        self.connected = true;
        self.device_id = device_id.to_string();
        Ok(())
    }

    fn disconnect(&mut self) {
        self.connected = false;
        self.device_id.clear();
    }

    fn scan(&self, params: &AcqParams) -> Result<SpectrumFrame, String> {
        let (xs, ys) = self.generate(params, 0.0);
        // units "": pre-styled for the requested mode, not raw counts
        Ok(SpectrumFrame { xs, ys, mode: params.mode.clone(), units: String::new(), timestamp: now_ms() })
    }

    fn telemetry(&self) -> Result<TelemetryData, String> {
        Ok(TelemetryData {
            device_id:   self.device_id.clone(),
            temp_c:      42.1 + (anim_t() * 0.1).sin() * 0.3,
            lamp_hours:  1280,
            drift_sigma: 0.42,
            headroom:    87.0,
            queue_depth: 0,
            timestamp:   now_ms(),
        })
    }

    fn calibrate_dark(&self, _params: &AcqParams) -> Result<CalResult, String> {
        // Simulate ~600ms work
        std::thread::sleep(std::time::Duration::from_millis(650));
        Ok(CalResult { status: "ok".into(), rms: None, warn: None })
    }

    fn calibrate_reference(&self, _params: &AcqParams) -> Result<CalResult, String> {
        std::thread::sleep(std::time::Duration::from_millis(650));
        Ok(CalResult { status: "ok".into(), rms: None, warn: None })
    }

    fn calibrate_xcal(&self) -> Result<XCalResult, String> {
        std::thread::sleep(std::time::Duration::from_millis(1400));
        Ok(XCalResult {
            status:       "ok".into(),
            rms:          0.018,
            coefficients: vec![400.0, 1.6],
            peaks_found:  12,
        })
    }
}
