use crate::database::{insert_ai_response, query_database, set_question_pending_correction};
use crate::types::{
    ModelCallProgressRequest, ModelCallResponseRequest, QueryData, QueryRequest, QueryResponse,
    ServerInfo, ServerState,
};
use futures_util::StreamExt;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use tauri::{Emitter, State};
use tokio::task::JoinHandle;
use tokio_stream::wrappers::BroadcastStream;
use uuid;
use warp::http::HeaderMap;
use warp::Filter;

const QUERY_TEST_PAGE_HTML: &str = include_str!("query_test_page.html");

/// 验证管理员 token（从 Authorization: Bearer <token> 或直接值中提取）
fn check_admin_token(auth: &Option<String>) -> bool {
    let token = match auth {
        None => return false,
        Some(v) => {
            let v = v.trim();
            if v.to_lowercase().starts_with("bearer ") {
                v[7..].trim().to_string()
            } else {
                v.to_string()
            }
        }
    };
    if token.is_empty() {
        return false;
    }
    let config_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("config.json");
    let config: serde_json::Value = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let admin_token = config
        .get("adminToken")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    !admin_token.is_empty() && token == admin_token
}

/// 检测文本中是否包含URL
fn contains_url(text: &str) -> bool {
    let url_regex = Regex::new(r"https?://[^\s]+").unwrap();
    url_regex.is_match(text)
}

fn resolve_request_origin(headers: &HeaderMap) -> String {
    let host = headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("127.0.0.1:3000");
    format!("http://{}", host)
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn build_pending_correction_button(origin: &str, question_id: i64, is_pending_correction: bool) -> String {
    if question_id <= 0 {
        return String::new();
    }

    if is_pending_correction {
        return "<button type=\"button\" disabled style=\"padding:4px 10px;border:none;border-radius:999px;background:#f59e0b;color:#fff;font-size:12px;cursor:not-allowed;opacity:0.75;white-space:nowrap;\">已标记待修正</button>".to_string();
    }

    let url = format!("{}/api/questions/{}/pending-correction", origin, question_id);
    format!(
        r#"<button type="button" style="padding:4px 10px;border:none;border-radius:999px;background:#ef4444;color:#fff;font-size:12px;cursor:pointer;white-space:nowrap;" onclick="(async()=>{{const btn=this;if(btn.dataset.loading==='1')return;const text=btn.textContent||'标记为待修正';btn.dataset.loading='1';btn.disabled=true;btn.textContent='标记中...';try{{const res=await fetch('{url}',{{method:'POST'}});const data=await res.json().catch(()=>({{success:false,message:'标记失败'}}));if(!res.ok||!data.success)throw new Error(data.message||'标记失败');btn.textContent='已标记待修正';btn.style.opacity='0.75';btn.style.cursor='not-allowed';}}catch(error){{btn.disabled=false;btn.textContent=text;alert(error&&error.message?error.message:'标记失败');}}finally{{delete btn.dataset.loading;}}}})()">标记为待修正</button>"#,
        url = url
    )
}

fn build_query_data(
    origin: &str,
    question_id: i64,
    question: &str,
    answer: String,
    is_ai: bool,
    is_pending_correction: bool,
) -> QueryData {
    let escaped_question = escape_html(question).replace('\n', "<br>");
    let button_html = build_pending_correction_button(origin, question_id, is_pending_correction);
    let question_html = if button_html.is_empty() {
        escaped_question
    } else {
        format!(
            "<div style=\"display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;\"><span style=\"flex:1 1 auto;min-width:0;\">{}</span>{}</div>",
            escaped_question, button_html
        )
    };

    QueryData {
        id: question_id,
        question: question_html,
        answer,
        is_ai,
        is_pending_correction,
    }
}

#[derive(Debug, Clone, Copy)]
enum QuestionKind {
    Single,
    Multiple,
    Judgement,
    Completion,
}

impl QuestionKind {
    fn chinese_name(&self) -> &'static str {
        match self {
            QuestionKind::Single => "单选",
            QuestionKind::Multiple => "多选",
            QuestionKind::Judgement => "判断",
            QuestionKind::Completion => "填空",
        }
    }

    fn prompt_hint(&self) -> &'static str {
        match self {
            QuestionKind::Single => "这是单选题，请返回正确选项的内容，不要返回选项字母、选项序号或无关说明。",
            QuestionKind::Multiple => "这是多选题，请返回所有正确选项的内容，不要返回选项字母、选项序号。如果有多个正确选项，请使用“###”连接每个选项内容。",
            QuestionKind::Judgement => "这是判断题，请只回答“正确”或“错误”，不要添加任何其他内容。",
            QuestionKind::Completion => "这是一道填空题或者简答题，也有可能是名词解释。如果有多个空，请将每个空的答案使用“###”连接。",
        }
    }
}

fn detect_question_kind(query_type: &str) -> Option<QuestionKind> {
    let trimmed = query_type.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_lowercase();

    if normalized.contains("single") || trimmed.contains("单选") || trimmed.contains("单项选择")
    {
        Some(QuestionKind::Single)
    } else if normalized.contains("multiple")
        || trimmed.contains("多选")
        || trimmed.contains("多项选择")
    {
        Some(QuestionKind::Multiple)
    } else if normalized.contains("judgement")
        || normalized.contains("judgment")
        || trimmed.contains("判断")
    {
        Some(QuestionKind::Judgement)
    } else if normalized.contains("completion") || trimmed.contains("填空") {
        Some(QuestionKind::Completion)
    } else {
        None
    }
}

fn build_model_query_prompt(
    title: &str,
    options: Option<&str>,
    query_type: Option<&str>,
) -> String {
    let mut q = String::from(
        "请先分析我给出的问题，给出简要的思考过程，如果问题比较复杂，给出详细思考过程。最后将答案用JSON的格式回答我，格式{\"answer\":\"答案\"}。"
    );

    q.push_str("如果是选择题，请返回对应选项的内容，不要返回选项字母或选项序号。");

    if let Some(raw_type) = query_type.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(kind) = detect_question_kind(raw_type) {
            q.push_str(&format!("题目类型：{}题。", kind.chinese_name()));
            q.push_str(kind.prompt_hint());
        } else {
            q.push_str(&format!("题目类型字段：{}。", raw_type));
        }
    }

    q.push_str(&format!("题目：{}", title));

    if let Some(options) = options.map(str::trim).filter(|value| !value.is_empty()) {
        q.push_str(&format!("，选项：{}", options));
    }

    q
}

/// 启动 Web 辅助服务器
async fn start_web_server(web_port: u16, bind_ip: [u8; 4]) -> JoinHandle<()> {
    use warp::Filter;

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type", "authorization"])
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"]);

    // dev 模式：反向代理到 vite dev server (3002)
    if cfg!(debug_assertions) {
        println!("🌐 Web server (dev) proxying to http://localhost:3002");
        let client = reqwest::Client::new();
        let proxy_route = warp::any()
            .and(warp::method())
            .and(warp::path::full())
            .and(
                warp::query::raw()
                    .or(warp::any().map(|| String::new()))
                    .unify(),
            )
            .and(warp::header::headers_cloned())
            .and(warp::body::bytes())
            .and_then(
                move |method: warp::http::Method,
                      path: warp::path::FullPath,
                      query: String,
                      headers: warp::http::HeaderMap,
                      body: bytes::Bytes| {
                    let client = client.clone();
                    async move {
                        let url = if query.is_empty() {
                            format!("http://localhost:3002{}", path.as_str())
                        } else {
                            format!("http://localhost:3002{}?{}", path.as_str(), query)
                        };
                        let method_str = method.as_str().to_string();
                        let req_method = reqwest::Method::from_bytes(method_str.as_bytes())
                            .unwrap_or(reqwest::Method::GET);
                        let mut req = client.request(req_method, &url).body(body);
                        for (key, value) in headers.iter() {
                            let name = key.as_str();
                            if name != "host" {
                                req = req.header(key.as_str(), value.as_bytes());
                            }
                        }
                        match req.send().await {
                            Ok(resp) => {
                                let status = resp.status();
                                let resp_headers = resp.headers().clone();
                                let resp_body = resp.bytes().await.unwrap_or_default();
                                let mut reply =
                                    warp::http::Response::builder().status(status.as_u16());
                                for (key, value) in resp_headers.iter() {
                                    let name = key.as_str();
                                    if name != "transfer-encoding" {
                                        reply = reply.header(key.as_str(), value.as_bytes());
                                    }
                                }
                                Ok::<_, warp::Rejection>(reply.body(resp_body.to_vec()).unwrap())
                            }
                            Err(_) => Ok::<_, warp::Rejection>(
                                warp::http::Response::builder()
                                    .status(502)
                                    .body(b"vite dev server not running on port 3002".to_vec())
                                    .unwrap(),
                            ),
                        }
                    }
                },
            );
        return tokio::spawn(async move {
            warp::serve(proxy_route.with(cors))
                .run((bind_ip, web_port))
                .await;
        });
    }

    // /api/login 路由，避免跨端口 CORS 问题
    let web_login_route = warp::path("api")
        .and(warp::path("login"))
        .and(warp::post())
        .and(warp::body::json())
        .and_then(|body: serde_json::Value| async move {
            let token = body
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if token.is_empty() {
                let resp = serde_json::json!({"success": false, "message": "token不能为空"});
                return Ok::<_, warp::Rejection>(warp::reply::json(&resp));
            }
            let config_path = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("config.json");
            let config: serde_json::Value = std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            let admin_token = config
                .get("adminToken")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !admin_token.is_empty() && token == admin_token {
                return Ok::<_, warp::Rejection>(warp::reply::json(
                    &serde_json::json!({"success": true, "role": "admin", "name": "管理员"}),
                ));
            }
            if let Some(users) = config
                .get("multiUser")
                .and_then(|m| m.get("users"))
                .and_then(|u| u.as_array())
            {
                for user in users {
                    let ut = user.get("token").and_then(|v| v.as_str()).unwrap_or("");
                    if !ut.is_empty() && token == ut {
                        let name = user
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("用户")
                            .to_string();
                        return Ok::<_, warp::Rejection>(warp::reply::json(
                            &serde_json::json!({"success": true, "role": "user", "name": name}),
                        ));
                    }
                }
            }
            Ok::<_, warp::Rejection>(warp::reply::json(
                &serde_json::json!({"success": false, "message": "Token 无效"}),
            ))
        });

    let fallback_route = warp::any().map(|| {
        warp::reply::with_status(
            warp::reply::json(&serde_json::json!({
                "success": false,
                "message": "Web 静态资源已移除"
            })),
            warp::http::StatusCode::NOT_FOUND,
        )
    });

    println!("🌐 Web static assets disabled; only auxiliary API routes are served");
    let routes = web_login_route.or(fallback_route).with(cors);
    tokio::spawn(async move {
        warp::serve(routes).run((bind_ip, web_port)).await;
    })
}

/// 启动HTTP服务器
#[tauri::command]
pub async fn start_server(
    port: u16,
    web_port: u16,
    bind_address: String,
    state: State<'_, ServerState>,
) -> Result<ServerInfo, String> {
    // 验证端口号
    if port == 0 {
        return Err("Invalid port number".to_string());
    }

    // 检查服务器是否已经在运行
    {
        let info = state.info.lock();
        if info.running {
            return Ok(info.clone());
        }
    }

    // 克隆状态以在异步任务中使用
    let logger = state.logger.clone();

    // 创建请求记录中间件（用于其他路由）
    let logging_middleware = warp::log::custom(move |info| {
        let method = info.method().to_string();
        let path = info.path().to_string();
        let status = info.status().as_u16();
        let response_time = info.elapsed().as_millis() as u64;

        println!(
            "🔍 Logging middleware triggered: {} {} - Status: {}, Time: {}ms",
            method, path, status, response_time
        );

        // 对于非query路由，使用简化的日志记录
        logger.log_request(
            method,
            path,
            status,
            response_time,
            None, // request_body
            None, // response_body
            None, // headers
            None, // ip
            None, // user_agent
        );

        println!("✅ Request logged successfully");
    });

    // 状态路由
    let status_route = warp::path("api")
        .and(warp::path("status"))
        .and(warp::get())
        .map(|| {
            warp::reply::json(&serde_json::json!({
                "status": "running",
                "message": "Server is running"
            }))
        });

    // 时间路由
    let time_route = warp::path("api")
        .and(warp::path("time"))
        .and(warp::get())
        .map(|| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            warp::reply::json(&serde_json::json!({
                "timestamp": now,
                "time": chrono::Utc::now().to_rfc3339()
            }))
        });

    // Echo路由
    let echo_route = warp::path("api")
        .and(warp::path("echo"))
        .and(warp::post())
        .and(warp::body::json())
        .map(|body: serde_json::Value| {
            warp::reply::json(&serde_json::json!({
                "echo": body,
                "received_at": chrono::Utc::now().to_rfc3339()
            }))
        });

    // 数据库查询路由 - 带有详细日志记录
    let logger_for_query = state.logger.clone();

    // POST 请求处理
    let query_post_route = warp::path("query")
        .and(warp::post())
        .and(warp::header::headers_cloned())
        .and(warp::body::json())
        .and_then(move |headers: HeaderMap, request: QueryRequest| {
            let logger = logger_for_query.clone();
            async move {
                let start_time = std::time::Instant::now();
                let request_body = serde_json::to_string(&request).unwrap_or_default();
                
                // 生成唯一请求ID
                let request_id = uuid::Uuid::new_v4().to_string();
                
                // 提取请求头信息
                let mut header_map = HashMap::new();
                for (key, value) in headers.iter() {
                    if let Ok(value_str) = value.to_str() {
                        header_map.insert(key.to_string(), value_str.to_string());
                    }
                }
                
                // 提取IP和User-Agent
                let user_agent = headers.get("user-agent")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let ip = headers.get("x-forwarded-for")
                    .or_else(|| headers.get("x-real-ip"))
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "127.0.0.1".to_string());

                // 记录请求开始
                logger.log_request_start(
                    request_id.clone(),
                    "POST".to_string(),
                    "/query".to_string(),
                    Some(request_body),
                    Some(header_map),
                    Some(ip),
                    user_agent,
                );

                // 检测title和options中是否包含URL
                let mut has_url = contains_url(&request.title);
                if let Some(options) = &request.options {
                    if !has_url {
                        has_url = contains_url(options);
                    }
                }

                let request_origin = resolve_request_origin(&headers);

                // 先进行数据库查询（无论是否包含URL）
                let result = match query_database(&request.title, request.options.as_deref()).await {
                    Ok(results) => {
                        if !results.is_empty() {
                            println!("✅ 在数据库中找到匹配结果: {} 条记录", results.len());
                            let data_list: Vec<QueryData> = results
                                .into_iter()
                                .map(|(id, question, answer, is_ai, is_pending_correction)| {
                                    build_query_data(
                                        &request_origin,
                                        id,
                                        &question,
                                        answer,
                                        is_ai,
                                        is_pending_correction,
                                    )
                                })
                                .collect();
                            let response = QueryResponse::success(data_list);
                            (200, response)
                        } else {
                            println!("🔍 数据库中未找到匹配结果: {}", request.title);

                            // 如果检测到URL，发送视觉分析请求（带 __URL_QUESTION__: 前缀）
                            let formatted_query = if has_url {
                                println!("🔗 检测到URL，发送视觉分析请求: {}", request.title);
                                let mut q = format!("__URL_QUESTION__:{}", request.title);
                                if let Some(options) = &request.options {
                                    if !options.is_empty() {
                                        q.push_str(&format!("\n__OPTIONS__:{}", options));
                                    }
                                }
                                q
                            } else {
                                // 普通题目：统一使用带分析的文本模型提示词
                                println!("🤖 Database query returned no results, requesting model call for: {}", request.title);
                                build_model_query_prompt(
                                    &request.title,
                                    request.options.as_deref(),
                                    request.query_type.as_deref(),
                                )
                            };

                            logger.send_model_call_request(request_id.clone(), formatted_query);

                            // 等待模型调用完成（URL题目等待更长时间：120秒）
                            let wait_secs = if has_url { 120 } else { 30 };
                            match logger.wait_for_model_response(request_id.clone(), wait_secs).await {
                                Ok(model_content) => {
                                    println!("✅ Received model response: {}", model_content);
                                    if let Some(err_msg) = is_model_error(&model_content) {
                                        let response = QueryResponse::error(err_msg);
                                        (500, response)
                                    } else {
                                        let mut extracted_answer = extract_answer_from_json(&model_content);

                                        // Check for incomplete question response
                                        if model_content.contains("题目不完整，无法确定具体问题。") {
                                            extracted_answer = String::new();
                                            println!("⚠️ 检测到题目不完整，将答案留空");
                                        }

                                        extracted_answer = extracted_answer.trim().to_string();

                                        // Store to database
                                        let inserted_id = if extracted_answer.is_empty() {
                                            println!("⚠️ AI最终处理结果答案为空，跳过保存题目");
                                            0
                                        } else {
                                            match insert_ai_response(
                                                &request.title,
                                                &extracted_answer,
                                                request.options.clone(),
                                                request.query_type.clone(),
                                                true,
                                            ) {
                                                Ok(id) => {
                                                    println!("✅ AI response stored to database");
                                                    id
                                                }
                                                Err(e) => {
                                                    println!("❌ Failed to store AI response: {}", e);
                                                    0
                                                }
                                            }
                                        };

                                        let data = build_query_data(
                                            &request_origin,
                                            inserted_id,
                                            &request.title,
                                            extracted_answer,
                                            true,
                                            false,
                                        );
                                        let response = QueryResponse::success(vec![data]);
                                        (200, response)
                                    }
                                }
                                Err(e) => {
                                    println!("❌ Model call timeout or error: {}", e);
                                    let response = QueryResponse::error(format!("Model call failed: {}", e));
                                    (408, response)
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Database query error: {}", e);
                        let response = QueryResponse::error(format!("Database error: {}", e));
                        (500, response)
                    }
                };

                let response_time = start_time.elapsed().as_millis() as u64;
                let response_body = serde_json::to_string(&result.1).unwrap_or_default();
                
                // 记录请求完成
                logger.log_request_complete(
                    request_id,
                    "POST".to_string(),
                    "/query".to_string(),
                    result.0,
                    response_time,
                    Some(response_body),
                );

                Ok::<_, warp::Rejection>(warp::reply::json(&result.1))
            }
        });

    // GET 请求处理
    let logger_for_query_get = state.logger.clone();
    let query_get_route = warp::path("query")
        .and(warp::get())
        .and(warp::header::headers_cloned())
        .and(warp::query::<HashMap<String, String>>())
        .and_then(move |headers: HeaderMap, params: HashMap<String, String>| {
            let logger = logger_for_query_get.clone();
            async move {
                let start_time = std::time::Instant::now();
                
                // 从查询参数构建 QueryRequest
                let title = params.get("title").cloned().unwrap_or_default();
                let options = params.get("options").cloned();
                let query_type = params.get("type").cloned();
                
                let request = QueryRequest {
                    title: title.clone(),
                    options,
                    query_type,
                };
                
                let request_body = serde_json::to_string(&request).unwrap_or_default();
                
                // 生成唯一请求ID
                let request_id = uuid::Uuid::new_v4().to_string();
                
                // 提取请求头信息
                let mut header_map = HashMap::new();
                for (key, value) in headers.iter() {
                    if let Ok(value_str) = value.to_str() {
                        header_map.insert(key.to_string(), value_str.to_string());
                    }
                }
                
                // 提取IP和User-Agent
                let user_agent = headers.get("user-agent")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string());
                let ip = headers.get("x-forwarded-for")
                    .or_else(|| headers.get("x-real-ip"))
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "127.0.0.1".to_string());

                // 记录请求开始
                logger.log_request_start(
                    request_id.clone(),
                    "GET".to_string(),
                    "/query".to_string(),
                    Some(request_body),
                    Some(header_map),
                    Some(ip),
                    user_agent,
                );

                // 检测title和options中是否包含URL
                let mut has_url = contains_url(&request.title);
                if let Some(options) = &request.options {
                    if !has_url {
                        has_url = contains_url(options);
                    }
                }

                let request_origin = resolve_request_origin(&headers);

                // 先进行数据库查询（无论是否包含URL）
                let result = match query_database(&request.title, request.options.as_deref()).await {
                    Ok(results) => {
                        if !results.is_empty() {
                            println!("✅ 在数据库中找到匹配结果: {} 条记录", results.len());
                            let data_list: Vec<QueryData> = results
                                .into_iter()
                                .map(|(id, question, answer, is_ai, is_pending_correction)| {
                                    build_query_data(
                                        &request_origin,
                                        id,
                                        &question,
                                        answer,
                                        is_ai,
                                        is_pending_correction,
                                    )
                                })
                                .collect();
                            let response = QueryResponse::success(data_list);
                            (200, response)
                        } else {
                            println!("🔍 数据库中未找到匹配结果: {}", request.title);

                            // 如果检测到URL，发送视觉分析请求（带 __URL_QUESTION__: 前缀）
                            let formatted_query = if has_url {
                                println!("🔗 检测到URL，发送视觉分析请求: {}", request.title);
                                let mut q = format!("__URL_QUESTION__:{}", request.title);
                                if let Some(options) = &request.options {
                                    if !options.is_empty() {
                                        q.push_str(&format!("\n__OPTIONS__:{}", options));
                                    }
                                }
                                q
                            } else {
                                println!("🤖 Database query returned no results, requesting model call for: {}", request.title);
                                build_model_query_prompt(
                                    &request.title,
                                    request.options.as_deref(),
                                    request.query_type.as_deref(),
                                )
                            };

                            logger.send_model_call_request(request_id.clone(), formatted_query);

                            // 等待模型调用完成（URL题目等待更长时间：120秒）
                            let wait_secs = if has_url { 120 } else { 30 };
                            match logger.wait_for_model_response(request_id.clone(), wait_secs).await {
                                Ok(model_content) => {
                                    println!("✅ Received model response: {}", model_content);
                                    if let Some(err_msg) = is_model_error(&model_content) {
                                        let response = QueryResponse::error(err_msg);
                                        (500, response)
                                    } else {
                                        let mut extracted_answer = extract_answer_from_json(&model_content);

                                        // Check for incomplete question response
                                        if model_content.contains("题目不完整，无法确定具体问题。") {
                                            extracted_answer = String::new();
                                            println!("⚠️ 检测到题目不完整，将答案留空");
                                        }

                                        extracted_answer = extracted_answer.trim().to_string();

                                        // Store to database
                                        let inserted_id = if extracted_answer.is_empty() {
                                            println!("⚠️ AI最终处理结果答案为空，跳过保存题目");
                                            0
                                        } else {
                                            match insert_ai_response(
                                                &request.title,
                                                &extracted_answer,
                                                request.options.clone(),
                                                request.query_type.clone(),
                                                true,
                                            ) {
                                                Ok(id) => {
                                                    println!("✅ AI response stored to database");
                                                    id
                                                }
                                                Err(e) => {
                                                    println!("❌ Failed to store AI response: {}", e);
                                                    0
                                                }
                                            }
                                        };

                                        let data = build_query_data(
                                            &request_origin,
                                            inserted_id,
                                            &request.title,
                                            extracted_answer,
                                            true,
                                            false,
                                        );
                                        let response = QueryResponse::success(vec![data]);
                                        (200, response)
                                    }
                                }
                                Err(e) => {
                                    println!("❌ Model call timeout or error: {}", e);
                                    let response = QueryResponse::error(format!("Model call failed: {}", e));
                                    (408, response)
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Database query error: {}", e);
                        let response = QueryResponse::error(format!("Database error: {}", e));
                        (500, response)
                    }
                };

                let response_time = start_time.elapsed().as_millis() as u64;
                let response_body = serde_json::to_string(&result.1).unwrap_or_default();
                
                // 记录请求完成
                logger.log_request_complete(
                    request_id,
                    "GET".to_string(),
                    "/query".to_string(),
                    result.0,
                    response_time,
                    Some(response_body),
                );

                Ok::<_, warp::Rejection>(warp::reply::json(&result.1))
            }
        });

    // 合并 GET 和 POST 路由
    let query_route = query_post_route.or(query_get_route);

    let mark_pending_correction_route = warp::path("api")
        .and(warp::path("questions"))
        .and(warp::path::param::<i64>())
        .and(warp::path("pending-correction"))
        .and(warp::post())
        .and_then(|question_id: i64| async move {
            match set_question_pending_correction(question_id, true).await {
                Ok(_) => Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({
                        "success": true,
                        "message": "题目已标记为待修正",
                        "id": question_id,
                    })),
                    warp::http::StatusCode::OK,
                )),
                Err(error) => Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({
                        "success": false,
                        "message": error,
                    })),
                    warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                )),
            }
        });

    // 模型调用响应路由
    let logger_for_model_response = state.logger.clone();
    let model_response_route = warp::path("api")
        .and(warp::path("model"))
        .and(warp::path("response"))
        .and(warp::post())
        .and(warp::body::json())
        .and_then(move |request: ModelCallResponseRequest| {
            let logger = logger_for_model_response.clone();
            async move {
                println!(
                    "🤖 Received model call response for request_id: {}",
                    request.request_id
                );

                let is_success = request
                    .is_success
                    .unwrap_or_else(|| is_model_error(&request.content).is_none());

                // 发送模型调用响应事件
                logger.send_model_call_response(
                    request.request_id.clone(),
                    request.content.clone(),
                    request.reasoning_content.clone(),
                    is_success,
                );

                if is_success {
                    match store_ai_response_to_database(&request.request_id, &request.content).await
                    {
                        Ok(_) => println!("✅ AI响应已成功存储到数据库"),
                        Err(e) => println!("❌ 存储AI响应到数据库失败: {}", e),
                    }
                } else {
                    println!("⚠️ 检测到模型错误响应，跳过存储到数据库");
                }

                // 返回成功响应
                let response = serde_json::json!({
                    "success": true,
                    "message": "Model response received successfully"
                });

                Ok::<_, warp::Rejection>(warp::reply::json(&response))
            }
        });

    // SSE日志流路由
    let logger_for_sse = state.logger.clone();
    let sse_logs_route = warp::path("api")
        .and(warp::path("logs"))
        .and(warp::path("stream"))
        .and(warp::get())
        .map(move || {
            println!("🔌 New SSE connection established");
            let receiver = logger_for_sse.subscribe();
            println!(
                "📻 SSE receiver created, current subscriber count: {}",
                logger_for_sse.subscriber_count()
            );

            let stream = BroadcastStream::new(receiver).filter_map(|result| async move {
                match result {
                    Ok(event) => {
                        println!("📤 Sending SSE event: {:?}", event);
                        let json_data = serde_json::to_string(&event).ok()?;

                        // 根据事件类型设置不同的event名称
                        let event_name = match &event {
                            crate::logger::SSEEvent::RequestLog(_) => "log",
                            crate::logger::SSEEvent::ModelCallRequest(_) => "model_call_request",
                            crate::logger::SSEEvent::ModelCallProgress(_) => "model_call_progress",
                            crate::logger::SSEEvent::ModelCallResponse(_) => "model_call_response",
                        };

                        Some(Ok::<_, warp::Error>(
                            warp::sse::Event::default()
                                .event(event_name)
                                .data(json_data),
                        ))
                    }
                    Err(e) => {
                        println!("❌ SSE stream error: {:?}", e);
                        None
                    }
                }
            });

            warp::sse::reply(stream)
        });

    let root_route = warp::path::end()
        .and(warp::get())
        .map(|| warp::reply::html(QUERY_TEST_PAGE_HTML));

    // 根路由的HEAD方法
    let app_handle_clone = state.app_handle.clone();
    let root_head_route = warp::path::end()
        .and(warp::head())
        .map(move || {
            if let Some(app) = &app_handle_clone {
                let _ = app.emit("ocs-head-received", ());
            }
            warp::reply::with_header("Hello,OCS", "content-type", "text/plain")
        });

    let cors = warp::cors()
        .allow_any_origin()
        .allow_headers(vec!["content-type"])
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"]);

    // 将需要记录日志的路由组合在一起（query路由已经有自己的详细日志记录）
    let logged_routes = status_route
        .or(time_route)
        .or(echo_route)
        .with(logging_middleware);

    // 模型调用进度路由（用于流式输出心跳）
    let logger_for_model_progress = state.logger.clone();
    let model_progress_route = warp::path("api")
        .and(warp::path("model"))
        .and(warp::path("progress"))
        .and(warp::post())
        .and(warp::body::json())
        .and_then(move |request: ModelCallProgressRequest| {
            let logger = logger_for_model_progress.clone();
            async move {
                println!(
                    "📶 Received model call progress for request_id: {}",
                    request.request_id
                );
                logger
                    .send_model_call_progress(request.request_id.clone(), request.content.clone());
                let response = serde_json::json!({
                    "success": true,
                    "message": "Model progress received successfully"
                });
                Ok::<_, warp::Rejection>(warp::reply::json(&response))
            }
        });

    // 登录路由：验证管理员token或用户token
    let login_route = warp::path("api")
        .and(warp::path("login"))
        .and(warp::post())
        .and(warp::body::json())
        .and_then(move |body: serde_json::Value| async move {
            let token = body
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if token.is_empty() {
                let resp = serde_json::json!({"success": false, "message": "token不能为空"});
                return Ok::<_, warp::Rejection>(warp::reply::json(&resp));
            }
            // 读取配置文件
            let config_path = {
                let exe_dir = std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                    .unwrap_or_else(|| std::path::PathBuf::from("."));
                exe_dir.join("config.json")
            };
            let config_str = std::fs::read_to_string(&config_path).unwrap_or_default();
            let config: serde_json::Value = serde_json::from_str(&config_str).unwrap_or_default();
            // 验证管理员token
            let admin_token = config
                .get("adminToken")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !admin_token.is_empty() && token == admin_token {
                let resp = serde_json::json!({"success": true, "role": "admin", "name": "管理员"});
                return Ok::<_, warp::Rejection>(warp::reply::json(&resp));
            }
            // 验证普通用户token
            if let Some(users) = config
                .get("multiUser")
                .and_then(|m| m.get("users"))
                .and_then(|u| u.as_array())
            {
                for user in users {
                    let user_token = user.get("token").and_then(|v| v.as_str()).unwrap_or("");
                    if !user_token.is_empty() && token == user_token {
                        let name = user.get("name").and_then(|v| v.as_str()).unwrap_or("用户");
                        let resp =
                            serde_json::json!({"success": true, "role": "user", "name": name});
                        return Ok::<_, warp::Rejection>(warp::reply::json(&resp));
                    }
                }
            }
            let resp = serde_json::json!({"success": false, "message": "token无效"});
            Ok::<_, warp::Rejection>(warp::reply::json(&resp))
        });

    // GET /api/models — 读取模型配置（需要管理员token验证）
    let models_get_route = warp::path("api")
        .and(warp::path("models"))
        .and(warp::get())
        .and(warp::header::optional::<String>("authorization"))
        .and_then(|auth: Option<String>| async move {
            if !check_admin_token(&auth) {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"success": false, "message": "未授权"})),
                    warp::http::StatusCode::UNAUTHORIZED,
                ));
            }
            let path = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("model_config.json");
            let data: serde_json::Value = std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::json!({}));
            Ok::<_, warp::Rejection>(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({"success": true, "data": data})),
                warp::http::StatusCode::OK,
            ))
        });

    // PUT /api/models — 写入模型配置（需要管理员token验证）
    let models_put_route = warp::path("api")
        .and(warp::path("models"))
        .and(warp::put())
        .and(warp::header::optional::<String>("authorization"))
        .and(warp::body::json())
        .and_then(|auth: Option<String>, body: serde_json::Value| async move {
            if !check_admin_token(&auth) {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"success": false, "message": "未授权"})),
                    warp::http::StatusCode::UNAUTHORIZED,
                ));
            }
            let path = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("model_config.json");
            match std::fs::write(&path, body.to_string()) {
                Ok(_) => Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({"success": true})),
                    warp::http::StatusCode::OK,
                )),
                Err(e) => Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(
                        &serde_json::json!({"success": false, "message": e.to_string()}),
                    ),
                    warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                )),
            }
        });

    // 组合所有路由（query路由和SSE路由不需要额外的日志中间件）
    let routes = root_route
        .or(root_head_route)
        .or(logged_routes)
        .or(query_route)
        .or(mark_pending_correction_route)
        .or(model_response_route)
        .or(model_progress_route)
        .or(sse_logs_route)
        .or(login_route)
        .or(models_get_route)
        .or(models_put_route)
        .with(cors);

    // 解析绑定地址
    let bind_ip: [u8; 4] = if bind_address == "0.0.0.0" {
        [0, 0, 0, 0]
    } else if bind_address == "127.0.0.1" {
        [127, 0, 0, 1]
    } else {
        // 尝试解析其他IP地址
        let parts: Vec<&str> = bind_address.split('.').collect();
        if parts.len() != 4 {
            return Err(format!("Invalid IP address format: {}", bind_address));
        }
        let mut ip = [0u8; 4];
        for (i, part) in parts.iter().enumerate() {
            match part.parse::<u8>() {
                Ok(octet) => ip[i] = octet,
                Err(_) => return Err(format!("Invalid IP address format: {}", bind_address)),
            }
        }
        ip
    };

    // 在后台启动服务器
    let server_handle = tokio::spawn(async move {
        warp::serve(routes).run((bind_ip, port)).await;
    });

    // 更新状态
    let result = {
        let mut info = state.info.lock();
        info.running = true;
        info.port = Some(port);
        // 根据绑定地址生成正确的URL
        let url_host = if bind_address == "0.0.0.0" {
            "localhost".to_string()
        } else {
            bind_address.clone()
        };
        info.url = Some(format!("http://{}:{}", url_host, port));
        info.clone()
    };

    // 存储服务器句柄
    *state.handle.lock() = Some(server_handle);

    // 启动 Web 静态文件服务器
    if web_port > 0 {
        let web_handle = start_web_server(web_port, bind_ip).await;
        *state.web_handle.lock() = Some(web_handle);
        println!("🌐 Web server started on port {}", web_port);
    }

    Ok(result)
}

/// 停止HTTP服务器
///
/// # 参数
/// * `state` - 服务器状态管理
///
/// # 返回值
/// * `Ok(ServerInfo)` - 服务器停止成功，返回服务器信息
/// * `Err(String)` - 服务器停止失败，返回错误信息
#[tauri::command]
pub async fn stop_server(state: State<'_, ServerState>) -> Result<ServerInfo, String> {
    {
        let info = state.info.lock();
        if !info.running {
            return Ok(info.clone());
        }
    }

    // 停止服务器
    if let Some(handle) = state.handle.lock().take() {
        handle.abort();
    }

    // 停止 Web 服务器
    if let Some(web_handle) = state.web_handle.lock().take() {
        web_handle.abort();
    }

    // 更新状态
    let result = {
        let mut info = state.info.lock();
        info.running = false;
        info.port = None;
        info.url = None;
        info.clone()
    };

    Ok(result)
}

/// 获取服务器状态
///
/// # 参数
/// * `state` - 服务器状态管理
///
/// # 返回值
/// * `Ok(ServerInfo)` - 返回当前服务器状态信息
#[tauri::command]
pub async fn get_server_status(state: State<'_, ServerState>) -> Result<ServerInfo, String> {
    let info = state.info.lock();
    Ok(info.clone())
}

/// 存储AI响应到数据库
///
/// # Arguments
/// * `request_id` - 请求ID
/// * `content` - AI响应内容
///
/// # Returns
/// * `Result<(), String>` - 成功返回Ok(())，失败返回错误信息
async fn store_ai_response_to_database(request_id: &str, content: &str) -> Result<(), String> {
    // 记录AI响应信息，准备存储到数据库
    println!(
        "📝 准备存储AI响应到数据库: request_id={}, content_length={}",
        request_id,
        content.len()
    );

    // 如果回答是"题目不完整，无法确定具体问题。"，则记录日志
    if content.contains("题目不完整，无法确定具体问题。") {
        println!("⚠️ 检测到题目不完整 (in callback)");
    }

    // TODO: 目前无法在此处存储，因为缺少原始问题的标题 (Title)。
    // 完整的存储逻辑已在 query_post_route 中实现，那里有完整的上下文。
    // 如果将来需要支持异步回调存储，需要实现通过 request_id 查找原始 title 的机制。

    Ok(())
}

/// 从JSON响应中提取answer字段
///
/// # Arguments
/// * `json_content` - AI返回的JSON字符串
///
/// # Returns
/// * `String` - 提取的答案内容，如果解析失败则返回原始内容
fn extract_answer_from_json(json_content: &str) -> String {
    // 1) 去除可能的 markdown 代码块标记
    let mut cleaned = json_content.trim().to_string();
    if cleaned.starts_with("```json") {
        cleaned = cleaned[7..].to_string();
    } else if cleaned.starts_with("```") {
        cleaned = cleaned[3..].to_string();
    }
    if cleaned.ends_with("```") {
        cleaned = cleaned[..cleaned.len() - 3].to_string();
    }
    cleaned = cleaned.trim().to_string();

    println!("🔍 清理后的内容: {}", cleaned);

    // 提取答案的内部工具函数
    fn extract_field_from_value(v: &Value) -> Option<String> {
        if let Some(answer) = v.get("answer").and_then(|a| a.as_str()) {
            return Some(answer.to_string());
        }
        if let Some(answer) = v.get("anwser").and_then(|a| a.as_str()) {
            return Some(answer.to_string());
        }
        None
    }

    // 2) 首先尝试直接解析整个文本为 JSON
    if let Ok(v) = serde_json::from_str::<Value>(&cleaned) {
        if let Some(ans) = extract_field_from_value(&v) {
            println!("✅ 直接解析文本为JSON并提取到答案: {}", ans);
            return ans;
        }
    }

    // 3) 失败则从末尾尝试提取最后一个平衡的 JSON 对象片段
    fn extract_last_balanced_json(text: &str) -> Option<String> {
        let bytes = text.as_bytes();
        let mut end: Option<usize> = None;
        let mut depth: i32 = 0;
        let mut i = bytes.len();
        while i > 0 {
            i -= 1;
            let b = bytes[i];
            if end.is_none() {
                if b == b'}' {
                    end = Some(i);
                    depth = 1;
                    continue;
                }
            } else {
                if b == b'}' {
                    depth += 1;
                } else if b == b'{' {
                    depth -= 1;
                    if depth == 0 {
                        let start = i;
                        let slice = &text[start..=end.unwrap()];
                        return Some(slice.to_string());
                    }
                }
            }
        }
        None
    }

    if let Some(json_str) = extract_last_balanced_json(&cleaned) {
        println!("🔎 发现末尾的JSON片段: {}", json_str);
        if let Ok(v) = serde_json::from_str::<Value>(&json_str) {
            if let Some(ans) = extract_field_from_value(&v) {
                println!("✅ 从末尾JSON片段中提取到答案: {}", ans);
                return ans;
            }
        } else {
            println!("⚠️ 末尾JSON片段解析失败");
        }
    }

    // 4) 使用正则在混合文本中直接捕获 answer 字段
    let re = Regex::new(r#"(?s)\{\s*\"(?:answer|anwser)\"\s*:\s*\"(.*?)\"[\s\S]*?\}"#).unwrap();
    if let Some(caps) = re.captures(&cleaned) {
        if let Some(m) = caps.get(1) {
            let ans = m.as_str().to_string();
            println!("✅ 通过正则从混合文本中捕获到答案: {}", ans);
            return ans;
        }
    }

    // 5) 回退：返回原始内容
    println!("⚠️ 未能提取到结构化答案，返回原始内容");
    json_content.to_string()
}

fn is_model_error(text: &str) -> Option<String> {
    let mut cleaned = text.trim().to_string();
    if cleaned.starts_with("```json") {
        cleaned = cleaned[7..].to_string();
    } else if cleaned.starts_with("```") {
        cleaned = cleaned[3..].to_string();
    }
    if cleaned.ends_with("```") {
        cleaned = cleaned[..cleaned.len() - 3].to_string();
    }
    let cleaned = cleaned.trim().to_string();

    if cleaned.starts_with("错误:") || cleaned.starts_with("Error:") {
        return Some(cleaned);
    }

    if cleaned.contains("\"error\"") {
        if let Ok(v) = serde_json::from_str::<Value>(&cleaned) {
            if let Some(err) = v.get("error") {
                if let Some(msg) = err.get("message").and_then(|m| m.as_str()) {
                    return Some(msg.to_string());
                }
                return Some(err.to_string());
            }
        }

        fn extract_last_balanced_json(text: &str) -> Option<String> {
            let bytes = text.as_bytes();
            let mut end: Option<usize> = None;
            let mut depth: i32 = 0;
            let mut i = bytes.len();
            while i > 0 {
                i -= 1;
                let b = bytes[i];
                if end.is_none() {
                    if b == b'}' {
                        end = Some(i);
                        depth = 1;
                        continue;
                    }
                } else {
                    if b == b'}' {
                        depth += 1;
                    } else if b == b'{' {
                        depth -= 1;
                        if depth == 0 {
                            let start = i;
                            let slice = &text[start..=end.unwrap()];
                            return Some(slice.to_string());
                        }
                    }
                }
            }
            None
        }

        if let Some(json_str) = extract_last_balanced_json(&cleaned) {
            if let Ok(v) = serde_json::from_str::<Value>(&json_str) {
                if let Some(err) = v.get("error") {
                    if let Some(msg) = err.get("message").and_then(|m| m.as_str()) {
                        return Some(msg.to_string());
                    }
                    return Some(err.to_string());
                }
            }
        }
    }

    None
}
