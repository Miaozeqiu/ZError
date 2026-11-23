mod images;
pub use images::*;
mod documents;
pub use documents::*;
mod fonts;
pub use fonts::*;

use crate::window_size::{resolve_window_size, FILE_INFO_WINDOW_PRESET, URL_CONTENT_WINDOW_PRESET};
use tauri::{Manager, State};

use crate::database::{
    clear_persisted_request_logs as db_clear_request_logs,
    file_exists as db_file_exists,
    get_username as db_get_username,
    load_persisted_request_logs as db_load_request_logs,
};
use crate::logger::RequestLog;
use crate::types::ServerState;
use base64::{engine::general_purpose, Engine as _};
use calamine::{open_workbook_auto, DataType, Reader};
use jieba_rs::Jieba;
use quick_xml::events::Event;
use quick_xml::Reader as XmlReader;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::Write as _;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use urlencoding;
use zip::ZipArchive;

static JIEBA: OnceLock<Jieba> = OnceLock::new();

#[tauri::command]
pub fn app_update_target() -> Option<String> {
    tauri_plugin_updater::target()
}

/// macOS 原地更新只能替换 `.app` 包；`tauri:dev` 的 debug 二进制会误把 `target/debug` 整目录当目标。
#[tauri::command]
pub fn can_native_updater_install() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::env::current_exe()
            .ok()
            .map(|p| p.to_string_lossy().contains(".app/Contents/MacOS"))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// 清除 macOS 隔离属性。未公证的 adhoc 签名 App 带 quarantine 时，系统会误报「已损坏」。
/// 若 path 为 .dmg 且内容实际是 gzip（.app.tar.gz 误命名），则返回错误，避免打开时报「已损坏」。
#[tauri::command]
pub fn clear_macos_quarantine(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("path 为空".into());
    }

    if path.to_lowercase().ends_with(".dmg") {
        let mut file = File::open(&path).map_err(|e| format!("无法打开文件: {e}"))?;
        let mut magic = [0u8; 2];
        use std::io::Read;
        file.read_exact(&mut magic)
            .map_err(|e| format!("无法读取文件头: {e}"))?;
        if magic == [0x1f, 0x8b] {
            return Err(
                "下载到的不是 DMG（实际是 .tar.gz 更新包）。请使用应用内更新，或更换为真正的 .dmg 下载地址。"
                    .into(),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("xattr")
            .args(["-cr", &path])
            .status()
            .map_err(|e| format!("xattr 执行失败: {e}"))?;
        if !status.success() {
            return Err(format!("xattr 退出码: {:?}", status.code()));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[tauri::command]
pub fn segment_text(text: String) -> Vec<String> {
    let jieba = JIEBA.get_or_init(Jieba::new);
    // 使用搜索引擎模式分词，对应 python 的 jieba.cut_for_search
    let words = jieba.cut_for_search(&text, false);
    words.into_iter().map(|s| s.to_string()).collect()
}

#[cfg(target_os = "windows")]
static ELEVATION_FLAG: OnceLock<AtomicBool> = OnceLock::new();
#[cfg(target_os = "windows")]
fn elevation_requested() -> &'static AtomicBool {
    ELEVATION_FLAG.get_or_init(|| AtomicBool::new(false))
}

#[cfg(target_os = "windows")]
pub fn spawn_elevated_self() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let already = elevation_requested().swap(true, Ordering::SeqCst);
    if already {
        return Err("already_requested".to_string());
    }
    let status = runas::Command::new(exe)
        .arg("--elevated")
        .gui(true)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("elevation_failed".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}


#[tauri::command]
pub async fn open_url_content_window(
    app: tauri::AppHandle,
    questions: String,
    window_id: Option<String>,
) -> Result<String, String> {
    println!("🪟 创建URL内容处理窗口");

    // 使用传入的 windowId，或生成一个新的
    let window_id = window_id.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string()
    });

    // 先尝试关闭已存在的窗口
    if let Some(existing_window) = app.get_webview_window("url-content") {
        println!("🔄 发现已存在的窗口，尝试关闭");
        if let Err(e) = existing_window.close() {
            println!("⚠️ 关闭已存在窗口失败: {}", e);
        } else {
            println!("✅ 已关闭已存在的窗口");
            // 等待一小段时间确保窗口完全关闭
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    }

    // 检测是否为开发环境
    let is_dev = cfg!(debug_assertions);

    // 根据环境选择不同的URL策略
    let window_url = if is_dev {
        // 开发环境：使用localhost
        format!(
            "http://localhost:1420/#/url-content?windowId={}&questions={}",
            window_id,
            urlencoding::encode(&questions)
        )
    } else {
        // 生产环境：使用tauri://localhost
        format!(
            "tauri://localhost/#/url-content?windowId={}&questions={}",
            window_id,
            urlencoding::encode(&questions)
        )
    };

    println!("🌐 窗口URL: {}", window_url);
    let window_size = resolve_window_size(&app, URL_CONTENT_WINDOW_PRESET);

    // 创建新窗口
    let window_builder = tauri::WebviewWindowBuilder::new(
        &app,
        "url-content", // 修改为与启动时一致的标签
        if is_dev {
            tauri::WebviewUrl::External(window_url.parse().unwrap())
        } else {
            tauri::WebviewUrl::App(
                format!(
                    "/#/url-content?windowId={}&questions={}",
                    window_id,
                    urlencoding::encode(&questions)
                )
                .into(),
            )
        },
    )
    .title("URL内容处理")
    .inner_size(window_size.width, window_size.height)
    .min_inner_size(window_size.min_width, window_size.min_height)
    .center()
    .resizable(true)
    .decorations(false) // 隐藏Windows自带的标题栏
    .always_on_top(false);

    let window = window_builder.build();

    match window {
        Ok(_) => {
            println!("✅ URL内容处理窗口创建成功");
            Ok("窗口创建成功".to_string())
        }
        Err(e) => {
            let error_msg = format!("创建窗口失败: {}", e);
            println!("❌ {}", error_msg);
            Err(error_msg)
        }
    }
}

#[tauri::command]
pub async fn open_text_window(
    app: tauri::AppHandle,
    title: String,
    text: String,
) -> Result<String, String> {
    if let Some(existing) = app.get_webview_window("file-info") {
        let _ = existing.close();
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    let is_dev = cfg!(debug_assertions);
    let encoded_name = urlencoding::encode(&text);
    let window_url = if is_dev {
        format!("http://localhost:1420/#/file-info?name={}", encoded_name)
    } else {
        format!("tauri://localhost/#/file-info?name={}", encoded_name)
    };
    let window_size = resolve_window_size(&app, FILE_INFO_WINDOW_PRESET);

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "file-info",
        if is_dev {
            let external: url::Url = window_url.parse::<url::Url>().map_err(|e| e.to_string())?;
            tauri::WebviewUrl::External(external)
        } else {
            tauri::WebviewUrl::App(format!("/#/file-info?name={}", encoded_name).into())
        },
    )
    .title(title)
    .inner_size(window_size.width, window_size.height)
    .min_inner_size(window_size.min_width, window_size.min_height)
    .center()
    .resizable(true)
    .decorations(false)
    .always_on_top(false);

    match builder.build() {
        Ok(_) => Ok("ok".to_string()),
        Err(e) => Err(format!("创建窗口失败: {}", e)),
    }
}


#[tauri::command]
pub async fn get_request_logs(state: State<'_, ServerState>) -> Result<Vec<RequestLog>, String> {
    match db_load_request_logs(Some(state.logger.max_logs())) {
        Ok(logs) => Ok(logs),
        Err(error) => {
            println!("⚠️ 从SQLite读取请求日志失败，回退内存日志: {}", error);
            let mut logs = state.logger.get_logs();
            logs.reverse();
            if logs.is_empty() {
                Err(error)
            } else {
                Ok(logs)
            }
        }
    }
}

#[tauri::command]
pub async fn get_daily_request_counts() -> Result<Vec<(String, i64)>, String> {
    crate::database::get_daily_request_counts()
}


#[tauri::command]
pub async fn clear_request_logs(state: State<'_, ServerState>) -> Result<String, String> {
    db_clear_request_logs()?;
    state.logger.clear_logs();
    Ok("Request logs cleared successfully".to_string())
}

#[tauri::command]
pub async fn open_devtools(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(webview) = app.get_webview("main") {
        webview.open_devtools();
        Ok("开发者工具已打开".to_string())
    } else if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
        Ok("开发者工具已打开".to_string())
    } else {
        Err("无法找到主窗口".to_string())
    }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn request_admin_elevation(_app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        spawn_elevated_self()?;
        _app.exit(0);
        Ok("ok".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    Err("unsupported_platform".to_string())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn request_admin_elevation(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(crate::linux_elevation::relaunch)
        .await
        .map_err(|error| error.to_string())??;
    app.exit(0);
    Ok("ok".to_string())
}

/// 读取配置文件
#[tauri::command]
pub async fn read_config(webview: tauri::Webview) -> Result<String,String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let value=crate::secret_vault::secure_document_read(webview,"app_settings".into(),None).await?;
    Ok(if value.is_null() {String::new()} else {value.to_string()})
}

/// 写入配置文件
#[tauri::command]
pub async fn write_config(webview: tauri::Webview, content:String) -> Result<(),String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let data=if content.trim().is_empty() {serde_json::json!({})} else {serde_json::from_str(&content).map_err(|_|"配置格式错误")?};
    crate::secret_vault::secure_document_write(webview,"app_settings".into(),data).await.map(|_|())
}

/// 读取模型配置文件
#[tauri::command]
pub async fn read_model_config(webview: tauri::Webview) -> Result<String,String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let value=crate::secret_vault::secure_document_read(webview,"model_settings".into(),None).await?;
    Ok(if value.is_null() {String::new()} else {value.to_string()})
}

/// 写入模型配置文件
#[tauri::command]
pub async fn write_model_config(webview: tauri::Webview, content:String) -> Result<(),String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let data=if content.trim().is_empty() {serde_json::json!({})} else {serde_json::from_str(&content).map_err(|_|"配置格式错误")?};
    crate::secret_vault::secure_document_write(webview,"model_settings".into(),data).await.map(|_|())
}

/// 读取登录会话（用户数据目录 auth.json）
#[tauri::command]
pub async fn read_auth(webview: tauri::Webview) -> Result<String,String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let value=crate::secret_vault::secure_document_read(webview,"auth".into(),None).await?;
    Ok(if value.is_null() {String::new()} else {value.to_string()})
}

/// 写入登录会话
#[tauri::command]
pub async fn write_auth(webview: tauri::Webview, content:String) -> Result<(),String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let data=if content.trim().is_empty() {serde_json::json!({})} else {serde_json::from_str(&content).map_err(|_|"配置格式错误")?};
    crate::secret_vault::secure_document_write(webview,"auth".into(),data).await.map(|_|())
}


#[derive(Clone, serde::Serialize)]
pub struct SystemCjkFont {
    pub family: String,
    pub data: String,
}

static CJK_SYSTEM_FONT: OnceLock<SystemCjkFont> = OnceLock::new();
