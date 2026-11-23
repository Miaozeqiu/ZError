// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 模块声明
pub mod app_activity;
pub mod app_browser;
mod browser_theme;
#[cfg(any(windows, target_os = "macos"))]
mod browser_login;
pub mod browser_control;
pub mod browser_geometry;
#[cfg(target_os = "macos")]
pub mod cdp_client;
#[cfg(target_os = "macos")]
pub mod cef;
#[cfg(target_os = "macos")]
pub mod cef_runtime;
#[cfg(target_os = "macos")]
mod macos_wheel;
pub mod commands;
pub mod cli;
pub mod database;
pub mod logger;
#[cfg(target_os = "linux")]
mod linux_elevation;
#[cfg(target_os = "linux")]
mod linux_documents;
mod model_response;
pub mod server;
pub mod secret_vault;
pub mod secret_http;
pub mod secret_browser;
mod secret_access;
#[cfg(windows)]
mod webview2;
#[cfg(windows)]
mod webview2_secrets;
#[cfg(target_os = "macos")]
mod secret_keychain;
pub mod types;
pub mod window_size;
#[cfg(windows)]
mod windows_taskbar;

use crate::window_size::{resolve_window_size, MAIN_WINDOW_PRESET};
pub use commands::open_text_window;
pub use commands::{
    app_update_target, can_native_updater_install, clear_macos_quarantine, clear_request_logs,
    convert_doc_to_docx, create_directory,
    fetch_image_as_base64, file_exists, get_daily_request_counts, get_request_logs, get_username,
    greet, load_cjk_system_font, open_cache_dir, open_devtools, open_url_content_window, read_config, read_doc_range,
    reveal_in_file_manager,
    read_docx_range, read_excel_headers, read_excel_range, read_file_bytes, read_file_range,
    read_auth, read_file_text, read_model_config, request_admin_elevation, segment_text, stat_local_file,
    write_auth, write_config, write_model_config
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

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app
        .get_webview("main")
        .map(|webview| webview.window())
    else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let _ = window.show();
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = window.set_focus();
    }
    #[cfg(not(target_os = "macos"))]
    {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crate::app_activity::prefer_chinese_system_dialogs();
    #[cfg(target_os = "macos")]
    ensure_tmpdir_same_volume_as_exe();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            crate::cli::broker::cli_connect,
            crate::cli::broker::cli_take,
            crate::cli::broker::cli_request_active,
            crate::cli::broker::cli_complete,
            crate::cli::broker::cli_install,
            greet,
            load_cjk_system_font,
            app_update_target,
            can_native_updater_install,
            clear_macos_quarantine,
            create_directory,
            file_exists,
            get_username,
            start_server,
            stop_server,
            get_server_status,
            get_request_logs,
            crate::server::lookup_homework_bank_answers,
            get_daily_request_counts,
            clear_request_logs,
            open_devtools,
            fetch_image_as_base64,
            open_url_content_window,
            open_text_window,
            request_admin_elevation,
            read_file_text,
            read_file_bytes,
            stat_local_file,
            read_excel_headers,
            read_excel_range,
            read_docx_range,
            read_doc_range,
            read_file_range,
            convert_doc_to_docx,
            segment_text,
            secret_vault::secure_document_read,
            secret_vault::secure_site_account_names,
            secret_vault::secure_site_password_length,
            secret_vault::secure_remove_site_accounts,
            secret_vault::secure_api_key_length,
            secret_vault::secure_storage_authorize,
            secret_vault::secure_document_write,
            secret_vault::secure_register,
            secret_vault::secure_save_chat_login,
            secret_vault::secure_register_api,
            secret_vault::secure_bind_pending,
            secret_vault::secure_archive_legacy,
            secret_vault::secure_cleanup_legacy,
            secret_vault::secure_redact,
            secret_http::secure_http_request,
            secret_http::secure_http_cancel,
            secret_access::secure_secret_action,
            read_config,
            write_config,
            read_model_config,
            write_model_config,
            read_auth,
            write_auth,
            open_cache_dir,
            reveal_in_file_manager,
            search_questions_fuzzy,
            search_questions_page,
            get_folders,
            get_ai_responses,
            get_paginated_questions,
            get_questions_recursive,
            get_pending_correction_questions,
            get_pending_correction_question_count,
            get_folder_question_count,
            get_folder_path,
            get_folder_stats,
            get_question_metric_stats,
            get_questions_by_ids,
            add_practice_record,
            update_practice_note,
            get_practice_history,
            get_practice_summaries,
            get_recent_practice_marks,
            get_question_practice_stats,
            list_recent_wrong_questions,
            list_study_subjects,
            create_study_subject,
            rename_study_subject,
            delete_study_subject,
            get_study_graph,
            set_study_graph,
            patch_study_graph,
            apply_study_progress,
            list_study_activity,
            list_study_activity_between,
            list_study_heatmap,
            list_study_timeline_summaries,
            get_study_timeline_summary_cursor,
            list_unsummarized_study_activity,
            insert_study_timeline_summary,
            link_questions_to_node,
            unlink_question_knowledge,
            list_question_knowledge,
            list_node_questions,
            list_subject_questions,
            merge_study_subjects,
            split_study_subject,
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
            move_folder,
            crate::app_browser::browser_open,
            crate::app_browser::browser_set_bounds,
            crate::app_browser::browser_show,
            crate::app_browser::browser_hide,
            crate::app_browser::browser_hide_all,
            crate::app_browser::browser_close,
            crate::app_browser::browser_navigate,
            crate::app_browser::browser_reload,
            crate::browser_theme::browser_set_theme,
            crate::app_browser::browser_set_audio_muted,
            crate::app_browser::browser_go_back,
            crate::app_browser::browser_go_forward,
            crate::app_browser::browser_get_state,
            crate::app_browser::browser_set_zoom,
            crate::app_browser::browser_eval,
            crate::app_browser::browser_eval_main,
            crate::app_browser::browser_eval_frames,
            crate::app_browser::browser_set_app_above_page,
            crate::app_browser::browser_engine,
            crate::app_browser::browser_capabilities,
            crate::app_browser::browser_protocol,
            crate::browser_control::browser_control_register,
            crate::browser_control::browser_control_set,
            crate::app_browser::browser_screenshot,
            crate::app_browser::browser_cookies,
            crate::app_browser::browser_set_cookies,
            crate::app_browser::browser_clear_cookies,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            crate::cef_runtime::install_app_protocol();

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

            // CLI 使用独立且需要认证的环回接口，与题库 /query 服务分开。
            // 拖拽安装/AppImage 没有安装后钩子，首次启动及更新后自动修复用户命令。
            // 开发构建不接管用户正式安装的命令；需要时仍可在设置中手动修复。
            if !cfg!(debug_assertions) {
                tauri::async_runtime::spawn_blocking(|| {
                    if let Err(error) = crate::cli::client::install() {
                        eprintln!("CLI 自动配置未完成：{error}");
                    }
                });
            }
            if let Err(error) = tauri::async_runtime::block_on(async { crate::cli::start(app.handle()) }) {
                eprintln!("CLI 初始化失败：{error}");
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

            // 调试安装包同样内嵌前端资源；仅 tauri dev 使用开发地址
            // 及其对应的 IPC 来源白名单。
            let is_dev = cfg!(dev);
            let url = if is_dev {
                tauri::WebviewUrl::External("http://localhost:1420".parse().unwrap())
            } else {
                tauri::WebviewUrl::App("/".into())
            };
            let app_handle = app.handle().clone();
            let main_window_size = resolve_window_size(&app_handle, MAIN_WINDOW_PRESET);
            
            #[cfg(target_os = "macos")]
            let _main = tauri::WebviewWindowBuilder::new(app, "main", url)
                .initialization_script_for_all_frames(include_str!("campus_auth.js"))
                // Agent execution and video-event continuation live in this
                // webview. WK's default five-minute hidden-view suspension
                // must not freeze them when the user switches applications.
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
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
                let builder = tauri::WebviewWindowBuilder::new(app, "main", url)
                    .initialization_script_for_all_frames(include_str!("campus_auth.js"))
                    .title("ZError")
                    .inner_size(main_window_size.width, main_window_size.height)
                    .min_inner_size(main_window_size.min_width, main_window_size.min_height)
                    .center()
                    .resizable(true)
                    .decorations(false);
                #[cfg(not(windows))]
                let builder = builder.icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/128x128@2x.png"
                ))?)?;
                #[cfg(windows)]
                let builder = builder.visible(false);
                let built = builder.build();
                #[cfg(windows)]
                if let Ok(ref window) = built {
                    // Let the shell discover the window after the native icons are set.
                    crate::windows_taskbar::install(window);
                    window.show()?;
                }
                built
            };

            #[cfg(target_os = "macos")]
            if let Ok(ref window) = _main {
                if let Err(error) = crate::macos_wheel::install(window) {
                    eprintln!("Failed to install app-local wheel smoothing: {error}");
                }
            }

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

            #[cfg(target_os = "linux")]
            crate::linux_elevation::notify_ready(_main.is_ok())?;

            println!("✅ 应用启动完成，主窗口已创建，其他窗口按需创建");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
