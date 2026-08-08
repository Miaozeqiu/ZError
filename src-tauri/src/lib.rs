// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 模块声明
pub mod app_activity;
pub mod commands;
pub mod database;
pub mod logger;
pub mod server;
pub mod types;
pub mod window_size;

use crate::window_size::{resolve_window_size, MAIN_WINDOW_PRESET};
pub use commands::open_text_window;
pub use commands::{
    can_native_updater_install, clear_request_logs, convert_doc_to_docx, create_directory,
    fetch_image_as_base64, file_exists, get_daily_request_counts, get_request_logs, get_username,
    greet, open_cache_dir, open_devtools, open_url_content_window, read_config, read_doc_range,
    read_docx_range, read_excel_headers, read_excel_range, read_file_bytes, read_file_range,
    read_file_text, read_model_config, request_admin_elevation, segment_text, write_config,
    write_model_config
};
pub use database::*;
pub use database::{
    clear_folder_questions, delete_folder, delete_question, delete_questions, move_folder,
    rename_folder,
};
pub use server::{get_server_status, start_server, stop_server};
use tauri::Manager;
pub use types::*;

/// macOS updater 用 rename 替换 .app；若 TMPDIR 与可执行文件不在同一卷会报 Cross-device link (os error 18)。
/// 开发时工程在 /Volumes/外置盘、系统 TMPDIR 在内置盘时尤其常见。
#[cfg(target_os = "macos")]
fn ensure_tmpdir_same_volume_as_exe() {
    use std::os::unix::fs::MetadataExt;
    use std::path::PathBuf;

    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Ok(exe_meta) = std::fs::metadata(&exe) else {
        return;
    };
    let exe_dev = exe_meta.dev();

    let current_tmp = std::env::temp_dir();
    if let Ok(tmp_meta) = std::fs::metadata(&current_tmp) {
        if tmp_meta.dev() == exe_dev {
            return;
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = exe.parent() {
        candidates.push(dir.join(".zerror-updater-tmp"));
    }

    // .../Xxx.app/Contents/MacOS/zerror → 优先放在 .app 同级目录
    let mut p = exe.clone();
    for _ in 0..4 {
        if p.extension().and_then(|e| e.to_str()) == Some("app") {
            if let Some(parent) = p.parent() {
                candidates.push(parent.join(".zerror-updater-tmp"));
            }
            break;
        }
        match p.parent() {
            Some(parent) if parent != p => p = parent.to_path_buf(),
            _ => break,
        }
    }

    // 外置卷：/Volumes/Name/... → /Volumes/Name/tmp/ZError-updater
    let components: Vec<_> = exe.components().collect();
    if components.len() >= 3 {
        use std::path::Component;
        if matches!(components[0], Component::RootDir)
            && matches!(components[1], Component::Normal(v) if v == "Volumes")
        {
            if let Component::Normal(vol) = components[2] {
                let mut root = PathBuf::from("/");
                root.push("Volumes");
                root.push(vol);
                candidates.push(root.join("tmp").join("ZError-updater"));
            }
        }
    }

    for candidate in candidates {
        if std::fs::create_dir_all(&candidate).is_err() {
            continue;
        }
        if let Ok(meta) = std::fs::metadata(&candidate) {
            if meta.dev() == exe_dev {
                std::env::set_var("TMPDIR", &candidate);
                eprintln!(
                    "[zerror] TMPDIR aligned for updater: {} (was on another volume)",
                    candidate.display()
                );
                return;
            }
        }
    }

    eprintln!(
        "[zerror] warning: could not align TMPDIR with executable volume ({}); updater may fail with Cross-device link",
        exe.display()
    );
}

/// Windows 任务栏用 ICON_BIG；Tauri 默认只设 ICON_SMALL，且 codegen 只取 ico 第一帧。
/// 这里从多尺寸 icon.ico 按 DPI 取出小/大图标分别设置，避免任务栏发糊。
/// 使用 user32 直调，避开项目里 windows 0.56 与 Tauri 自带 0.61 的 HWND 类型冲突。
#[cfg(windows)]
fn apply_windows_taskbar_icons(window: &tauri::WebviewWindow) {
    const WM_SETICON: u32 = 0x0080;
    const ICON_SMALL: usize = 0;
    const ICON_BIG: usize = 1;
    const LR_DEFAULTCOLOR: u32 = 0;

    #[link(name = "user32")]
    extern "system" {
        fn SendMessageW(
            hwnd: *mut core::ffi::c_void,
            msg: u32,
            wparam: usize,
            lparam: isize,
        ) -> isize;
        fn LookupIconIdFromDirectoryEx(
            presbits: *const u8,
            ficon: i32,
            cxdesired: i32,
            cydesired: i32,
            flags: u32,
        ) -> i32;
        fn CreateIconFromResourceEx(
            presbits: *const u8,
            dwressize: u32,
            ficon: i32,
            dwver: u32,
            cxdesired: i32,
            cydesired: i32,
            flags: u32,
        ) -> *mut core::ffi::c_void;
    }

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0;
    let ico: &[u8] = include_bytes!("../icons/icon.ico");

    // 任务栏直接用 128/256，不要用 16/32（本身就糊，放大更糊）
    unsafe fn load_hicon(ico: &[u8], cx: i32, cy: i32) -> Option<*mut core::ffi::c_void> {
        let offset = LookupIconIdFromDirectoryEx(ico.as_ptr(), 1, cx, cy, LR_DEFAULTCOLOR);
        if offset <= 0 || (offset as usize) >= ico.len() {
            return None;
        }
        let bits = &ico[offset as usize..];
        // cx/cy=0：按资源原始尺寸创建，避免再被压成 32
        let hicon = CreateIconFromResourceEx(
            bits.as_ptr(),
            bits.len() as u32,
            1,
            0x0003_0000,
            0,
            0,
            LR_DEFAULTCOLOR,
        );
        if hicon.is_null() {
            None
        } else {
            Some(hicon)
        }
    }

    unsafe {
        if let Some(hicon) = load_hicon(ico, 128, 128) {
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, hicon as isize);
        }
        if let Some(hicon) = load_hicon(ico, 256, 256) {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, hicon as isize);
        }
    }
}

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    #[cfg(target_os = "macos")]
    {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
            let _ = window.set_focus();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("main") {
            if window.is_minimized().unwrap_or(false) {
                let _ = window.unminimize();
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    ensure_tmpdir_same_volume_as_exe();

    let mut builder = tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    // 直接关闭，不隐藏到系统托盘
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        // tauri-plugin-sql removed - using rusqlite directly
        // .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // updater / process 必须挂在 Builder 上（不要放进 setup），否则前端会报 plugin updater not found
    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            greet,
            can_native_updater_install,
            create_directory,
            file_exists,
            get_username,
            start_server,
            stop_server,
            get_server_status,
            get_request_logs,
            get_daily_request_counts,
            clear_request_logs,
            open_devtools,
            fetch_image_as_base64,
            open_url_content_window,
            open_text_window,
            request_admin_elevation,
            read_file_text,
            read_file_bytes,
            read_excel_headers,
            read_excel_range,
            read_docx_range,
            read_doc_range,
            read_file_range,
            convert_doc_to_docx,
            segment_text,
            read_config,
            write_config,
            read_model_config,
            write_model_config,
            open_cache_dir,
            search_questions_fuzzy,
            get_folders,
            get_ai_responses,
            get_paginated_questions,
            get_questions_recursive,
            get_pending_correction_questions,
            get_pending_correction_question_count,
            get_folder_question_count,
            get_folder_path,
            get_folder_stats,
            add_question,
            set_question_pending_correction,
            update_question,
            move_question,
            copy_question,
            add_folder,
            delete_question,
            delete_questions,
            clear_folder_questions,
            delete_folder,
            rename_folder,
            move_folder
        ])
        .setup(|app| {
            // 初始化 ServerState 并注入 app_handle
            let mut state = ServerState::default();
            state.app_handle = Some(app.handle().clone());
            app.manage(state);

            // Windows-specific single instance check and elevation logic
            #[cfg(target_os = "windows")]
            {
                let elevated_arg = std::env::args().any(|a| a == "--elevated");
                unsafe {
                    use windows::core::w;
                    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
                    use windows::Win32::System::Threading::CreateMutexW;
                    use windows::Win32::UI::WindowsAndMessaging::{
                        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
                    };
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
                let username =
                    crate::database::get_username().unwrap_or_else(|_| "Administrator".to_string());
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
            }

            // Linux/macOS database initialization
            #[cfg(not(target_os = "windows"))]
            {
                let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
                let base_dir = format!("{}/.local/share/zerror", home_dir);
                let db_path = format!("{}/airesponses.db", base_dir);

                if let Err(e) = std::fs::create_dir_all(&base_dir) {
                    println!("⚠️ 创建数据目录失败: {}", e);
                } else {
                    if let Err(e) = crate::database::init_database_schema(&db_path) {
                        println!("⚠️ 初始化数据库失败: {}", e);
                    }
                }
            }

            let is_dev = cfg!(debug_assertions);
            let url = if is_dev {
                tauri::WebviewUrl::External("http://localhost:1420".parse().unwrap())
            } else {
                tauri::WebviewUrl::App("/".into())
            };
            let app_handle = app.handle().clone();
            let main_window_size = resolve_window_size(&app_handle, MAIN_WINDOW_PRESET);
            
            #[cfg(target_os = "macos")]
            let _main = tauri::WebviewWindowBuilder::new(app, "main", url)
                .title("")  // macOS 不显示原生标题文字，避免系统/软件主题不一致时标题看不清
                .inner_size(main_window_size.width, main_window_size.height)
                .min_inner_size(main_window_size.min_width, main_window_size.min_height)
                .center()
                .resizable(true)
                .decorations(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .build();
                
            #[cfg(not(target_os = "macos"))]
            let _main = {
                // 显式用 256 PNG，避免 codegen 误用 ico 里过小的第一帧导致任务栏发糊
                let window_icon =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
                        .expect("window icon png");
                let built = tauri::WebviewWindowBuilder::new(app, "main", url)
                    .title("ZError")
                    .inner_size(main_window_size.width, main_window_size.height)
                    .min_inner_size(main_window_size.min_width, main_window_size.min_height)
                    .center()
                    .resizable(true)
                    .decorations(false)
                    .icon(window_icon)?
                    .build();
                #[cfg(windows)]
                if let Ok(ref win) = built {
                    apply_windows_taskbar_icons(win);
                }
                built
            };

            let show = tauri::menu::MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit = tauri::menu::MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = tauri::menu::MenuBuilder::new(app)
                .items(&[&show, &quit])
                .build()?;

            let mut tray_builder = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    }
                    | tauri::tray::TrayIconEvent::DoubleClick {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } => {
                        show_main_window(tray.app_handle());
                    }
                    _ => {}
                });

            // macOS 菜单栏用 Template 图（黑底镂空字），系统会按菜单栏着色为白/黑
            #[cfg(target_os = "macos")]
            {
                match tauri::image::Image::from_bytes(include_bytes!("../icons/trayTemplate.png")) {
                    Ok(img) => {
                        tray_builder = tray_builder.icon(img).icon_as_template(true);
                    }
                    Err(err) => {
                        eprintln!("⚠️ 托盘 Template 图标加载失败，回退默认图标: {err}");
                        if let Some(img) = app.default_window_icon().cloned() {
                            tray_builder = tray_builder.icon(img);
                        }
                    }
                }
            }
            // Windows / Linux：按 DPI 选用已烘焙好的像素尺寸 PNG，避免 256 硬缩发糊
            #[cfg(not(target_os = "macos"))]
            {
                let scale = app
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .map(|m| m.scale_factor())
                    .unwrap_or(1.0);
                // Win11 托盘用预烘焙像素图；默认 32，高 DPI 升到 48/64，避免 256 硬缩发糊
                let tray_bytes: &'static [u8] = if scale >= 2.5 {
                    include_bytes!("../icons/tray-win-64.png")
                } else if scale >= 1.75 {
                    include_bytes!("../icons/tray-win-48.png")
                } else {
                    include_bytes!("../icons/tray-win-32.png")
                };
                match tauri::image::Image::from_bytes(tray_bytes) {
                    Ok(img) => {
                        tray_builder = tray_builder.icon(img);
                    }
                    Err(err) => {
                        eprintln!("⚠️ 托盘 png 加载失败，回退 32px: {err}");
                        match tauri::image::Image::from_bytes(include_bytes!(
                            "../icons/tray-win-32.png"
                        )) {
                            Ok(img) => {
                                tray_builder = tray_builder.icon(img);
                            }
                            Err(err2) => {
                                eprintln!("⚠️ 托盘图标加载失败，回退默认图标: {err2}");
                                if let Some(img) = app.default_window_icon().cloned() {
                                    tray_builder = tray_builder.icon(img);
                                }
                            }
                        }
                    }
                }
            }

            let _tray = tray_builder.build(app)?;

            println!("✅ 应用启动完成，主窗口已创建，其他窗口按需创建");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
