use tauri::{State, Manager};
use crate::types::ServerState;
use crate::logger::RequestLog;
use crate::database::{get_username as db_get_username, file_exists as db_file_exists};
use std::fs;
use base64::{Engine as _, engine::general_purpose};
use urlencoding;
use std::path::PathBuf;
use std::sync::{OnceLock, atomic::{AtomicBool, Ordering}};
use calamine::{open_workbook_auto, Reader, DataType};
use std::fs::File;
use zip::ZipArchive;
use quick_xml::Reader as XmlReader;
use quick_xml::events::Event;
use std::process::Command;
use std::io::Write as _;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

static ELEVATION_FLAG: OnceLock<AtomicBool> = OnceLock::new();
fn elevation_requested() -> &'static AtomicBool { ELEVATION_FLAG.get_or_init(|| AtomicBool::new(false)) }

pub fn spawn_elevated_self() -> Result<(), String> {
    let exe: PathBuf = std::env::current_exe().map_err(|e| format!("{}", e))?;
    #[cfg(target_os = "windows")]
    {
        let already = elevation_requested().swap(true, Ordering::SeqCst);
        if already { return Err("already_requested".to_string()); }
        let status = runas::Command::new(exe)
            .arg("--elevated")
            .gui(true)
            .status()
            .map_err(|e| format!("{}", e))?;
        if !status.success() {
            return Err("elevation_failed".to_string());
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("unsupported_platform".to_string())
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 设置非思考模型分析开关（影响提示词）
#[tauri::command]
pub fn set_non_thinking_analysis_enabled(state: State<'_, ServerState>, enabled: bool) -> Result<String, String> {
    {
        let mut flag = state.analysis_enabled.lock();
        *flag = enabled;
    }
    Ok(if enabled { "enabled".to_string() } else { "disabled".to_string() })
}

/// 设置当前选中的模型是否为思考模型
/// 由前端根据模型的 jsCode 是否包含 reasoning_content 来判断
#[tauri::command]
pub fn set_current_model_is_thinking(state: State<'_, ServerState>, is_thinking: bool) -> Result<String, String> {
    {
        let mut flag = state.is_thinking_model.lock();
        *flag = is_thinking;
    }
    Ok(if is_thinking { "thinking".to_string() } else { "non-thinking".to_string() })
}

#[tauri::command]
pub async fn fetch_image_as_base64(url: String) -> Result<String, String> {
    println!("🖼️ 开始获取图片: {}", url);
    
    // 尝试多种请求策略
    let strategies = vec![
        ("完整浏览器伪装", create_full_browser_request(&url)?),
        ("简化请求头", create_simple_request(&url)?),
        ("移动端伪装", create_mobile_request(&url)?),
    ];
    
    for (strategy_name, request) in strategies {
        println!("🔄 尝试策略: {}", strategy_name);
        
        match request.send().await {
            Ok(response) => {
                println!("📊 响应状态: {}", response.status());
                
                if response.status().is_success() {
                    match response.bytes().await {
                        Ok(bytes) => {
                            // 转换为base64
                            let base64_string = general_purpose::STANDARD.encode(&bytes);
                            
                            // 检测图片类型
                            let content_type = detect_image_type(&bytes);
                            let data_url = format!("data:{};base64,{}", content_type, base64_string);
                            
                            println!("✅ 图片获取成功 ({}), 大小: {} bytes", strategy_name, bytes.len());
                            return Ok(data_url);
                        }
                        Err(e) => {
                            println!("❌ 读取图片数据失败 ({}): {}", strategy_name, e);
                            continue;
                        }
                    }
                } else {
                    println!("❌ HTTP请求失败 ({}): {} {}", 
                        strategy_name, 
                        response.status(), 
                        response.status().canonical_reason().unwrap_or("Unknown")
                    );
                    continue;
                }
            }
            Err(e) => {
                println!("❌ 网络请求失败 ({}): {}", strategy_name, e);
                continue;
            }
        }
    }
    
    Err("所有请求策略都失败了".to_string())
}

// 创建完整浏览器伪装请求
fn create_full_browser_request(url: &str) -> Result<reqwest::RequestBuilder, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
    
    let parsed_url = url::Url::parse(url).map_err(|e| format!("URL解析失败: {}", e))?;
    let domain = parsed_url.host_str().unwrap_or("www.google.com");
    let referer = if domain.contains("chaoxing.com") {
        "https://mooc1-1.chaoxing.com/"
    } else if domain.contains("zhihuishu.com") {
        "https://www.zhihuishu.com/"
    } else {
        "https://www.google.com/"
    };
    
    Ok(client
        .get(url)
        .header("Accept", "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6")
        .header("Accept-Encoding", "gzip, deflate, br")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header("Sec-Ch-Ua", "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"")
        .header("Sec-Ch-Ua-Mobile", "?0")
        .header("Sec-Ch-Ua-Platform", "\"Windows\"")
        .header("Sec-Fetch-Dest", "image")
        .header("Sec-Fetch-Mode", "no-cors")
        .header("Sec-Fetch-Site", "cross-site")
        .header("Upgrade-Insecure-Requests", "1")
        .header("DNT", "1")
        .header("Connection", "keep-alive")
        .header("Referer", referer)
        .timeout(std::time::Duration::from_secs(30)))
}

// 创建简化请求
fn create_simple_request(url: &str) -> Result<reqwest::RequestBuilder, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
    
    Ok(client
        .get(url)
        .header("Accept", "image/*,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .timeout(std::time::Duration::from_secs(30)))
}

// 创建移动端伪装请求
fn create_mobile_request(url: &str) -> Result<reqwest::RequestBuilder, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;
    
    Ok(client
        .get(url)
        .header("Accept", "image/webp,image/apng,image/*,*/*;q=0.8")
        .header("Accept-Language", "zh-CN,zh-Hans;q=0.9")
        .header("Accept-Encoding", "gzip, deflate, br")
        .timeout(std::time::Duration::from_secs(30)))
}

// 检测图片类型
fn detect_image_type(bytes: &[u8]) -> &'static str {
    if bytes.len() < 4 {
        return "image/png"; // 默认类型
    }
    
    // PNG: 89 50 4E 47
    if bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47 {
        return "image/png";
    }
    
    // JPEG: FF D8 FF
    if bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return "image/jpeg";
    }
    
    // GIF: 47 49 46 38
    if bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x38 {
        return "image/gif";
    }
    
    // WebP: 52 49 46 46 (RIFF) + WebP signature
    if bytes.len() >= 12 && 
       bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46 &&
       bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50 {
        return "image/webp";
    }
    
    // BMP: 42 4D
    if bytes[0] == 0x42 && bytes[1] == 0x4D {
        return "image/bmp";
    }
    
    // 默认返回PNG
    "image/png"
}

#[tauri::command]
pub async fn open_url_content_window(
    app: tauri::AppHandle,
    questions: String, // 改为支持多个题目的JSON字符串
) -> Result<String, String> {
    println!("🪟 创建URL内容处理窗口");
    
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
            "http://localhost:1420/#/url-content?questions={}",
            urlencoding::encode(&questions)
        )
    } else {
        // 生产环境：使用tauri://localhost
        format!(
            "tauri://localhost/#/url-content?questions={}",
            urlencoding::encode(&questions)
        )
    };
    
    println!("🌐 窗口URL: {}", window_url);
    
    // 创建新窗口
    let window_builder = tauri::WebviewWindowBuilder::new(
        &app,
        "url-content", // 修改为与启动时一致的标签
        if is_dev {
            tauri::WebviewUrl::External(window_url.parse().unwrap())
        } else {
            tauri::WebviewUrl::App(format!("/#/url-content?questions={}", urlencoding::encode(&questions)).into())
        }
    )
    .title("URL内容处理")
    .inner_size(1200.0, 800.0) // 增加窗口宽度以容纳侧边栏
    .min_inner_size(1000.0, 600.0)
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
pub async fn open_text_window(app: tauri::AppHandle, title: String, text: String) -> Result<String, String> {
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

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "file-info",
        if is_dev {
            let external: url::Url = window_url.parse::<url::Url>().map_err(|e| e.to_string())?;
            tauri::WebviewUrl::External(external)
        } else {
            tauri::WebviewUrl::App(format!("/#/file-info?name={}", encoded_name).into())
        }
    )
    .title(title)
    .inner_size(1280.0, 900.0)
    .min_inner_size(960.0, 600.0)
    .center()
    .resizable(true)
    .decorations(false)
    .always_on_top(false);

    match builder.build() {
        Ok(_) => Ok("ok".to_string()),
        Err(e) => Err(format!("创建窗口失败: {}", e)),
    }
}

/// 读取文本文件内容（用于算法运行时提供原始文本输入）
#[tauri::command]
pub async fn read_file_text(path: String) -> Result<String, String> {
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) => Err(format!("读取文件失败: {}", e))
    }
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<String, String> {
    match fs::read(&path) {
        Ok(bytes) => Ok(general_purpose::STANDARD.encode(&bytes)),
        Err(e) => Err(format!("读取二进制失败: {}", e))
    }
}

#[tauri::command]
pub async fn read_excel_headers(path: String) -> Result<Vec<String>, String> {
    let mut workbook = open_workbook_auto(&path).map_err(|e| format!("打开Excel失败: {}", e))?;
    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() {
        return Err("Excel文件没有工作表".to_string());
    }
    let range = workbook
        .worksheet_range(&sheet_names[0])
        .ok_or_else(|| "读取工作表失败".to_string())
        .and_then(|r| r.map_err(|e| format!("读取工作表失败: {}", e)))?;
    let mut headers: Vec<String> = Vec::new();
    for row in range.rows() {
        let mut any_non_empty = false;
        let mut row_vals: Vec<String> = Vec::new();
        for cell in row {
            let s = match cell {
                DataType::Empty => String::new(),
                DataType::String(s) => s.clone(),
                DataType::Float(n) => {
                    let mut s = format!("{}", n);
                    if s.ends_with(".0") { s = s.trim_end_matches(".0").to_string(); }
                    s
                }
                DataType::Int(i) => i.to_string(),
                DataType::Bool(b) => if *b { "TRUE".to_string() } else { "FALSE".to_string() },
                DataType::Error(_) => String::new(),
                _ => format!("{:?}", cell),
            };
            if !s.trim().is_empty() { any_non_empty = true; }
            row_vals.push(s);
        }
        if any_non_empty {
            headers = row_vals;
            break;
        }
    }
    if headers.is_empty() {
        return Err("未找到非空表头行".to_string());
    }
    Ok(headers)
}


#[tauri::command]
pub async fn read_excel_range(path: String, start: i32, end: i32) -> Result<Vec<Vec<String>>, String> {
    let mut workbook = open_workbook_auto(&path).map_err(|e| format!("打开Excel失败: {}", e))?;
    let sheet_names = workbook.sheet_names().to_owned();
    if sheet_names.is_empty() { return Err("Excel文件没有工作表".to_string()); }
    let range = workbook
        .worksheet_range(&sheet_names[0])
        .ok_or_else(|| "读取工作表失败".to_string())
        .and_then(|r| r.map_err(|e| format!("读取工作表失败: {}", e)))?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        let mut vals: Vec<String> = Vec::new();
        for cell in row {
            let s = match cell {
                DataType::Empty => String::new(),
                DataType::String(s) => s.clone(),
                DataType::Float(n) => {
                    let mut s = format!("{}", n);
                    if s.ends_with(".0") { s = s.trim_end_matches(".0").to_string(); }
                    s
                }
                DataType::Int(i) => i.to_string(),
                DataType::Bool(b) => if *b { "TRUE".to_string() } else { "FALSE".to_string() },
                DataType::Error(_) => String::new(),
                _ => format!("{:?}", cell),
            };
            vals.push(s);
        }
        rows.push(vals);
    }
    if rows.is_empty() { return Ok(vec![]); }
    let total = rows.len() as i32;
    let s = start.max(0).min(total - 1);
    let e = end.max(s).min(total - 1);
    Ok(rows[(s as usize)..=(e as usize)].to_vec())
}

fn read_docx_paragraphs(path: &str) -> Result<Vec<String>, String> {
    let f = File::open(path).map_err(|e| format!("打开docx失败: {}", e))?;
    let mut zip = ZipArchive::new(f).map_err(|e| format!("读取docx压缩失败: {}", e))?;
    let mut file = zip.by_name("word/document.xml").map_err(|e| format!("docx缺少document.xml: {}", e))?;
    let mut xml = String::new();
    use std::io::Read as _;
    file.read_to_string(&mut xml).map_err(|e| format!("读取document.xml失败: {}", e))?;
    let mut reader = XmlReader::from_str(&xml);
    reader.trim_text(true);
    let mut buf = Vec::new();
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_p = false;
    let mut in_text = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_vec();
                if name.ends_with(b"p") { in_p = true; current.clear(); }
                if name.ends_with(b"t") { in_text = true; }
            }
            Ok(Event::Text(t)) => {
                if in_text { current.push_str(&t.unescape().unwrap_or_default().to_string()); }
            }
            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_vec();
                if name.ends_with(b"t") { in_text = false; }
                if name.ends_with(b"p") { in_p = false; paragraphs.push(current.clone()); current.clear(); }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("解析docx失败: {}", e)),
            _ => {}
        }
        buf.clear();
    }
    Ok(paragraphs)
}

#[tauri::command]
pub async fn read_docx_range(path: String, start: i32, end: i32) -> Result<Vec<String>, String> {
    let pars = read_docx_paragraphs(&path)?;
    if pars.is_empty() { return Ok(vec![]); }
    let total = pars.len() as i32;
    let s = start.max(0).min(total - 1);
    let e = end.max(s).min(total - 1);
    Ok(pars[(s as usize)..=(e as usize)].to_vec())
}

fn read_doc_paragraphs(path: &str) -> Result<Vec<String>, String> {
    let data = fs::read(path).map_err(|e| format!("读取doc失败: {}", e))?;
    let mut paras: Vec<String> = Vec::new();
    let sample_len = data.len().min(512);
    let sample = String::from_utf8_lossy(&data[..sample_len]).to_string();
    let is_rtf = sample.trim_start().starts_with("{\\rtf");
    if is_rtf {
        let full = String::from_utf8_lossy(&data).to_string();
        fn rtf_to_text(src: &str) -> String {
            let bytes = src.as_bytes();
            let mut out = String::new();
            let mut i = 0usize;
            while i < bytes.len() {
                let c = bytes[i] as char;
                if c == '{' || c == '}' { i += 1; continue; }
                if c == '\\' {
                    i += 1;
                    if i >= bytes.len() { break; }
                    let c2 = bytes[i] as char;
                    if c2 == '\'' {
                        if i + 2 < bytes.len() {
                            let h1 = bytes[i + 1] as char;
                            let h2 = bytes[i + 2] as char;
                            let mut v: u8 = 0;
                            fn hex(c: char) -> u8 { match c { '0'..='9' => (c as u8 - b'0'), 'a'..='f' => (c as u8 - b'a' + 10), 'A'..='F' => (c as u8 - b'A' + 10), _ => 0 } }
                            v = (hex(h1) << 4) | hex(h2);
                            out.push(v as char);
                            i += 3;
                            continue;
                        } else { i += 1; continue; }
                    } else if c2 == 'u' {
                        i += 1;
                        let mut sign = 1i32;
                        if i < bytes.len() && bytes[i] as char == '-' { sign = -1; i += 1; }
                        let mut n: i32 = 0;
                        while i < bytes.len() {
                            let ch = bytes[i] as char;
                            if ch.is_ascii_digit() { n = n * 10 + (ch as i32 - '0' as i32); i += 1; } else { break; }
                        }
                        let code = (n * sign) as u32;
                        if let Some(ch) = std::char::from_u32(code) { out.push(ch); }
                        if i < bytes.len() && (bytes[i] as char) == '?' { i += 1; }
                        continue;
                    } else {
                        let mut j = i;
                        while j < bytes.len() {
                            let ch = bytes[j] as char;
                            if ch.is_ascii_alphabetic() { j += 1; continue; }
                            if ch.is_ascii_digit() { j += 1; continue; }
                            break;
                        }
                        let word = &src[i..j];
                        if word == "par" || word == "line" { out.push('\n'); }
                        i = j;
                        if i < bytes.len() && (bytes[i] as char).is_ascii_whitespace() { i += 1; }
                        continue;
                    }
                }
                out.push(c);
                i += 1;
            }
            out
        }
        let text = rtf_to_text(&full);
        paras = text
            .split('\n')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>();
    } else {
        if data.len() >= 2 {
            let mut u16s: Vec<u16> = Vec::with_capacity(data.len() / 2);
            let mut i = 0usize;
            while i + 1 < data.len() {
                let val = u16::from_le_bytes([data[i], data[i + 1]]);
                u16s.push(val);
                i += 2;
            }
            let s = String::from_utf16_lossy(&u16s);
            let normalized = s.replace('\u{0000}', "").replace('\r', "\n");
            paras = normalized
                .split('\n')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>();
        }
        if paras.is_empty() {
            let mut buf = String::new();
            for &b in &data {
                if b == b'\n' || b == b'\r' { buf.push('\n'); } else if b == 0 { continue; } else if (32..=126).contains(&b) { buf.push(b as char); } else { buf.push(' '); }
            }
            paras = buf
                .split('\n')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>();
        }
    }
    Ok(paras)
}

#[tauri::command]
pub async fn read_doc_range(path: String, start: i32, end: i32) -> Result<Vec<String>, String> {
    let pars = read_doc_paragraphs(&path)?;
    if pars.is_empty() { return Ok(vec![]); }
    let total = pars.len() as i32;
    let s = start.max(0).min(total - 1);
    let e = end.max(s).min(total - 1);
    Ok(pars[(s as usize)..=(e as usize)].to_vec())
}

#[tauri::command]
pub async fn read_file_range(path: String, start: i32, end: i32) -> Result<serde_json::Value, String> {
    let lower = path.to_lowercase();
    if lower.ends_with(".xlsx") || lower.ends_with(".xls") {
        let rows = read_excel_range(path, start, end).await?;
        Ok(serde_json::json!({"type":"excel","rows": rows}))
    } else if lower.ends_with(".docx") {
        let pars = read_docx_range(path, start, end).await?;
        Ok(serde_json::json!({"type":"docx","paragraphs": pars}))
    } else if lower.ends_with(".doc") {
        let pars = read_doc_range(path, start, end).await?;
        Ok(serde_json::json!({"type":"doc","paragraphs": pars}))
    } else {
        Err("暂不支持该文件类型".to_string())
    }
}

#[tauri::command]
pub async fn convert_doc_to_docx(path: String) -> Result<String, String> {
    let lower = path.to_lowercase();
    if !lower.ends_with(".doc") || lower.ends_with(".docx") {
        return Err("invalid_input".to_string());
    }
    let src = std::path::PathBuf::from(&path);
    if !src.exists() {
        return Err("not_found".to_string());
    }
    let data = std::fs::read(&src).map_err(|e| format!("{}", e))?;
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let hash_hex = format!("{:016x}", hasher.finish());
    let parent = src.parent().unwrap_or_else(|| std::path::Path::new("."));
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("converted");
    let dst = parent.join(format!("{}+{}.docx", hash_hex, stem));
    if dst.exists() {
        return Ok(dst.to_string_lossy().to_string());
    }
    let script = r#"import sys
from win32com.client import Dispatch
import os

def convert(src, dst):
    word = Dispatch('Word.Application')
    word.Visible = False
    try:
        if os.path.exists(dst):
            try:
                os.remove(dst)
            except Exception:
                pass
        doc = word.Documents.Open(src)
        doc.SaveAs(dst, FileFormat=16)
        doc.Close(False)
    finally:
        try:
            word.Quit()
        except Exception:
            pass

if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(2)
    convert(sys.argv[1], sys.argv[2])
"#;
    let mut tmp = std::env::temp_dir();
    tmp.push("zerror_doc_to_docx.py");
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("{}", e))?;
        f.write_all(script.as_bytes()).map_err(|e| format!("{}", e))?;
    }

    let interpreters = ["py", "python", "python3"];
    let mut last_err: Option<String> = None;
    for bin in interpreters.iter() {
        let mut cmd = if *bin == "py" { Command::new("py") } else { Command::new(bin) };
        let args = if *bin == "py" { vec![tmp.to_string_lossy().to_string(), path.clone(), dst.to_string_lossy().to_string()] } else { vec![tmp.to_string_lossy().to_string(), path.clone(), dst.to_string_lossy().to_string()] };
        let out = cmd.args(args).output();
        match out {
            Ok(o) => {
                if o.status.success() {
                    if dst.exists() {
                        let _ = std::fs::remove_file(&tmp);
                        return Ok(dst.to_string_lossy().to_string());
                    } else {
                        last_err = Some(String::from_utf8_lossy(&o.stderr).to_string());
                    }
                } else {
                    last_err = Some(String::from_utf8_lossy(&o.stderr).to_string());
                }
            }
            Err(e) => {
                last_err = Some(format!("{}", e));
            }
        }
    }
    let _ = std::fs::remove_file(&tmp);
    Err(last_err.unwrap_or_else(|| "convert_failed".to_string()))
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<String, String> {
    match fs::create_dir_all(&path) {
        Ok(_) => Ok(format!("Directory created: {}", path)),
        Err(e) => Err(format!("Failed to create directory: {}", e)),
    }
}

#[tauri::command]
pub fn get_username() -> Result<String, String> {
    db_get_username()
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    db_file_exists(&path)
}

#[tauri::command]
pub async fn get_request_logs(state: State<'_, ServerState>) -> Result<Vec<RequestLog>, String> {
    let logs = state.logger.get_logs();
    Ok(logs)
}

#[tauri::command]
pub async fn clear_request_logs(state: State<'_, ServerState>) -> Result<String, String> {
    state.logger.clear_logs();
    Ok("Request logs cleared successfully".to_string())
}

#[tauri::command]
pub async fn open_devtools(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
        Ok("开发者工具已打开".to_string())
    } else {
        Err("无法找到主窗口".to_string())
    }
}

#[tauri::command]
pub fn request_admin_elevation(app: tauri::AppHandle) -> Result<String, String> {
    match spawn_elevated_self() {
        Ok(_) => {
            app.exit(0);
            Ok("ok".to_string())
        }
        Err(e) => Err(e)
    }
}
