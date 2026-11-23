//! sessions implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn cef_target_url(app: &AppHandle, raw: &str, parsed: &url::Url) -> Result<String, String> {
  if crate::app_browser::is_home(raw) {
    if cfg!(debug_assertions) {
      return Ok("http://localhost:1420/browser-home.html".into());
    }
    if let Ok(dir) = app.path().resource_dir() {
      let file = dir.join("browser-home.html");
      if file.is_file() {
        return Ok(url::Url::from_file_path(&file)
          .map(|u| u.to_string())
          .unwrap_or_else(|_| parsed.to_string()));
      }
    }
  }
  let out = parsed.to_string();
  if out.starts_with("tauri://") || out.contains("tauri.localhost") {
    return Ok("http://localhost:1420/browser-home.html".into());
  }
  Ok(out)
}

pub(super) fn native_target_result(success: i32, result: &[u8]) -> Result<String, String> {
  let value: Value = serde_json::from_slice(result).map_err(|e| format!("读取原生页面身份失败：{e}"))?;
  if success != 1 {
    return Err(format!("读取原生页面身份失败：{value}"));
  }
  value.get("targetInfo").filter(|t| is_page_target(t))
    .map(target_id_of).filter(|id| !id.is_empty()).map(str::to_string)
    .ok_or_else(|| "原生标签页没有返回有效的 page target".to_string())
}

/// 通过这个 Browser 自身的 DevTools 通道取身份，绝不按 URL 或页面数量猜另一个标签。
pub(super) async fn native_page_target(id: &str) -> Result<String, String> {
  let (bid, known) = registry().lock().map_err(|_| "浏览器注册表不可用".to_string())?
    .tabs.get(id).map(|t| (t.browser_id, t.target_id.clone()))
    .ok_or_else(|| "标签页已关闭，请选择仍然打开的标签页".to_string())?;
  if bid == 0 { return Err("原生标签页尚未创建完成，请稍后重试".into()); }
  if !known.is_empty() { return Ok(known); }
  let app = app_handle().lock().ok().and_then(|h| h.clone())
    .ok_or_else(|| "浏览器尚未初始化".to_string())?;
  let (tx, rx) = tokio::sync::oneshot::channel();
  static NEXT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(1);
  let message_id = NEXT.fetch_add(1, Ordering::Relaxed);
  let registration = on_main(&app, move || -> Result<Registration, String> {
    let host = browser_by_id(bid).and_then(|b| b.host())
      .ok_or_else(|| "原生标签页不可用".to_string())?;
    let mut observer = NativeTargetObserver::new(message_id, Arc::new(Mutex::new(Some(tx))));
    let registration = host.add_dev_tools_message_observer(Some(&mut observer))
      .ok_or_else(|| "无法观察原生页面身份".to_string())?;
    let method = CefString::from("Target.getTargetInfo");
    if host.execute_dev_tools_method(message_id, Some(&method), None) == 0 {
      return Err("无法查询原生页面身份".into());
    }
    Ok(registration)
  })??;
  let result = tokio::time::timeout(Duration::from_secs(3), rx).await
    .map_err(|_| "读取原生页面身份超时".to_string())
    .and_then(|v| v.map_err(|_| "原生页面身份通道已关闭".to_string())).and_then(|v| v);
  on_main(&app, move || drop(registration))?;
  let target = result?;
  let mut reg = registry().lock().map_err(|_| "浏览器注册表不可用".to_string())?;
  let tab = reg.tabs.get_mut(id).filter(|t| t.browser_id == bid)
    .ok_or_else(|| "读取页面身份时标签页已关闭".to_string())?;
  tab.target_id = target.clone();
  Ok(target)
}

pub(super) fn forget_target(id: &str) {
  forget_bind(id);
}

pub(super) fn bind_sessions() -> &'static Mutex<HashMap<String, BindSession>> {
  static MAP: OnceLock<Mutex<HashMap<String, BindSession>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn cached_bind(id: &str) -> Option<BindSession> {
  bind_sessions().lock().ok()?.get(id).cloned()
}

pub(super) fn remember_bind(id: &str, target_id: &str, session: &str) {
  if id.is_empty() || target_id.is_empty() || session.is_empty() {
    return;
  }
  if let Ok(mut map) = bind_sessions().lock() {
    map.retain(|tab, bind| tab == id || bind.target_id != target_id);
    map.insert(
      id.to_string(),
      BindSession {
        target_id: target_id.to_string(),
        session: session.to_string(),
      },
    );
  }
  note_network_session(id, session);
  note_target(id, target_id);
}

pub(super) fn forget_bind(id: &str) {
  if let Ok(mut map) = bind_sessions().lock() {
    map.remove(id);
  }
  forget_network(id);
  crate::cef::forget(id);
}

pub(super) fn is_page_target(t: &Value) -> bool {
  t.get("type").and_then(|x| x.as_str()) == Some("page")
}

pub(super) fn target_id_of(t: &Value) -> &str {
  t.get("targetId").and_then(|v| v.as_str()).unwrap_or("")
}

pub(super) fn target_url_of(t: &Value) -> &str {
  t.get("url").and_then(|v| v.as_str()).unwrap_or("")
}

pub(super) fn session_of_target(target_id: &str) -> String {
  if target_id.is_empty() {
    return String::new();
  }
  network_log()
    .lock()
    .ok()
    .and_then(|log| {
      log
        .session_targets
        .iter()
        .find(|(_, tid)| tid.as_str() == target_id)
        .map(|(sid, _)| sid.clone())
    })
    .unwrap_or_default()
}

pub(super) fn exact_page_target<'a>(pages: &'a [Value], target: &str) -> Option<&'a Value> {
  if target.is_empty() { return None; }
  pages.iter().find(|page| is_page_target(page) && target_id_of(page) == target)
}

pub(super) async fn prepare_background_page(conn: &CdpConn, session: &str, id: &str) -> Result<(), String> {
  if !tab_is_visible(id) {
    // 收起的是原生展示层，不能同时关闭后台 Agent 的输入能力。
    // 使用 Chromium 的逻辑焦点，不显示 NSView、不抢系统窗口焦点；仍受自动化 epoch 检查。
    conn.call("Emulation.setFocusEmulationEnabled", json!({ "enabled": true }), Some(session)).await
      .map_err(|error| format!("激活后台浏览器失败：{error}"))?;
  }
  Ok(())
}

pub(crate) async fn bind_page(id: &str) -> Result<PageBind, String> {
  // 冷绑定串行，防止同一标签的并发快照/推送创建多个会话并互相覆盖缓存。
  static BIND: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
  let _guard = BIND.lock().await;
  let target_id = native_page_target(id).await?;
  let conn = ensure_cdp().await?;
  ensure_event_pump().await?;
  if let Some(cached) = cached_bind(id) {
    if cached.target_id == target_id && !cached.session.is_empty() {
      // detached 事件可能尚未处理；先确认会话确实仍然指向这个原生页面。
      if let Ok(info) = conn.call("Target.getTargetInfo", json!({}), Some(&cached.session)).await {
        if info.get("targetInfo").is_some_and(|t| is_page_target(t) && target_id_of(t) == target_id) {
          let url = target_url_of(&info["targetInfo"]).to_string();
          prepare_background_page(&conn, &cached.session, id).await?;
          return Ok(PageBind { conn, session: Some(cached.session), target_id, url });
        }
      }
    }
    forget_target(id);
  }
  let pages = conn.pages().await.map_err(|e| format!("读取 CDP 页面列表失败：{e}"))?;
  let page = exact_page_target(&pages, &target_id).ok_or_else(|| format!(
    "当前原生标签页暂未出现在 CDP 页面列表中（发现 {} 个页面），请稍后重试",
    pages.iter().filter(|p| is_page_target(p)).count()
  ))?;
  let url = target_url_of(page).to_string();
  let sid = match conn.attach(&target_id).await {
    Ok(sid) => sid,
    Err(error) => {
      let existing = session_of_target(&target_id);
      if existing.is_empty() { return Err(format!("附加当前标签页失败：{error}")); }
      existing
    }
  };
  conn.call("Page.enable", json!({}), Some(&sid)).await
    .map_err(|e| format!("当前标签页会话不可用：{e}"))?;
  conn.call("Runtime.enable", json!({}), Some(&sid)).await
    .map_err(|e| format!("当前标签页脚本通道不可用：{e}"))?;
  prepare_background_page(&conn, &sid, id).await?;
  let h264 = claim_h264_bundle();
  let _ = conn.call("Page.addScriptToEvaluateOnNewDocument", json!({ "source": h264 }), Some(&sid)).await;
  let _ = conn.evaluate(&h264, Some(&sid)).await;
  let _ = crate::cef::install_push(&conn, Some(&sid)).await;
  // 关闭回调可能在 attach 期间到来，不能再给已经关闭的标签留下占用记录。
  if !registry().lock().ok().is_some_and(|r| r.tabs.contains_key(id)) {
    let _ = conn.call("Target.detachFromTarget", json!({ "sessionId": sid }), None).await;
    return Err("绑定期间标签页已关闭".into());
  }
  remember_bind(id, &target_id, &sid);
  Ok(PageBind { conn, session: Some(sid), target_id, url })
}

pub(super) async fn page_session(id: &str) -> Result<(CdpConn, Option<String>), String> {
  let page = bind_page(id).await?;
  Ok((page.conn, page.session))
}

pub(crate) fn reset_cdp_state() {
  if let Ok(mut g) = cdp().lock() {
    *g = None;
  }
  if let Ok(mut map) = bind_sessions().lock() {
    map.clear();
  }
  if let Ok(mut log) = network_log().lock() {
    log.owner.clear();
    log.targets.clear();
    log.session_targets.clear();
    log.last_browser.clear();
    log.pump = false;
  }
  crate::cef::forget_all();
}

pub(super) fn forget_session(session: &str) {
  if session.is_empty() {
    return;
  }
  let page_ids: Vec<String> = bind_sessions()
    .lock()
    .ok()
    .map(|map| {
      map
        .iter()
        .filter(|(_, bind)| bind.session == session)
        .map(|(id, _)| id.clone())
        .collect()
    })
    .unwrap_or_default();
  for id in page_ids {
    forget_bind(&id);
  }
  if let Ok(mut log) = network_log().lock() {
    log.owner.remove(session);
  }
}

pub(super) fn forget_by_target(target_id: &str) {
  if target_id.is_empty() {
    return;
  }
  if let Ok(mut reg) = registry().lock() {
    for tab in reg.tabs.values_mut().filter(|tab| tab.target_id == target_id) {
      tab.target_id.clear();
    }
  }
  let page_ids: Vec<String> = bind_sessions()
    .lock()
    .ok()
    .map(|map| {
      map
        .iter()
        .filter(|(_, bind)| bind.target_id == target_id)
        .map(|(id, _)| id.clone())
        .collect()
    })
    .unwrap_or_default();
  for id in page_ids {
    forget_target(&id);
  }
  if let Ok(mut log) = network_log().lock() {
    log.targets.remove(target_id);
  }
}

pub(super) fn emit_frame(id: &str, url: &str) {
  let Ok(guard) = app_handle().lock() else {
    return;
  };
  let Some(app) = guard.as_ref() else {
    return;
  };
  let _ = app.emit(
    "app-browser-frame",
    json!({ "id": id, "url": url }),
  );
}

pub(super) async fn ensure_cdp() -> Result<CdpConn, String> {
  static CONNECT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
  let _guard = CONNECT.lock().await;
  if let Ok(g) = cdp().lock() {
    if let Some(c) = g.clone() {
      if c.is_alive() {
        return Ok(c);
      }
    }
  }
  reset_cdp_state();
  let port = cef_runtime::debug_port();
  if port <= 0 {
    return Err("CDP 尚未就绪".into());
  }
  let conn = connect_loop(port).await?;
  let _ = conn
    .call(
      "Target.setDiscoverTargets",
      json!({ "discover": true }),
      None,
    )
    .await;
  let _ = conn
    .call(
      "Target.setAutoAttach",
      json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true }),
      None,
    )
    .await;
  if let Ok(mut g) = cdp().lock() {
    *g = Some(conn.clone());
  }
  Ok(conn)
}
