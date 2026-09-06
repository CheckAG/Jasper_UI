// The device's reply to `M`: `KEY=VALUE;` pairs, semicolon-terminated including
// the last one. Example (current firmware, 146 bytes):
//
//   PIXELS=3694;ACTIVE=32:3679;DARK=16:28;INTEG_MIN_MS=8;INTEG_MAX_MS=10000;
//   MAX_INTENSITY=32767;PIXEL_RATE_HZ=500000;READOUT_US=7388;SENSOR=TCD1304AP;
//
// A host must ignore keys it does not recognise: new ones arrive without a
// protocol version bump. Removing or redefining one bumps the version byte,
// which the frame parser already rejects.

use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Metadata {
    pub pixels: usize,
    /// Illuminated pixel window, inclusive 0-based indices.
    pub active: (usize, usize),
    /// Masked pixels for dark-current reference, inclusive 0-based.
    ///
    /// ponytail: unconfirmed against hardware — the hardware repo flags this as
    /// derived from the datasheet's output-element table and never checked.
    /// Wrong indices raise no error, they silently bias every dark-corrected
    /// spectrum. Cap the sensor and confirm before relying on it.
    pub dark: (usize, usize),
    pub integ_min_ms: u32,
    pub integ_max_ms: u32,
    /// The point at which a reading stops being meaningful and rolls negative.
    /// 32767, not 65535: the ADC is 16-bit but samples are read signed.
    pub max_intensity: i32,
    pub pixel_rate_hz: u32,
    pub readout_us: u32,
    pub sensor: String,
    /// Every key as sent, including ones this struct does not model.
    pub raw: BTreeMap<String, String>,
}

impl Default for Metadata {
    /// The current firmware's values. Only reached if the device omits a key —
    /// a guess is better than a panic, and `raw` still shows what really arrived.
    fn default() -> Self {
        Self {
            pixels:        3694,
            active:        (32, 3679),
            dark:          (16, 28),
            integ_min_ms:  8,
            integ_max_ms:  10_000,
            max_intensity: 32_767,
            pixel_rate_hz: 500_000,
            readout_us:    7_388,
            sensor:        String::new(),
            raw:           BTreeMap::new(),
        }
    }
}

impl Metadata {
    pub fn parse(text: &str) -> Self {
        let raw: BTreeMap<String, String> = text
            .split(';')
            .filter_map(|item| item.split_once('='))
            .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
            .collect();

        let mut m = Self { raw, ..Default::default() };

        if let Some(v) = m.num("PIXELS") { m.pixels = v as usize; }
        if let Some(v) = m.range("ACTIVE") { m.active = v; }
        if let Some(v) = m.range("DARK") { m.dark = v; }
        if let Some(v) = m.num("INTEG_MIN_MS") { m.integ_min_ms = v as u32; }
        if let Some(v) = m.num("INTEG_MAX_MS") { m.integ_max_ms = v as u32; }
        if let Some(v) = m.num("MAX_INTENSITY") { m.max_intensity = v as i32; }
        if let Some(v) = m.num("PIXEL_RATE_HZ") { m.pixel_rate_hz = v as u32; }
        if let Some(v) = m.num("READOUT_US") { m.readout_us = v as u32; }
        if let Some(v) = m.raw.get("SENSOR") { m.sensor = v.clone(); }
        m
    }

    fn num(&self, key: &str) -> Option<i64> {
        self.raw.get(key)?.parse().ok()
    }

    fn range(&self, key: &str) -> Option<(usize, usize)> {
        let (lo, hi) = self.raw.get(key)?.split_once(':')?;
        Some((lo.trim().parse().ok()?, hi.trim().parse().ok()?))
    }

    /// Clamp a requested integration time the way the device will. The device
    /// clamps regardless and reports what it applied; doing it here too keeps
    /// the UI from offering values that will silently snap.
    pub fn clamp_integration(&self, ms: u32) -> u32 {
        ms.clamp(self.integ_min_ms, self.integ_max_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CURRENT: &str = "PIXELS=3694;ACTIVE=32:3679;DARK=16:28;INTEG_MIN_MS=8;\
                           INTEG_MAX_MS=10000;MAX_INTENSITY=32767;PIXEL_RATE_HZ=500000;\
                           READOUT_US=7388;SENSOR=TCD1304AP;";

    #[test]
    fn parses_the_current_firmware_reply() {
        let m = Metadata::parse(CURRENT);
        assert_eq!(m.pixels, 3694);
        assert_eq!(m.active, (32, 3679));
        assert_eq!(m.dark, (16, 28));
        assert_eq!((m.integ_min_ms, m.integ_max_ms), (8, 10_000));
        assert_eq!(m.max_intensity, 32_767);
        assert_eq!(m.pixel_rate_hz, 500_000);
        assert_eq!(m.readout_us, 7_388);
        assert_eq!(m.sensor, "TCD1304AP");
    }

    #[test]
    fn active_and_dark_are_real_non_overlapping_windows() {
        let m = Metadata::parse(CURRENT);
        assert!(m.dark.1 < m.active.0, "dark window must sit before the active one");
        assert!(m.active.1 < m.pixels, "active window must fit inside the array");
    }

    #[test]
    fn unknown_keys_from_a_newer_firmware_do_not_break_the_parse() {
        let m = Metadata::parse("PIXELS=100;FUTURE_THING=xyz;SAMPLE_FMT=S16LE;RANGE=1:2;");
        assert_eq!(m.pixels, 100);
        assert_eq!(m.raw.get("FUTURE_THING").map(String::as_str), Some("xyz"));
        assert_eq!(m.raw.get("SAMPLE_FMT").map(String::as_str), Some("S16LE"));
        // Anything not sent keeps the current firmware's value rather than zero.
        assert_eq!(m.max_intensity, 32_767);
    }

    #[test]
    fn missing_and_malformed_values_fall_back_instead_of_panicking() {
        let m = Metadata::parse("PIXELS=notanumber;DARK=oops;;=;SENSOR=");
        assert_eq!(m.pixels, 3694);
        assert_eq!(m.dark, (16, 28));
        assert_eq!(m.sensor, "");
    }

    #[test]
    fn integration_is_clamped_to_the_device_range() {
        let m = Metadata::parse(CURRENT);
        assert_eq!(m.clamp_integration(3), 8, "floor");
        assert_eq!(m.clamp_integration(999_999), 10_000, "ceiling");
        assert_eq!(m.clamp_integration(25), 25, "in range, untouched");
    }
}
