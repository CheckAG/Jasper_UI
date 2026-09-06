// Host-side measurement pipeline (PROTOCOL.md §5: dark subtraction and
// derived modes are the host's job, not the device's).
//
// Drivers return frames tagged by `units`: real devices send raw "counts";
// the mock sends pre-styled data (units ""). `process()` turns raw counts
// into the requested measurement mode using the stored dark/reference
// frames, and passes everything else through untouched — so the mock and a
// real device flow through the same code path.

use crate::instrument::driver::{AcqParams, SpectrumDriver, SpectrumFrame};

/// One stored calibration frame (averaged raw counts).
pub struct CalFrame {
    pub ys: Vec<f32>,
    /// Integration the frame was taken at; a dark frame only cancels the
    /// offset of scans with matching integration.
    pub integration_ms: u32,
}

#[derive(Default)]
pub struct Calibration {
    pub dark:      Option<CalFrame>,
    pub reference: Option<CalFrame>,
}

/// Capture `n` scans through the driver and average them (for dark/reference).
pub fn average_scans(
    driver: &dyn SpectrumDriver,
    params: &AcqParams,
    n: usize,
) -> Result<SpectrumFrame, String> {
    let mut acc: Option<SpectrumFrame> = None;
    for _ in 0..n.max(1) {
        let f = driver.scan(params)?;
        match &mut acc {
            None => acc = Some(f),
            Some(a) => {
                if f.ys.len() != a.ys.len() {
                    return Err("pixel count changed mid-calibration".into());
                }
                for (s, v) in a.ys.iter_mut().zip(&f.ys) {
                    *s += v;
                }
            }
        }
    }
    let mut a = acc.ok_or("no scans captured")?;
    for v in &mut a.ys {
        *v /= n.max(1) as f32;
    }
    Ok(a)
}

/// Apply the measurement-mode math to a raw-counts frame.
///
/// absorbance / transmittance / reflectance need BOTH dark and reference;
/// without them the frame falls back to raw counts (units stays "counts" so
/// the GUI labels it as such). intensity/counts/irradiance get dark
/// subtraction when a dark frame exists.
pub fn process(mut frame: SpectrumFrame, cal: &Calibration) -> SpectrumFrame {
    if frame.units != "counts" {
        return frame; // mock-styled or already-processed data
    }
    let n = frame.ys.len();
    let dark = cal.dark.as_ref().filter(|d| d.ys.len() == n);
    let reference = cal.reference.as_ref().filter(|r| r.ys.len() == n);

    match frame.mode.as_str() {
        "absorbance" | "transmittance" | "reflectance" => {
            let (Some(d), Some(r)) = (dark, reference) else {
                return frame;
            };
            let absorbance = frame.mode == "absorbance";
            for i in 0..n {
                // Guard near-zero denominator (reference ≈ dark) with 1 count
                let t = (frame.ys[i] - d.ys[i]) / (r.ys[i] - d.ys[i]).max(1.0);
                // Clamp T below at 1e-4 → absorbance caps at 4.0
                frame.ys[i] = if absorbance { -t.max(1e-4).log10() } else { t };
            }
            frame.units = if absorbance { "abs".into() } else { "ratio".into() };
        }
        _ => {
            if let Some(d) = dark {
                for i in 0..n {
                    frame.ys[i] -= d.ys[i];
                }
                frame.units = "counts_d".into();
            }
        }
    }
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(ys: Vec<f32>, mode: &str, units: &str) -> SpectrumFrame {
        SpectrumFrame {
            xs: (0..ys.len()).map(|i| i as f32).collect(),
            ys,
            mode: mode.into(),
            units: units.into(),
            timestamp: 0,
        }
    }

    fn cal(dark: Option<Vec<f32>>, reference: Option<Vec<f32>>) -> Calibration {
        Calibration {
            dark:      dark.map(|ys| CalFrame { ys, integration_ms: 120 }),
            reference: reference.map(|ys| CalFrame { ys, integration_ms: 120 }),
        }
    }

    #[test]
    fn absorbance_known_value() {
        // S=600, D=100, R=1100 → T = 500/1000 = 0.5 → A = log10(2) ≈ 0.30103
        let c = cal(Some(vec![100.0; 4]), Some(vec![1100.0; 4]));
        let out = process(frame(vec![600.0; 4], "absorbance", "counts"), &c);
        assert_eq!(out.units, "abs");
        for y in &out.ys {
            assert!((y - 0.30103).abs() < 1e-4, "A = {y}");
        }
    }

    #[test]
    fn transmittance_is_ratio() {
        let c = cal(Some(vec![100.0; 2]), Some(vec![1100.0; 2]));
        let out = process(frame(vec![850.0; 2], "transmittance", "counts"), &c);
        assert_eq!(out.units, "ratio");
        assert!((out.ys[0] - 0.75).abs() < 1e-5);
    }

    #[test]
    fn absorbance_without_cal_falls_back_to_counts() {
        let out = process(frame(vec![600.0; 4], "absorbance", "counts"), &cal(None, None));
        assert_eq!(out.units, "counts");
        assert_eq!(out.ys[0], 600.0);
    }

    #[test]
    fn intensity_gets_dark_subtraction() {
        let c = cal(Some(vec![100.0; 3]), None);
        let out = process(frame(vec![600.0; 3], "intensity", "counts"), &c);
        assert_eq!(out.units, "counts_d");
        assert_eq!(out.ys[0], 500.0);
    }

    #[test]
    fn mock_styled_frames_pass_through() {
        let c = cal(Some(vec![100.0; 2]), Some(vec![1100.0; 2]));
        let out = process(frame(vec![0.42; 2], "absorbance", ""), &c);
        assert_eq!(out.units, "");
        assert_eq!(out.ys[0], 0.42);
    }

    #[test]
    fn pixel_count_mismatch_is_ignored() {
        // 320-px mock dark stored, then 1024-px real frames arrive
        let c = cal(Some(vec![100.0; 320]), Some(vec![1100.0; 320]));
        let out = process(frame(vec![600.0; 1024], "absorbance", "counts"), &c);
        assert_eq!(out.units, "counts"); // untouched
    }

    #[test]
    fn absorbance_clamps_at_4() {
        // S below dark → T clamps at 1e-4 → A = 4
        let c = cal(Some(vec![100.0; 2]), Some(vec![1100.0; 2]));
        let out = process(frame(vec![50.0; 2], "absorbance", "counts"), &c);
        assert!((out.ys[0] - 4.0).abs() < 1e-5);
    }
}
