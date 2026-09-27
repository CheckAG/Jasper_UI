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
/// `units` says what `ys` actually are, so the GUI labels honestly:
///   ""         — mock-styled data shaped for the requested mode
///   "counts"   — raw device counts (no calibration applied yet)
///   "counts_d" — dark-subtracted counts
///   "ratio"    — (S−D)/(R−D), for transmittance/reflectance
///   "abs"      — −log10 of that ratio
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SpectrumFrame {
    pub xs:        Vec<f32>,
    pub ys:        Vec<f32>,
    pub mode:      String,
    pub units:     String,
    /// Integration time that actually produced this frame, in ms, as reported
    /// by the device — not what was asked for. The device clamps to its own
    /// range, so these differ whenever the request was out of bounds.
    pub integration_ms: u32,
    pub timestamp: u64,
}

/// One instrument the host can see. Produced by probing a port, so every field
/// here came from the device itself.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceInfo {
    /// Port path — what `connect` takes.
    pub id:       String,
    /// Human label, e.g. "TCD1304 · 323731".
    pub name:     String,
    pub model:    String,
    /// "online" when this is the connected device, else "available".
    pub status:   String,
    pub serial:   String,
    pub firmware: String,
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

/// What an instrument can actually tell you about itself.
///
/// This replaced a `TelemetryData` of temperature, lamp hours, drift and
/// headroom — none of which the TCD1304 measures, so all four were rendered as
/// zeros indistinguishable from real readings. Everything here is either read
/// from the device during the handshake or counted from frame headers since.
///
/// Mirrored by hand in `src/lib/types.ts` and `src/lib/dto.ts`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceMetadata {
    pub port:             String,
    pub manufacturer:     String,
    pub model:            String,
    /// Per-unit identifier. On the TCD1304 this is the MCU unique ID — the USB
    /// serial string descriptor is a compile-time constant on every board, so
    /// this is the only thing that distinguishes two units.
    pub serial:           String,
    /// Opaque display string. Gate behaviour on `protocol_version`, never this.
    pub firmware:         String,
    pub protocol_version: u32,
    pub pixels:           u32,
    pub integ_min_ms:     u32,
    pub integ_max_ms:     u32,
    pub max_intensity:    i32,
    pub sensor:           String,
    pub last_seq:         u16,
    pub dropped_frames:   u32,
    pub last_capture_ms:  u32,
    pub timestamp:        u64,
}

/// One line in the Instrument workspace's diagnostics log.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiagEntry {
    pub id:       String,
    pub ts:       u64,
    /// "info" | "warn" | "error"
    pub severity: String,
    pub message:  String,
}

// ── Driver trait ──────────────────────────────────────────────────────────────

pub trait SpectrumDriver: Send {
    fn device_list(&self) -> Vec<DeviceInfo>;
    fn connect(&mut self, device_id: &str) -> Result<(), String>;
    fn disconnect(&mut self);
    fn scan(&self, params: &AcqParams) -> Result<SpectrumFrame, String>;
    fn calibrate_dark(&self, params: &AcqParams) -> Result<CalResult, String>;
    fn calibrate_reference(&self, params: &AcqParams) -> Result<CalResult, String>;
    fn calibrate_xcal(&self) -> Result<XCalResult, String>;

    /// Identity and limits, once connected. `None` before the handshake.
    /// Defaults to `None` so a driver with nothing to report says nothing.
    fn device_metadata(&self) -> Option<DeviceMetadata> {
        None
    }

    /// Whether an instrument is actually open. Operations that touch hardware
    /// are refused when this is false, rather than connecting on the caller's
    /// behalf.
    fn is_connected(&self) -> bool {
        false
    }

    /// Recent events — connects, handshake failures, device errors, timeouts.
    /// Newest last. Defaults to empty rather than to invented entries.
    fn diagnostics(&self) -> Vec<DiagEntry> {
        Vec::new()
    }
}
