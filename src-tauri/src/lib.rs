mod state;
pub mod instrument; // pub: integration tests drive the driver against the protocol simulator
pub mod storage;
mod api;
mod commands;

use tauri::Manager;
use state::AppState;
use commands::instrument::*;
use commands::storage::*;
use commands::sidecar::cmd_sidecar_request;
use commands::export::{cmd_save_export, cmd_save_xlsx};

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

            let home = app.path().home_dir().expect("failed to resolve home dir");
            app.manage(AppState::new(&data_dir, storage::files::spectra_root(&home)));

            // Scripts, the CLI and agents reach the Device API here. A second
            // copy of the app finds the port taken and runs without it.
            match std::net::TcpListener::bind(("127.0.0.1", api::server::PORT)) {
                Ok(listener) => {
                    let handle = app.handle().clone();
                    let events: std::sync::Arc<dyn api::Events> = std::sync::Arc::new(handle.clone());
                    api::server::serve(listener, std::sync::Arc::new(move |caller, req| {
                        api::dispatch(&handle.state::<AppState>(), events.clone(), caller, req)
                    }));
                    eprintln!("[api] listening on 127.0.0.1:{}", api::server::PORT);
                }
                Err(e) => eprintln!("[api] not listening on 127.0.0.1:{}: {e}", api::server::PORT),
            }

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
            // Instrument — everything but firmware and x-cal goes through the Device API
            cmd_api,
            cmd_frame_consumed,
            cmd_calibrate_xcal,
            cmd_update_firmware,
            // Storage
            cmd_save_session,
            cmd_load_sessions,
            cmd_delete_session,
            cmd_workspace_dir,
            cmd_load_captures,
            cmd_delete_capture,
            cmd_count_captures,
            cmd_save_audit,
            // Sidecar
            cmd_sidecar_request,
            // Export
            cmd_save_export,
            cmd_save_xlsx,
        ])
        .run(tauri::generate_context!())
        .expect("error while running JASPER");
}
