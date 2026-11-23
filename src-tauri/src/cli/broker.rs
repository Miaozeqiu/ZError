use super::client::transport::{
    directory, private_directory, read_endpoint, request_with_timeout, Endpoint, MAX_BODY,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Write, sync::Arc, time::Duration};
use tauri::{Emitter, EventTarget, Manager};
use tokio::sync::oneshot;
use warp::{
    http::{HeaderMap, StatusCode},
    Filter, Reply,
};

struct Pending {
    request: Call,
    delivered: bool,
    send: oneshot::Sender<Value>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Call {
    method: String,
    params: Value,
}
#[derive(Default)]
struct Inner {
    generation: Option<String>,
    pending: HashMap<String, Pending>,
}
#[derive(Default, Clone)]
pub struct CliState(Arc<Mutex<Inner>>);

struct PendingGuard {
    id: String,
    state: CliState,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.state.0.lock().pending.remove(&self.id);
    }
}

fn allowed(headers: &HeaderMap, port: u16, token: &str) -> bool {
    headers.get("host").and_then(|h| h.to_str().ok()) == Some(format!("127.0.0.1:{port}").as_str())
        && headers.get("authorization").and_then(|h| h.to_str().ok())
            == Some(format!("Bearer {token}").as_str())
        && headers
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .map(|h| h.split(';').next().unwrap_or("").trim() == "application/json")
            .unwrap_or(false)
        && !headers.contains_key("origin")
        && !headers.keys().any(|h| h.as_str().starts_with("sec-fetch-"))
}

async fn dispatch(call: Call, state: CliState, app: tauri::AppHandle) -> Value {
    if call.method.len() > 96
        || !call
            .method
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b == b'.' || b == b'_')
        || !call.params.is_object()
    {
        return json!({"ok":false,"code":"invalid_request","error":"无效的方法或参数"});
    }
    let id = uuid::Uuid::new_v4().to_string();
    let receive = {
        let mut inner = state.0.lock();
        if inner.generation.is_none() {
            return json!({"ok":false,"code":"not_ready","error":"软件界面尚未就绪，请稍后重试"});
        }
        if inner.pending.len() >= 16 {
            return json!({"ok":false,"code":"busy","error":"CLI 请求过多，请稍后重试"});
        }
        let (send, receive) = oneshot::channel();
        inner.pending.insert(
            id.clone(),
            Pending {
                request: call,
                delivered: false,
                send,
            },
        );
        receive
    };
    let _guard = PendingGuard {
        id: id.clone(),
        state,
    };
    // 敏感参数仅保留在 Rust 中，事件只携带不含业务信息的请求 ID。
    if app
        .emit_to(
            EventTarget::webview("main"),
            "cli-request",
            json!({"id":id}),
        )
        .is_err()
    {
        return json!({"ok":false,"code":"unavailable","error":"无法连接主界面"});
    }
    match tokio::time::timeout(Duration::from_secs(30), receive).await {
        Ok(Ok(value)) => value,
        _ => {
            json!({"ok":false,"code":"timeout","error":"请求超时或界面已重载。操作可能已执行，请先查询状态；长任务请使用 agent run / tools run。"})
        }
    }
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let state = CliState::default();
    app.manage(state.clone());
    let dir = directory()?;
    private_directory(&dir)?;
    // 不覆盖仍在运行的实例所持有的控制接口，包括其他软件版本的实例。
    if let Ok(old) = read_endpoint() {
        if request_with_timeout(&old, "status", json!({}), Duration::from_secs(1)).is_ok() {
            return Ok(());
        }
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let token_filter = token.clone();
    let port = Arc::new(std::sync::atomic::AtomicU16::new(0));
    let filter_port = port.clone();
    let handle = app.clone();
    let routes = warp::path("rpc")
        .and(warp::path::end())
        .and(warp::post())
        .and(warp::header::headers_cloned())
        .and(warp::body::content_length_limit(MAX_BODY as u64))
        .and(warp::body::bytes())
        .and_then(move |headers: HeaderMap, body: bytes::Bytes| {
            let app = handle.clone();
            let state = state.clone();
            let token = token_filter.clone();
            let port = filter_port.load(std::sync::atomic::Ordering::Acquire);
            async move {
                let (value, status) = if !allowed(&headers, port, &token) {
                    (
                        json!({"ok":false,"error":"forbidden"}),
                        StatusCode::FORBIDDEN,
                    )
                } else if let Ok(call) = serde_json::from_slice::<Call>(&body) {
                    (dispatch(call, state, app).await, StatusCode::OK)
                } else {
                    (
                        json!({"ok":false,"error":"invalid_request"}),
                        StatusCode::BAD_REQUEST,
                    )
                };
                Ok::<_, std::convert::Infallible>(
                    warp::reply::with_status(warp::reply::json(&value), status).into_response(),
                )
            }
        });
    let (address, server) = warp::serve(routes)
        .try_bind_ephemeral(([127, 0, 0, 1], 0))
        .map_err(|_| "无法绑定 CLI 本机接口")?;
    port.store(address.port(), std::sync::atomic::Ordering::Release);
    let endpoint = Endpoint {
        version: 1,
        port: address.port(),
        token,
        pid: std::process::id(),
    };
    let target = dir.join("endpoint.json");
    if target.exists() {
        fs::remove_file(&target).map_err(|_| "无法更新 CLI 连接文件")?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&target).map_err(|_| "无法创建 CLI 连接文件")?;
    file.write_all(&serde_json::to_vec(&endpoint).map_err(|_| "无法序列化 CLI 连接文件")?)
        .map_err(|_| "无法写入 CLI 连接文件")?;
    file.sync_all().map_err(|_| "无法保存 CLI 连接文件")?;
    tauri::async_runtime::spawn(server);
    // 后台更新不占用模型请求和 CLI 前台调用；仅处理用户已安装、
    // 已登记自动更新且没有本地修改的技能。
    tauri::async_runtime::spawn(async {
        loop {
            let _ =
                tauri::async_runtime::spawn_blocking(super::client::skills::sync_registered).await;
            tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cli_connect(
    webview: tauri::Webview,
    state: tauri::State<CliState>,
) -> Result<Value, String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let mut inner = state.0.lock();
    // 界面重载时取消排队任务，避免在新一代界面中重放写入操作。
    for (_, p) in inner.pending.drain() {
        let _=p.send.send(json!({"ok":false,"code":"app_reloaded","error":"主界面已重载；请先查询状态再决定是否重试"}));
    }
    let generation = uuid::Uuid::new_v4().to_string();
    inner.generation = Some(generation.clone());
    Ok(json!({"generation":generation}))
}

#[tauri::command]
pub fn cli_take(
    webview: tauri::Webview,
    state: tauri::State<CliState>,
    id: String,
    generation: String,
) -> Result<Option<Call>, String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let mut inner = state.0.lock();
    if inner.generation.as_deref() != Some(&generation) {
        return Err("CLI 界面连接已失效".into());
    }
    let Some(pending) = inner.pending.get_mut(&id) else {
        return Ok(None);
    };
    if pending.delivered {
        return Ok(None);
    }
    pending.delivered = true;
    Ok(Some(pending.request.clone()))
}

#[tauri::command]
pub fn cli_request_active(
    webview: tauri::Webview,
    state: tauri::State<CliState>,
    id: String,
    generation: String,
) -> Result<bool, String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let inner = state.0.lock();
    Ok(inner.generation.as_deref() == Some(&generation)
        && inner.pending.get(&id).map(|pending| pending.delivered) == Some(true))
}

#[tauri::command]
pub async fn cli_complete(
    webview: tauri::Webview,
    state: tauri::State<'_, CliState>,
    id: String,
    generation: String,
    result: Value,
) -> Result<(), String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let result=tauri::async_runtime::spawn_blocking(move || crate::secret_vault::redact(result)).await
        .ok().and_then(Result::ok).unwrap_or_else(||json!({"ok":false,"code":"secure_store_locked","error":"安全存储未解锁，无法安全返回结果；请先在软件中恢复凭据存储"}));
    let result = if serde_json::to_vec(&result)
        .map(|s| s.len())
        .unwrap_or(MAX_BODY + 1)
        > MAX_BODY
    {
        json!({"ok":false,"code":"response_too_large","error":"返回内容超过 2 MiB，请使用分页查询"})
    } else {
        result
    };
    let mut inner = state.0.lock();
    if inner.generation.as_deref() != Some(&generation) {
        return Err("CLI 界面连接已失效".into());
    }
    if inner.pending.get(&id).map(|p| p.delivered) != Some(true) {
        return Ok(());
    }
    if let Some(pending) = inner.pending.remove(&id) {
        let _ = pending.send.send(result);
    }
    Ok(())
}

#[tauri::command]
pub async fn cli_install(webview: tauri::Webview) -> Result<Value, String> {
    crate::secret_vault::trusted_webview(&webview)?;
    tauri::async_runtime::spawn_blocking(super::client::install)
        .await
        .map_err(|_| "CLI 安装未完成")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_authenticated_non_browser_requests() {
        let mut h = HeaderMap::new();
        h.insert("host", "127.0.0.1:1234".parse().unwrap());
        h.insert("authorization", "Bearer token".parse().unwrap());
        h.insert("content-type", "application/json".parse().unwrap());
        assert!(allowed(&h, 1234, "token"));
        assert!(!allowed(&h, 1234, "wrong"));
        assert!(!allowed(&h, 1235, "token"));
        h.insert("origin", "http://localhost".parse().unwrap());
        assert!(!allowed(&h, 1234, "token"));
        h.remove("origin");
        h.insert("sec-fetch-site", "none".parse().unwrap());
        assert!(!allowed(&h, 1234, "token"));
        h.remove("sec-fetch-site");
        h.insert("host", "attacker.example".parse().unwrap());
        assert!(!allowed(&h, 1234, "token"));
    }
    #[test]
    fn cancelled_request_is_removed() {
        let state = CliState::default();
        let (send, _receive) = oneshot::channel();
        state.0.lock().pending.insert(
            "a".into(),
            Pending {
                request: Call {
                    method: "status".into(),
                    params: json!({}),
                },
                delivered: false,
                send,
            },
        );
        {
            let _guard = PendingGuard {
                id: "a".into(),
                state: state.clone(),
            };
        }
        assert!(state.0.lock().pending.is_empty());
    }
}
