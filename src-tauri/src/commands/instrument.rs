use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State, Emitter};
use crate::state::AppState;
use crate::instrument::driver::{AcqParams, DeviceInfo, CalResult, XCalResult, SpectrumDriver};
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

/// Every instrument the host can see.
///
/// Ports are probed with the protocol handshake — nothing is listed that did not
/// answer as a TCD1304, so this returns an empty list when no hardware is
/// attached rather than placeholders.
#[tauri::command]
pub async fn cmd_discover_devices(
    state: State<'_, AppState>,
) -> Result<Vec<DeviceInfo>, String> {
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        // The connected device comes from the live driver, which knows its own
        // identity without reopening anything. Everything else is found by
        // probing — including when the session started with no hardware, so a
        // board plugged in later is still reachable.
        let mine = driver.lock().map_err(|e| e.to_string())?.device_list();
        let connected: Option<String> = mine.first().map(|d| d.id.clone());
        let mut all = mine;
        all.extend(crate::instrument::tcd1304::discover(connected.as_deref()));
        Ok(all)
    })
    .await
}

/// Connect to a device by port path.
///
/// Swaps the live driver, so a session that started with no hardware can pick
/// up a board plugged in later — and so a port typed in by hand works exactly
/// like a discovered one. `"mock"` selects the simulated driver.
#[tauri::command]
pub async fn cmd_connect_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<(), String> {
    state.stop_acquisition();
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        let mut slot = driver.lock().map_err(|e| e.to_string())?;
        slot.disconnect();

        let mut next: Box<dyn SpectrumDriver + Send> = if device_id == "mock" {
            Box::new(crate::instrument::mock::MockDriver::new())
        } else {
            Box::new(crate::instrument::tcd1304::Tcd1304Driver::new(device_id.clone()))
        };
        // Handshake before adopting it: a failed connect must leave the previous
        // driver in place rather than swapping in one that cannot talk.
        next.connect(&device_id)?;
        *slot = next;
        Ok(())
    })
    .await
}

/// Recent instrument events. Empty until something has happened.
#[tauri::command]
pub async fn cmd_get_diagnostics(
    state: State<'_, AppState>,
) -> Result<Vec<crate::instrument::driver::DiagEntry>, String> {
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        Ok(driver.lock().map_err(|e| e.to_string())?.diagnostics())
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

/// Identity and limits of the connected instrument.
///
/// Returns `None` when nothing is connected, or when the driver has nothing to
/// report — the panel shows an empty state rather than zeros that look like
/// readings.
#[tauri::command]
pub async fn cmd_get_device_metadata(
    state: State<'_, AppState>,
) -> Result<Option<crate::instrument::driver::DeviceMetadata>, String> {
    let driver = Arc::clone(&state.driver);
    run_blocking(move || {
        Ok(driver.lock().map_err(|e| e.to_string())?.device_metadata())
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

/// How long to honour the backpressure gate before assuming the frontend is
/// never going to report back. Long enough that a slow render is respected,
/// short enough that a dead renderer does not freeze the stream.
const STALE_FRAME_MS: u64 = 1_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Called by the frontend once a streamed frame has been rendered, so the
/// acquisition loop may produce the next one.
#[tauri::command]
pub fn cmd_frame_consumed(state: State<'_, AppState>) -> Result<(), String> {
    state.frame_in_flight.store(0, Ordering::SeqCst);
    Ok(())
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

    let in_flight = Arc::clone(&state.frame_in_flight);

    // A capture costs about 2x the integration time: the firmware discards the
    // in-progress frame and sends the next one. Pacing on 1x asks for frames
    // faster than the device can produce them, so the loop spends its time
    // blocked inside scan() while holding the driver mutex.
    let interval_ms = (2 * params.integration).max(16) as u64;

    std::thread::spawn(move || {
        while generation.load(Ordering::SeqCst) == my_gen {
            let started = std::time::Instant::now();

            // Backpressure. Each frame is 3694 points; at short integration
            // times the webview cannot render them as fast as the device can
            // produce them, and every extra frame queued makes the displayed
            // trace older. Skip the capture entirely rather than emitting into
            // a queue nobody is draining — showing the newest data beats
            // showing all of it, late.
            //
            // The gate opens again when the frontend calls `cmd_frame_consumed`,
            // or after STALE_FRAME_MS if it never does — a renderer that dies
            // mid-frame must not stop the stream forever.
            let waiting_since = in_flight.load(Ordering::SeqCst);
            if waiting_since != 0 && now_ms().saturating_sub(waiting_since) < STALE_FRAME_MS {
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            }

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
            in_flight.store(now_ms(), Ordering::SeqCst);
            if let Err(e) = app.emit("spectrum-frame", &frame) {
                eprintln!("emit spectrum-frame error: {e}");
                in_flight.store(0, Ordering::SeqCst);
            }

            // A real device blocks in scan() for the capture itself, so only
            // sleep the remainder of the frame interval — but always leave a
            // minimum gap, or this loop holds the driver mutex essentially
            // 100% of the time and starves every other command (metadata,
            // connect, calibration).
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
        {
            let d = driver.lock().map_err(|e| e.to_string())?;
            if !d.is_connected() {
                return Err(crate::instrument::tcd1304::NOT_CONNECTED.to_string());
            }
        }

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
        {
            let d = driver.lock().map_err(|e| e.to_string())?;
            if !d.is_connected() {
                return Err(crate::instrument::tcd1304::NOT_CONNECTED.to_string());
            }
        }

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
        {
            let d = driver.lock().map_err(|e| e.to_string())?;
            if !d.is_connected() {
                return Err(crate::instrument::tcd1304::NOT_CONNECTED.to_string());
            }
        }

        driver.lock().map_err(|e| e.to_string())?.calibrate_xcal()
    })
    .await
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    /// The rule the acquisition loop applies before each capture. Extracted so
    /// it can be checked without a Tauri app handle or a device.
    fn should_skip(in_flight: &AtomicU64, now: u64) -> bool {
        let waiting_since = in_flight.load(Ordering::SeqCst);
        waiting_since != 0 && now.saturating_sub(waiting_since) < STALE_FRAME_MS
    }

    #[test]
    fn an_idle_frontend_never_blocks_capture() {
        let gate = AtomicU64::new(0);
        assert!(!should_skip(&gate, 10_000));
    }

    #[test]
    fn a_frame_awaiting_render_holds_the_next_capture() {
        let gate = AtomicU64::new(10_000);
        assert!(should_skip(&gate, 10_000), "same instant");
        assert!(should_skip(&gate, 10_000 + STALE_FRAME_MS - 1), "still within the window");
    }

    #[test]
    fn a_renderer_that_never_reports_back_does_not_freeze_the_stream() {
        // The gate is an optimisation, not a lock. If the frontend dies holding
        // it, capture has to resume rather than wait forever.
        let gate = AtomicU64::new(10_000);
        assert!(!should_skip(&gate, 10_000 + STALE_FRAME_MS));
        assert!(!should_skip(&gate, 10_000 + STALE_FRAME_MS * 10));
    }

    #[test]
    fn reporting_a_frame_rendered_reopens_the_gate() {
        let gate = AtomicU64::new(10_000);
        assert!(should_skip(&gate, 10_000));
        gate.store(0, Ordering::SeqCst); // what cmd_frame_consumed does
        assert!(!should_skip(&gate, 10_000));
    }

    #[test]
    fn frame_interval_paces_on_the_real_cost_of_a_capture() {
        // A capture costs about 2x integration: the firmware discards the
        // in-progress frame and sends the next. Pacing on 1x asks for frames
        // faster than the device can make them.
        let interval = |integration: u32| (2 * integration).max(16) as u64;
        assert_eq!(interval(50), 100);
        assert_eq!(interval(8), 16, "the floor still applies at the device minimum");
        assert_eq!(interval(0), 16, "and to a nonsense request");
    }
}
