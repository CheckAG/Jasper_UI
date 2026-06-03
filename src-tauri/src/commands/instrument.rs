use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State, Emitter};
use crate::state::AppState;
use crate::instrument::driver::{AcqParams, DeviceInfo, TelemetryData, CalResult, XCalResult};

// ── Device management ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_discover_devices(
    state: State<'_, AppState>,
) -> Result<Vec<DeviceInfo>, String> {
    let driver = state.driver.lock().map_err(|e| e.to_string())?;
    Ok(driver.device_list())
}

#[tauri::command]
pub fn cmd_connect_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<(), String> {
    let mut driver = state.driver.lock().map_err(|e| e.to_string())?;
    driver.connect(&device_id)
}

#[tauri::command]
pub fn cmd_disconnect_device(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.stop_acquisition();
    let mut driver = state.driver.lock().map_err(|e| e.to_string())?;
    driver.disconnect();
    Ok(())
}

#[tauri::command]
pub fn cmd_get_telemetry(
    state: State<'_, AppState>,
) -> Result<TelemetryData, String> {
    let driver = state.driver.lock().map_err(|e| e.to_string())?;
    driver.telemetry()
}

// ── Single scan ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn cmd_scan(
    state: State<'_, AppState>,
    params: AcqParams,
) -> Result<crate::instrument::driver::SpectrumFrame, String> {
    let driver = state.driver.lock().map_err(|e| e.to_string())?;
    driver.scan(&params)
}

// ── Continuous acquisition ────────────────────────────────────────────────────

/// Starts a background thread that emits "spectrum-frame" events continuously.
/// Stopping the previous acquisition (if any) happens automatically.
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

    // Take a single scan to get the xs array (static for this instrument)
    let xs = {
        let driver = state.driver.lock().map_err(|e| e.to_string())?;
        let frame = driver.scan(&params)?;
        frame.xs
    };

    let interval_ms = (params.integration).max(16) as u64;
    let mode = params.mode.clone();

    std::thread::spawn(move || {
        let mut t: f32 = 0.0;
        while generation.load(Ordering::SeqCst) == my_gen {
            let ys = crate::instrument::mock::synth_ys(&params, t, &xs, 0.0);
            let frame = crate::instrument::driver::SpectrumFrame {
                xs: xs.clone(),
                ys,
                mode: mode.clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            };

            // Re-check generation right before emitting so a just-retired thread
            // can't push a stale-mode frame.
            if generation.load(Ordering::SeqCst) != my_gen {
                break;
            }
            if let Err(e) = app.emit("spectrum-frame", &frame) {
                eprintln!("emit spectrum-frame error: {e}");
            }

            t += interval_ms as f32 / 1000.0;
            std::thread::sleep(std::time::Duration::from_millis(interval_ms));
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

#[tauri::command]
pub fn cmd_calibrate_dark(
    state: State<'_, AppState>,
    params: AcqParams,
) -> Result<CalResult, String> {
    let driver = state.driver.lock().map_err(|e| e.to_string())?;
    driver.calibrate_dark(&params)
}

#[tauri::command]
pub fn cmd_calibrate_reference(
    state: State<'_, AppState>,
    params: AcqParams,
) -> Result<CalResult, String> {
    let driver = state.driver.lock().map_err(|e| e.to_string())?;
    driver.calibrate_reference(&params)
}

#[tauri::command]
pub fn cmd_calibrate_xcal(
    state: State<'_, AppState>,
) -> Result<XCalResult, String> {
    let driver = state.driver.lock().map_err(|e| e.to_string())?;
    driver.calibrate_xcal()
}

