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
pub use commands::{greet, create_directory, get_username, file_exists, get_request_logs, clear_request_logs, open_devtools, fetch_image_as_base64, open_url_content_window, set_non_thinking_analysis_enabled, set_current_model_is_thinking, request_admin_elevation};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
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
            , request_admin_elevation
        ])
        .setup(|app| {
            let elevated_arg = std::env::args().any(|a| a == "--elevated");
            unsafe {
                use windows::core::w;
                use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
                use windows::Win32::System::Threading::CreateMutexW;
                use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, ShowWindow, SetForegroundWindow, SW_RESTORE};
                let _mutex = CreateMutexW(None, false, w!("Global\\ZError_SingleInstance"));
                let err = GetLastError();
                if err.0 == ERROR_ALREADY_EXISTS.0 && !elevated_arg {
                    let hwnd = FindWindowW(None, w!("ZError"));
                    if hwnd.0 != 0 {
                        let _ = ShowWindow(hwnd, SW_RESTORE);
                        let _ = SetForegroundWindow(hwnd);
                    }
                    std::process::exit(0);
                }
            }
            let username = crate::database::get_username().unwrap_or_else(|_| "Administrator".to_string());
            let base_dir = format!("C:\\Users\\{}\\AppData\\Local\\ZError", username);
            let db_path = format!("{}\\airesponses.db", base_dir);

            let mut need_elevation = false;
            if let Err(e) = std::fs::create_dir_all(&base_dir) {
                println!("⚠️ 创建数据目录失败: {}", e);
                need_elevation = true;
            } else {
                match crate::database::init_database_schema(&db_path) {
                    Ok(_) => {}
                    Err(e) => {
                        println!("⚠️ 初始化数据库失败: {}", e);
                        need_elevation = true;
                    }
                }
            }

            if need_elevation && !elevated_arg {
                match crate::commands::spawn_elevated_self() {
                    Ok(_) => {
                        std::process::exit(0);
                    }
                    Err(err) => {
                        println!("❌ 请求管理员权限失败: {}", err);
                    }
                }
            }

            let is_dev = cfg!(debug_assertions);
            let url = if is_dev {
                tauri::WebviewUrl::External("http://localhost:1420".parse().unwrap())
            } else {
                tauri::WebviewUrl::App("/".into())
            };
            let _main = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                url,
            )
            .title("ZError")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .center()
            .resizable(true)
            .decorations(false)
            .build();

            let show = tauri::menu::MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit = tauri::menu::MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = tauri::menu::MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            let tray_icon_image = app.default_window_icon().cloned();

            let mut tray_builder = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });

            if let Some(img) = tray_icon_image { tray_builder = tray_builder.icon(img); }

            let _tray = tray_builder.build(app)?;

            println!("✅ 应用启动完成，主窗口已创建，其他窗口按需创建");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
