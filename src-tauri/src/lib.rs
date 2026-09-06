mod state;
pub mod instrument; // pub: integration tests drive the driver against the protocol simulator
mod storage;
mod commands;

use tauri::Manager;
use state::AppState;
use commands::instrument::*;
use commands::storage::*;
use commands::sidecar::cmd_sidecar_request;
use commands::export::cmd_save_export;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir)
                .expect("failed to create app data dir");

            app.manage(AppState::new(&data_dir));

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Instrument
            cmd_discover_devices,
            cmd_connect_device,
            cmd_disconnect_device,
            cmd_get_device_metadata,
            cmd_scan,
            cmd_start_acquisition,
            cmd_stop_acquisition,
            cmd_calibrate_dark,
            cmd_calibrate_reference,
            cmd_calibrate_xcal,
            // Storage
            cmd_save_session,
            cmd_load_sessions,
            cmd_delete_session,
            cmd_save_capture,
            cmd_load_captures,
            cmd_delete_capture,
            cmd_count_captures,
            cmd_save_audit,
            // Sidecar
            cmd_sidecar_request,
            // Export
            cmd_save_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JASPER");
}
