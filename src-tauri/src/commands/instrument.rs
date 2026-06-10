use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State, Emitter};
use crate::state::AppState;
use crate::instrument::driver::{AcqParams, DeviceInfo, TelemetryData, CalResult, XCalResult};
use crate::instrument::process::{self, CalFrame};

/// Scans averaged into a stored dark/reference frame.
const CAL_SCANS: usize = 4;

/// Run driver work on a blocking thread. A real (or simulated) device holds
/// the driver mutex for a full integration period per scan, so commands that
/// wait for it MUST NOT run on the main thread — that froze the whole UI.
async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// ── Device management ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_discover_devices(
    state: State<'_, AppState>,
) -> Result<Vec<DeviceInfo>, String> {
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        let driver = driver.lock().map_err(|e| e.to_string())?;
        Ok(driver.device_list())
    })
    .await
}

#[tauri::command]
pub async fn cmd_connect_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<(), String> {
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        driver.lock().map_err(|e| e.to_string())?.connect(&device_id)
    })
    .await
}

#[tauri::command]
pub async fn cmd_disconnect_device(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.stop_acquisition();
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        driver.lock().map_err(|e| e.to_string())?.disconnect();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn cmd_get_telemetry(
    state: State<'_, AppState>,
) -> Result<TelemetryData, String> {
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        driver.lock().map_err(|e| e.to_string())?.telemetry()
    })
    .await
}

// ── Single scan ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cmd_scan(
    state: State<'_, AppState>,
    params: AcqParams,
) -> Result<crate::instrument::driver::SpectrumFrame, String> {
    let driver = Arc::clone(&state.driver);
    let calibration = Arc::clone(&state.calibration);
    run_blocking(move || {
        let frame = {
            let driver = driver.lock().map_err(|e| e.to_string())?;
            driver.scan(&params)?
        };
        let cal = calibration.lock().map_err(|e| e.to_string())?;
        Ok(process::process(frame, &cal))
    })
    .await
}

// ── Continuous acquisition ────────────────────────────────────────────────────

/// Starts a background thread that emits "spectrum-frame" events continuously.
/// Stopping the previous acquisition (if any) happens automatically.
///
/// Every frame comes from `driver.scan()` through the SpectrumDriver trait, so
/// the same loop streams from the mock or a real device unchanged.
#[tauri::command]
pub fn cmd_start_acquisition(
    app: AppHandle,
    state: State<'_, AppState>,
    params: AcqParams,
) -> Result<(), String> {
    // Claim a fresh generation; any previously running thread now sees a
    // mismatch on its next iteration and exits. No shared bool to race on.
    let my_gen = state.acq_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let generation = Arc::clone(&state.acq_generation);
    let driver = Arc::clone(&state.driver);
    let calibration = Arc::clone(&state.calibration);

    let interval_ms = (params.integration).max(16) as u64;

    std::thread::spawn(move || {
        while generation.load(Ordering::SeqCst) == my_gen {
            let started = std::time::Instant::now();

            let frame = {
                let drv = match driver.lock() {
                    Ok(d) => d,
                    Err(_) => break,
                };
                match drv.scan(&params) {
                    Ok(f) => f,
                    Err(e) => {
                        eprintln!("acquisition scan error, stopping stream: {e}");
                        break;
                    }
                }
            };

            // Raw counts → requested mode (dark/reference math, host-side)
            let frame = match calibration.lock() {
                Ok(cal) => process::process(frame, &cal),
                Err(_) => break,
            };

            // Re-check generation right before emitting so a just-retired thread
            // can't push a stale-mode frame.
            if generation.load(Ordering::SeqCst) != my_gen {
                break;
            }
            if let Err(e) = app.emit("spectrum-frame", &frame) {
                eprintln!("emit spectrum-frame error: {e}");
            }

            // A real device blocks in scan() for the integration time itself,
            // so only sleep the remainder of the frame interval — but always
            // leave a minimum gap, or this loop holds the driver mutex
            // essentially 100% of the time and starves every other command
            // (telemetry, connect, calibration).
            let elapsed_ms = started.elapsed().as_millis() as u64;
            let gap_ms = interval_ms.saturating_sub(elapsed_ms).max(15);
            std::thread::sleep(std::time::Duration::from_millis(gap_ms));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cmd_stop_acquisition(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.stop_acquisition();
    Ok(())
}

// ── Calibration ───────────────────────────────────────────────────────────────

/// Capture CAL_SCANS averaged frames and store as the dark frame.
/// Pauses the stream first so calibration doesn't fight it for the driver;
/// the frontend restarts acquisition when the calibration completes.
/// The quality warning only applies to raw-counts sources; mock-styled
/// frames are stored too but never used by process().
#[tauri::command]
pub async fn cmd_calibrate_dark(
    state: State<'_, AppState>,
    params: AcqParams,
) -> Result<CalResult, String> {
    state.stop_acquisition();
    let driver = Arc::clone(&state.driver);
    let calibration = Arc::clone(&state.calibration);
    run_blocking(move || {
        let avg = {
            let driver = driver.lock().map_err(|e| e.to_string())?;
            driver.calibrate_dark(&params)?; // device-specific hook (mock UX delay)
            process::average_scans(driver.as_ref(), &params, CAL_SCANS)?
        };

        let mut warn = None;
        if avg.units == "counts" {
            let mean = avg.ys.iter().sum::<f32>() / avg.ys.len().max(1) as f32;
            if mean > 5000.0 {
                warn = Some(format!("dark level high ({mean:.0} counts) — is the light off?"));
            }
        }

        let mut cal = calibration.lock().map_err(|e| e.to_string())?;
        cal.dark = Some(CalFrame { ys: avg.ys, integration_ms: params.integration });
        Ok(CalResult { status: "ok".into(), rms: None, warn })
    })
    .await
}

/// Capture CAL_SCANS averaged frames and store as the reference frame.
/// Same stream-pause contract as cmd_calibrate_dark.
#[tauri::command]
pub async fn cmd_calibrate_reference(
    state: State<'_, AppState>,
    params: AcqParams,
) -> Result<CalResult, String> {
    state.stop_acquisition();
    let driver = Arc::clone(&state.driver);
    let calibration = Arc::clone(&state.calibration);
    run_blocking(move || {
        let avg = {
            let driver = driver.lock().map_err(|e| e.to_string())?;
            driver.calibrate_reference(&params)?;
            process::average_scans(driver.as_ref(), &params, CAL_SCANS)?
        };

        let mut cal = calibration.lock().map_err(|e| e.to_string())?;

        let mut warn = None;
        if avg.units == "counts" {
            let max = avg.ys.iter().cloned().fold(f32::MIN, f32::max);
            let dark_mean = cal
                .dark
                .as_ref()
                .filter(|d| d.ys.len() == avg.ys.len())
                .map(|d| d.ys.iter().sum::<f32>() / d.ys.len().max(1) as f32);
            if max >= 55_000.0 {
                warn = Some("reference near saturation — reduce integration".into());
            } else if let Some(dm) = dark_mean {
                if max - dm < 500.0 {
                    warn = Some("reference signal low — check the light path".into());
                }
            }
        }

        cal.reference = Some(CalFrame { ys: avg.ys, integration_ms: params.integration });
        Ok(CalResult { status: "ok".into(), rms: None, warn })
    })
    .await
}

#[tauri::command]
pub async fn cmd_calibrate_xcal(
    state: State<'_, AppState>,
) -> Result<XCalResult, String> {
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        driver.lock().map_err(|e| e.to_string())?.calibrate_xcal()
    })
    .await
}

