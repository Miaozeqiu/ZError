use tauri::{State, Manager};
use crate::types::ServerState;
use crate::logger::RequestLog;
use crate::database::{get_username as db_get_username, file_exists as db_file_exists};
use std::fs;
use base64::{Engine as _, engine::general_purpose};
use urlencoding;

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