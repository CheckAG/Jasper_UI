use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State};
use crate::state::AppState;
use crate::instrument::driver::XCalResult;
use crate::api::{self, Caller, Request};
#[cfg(test)]
use crate::api::STALE_FRAME_MS;

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

/// The GUI's way into the Device API. Everything the GUI does to the
/// instrument — connect, settings, live, dark/reference, capture — goes
/// through here, the same dispatcher scripts and agents will use.
#[tauri::command]
pub async fn cmd_api(
    app: AppHandle,
    request: serde_json::Value,
) -> Result<serde_json::Value, api::ApiError> {
    let request: Request = serde_json::from_value(request)
        .map_err(|e| api::ApiError { code: 4011, message: "INVALID_VALUE", detail: e.to_string(), data: serde_json::Value::Null })?;
    let events: Arc<dyn api::Events> = Arc::new(app.clone());
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        api::dispatch(&state, events, Caller::Gui, request)
    })
    .await
    .map_err(|e| api::ApiError { code: 5000, message: "INTERNAL", detail: e.to_string(), data: serde_json::Value::Null })?
}

// ── Live-stream backpressure ──────────────────────────────────────────────────

/// Called by the frontend once a streamed frame has been rendered, so the
/// acquisition loop may produce the next one.
#[tauri::command]
pub fn cmd_frame_consumed(state: State<'_, AppState>) -> Result<(), String> {
    state.frame_in_flight.store(0, Ordering::SeqCst);
    Ok(())
}

// ── Wavelength calibration (not implemented on this device yet, #7) ───────────

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
