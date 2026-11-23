//! network implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn network_log() -> &'static Mutex<NetworkLog> {
  static LOG: OnceLock<Mutex<NetworkLog>> = OnceLock::new();
  LOG.get_or_init(|| {
    Mutex::new(NetworkLog {
      pump: false,
      last_browser: String::new(),
      owner: HashMap::new(),
      targets: HashMap::new(),
      session_targets: HashMap::new(),
      hits: HashMap::new(),
    })
  })
}

pub(super) fn note_session_target(session: &str, target_id: &str) {
  if session.is_empty() || target_id.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    log.session_targets.insert(session.to_string(), target_id.to_string());
  }
}

pub(crate) fn note_network_session(id: &str, session: &str) {
  if id.is_empty() || session.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    log.owner.insert(session.to_string(), id.to_string());
    log.last_browser = id.to_string();
  }
}

pub(super) fn note_target(id: &str, target_id: &str) {
  if id.is_empty() || target_id.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    log.targets.insert(target_id.to_string(), id.to_string());
  }
}

pub(super) fn owner_of_target(target_id: &str) -> String {
  if target_id.is_empty() {
    return String::new();
  }
  network_log()
    .lock()
    .ok()
    .and_then(|log| log.targets.get(target_id).cloned())
    .unwrap_or_default()
}

pub(super) fn forget_network(id: &str) {
  if let Ok(mut log) = network_log().lock() {
    log.owner.retain(|_, owner| owner != id);
    log.targets.retain(|_, owner| owner != id);
    log.hits.remove(id);
    if log.last_browser == id {
      log.last_browser.clear();
    }
  }
}

/// 只认登记过的 session；对不上再按 session→target→owner 精确反查，仍对不上返回空，不猜。推送归属用这个。
pub(crate) fn owner_of_session_exact(session: &str) -> String {
  if session.is_empty() {
    return String::new();
  }
  let Ok(mut log) = network_log().lock() else {
    return String::new();
  };
  if let Some(owner) = log.owner.get(session) {
    return owner.clone();
  }
  let via_target = log
    .session_targets
    .get(session)
    .and_then(|tid| log.targets.get(tid))
    .cloned()
    .unwrap_or_default();
  if !via_target.is_empty() {
    log.owner.insert(session.to_string(), via_target.clone());
  }
  via_target
}

pub(super) fn push_network_hit(id: &str, hit: NetHit) {
  if id.is_empty() || hit.url.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    let queue = log.hits.entry(id.to_string()).or_default();
    queue.push_back(hit);
    while queue.len() > 80 {
      queue.pop_front();
    }
  }
}

pub(super) fn on_cdp_event(conn: &CdpConn, event: &Value) {
  let method = event.get("method").and_then(|v| v.as_str()).unwrap_or("");
  let params = event.get("params").cloned().unwrap_or(Value::Null);
  if method == "Runtime.bindingCalled" {
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let payload = params.get("payload").and_then(|v| v.as_str()).unwrap_or("");
    let session = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    crate::cef::on_binding_called(session, name, payload);
    return;
  }
  if method == "Target.attachedToTarget" {
    let sid = params
      .get("sessionId")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string();
    if sid.is_empty() {
      return;
    }
    let parent = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    let tid = params
      .get("targetInfo")
      .and_then(|t| t.get("targetId"))
      .and_then(|v| v.as_str())
      .unwrap_or("");
    note_session_target(&sid, tid);
    let mut owner = owner_of_session_exact(parent);
    if owner.is_empty() {
      owner = owner_of_target(tid);
    }
    if !owner.is_empty() {
      note_network_session(&owner, &sid);
      note_target(&owner, tid);
    }
    let conn = conn.clone();
    tokio::spawn(async move {
      let _ = conn.call("Network.enable", json!({}), Some(&sid)).await;
      let _ = conn.call("Page.enable", json!({}), Some(&sid)).await;
    });
    return;
  }
  if method == "Target.detachedFromTarget" {
    let sid = params.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    if let Ok(mut log) = network_log().lock() {
      log.session_targets.remove(sid);
    }
    forget_session(sid);
    return;
  }
  if method == "Target.targetDestroyed" || method == "Target.targetCrashed" {
    let tid = params.get("targetId").and_then(|v| v.as_str()).unwrap_or("");
    forget_by_target(tid);
    return;
  }
  if method == "Page.frameNavigated" || method == "Page.frameStoppedLoading" {
    let url = params
      .get("frame")
      .and_then(|f| f.get("url"))
      .and_then(|v| v.as_str())
      .unwrap_or("");
    let session = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    let owner = owner_of_session_exact(session);
    if !owner.is_empty() {
      // 主框架或 knowledge/cards 换页：上一节的 tick 全作废。
      // 不清的话新一节的空白监测会先吃到旧视频那条「还在播」的缓存，进度条停在旧数字上。
      let is_main = params
        .get("frame")
        .and_then(|f| f.get("parentId"))
        .and_then(|v| v.as_str())
        .map(|p| p.is_empty())
        .unwrap_or(true);
      if method == "Page.frameNavigated" && (is_main || url.contains("/knowledge/cards")) {
        crate::cef::forget(&owner);
      }
      emit_frame(&owner, url);
    }
    return;
  }
  if method != "Network.responseReceived" {
    return;
  }
  let session = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
  let response = params.get("response").cloned().unwrap_or(Value::Null);
  let url = response
    .get("url")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  if url.is_empty() || url.starts_with("data:") || url.starts_with("blob:") {
    return;
  }
  let hit = NetHit {
    url,
    status: response.get("status").and_then(|v| v.as_i64()).unwrap_or(0),
    mime: response
      .get("mimeType")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
    kind: params
      .get("type")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
    method: response
      .get("headers")
      .and_then(|v| v.get("method"))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
    at: std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis() as i64)
      .unwrap_or(0),
  };
  let owner = owner_of_session_exact(session);
  if owner.is_empty() {
    crate::cdp_client::note_unowned();
    return;
  }
  push_network_hit(&owner, hit);
}

pub(super) async fn ensure_event_pump() -> Result<(), String> {
  let conn = ensure_cdp().await?;
  {
    let Ok(mut log) = network_log().lock() else {
      return Err("网络观察锁失败".into());
    };
    if log.pump {
      return Ok(());
    }
    log.pump = true;
  }
  let mut rx = conn.subscribe();
  let pump_conn = conn.clone();
  tokio::spawn(async move {
    loop {
      tokio::select! {
        result = rx.recv() => match result {
          Ok(event) => on_cdp_event(&pump_conn, &event),
          Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
          Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        },
        // CdpConn 自身持有广播 sender，断线时不能仅靠 recv() 返回 Closed。
        _ = tokio::time::sleep(Duration::from_millis(250)) => {
          if !pump_conn.is_alive() { break; }
        }
      }
    }
    // 只由 ensure_cdp 在连接锁内重置断线状态。旧泵退出不能清掉刚建立的新连接。
  });
  Ok(())
}

pub async fn watch_network(id: &str) -> Result<Value, String> {
  ensure_event_pump().await?;
  let page = bind_page(id).await?;
  if let Some(sid) = page.session.as_deref() {
    note_network_session(id, sid);
    let _ = page.conn.call("Network.enable", json!({}), Some(sid)).await;
  }
  Ok(json!({ "ok": true }))
}

pub fn recent_network(id: &str) -> Value {
  let hits = network_log()
    .lock()
    .ok()
    .and_then(|log| log.hits.get(id).cloned())
    .unwrap_or_default();
  json!({
    "ok": true,
    "hits": hits.iter().map(|hit| json!({
      "url": hit.url,
      "status": hit.status,
      "mime": hit.mime,
      "type": hit.kind,
      "method": hit.method,
      "at": hit.at,
    })).collect::<Vec<_>>(),
  })
}
