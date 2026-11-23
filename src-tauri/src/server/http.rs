//! http implementation; the parent module preserves the public facade.
use super::*;

/// 验证管理员 token（从 Authorization: Bearer <token> 或直接值中提取）
pub(super) fn check_admin_token(auth: &Option<String>) -> bool {
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
    let config = read_app_config();
    let admin_token = config
        .get("adminToken")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    !admin_token.is_empty() && token == admin_token
}

/// 启动HTTP服务器
#[tauri::command]
pub async fn start_server(
    port: u16,
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

        // 对于非query路由,使用简化的日志记录
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
    let app_for_query = state.app_handle.clone();

    let request_connection = warp::path::full()
        .and(warp::query::raw().map(Some).or(warp::any().map(|| None)).unify())
        .and(warp::addr::remote())
        .map(|path: warp::path::FullPath, query: Option<String>, remote: Option<SocketAddr>| {
            let mut target = path.as_str().to_owned();
            if let Some(query) = query {
                target.push('?');
                target.push_str(&query);
            }
            (target, remote.map(|address| address.to_string()))
        });

    // POST 请求处理
    let query_post_route = warp::path("query")
        .and(warp::post())
        .and(warp::header::headers_cloned())
        .and(request_connection)
        .and(warp::body::json())
        .and_then(move |headers: HeaderMap, (request_target, remote_address), request: QueryRequest| {
            let logger = logger_for_query.clone();
            let app = app_for_query.clone();
            async move {
                let start_time = std::time::Instant::now();
                // 日志请求体：images 只保留摘要，避免 base64 大字段进入日志与 SSE 广播
                let request_body = build_query_request_log_body(&request);

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
                    request_target,
                    remote_address,
                );

                let request_origin = resolve_request_origin(&headers, port);

                // 独立任务执行：请求端断开时仍会写完 completed 日志，避免 UI 一直「处理中」
                let logger_task = logger.clone();
                let app_task = app.clone();
                let request_task = request;
                let request_id_task = request_id.clone();
                let request_origin_task = request_origin;
                let (progress, stream_reply) = QueryProgress::for_request(&headers);
                let join = tokio::spawn(async move {
                    let outcome = resolve_query_with_same_question_check(
                        &logger_task,
                        app_task.as_ref(),
                        &request_task,
                        &request_id_task,
                        &request_origin_task,
                        &progress,
                    )
                    .await;
                    complete_query_reply(
                        &logger_task,
                        app_task.as_ref(),
                        request_id_task,
                        "POST",
                        start_time.elapsed().as_millis() as u64,
                        outcome,
                        &progress,
                    )
                });

                if let Some(reply) = stream_reply {
                    return Ok::<_, warp::Rejection>(reply);
                }
                match join.await {
                    Ok(reply) => Ok::<_, warp::Rejection>(reply),
                    Err(e) => {
                        eprintln!("❌ /query POST task join error: {}", e);
                        let response = QueryResponse::error("Internal query task failed".to_string());
                        Ok(warp::reply::json(&response).into_response())
                    }
                }
            }
        });

    // GET 请求处理
    let logger_for_query_get = state.logger.clone();
    let app_for_query_get = state.app_handle.clone();
    let query_get_route = warp::path("query")
        .and(warp::get())
        .and(warp::header::headers_cloned())
        .and(request_connection)
        .and(warp::query::<HashMap<String, String>>())
        .and_then(move |headers: HeaderMap, (request_target, remote_address), params: HashMap<String, String>| {
            let logger = logger_for_query_get.clone();
            let app = app_for_query_get.clone();
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
                    // GET 请求不承载图片题优化字段（base64 只能走 POST 请求体）
                    images: None,
                    suggestion_title: None,
                    suggestion_options: None,
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
                    request_target,
                    remote_address,
                );

                let request_origin = resolve_request_origin(&headers, port);

                let logger_task = logger.clone();
                let app_task = app.clone();
                let request_task = request;
                let request_id_task = request_id.clone();
                let request_origin_task = request_origin;
                let join = tokio::spawn(async move {
                    let progress = QueryProgress::default();
                    let outcome = resolve_query_with_same_question_check(
                        &logger_task,
                        app_task.as_ref(),
                        &request_task,
                        &request_id_task,
                        &request_origin_task,
                        &progress,
                    )
                    .await;
                    complete_query_reply(
                        &logger_task,
                        app_task.as_ref(),
                        request_id_task,
                        "GET",
                        start_time.elapsed().as_millis() as u64,
                        outcome,
                        &progress,
                    )
                });

                match join.await {
                    Ok(reply) => Ok::<_, warp::Rejection>(reply),
                    Err(e) => {
                        eprintln!("❌ /query GET task join error: {}", e);
                        let response = QueryResponse::error("Internal query task failed".to_string());
                        Ok(warp::reply::json(&response).into_response())
                    }
                }
            }
        });

    // 合并 GET 和 POST 路由
    let query_route = query_post_route.or(query_get_route);

    let mark_pending_correction_route = warp::path("api")
        .and(warp::path("questions"))
        .and(warp::path::param::<i64>())
        .and(warp::path("pending-correction"))
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::header::headers_cloned())
        .and_then(move |question_id: i64, headers: HeaderMap| async move {
            let same_origin = headers.get("origin").map_or(true, |origin| {
                origin.as_bytes() == resolve_request_origin(&headers, port).as_bytes()
            });
            if !same_origin {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({
                        "success": false,
                        "message": "请重新查询以获取待修正链接",
                    })),
                    warp::http::StatusCode::FORBIDDEN,
                ));
            }
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

                let is_success = crate::model_response::callback_succeeded(&request.content, request.is_success);

                // 发送模型调用响应事件
                logger.send_model_call_response(
                    request.request_id.clone(),
                    request.content.clone(),
                    request.reasoning_content.clone(),
                    is_success,
                );

                // Acknowledgement only. The query handler is the sole persistence owner.
                // 返回成功响应
                let response = serde_json::json!({
                    "success": true,
                    "message": "Model response received successfully",
                    "is_success": is_success
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
        .map(|| warp::reply::with_header(warp::reply::html(QUERY_TEST_PAGE_HTML), "cache-control", "no-cache"));

    let query_details_assets = warp::path!("query-details" / String)
        .and(warp::get())
        .and_then(|asset: String| async move {
            let (body, content_type) = match asset.as_str() {
                "styles.css" => (QUERY_DETAILS_CSS, "text/css; charset=utf-8"),
                "view.js" => (QUERY_DETAILS_JS, "text/javascript; charset=utf-8"),
                _ => return Err(warp::reject::not_found()),
            };
            Ok(warp::reply::with_header(
                warp::reply::with_header(body, "content-type", content_type),
                "cache-control",
                "no-cache",
            ))
        });

    let app_icon_route = warp::path("app-icon.png")
        .and(warp::path::end())
        .and(warp::get())
        .map(|| {
            let icon = include_bytes!("../../../public/icons/app-icon.png");
            warp::reply::with_header(icon.as_slice(), "content-type", "image/png")
        });

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
                    .send_model_call_progress(request.request_id, request.content, request.details);
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
            let config = read_app_config();
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
            let mut data=crate::secret_vault::document_read("model_settings",None).unwrap_or_default();
            if let Some(rows)=data["platforms"].as_array_mut() {for row in rows {if let Some(object)=row.as_object_mut() {object.remove("apiKey");object.remove("customHeaders");}}}
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
            // Omitting a key in a remote configuration update retains the local key.
            let mut body=body;
            let existing=crate::secret_vault::document_read("model_settings",None).unwrap_or_default();
            if let Some(rows)=body["platforms"].as_array_mut() {for row in rows {
                if let Some(previous)=existing["platforms"].as_array().and_then(|old|old.iter().find(|p|p["id"]==row["id"])) {
                    for field in ["apiKey","customHeaders"] {if row.get(field).is_none() {row[field]=previous[field].clone();}}
                }
            }}
            match crate::secret_vault::document_write("model_settings",body) {
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
        .or(app_icon_route)
        .or(query_details_assets)
        .or(root_head_route)
        .or(logged_routes)
        .or(query_route)
        .or(correction::routes(state.app_handle.clone()))
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

    begin_server_activity();

    Ok(result)
}

/// 停止HTTP服务器
///
/// # 参数
/// * `state` - 服务器状态管理
///
/// # 返回值
/// * `Ok(ServerInfo)` - 服务器停止成功,返回服务器信息
/// * `Err(String)` - 服务器停止失败,返回错误信息
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

    end_server_activity();

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
