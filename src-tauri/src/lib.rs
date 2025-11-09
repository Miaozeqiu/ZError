// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 模块声明
pub mod database;
pub mod logger;
pub mod server;
pub mod types;
pub mod commands;

pub use database::*;
pub use types::*;
pub use server::{start_server, stop_server, get_server_status};
pub use commands::{greet, create_directory, get_username, file_exists, get_request_logs, clear_request_logs, open_devtools, fetch_image_as_base64, open_url_content_window, set_non_thinking_analysis_enabled, set_current_model_is_thinking};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ServerState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            create_directory,
            file_exists,
            get_username,
            start_server,
            stop_server,
            get_server_status,
            get_request_logs,
            clear_request_logs,
            open_devtools,
            fetch_image_as_base64,
            open_url_content_window,
            set_non_thinking_analysis_enabled
            , set_current_model_is_thinking
        ])
        .setup(|app| {
            // 不在启动时创建UrlContent窗口，改为完全按需创建
            // 这样可以避免窗口状态不一致的问题
            println!("✅ 应用启动完成，UrlContent窗口将按需创建");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
