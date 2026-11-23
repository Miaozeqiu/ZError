//! images implementation; the parent module preserves the public facade.
use super::*;

#[tauri::command]
pub async fn fetch_image_as_base64(app: tauri::AppHandle, url: String) -> Result<String, String> {
    // --- 磁盘缓存 ---
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())
        .map(|d| d.join("image_cache"))?;
    let _ = std::fs::create_dir_all(&cache_dir);

    // 用 URL 的哈希值作为文件名
    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let hash = hasher.finish();
    let cache_file = cache_dir.join(format!("{}.b64", hash));

    // 命中缓存直接返回
    if let Ok(cached) = std::fs::read_to_string(&cache_file) {
        if !cached.is_empty() {
            return Ok(cached);
        }
    }

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
                            let data_url =
                                format!("data:{};base64,{}", content_type, base64_string);

                            println!(
                                "✅ 图片获取成功 ({}), 大小: {} bytes",
                                strategy_name,
                                bytes.len()
                            );
                            // 写入磁盘缓存
                            let _ = std::fs::write(&cache_file, &data_url);
                            return Ok(data_url);
                        }
                        Err(e) => {
                            println!("❌ 读取图片数据失败 ({}): {}", strategy_name, e);
                            continue;
                        }
                    }
                } else {
                    println!(
                        "❌ HTTP请求失败 ({}): {} {}",
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
pub(super) fn create_full_browser_request(url: &str) -> Result<reqwest::RequestBuilder, String> {
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
        .header(
            "Accept",
            "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        )
        .header(
            "Accept-Language",
            "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        )
        .header("Accept-Encoding", "gzip, deflate, br")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .header(
            "Sec-Ch-Ua",
            "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"",
        )
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
pub(super) fn create_simple_request(url: &str) -> Result<reqwest::RequestBuilder, String> {
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
pub(super) fn create_mobile_request(url: &str) -> Result<reqwest::RequestBuilder, String> {
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
pub(super) fn detect_image_type(bytes: &[u8]) -> &'static str {
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
    if bytes.len() >= 12
        && bytes[0] == 0x52
        && bytes[1] == 0x49
        && bytes[2] == 0x46
        && bytes[3] == 0x46
        && bytes[8] == 0x57
        && bytes[9] == 0x45
        && bytes[10] == 0x42
        && bytes[11] == 0x50
    {
        return "image/webp";
    }

    // BMP: 42 4D
    if bytes[0] == 0x42 && bytes[1] == 0x4D {
        return "image/bmp";
    }

    // 默认返回PNG
    "image/png"
}
