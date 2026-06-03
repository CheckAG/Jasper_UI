use serde::{Deserialize, Serialize};

// ── Shared data types (mirrored in src/lib/types.ts) ─────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AcqParams {
    pub mode:        String,
    pub acq_mode:    String,
    pub integration: u32,     // ms
    pub averaging:   u32,
    pub light_on:    bool,
    pub light_power: f32,
    pub x_unit:      String,
    pub y_unit:      String,
    pub lock_axes:   bool,
    pub stack:       bool,
}

impl Default for AcqParams {
    fn default() -> Self {
        Self {
            mode:        "absorbance".into(),
            acq_mode:    "continuous".into(),
            integration: 120,
            averaging:   4,
            light_on:    true,
            light_power: 80.0,
            x_unit:      "nm".into(),
            y_unit:      "au".into(),
            lock_axes:   false,
            stack:       false,
        }
    }
}

/// One spectrum frame emitted to the frontend.
/// `xs` is stable for a given instrument — frontend may cache it.
/// `mode` lets the frontend discard frames left over from a previous mode.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpectrumFrame {
    pub xs:        Vec<f32>,
    pub ys:        Vec<f32>,
    pub mode:      String,
    pub timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TelemetryData {
    pub device_id:   String,
    pub temp_c:      f32,
    pub lamp_hours:  u32,
    pub drift_sigma: f32,
    pub headroom:    f32,
    pub queue_depth: u32,
    pub timestamp:   u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceInfo {
    pub id:     String,
    pub name:   String,
    pub model:  String,
    pub status: String,
    pub temp_c: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalResult {
    pub status: String,
    pub rms:    Option<f32>,
    pub warn:   Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct XCalResult {
    pub status:       String,
    pub rms:          f32,
    pub coefficients: Vec<f32>,
    pub peaks_found:  u32,
}

// ── Driver trait ──────────────────────────────────────────────────────────────

pub trait SpectrumDriver: Send {
    fn device_list(&self) -> Vec<DeviceInfo>;
    fn connect(&mut self, device_id: &str) -> Result<(), String>;
    fn disconnect(&mut self);
    fn scan(&self, params: &AcqParams) -> Result<SpectrumFrame, String>;
    fn telemetry(&self) -> Result<TelemetryData, String>;
    fn calibrate_dark(&self, params: &AcqParams) -> Result<CalResult, String>;
    fn calibrate_reference(&self, params: &AcqParams) -> Result<CalResult, String>;
    fn calibrate_xcal(&self) -> Result<XCalResult, String>;
}
