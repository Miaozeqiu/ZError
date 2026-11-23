//! interaction implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn virtual_mouse_script(kind: &str, x: f64, y: f64, label: &str) -> String {
  let kind = serde_json::to_string(kind).unwrap_or_else(|_| "\"click\"".into());
  let label = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".into());
  format!(
    "(function(){{\n{VIRTUAL_MOUSE}\n  var x = {x};\n  var y = {y};\n  __zeEnsureMouse().act({kind}, x, y, {label});\n  return true;\n}})()"
  )
}

pub(super) fn virtual_mouse_enabled() -> bool {
  match std::env::var("ZERROR_VIRTUAL_MOUSE") {
    Ok(value) if value == "0" || value.eq_ignore_ascii_case("false") => false,
    Ok(value) if value == "1" || value.eq_ignore_ascii_case("true") => true,
    _ => cfg!(debug_assertions),
  }
}

pub(super) async fn show_virtual_mouse(
  conn: &CdpConn,
  session: Option<&str>,
  kind: &str,
  x: f64,
  y: f64,
  label: &str,
) {
  if !virtual_mouse_enabled() {
    return;
  }
  let _ = conn
    .evaluate(&virtual_mouse_script(kind, x, y, label), session)
    .await;
}

/// Playwright 式真实点击：先在顶层画出虚拟鼠标，再按下 / 抬起。
/// x/y 是顶层 page 视口 CSS 像素（与 getBoundingClientRect 换算到 top 后一致）。
/// 指针本身 pointer-events:none，点下去时不要藏，藏了再画经常在 iframe 里超时，之后就再也出不来。
pub(super) async fn click_point(
  conn: &CdpConn,
  x: f64,
  y: f64,
  session: Option<&str>,
  label: &str,
  button: &str,
  click_count: i64,
) -> Result<(), String> {
  let kind = if button == "right" {
    "right"
  } else if click_count >= 2 {
    "dblclick"
  } else {
    "click"
  };
  show_virtual_mouse(conn, None, kind, x, y, label).await;
  tokio::time::sleep(std::time::Duration::from_millis(240)).await;
  dispatch_click(conn, x, y, session, button, click_count).await
}

/// 只发 CDP 鼠标，不往页里画虚拟指针。
pub(crate) async fn dispatch_click(
  conn: &CdpConn,
  x: f64,
  y: f64,
  session: Option<&str>,
  button: &str,
  click_count: i64,
) -> Result<(), String> {
  let btn = if button == "right" { "right" } else { "left" };
  let down = if btn == "right" { 2 } else { 1 };
  let ev = |ty: &str, button: &str, buttons: u32, count: i64| {
    json!({
      "type": ty,
      "x": x,
      "y": y,
      "button": button,
      "buttons": buttons,
      "clickCount": count,
      "pointerType": "mouse",
    })
  };
  conn.call("Input.dispatchMouseEvent", ev("mouseMoved", "none", 0, 1), session).await?;
  tokio::time::sleep(std::time::Duration::from_millis(16)).await;
  let times = if click_count >= 2 { 2 } else { 1 };
  for count in 1..=times {
    conn.call("Input.dispatchMouseEvent", ev("mousePressed", btn, down, count), session).await?;
    tokio::time::sleep(std::time::Duration::from_millis(24)).await;
    // mouseReleased 的回执要等渲染进程把 click 处理完。目录点节名会同步改 location，
    // 顶层文档开始卸载，回执常常迟到甚至不来；事件本身早已送达，超时不算失败。
    match conn
      .call_ms("Input.dispatchMouseEvent", ev("mouseReleased", btn, 0, count), session, 1500)
      .await
    {
      Ok(_) => {}
      Err(e) if e.contains("超时") => {
        eprintln!("[cef] mouseReleased 回执超时，按已送达处理 ({x:.0},{y:.0})");
      }
      Err(e) => return Err(e),
    }
    if count < times {
      tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
  }
  Ok(())
}

pub(super) async fn key_event(
  conn: &CdpConn,
  session: Option<&str>,
  ty: &str,
  key: &str,
  code: &str,
  modifiers: u32,
  vk: i64,
) -> Result<(), String> {
  conn
    .call(
      "Input.dispatchKeyEvent",
      json!({
        "type": ty,
        "key": key,
        "code": code,
        "windowsVirtualKeyCode": vk,
        "nativeVirtualKeyCode": vk,
        "modifiers": modifiers,
      }),
      session,
    )
    .await
    .map(|_| ())
}

pub(super) async fn select_all(conn: &CdpConn, session: Option<&str>) -> Result<(), String> {
  // macOS：Command+A
  key_event(conn, session, "keyDown", "a", "KeyA", 4, 65).await?;
  key_event(conn, session, "keyUp", "a", "KeyA", 4, 65).await?;
  Ok(())
}

pub(super) async fn type_focused(conn: &CdpConn, session: Option<&str>, text: &str) -> Result<(), String> {
  select_all(conn, session).await.ok();
  conn
    .call("Input.insertText", json!({ "text": text }), session)
    .await
    .map(|_| ())
}

pub(crate) fn is_child_target(t: &Value, main_tid: &str, _main_url: &str) -> bool {
  let ty = t.get("type").and_then(|v| v.as_str()).unwrap_or("");
  if ty != "iframe" && ty != "page" {
    return false;
  }
  let tid = t.get("targetId").and_then(|v| v.as_str()).unwrap_or("");
  if tid.is_empty() || (!main_tid.is_empty() && tid == main_tid) {
    return false;
  }
  let url = t.get("url").and_then(|v| v.as_str()).unwrap_or("");
  if url.starts_with("devtools://")
    || url.starts_with("chrome-extension://")
    || url.contains("browser-home.html")
    || url.starts_with("zerror://")
  {
    return false;
  }
  // 只认 iframe。type=page 的其它文档是别的标签 / 导航残留，
  // 混进 snapshot 会把学习通目录塞进之江在线登录页，Agent 拿章节按钮当输入框填。
  ty == "iframe"
}

pub(super) fn box_score(v: &Value) -> i32 {
  let has_point = v.get("x").and_then(|x| x.as_f64()).is_some()
    && v.get("y").and_then(|x| x.as_f64()).is_some();
  if !has_point {
    return -1;
  }
  let exact = i32::from(v.get("exact").and_then(|x| x.as_bool()).unwrap_or(false));
  let area = v.get("area").and_then(|x| x.as_f64()).unwrap_or(20_000.0);
  let area_score = if area < 2_000.0 {
    20
  } else if area < 20_000.0 {
    10
  } else {
    0
  };
  exact * 50 + area_score
}

pub(super) fn click_session_for_box(page: &PageBind, boxv: &Value, found: Option<String>) -> Option<String> {
  match boxv.get("space").and_then(|v| v.as_str()) {
    Some("frame") => found,
    _ => page.session.clone(),
  }
}

pub(super) fn fail_rank(v: &Value) -> i32 {
  match v.get("reason").and_then(|x| x.as_str()) {
    Some("ambiguous") => 50,
    Some("disabled") => 40,
    Some("readonly") => 35,
    Some("covered") => 25,
    Some("hidden") => 20,
    Some("unstable") => 15,
    Some("not_found") => 2,
    Some("invalid") => 1,
    _ => 0,
  }
}

pub(super) fn consider_locate(v: Value, best_hit: &mut (Value, i32), best_fail: &mut (Value, i32)) {
  let score = box_score(&v);
  if score > best_hit.1 {
    *best_hit = (v, score);
    return;
  }
  if score < 0 {
    let rank = fail_rank(&v);
    if rank > best_fail.1 {
      *best_fail = (v, rank);
    }
  }
}

pub(super) async fn locate_in_frames(page: &PageBind, expr: &str) -> Value {
  let mut best_hit = (Value::Null, -1);
  let mut best_fail = (
    json!({ "ok": false, "reason": "not_found", "retry": true, "error": "没有找到元素" }),
    0,
  );
  if let Ok(v) = page.conn.evaluate(expr, page.session.as_deref()).await {
    consider_locate(v, &mut best_hit, &mut best_fail);
  }
  // 顶层没点到就返回。不要再 attach 每个 iframe 重跑定位脚本。
  if best_hit.1 >= 0 {
    let mut out = best_hit.0;
    if let Some(obj) = out.as_object_mut() {
      obj.insert("ok".into(), json!(true));
    }
    return out;
  }
  best_fail.0
}

pub async fn cdp_locate(_app: AppHandle, id: String, script: String) -> Result<Value, String> {
  let script = script.trim();
  if script.is_empty() {
    return Ok(json!({
      "ok": false,
      "reason": "invalid",
      "retry": false,
      "error": "缺少定位脚本"
    }));
  }
  let page = bind_page(&id).await?;
  Ok(locate_in_frames(&page, script).await)
}

pub(super) async fn find_box_in_frames(page: &PageBind, expr: &str) -> (Value, Option<String>) {
  let best = page.conn.evaluate(expr, page.session.as_deref()).await.unwrap_or(Value::Null);
  // 学习通 locate 已从顶层 walk 同源 iframe，并回 page 坐标。
  // 没点到也不要 attach 20+ 子 target：切章时页面正在重载，每个 iframe 再跑一遍会卡死整窗。
  let session = click_session_for_box(page, &best, page.session.clone());
  (best, session)
}

pub(super) fn miss(error: String) -> CdpActResult {
  CdpActResult {
    ok: false,
    error: Some(error),
    text: None,
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  }
}

pub(super) fn compact_label(raw: &str) -> String {
  raw.chars().filter(|c| !c.is_whitespace()).collect()
}

pub(super) fn is_student_tab(raw: &str) -> bool {
  let c = compact_label(raw);
  c == "我学的课" || c == "已学的课"
}

pub(super) fn click_label_matches(want: &str, label: &str) -> bool {
  let a = compact_label(want);
  let b = compact_label(label);
  if a.is_empty() || b.is_empty() {
    return false;
  }
  if b.contains("删除") && !a.contains("删除") {
    return false;
  }
  if is_student_tab(&a) && is_student_tab(&b) {
    return true;
  }
  b == a || b.starts_with(&a)
}

pub(super) fn looks_like_selector(raw: &str) -> bool {
  let t = raw.trim();
  t.starts_with('#') || t.starts_with('.') || t.starts_with('[') || t.contains('>') || t.contains(':')
}

pub(super) async fn click_found(
  conn: &CdpConn,
  boxv: Value,
  session: Option<String>,
  fallback: &str,
  verify_label: bool,
  button: &str,
  click_count: i64,
) -> Result<CdpActResult, String> {
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let label = boxv
    .get("text")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let Some((x, y)) = x.zip(y) else {
    return Ok(miss(format!("没有找到「{fallback}」")));
  };
  if verify_label && !looks_like_selector(fallback) && !label.is_empty() && !click_label_matches(fallback, &label) {
    return Ok(miss(format!("点到的是「{label}」，不是「{fallback}」")));
  }
  click_point(conn, x, y, session.as_deref(), &label, button, click_count).await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: Some(if label.is_empty() { fallback.to_string() } else { label }),
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub async fn cdp_click_text(_app: AppHandle, id: String, text: String) -> Result<CdpActResult, String> {
  cdp_click(_app, id, Some(text), None).await
}

pub async fn cdp_click(
  _app: AppHandle,
  id: String,
  text: Option<String>,
  selector: Option<String>,
) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let (expr, label) = if let Some(sel) = selector.as_deref().filter(|s| !s.is_empty()) {
    (
      FIND_SEL.replace("__SEL__", &serde_json::to_string(sel).unwrap_or_else(|_| "\"\"".into())),
      sel.to_string(),
    )
  } else {
    let want = text.unwrap_or_default();
    if want.trim().is_empty() {
      return Ok(miss("缺少点击目标".into()));
    }
    (
      FIND_CLICK.replace("__WANT__", &serde_json::to_string(&want).unwrap_or_else(|_| "\"\"".into())),
      want,
    )
  };
  let (boxv, session) = find_box_in_frames(&page, &expr).await;
  click_found(&page.conn, boxv, session, &label, selector.is_none(), "left", 1).await
}

pub async fn cdp_fill(_app: AppHandle, id: String, selector: String, text: String) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let expr = FIND_SEL.replace("__SEL__", &serde_json::to_string(&selector).unwrap_or_else(|_| "\"\"".into()));
  let (boxv, session) = find_box_in_frames(&page, &expr).await;
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let Some((x, y)) = x.zip(y) else {
    return Ok(CdpActResult {
      ok: false,
      error: Some("没有找到输入框".into()),
      text: None,
      snapshot: None,
      filled: Some(false),
      length: Some(0),
      hint: None,
    });
  };
  click_point(&page.conn, x, y, session.as_deref(), "输入", "left", 1).await?;
  type_focused(&page.conn, session.as_deref(), &text).await?;
  tokio::time::sleep(std::time::Duration::from_millis(80)).await;
  let check = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return {filled:false,length:0}; var got=el.isContentEditable?String(el.textContent||''):String(el.value||''); return {filled:got.length>0,length:got.length}; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "filled": false, "length": 0 }));
  let filled = check.get("filled").and_then(|v| v.as_bool()).unwrap_or(false);
  let length = check.get("length").and_then(|v| v.as_i64()).unwrap_or(0);
  Ok(CdpActResult {
    ok: filled,
    error: if filled { None } else { Some("输入框还是空的，页面没吃到这次填写".into()) },
    text: if filled { Some(text) } else { None },
    snapshot: None,
    filled: Some(filled),
    length: Some(length),
    hint: None,
  })
}

pub async fn cdp_click_box(
  _app: AppHandle,
  id: String,
  script: String,
  button: Option<String>,
  click_count: Option<i64>,
) -> Result<CdpActResult, String> {
  let script = script.trim();
  if script.is_empty() {
    return Ok(miss("缺少定位脚本".into()));
  }
  let page = bind_page(&id).await?;
  let (boxv, session) = find_box_in_frames(&page, script).await;
  let btn = if button.as_deref() == Some("right") { "right" } else { "left" };
  let count = click_count.unwrap_or(1).clamp(1, 2);
  click_found(&page.conn, boxv, session, "目标", false, btn, count).await
}

pub async fn cdp_fill_box(
  _app: AppHandle,
  id: String,
  script: String,
  text: String,
) -> Result<CdpActResult, String> {
  let script = script.trim();
  if script.is_empty() {
    return Ok(miss("缺少定位脚本".into()));
  }
  let page = bind_page(&id).await?;
  let (boxv, session) = find_box_in_frames(&page, script).await;
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let Some((x, y)) = x.zip(y) else {
    return Ok(CdpActResult {
      ok: false,
      error: Some("没有找到输入框".into()),
      text: None,
      snapshot: None,
      filled: Some(false),
      length: Some(0),
      hint: None,
    });
  };
  click_point(&page.conn, x, y, session.as_deref(), "输入", "left", 1).await?;
  tokio::time::sleep(std::time::Duration::from_millis(40)).await;
  type_focused(&page.conn, session.as_deref(), &text).await?;
  tokio::time::sleep(std::time::Duration::from_millis(80)).await;
  let check = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return {filled:false,length:0}; var got=el.isContentEditable?String(el.textContent||''):String(el.value||''); return {filled:got.length>0,length:got.length}; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "filled": false, "length": 0 }));
  let filled = check.get("filled").and_then(|v| v.as_bool()).unwrap_or(false);
  let length = check.get("length").and_then(|v| v.as_i64()).unwrap_or(0);
  Ok(CdpActResult {
    ok: filled,
    error: if filled { None } else { Some("输入框还是空的，页面没吃到这次填写".into()) },
    text: if filled { Some(text) } else { None },
    snapshot: None,
    filled: Some(filled),
    length: Some(length),
    hint: None,
  })
}

pub async fn cdp_hover(
  _app: AppHandle,
  id: String,
  text: Option<String>,
  selector: Option<String>,
) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let (expr, label) = if let Some(sel) = selector.as_deref().filter(|s| !s.is_empty()) {
    (
      FIND_SEL.replace("__SEL__", &serde_json::to_string(sel).unwrap_or_else(|_| "\"\"".into())),
      sel.to_string(),
    )
  } else {
    let want = text.unwrap_or_default();
    if want.trim().is_empty() {
      return Ok(miss("缺少悬停目标".into()));
    }
    (
      FIND_CLICK.replace("__WANT__", &serde_json::to_string(&want).unwrap_or_else(|_| "\"\"".into())),
      want,
    )
  };
  let (boxv, session) = find_box_in_frames(&page, &expr).await;
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let Some((x, y)) = x.zip(y) else {
    return Ok(miss(format!("没有找到「{label}」")));
  };
  show_virtual_mouse(&page.conn, None, "move", x, y, &label).await;
  page.conn
    .call(
      "Input.dispatchMouseEvent",
      json!({
        "type": "mouseMoved",
        "x": x,
        "y": y,
        "button": "none",
        "buttons": 0,
        "pointerType": "mouse",
      }),
      session.as_deref(),
    )
    .await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: Some(label),
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub async fn cdp_scroll(_app: AppHandle, id: String, amount: f64) -> Result<CdpActResult, String> {
  let (conn, session) = page_session(&id).await?;
  let pos = conn
    .evaluate(
      "(function(){ return { x: Math.floor((window.innerWidth||800)/2), y: Math.floor((window.innerHeight||600)/2) }; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "x": 400, "y": 300 }));
  let x = pos.get("x").and_then(|v| v.as_f64()).unwrap_or(400.0);
  let y = pos.get("y").and_then(|v| v.as_f64()).unwrap_or(300.0);
  show_virtual_mouse(&conn, None, "scroll", x, y, "滚动").await;
  conn
    .call(
      "Input.dispatchMouseEvent",
      json!({
        "type": "mouseWheel",
        "x": x,
        "y": y,
        "deltaX": 0,
        "deltaY": amount,
        "pointerType": "mouse",
      }),
      session.as_deref(),
    )
    .await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: None,
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub(super) fn key_spec(raw: &str) -> Option<(&'static str, &'static str, i64)> {
  Some(match raw {
    "Enter" | "Return" => ("Enter", "Enter", 13),
    "Tab" => ("Tab", "Tab", 9),
    "Escape" | "Esc" => ("Escape", "Escape", 27),
    "Backspace" => ("Backspace", "Backspace", 8),
    "Delete" => ("Delete", "Delete", 46),
    "ArrowUp" | "Up" => ("ArrowUp", "ArrowUp", 38),
    "ArrowDown" | "Down" => ("ArrowDown", "ArrowDown", 40),
    "ArrowLeft" | "Left" => ("ArrowLeft", "ArrowLeft", 37),
    "ArrowRight" | "Right" => ("ArrowRight", "ArrowRight", 39),
    "Space" | " " => (" ", "Space", 32),
    _ => return None,
  })
}

pub async fn cdp_press(_app: AppHandle, id: String, key: String) -> Result<CdpActResult, String> {
  let (conn, session) = page_session(&id).await?;
  let Some((name, code, vk)) = key_spec(key.trim()) else {
    return Ok(miss(format!("还不支持按「{key}」")));
  };
  key_event(&conn, session.as_deref(), "keyDown", name, code, 0, vk).await?;
  key_event(&conn, session.as_deref(), "keyUp", name, code, 0, vk).await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: Some(key),
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub async fn cdp_focus_node(
  _app: AppHandle,
  id: String,
  backend: i64,
  session: Option<String>,
) -> Result<CdpActResult, String> {
  if backend <= 0 {
    return Ok(miss("缺少 backendNodeId".into()));
  }
  let page = bind_page(&id).await?;
  let sid = session
    .filter(|s| !s.is_empty())
    .or_else(|| page.session.clone());
  let _ = page.conn.call("DOM.enable", json!({}), sid.as_deref()).await;
  page.conn
    .call("DOM.focus", json!({ "backendNodeId": backend }), sid.as_deref())
    .await
    .map_err(|err| {
      if crate::cdp_client::is_session_dead(&err) {
        crate::cdp_client::HOST_CHANNEL_DOWN.to_string()
      } else {
        format!("聚焦失败: {err}")
      }
    })?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: None,
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub(crate) async fn click_landed_elsewhere(
  conn: &CdpConn, session: Option<&str>, backend: i64, _x: f64, _y: f64,
) -> Option<String> {
  let result: Result<Option<String>, String> = async {
    let resolved = conn.call("DOM.resolveNode", json!({"backendNodeId":backend}), session).await?;
    let object = resolved.pointer("/object/objectId").and_then(Value::as_str).ok_or("目标节点已失效")?;
    let probe = conn.call("Runtime.callFunctionOn", json!({
      "objectId": object, "returnByValue": true,
      "functionDeclaration": r#"function(){
        var el=this.nodeType===3?this.parentElement:this;
        if(!el || !el.isConnected) return '目标节点已失效';
        var r=el.getBoundingClientRect(), doc=el.ownerDocument;
        if(r.width<2 || r.height<2) return '目标元素不可见';
        var hit=doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        if(!hit || !(hit===el || el.contains(hit))) return '真实落点被 '+(hit?hit.tagName.toLowerCase():'视口外区域')+' 遮挡';
        // 同源嵌套 frame 的上层遮罩也必须检查。
        var win=doc.defaultView;
        try {
          while(win && win.frameElement){
            var frame=win.frameElement, box=frame.getBoundingClientRect();
            var sx=box.width/(frame.offsetWidth||box.width), sy=box.height/(frame.offsetHeight||box.height);
            var x=box.left+(r.left+r.width/2+frame.clientLeft)*sx;
            var y=box.top+(r.top+r.height/2+frame.clientTop)*sy;
            var outer=frame.ownerDocument.elementFromPoint(x,y);
            if(outer!==frame && !frame.contains(outer)) return 'iframe 上层存在遮挡';
            r={left:x,top:y,width:0,height:0}; win=frame.ownerDocument.defaultView;
          }
        }catch(e){}
        return null;
      }"#
    }), session).await;
    let _ = conn.call("Runtime.releaseObject", json!({"objectId":object}), session).await;
    let value = probe?;
    if value.get("exceptionDetails").is_some() { return Err("落点验证脚本失败".into()); }
    Ok(value.pointer("/result/value").and_then(Value::as_str).map(str::to_string))
  }.await;
  match result { Ok(blocked) => blocked, Err(error) => Some(format!("无法验证点击目标：{error}")) }
}

pub(crate) async fn visible_control_backend(conn: &CdpConn, session: Option<&str>, backend: i64) -> Result<i64, String> {
  let resolved=conn.call("DOM.resolveNode", json!({"backendNodeId":backend}), session).await?;
  let object=resolved.pointer("/object/objectId").and_then(Value::as_str).ok_or("目标节点已失效")?;
  let result=conn.call("Runtime.callFunctionOn", json!({
    "objectId":object,
    "functionDeclaration":r#"function(){
      var el=this.nodeType===3?this.parentElement:this;
      if(!el) return this;
      var label=el.closest && el.closest('label');
      if(!label && el.labels) label=Array.from(el.labels).find(function(l){var r=l.getBoundingClientRect();return r.width>1&&r.height>1;});
      var role=el.getAttribute && el.getAttribute('role');
      if(!label && (role==='checkbox' || role==='radio') && el.querySelectorAll){
        var controls=el.querySelectorAll('input[type=checkbox],input[type=radio]');
        if(controls.length===1) label=controls[0].closest('label');
      }
      // A link/button/row may contain a checkbox for selection or completion.
      // Only an explicit checkable role may delegate to a descendant label.
      if(label && (label.control && /^(checkbox|radio)$/.test(label.control.type) || label.querySelector('input[type=checkbox],input[type=radio]'))) return label;
      return el;
    }"#
  }),session).await;
  let value=match result { Ok(value)=>value, Err(error)=>{let _=conn.call("Runtime.releaseObject",json!({"objectId":object}),session).await;return Err(error);} };
  let next=value.pointer("/result/objectId").and_then(Value::as_str);
  let described=if let Some(next)=next {conn.call("DOM.describeNode",json!({"objectId":next}),session).await} else {Err("可见点击节点不存在".into())};
  if let Some(next)=next {if next!=object {let _=conn.call("Runtime.releaseObject",json!({"objectId":next}),session).await;}}
  let _=conn.call("Runtime.releaseObject",json!({"objectId":object}),session).await;
  described?.pointer("/node/backendNodeId").and_then(Value::as_i64).ok_or_else(||"点击节点身份不可用".into())
}

pub(super) async fn check_node_state(page: &PageBind, backend: i64, session: Option<&str>) -> Result<Value, String> {
  let resolved = page.conn.call("DOM.resolveNode", json!({ "backendNodeId": backend }), session).await?;
  let object = resolved.pointer("/object/objectId").and_then(Value::as_str).ok_or("选项节点已失效")?;
  let result = page.conn.call("Runtime.callFunctionOn", json!({
    "objectId": object, "returnByValue": true,
    "functionDeclaration": r#"function(){
      var el=this, input=null;
      if(el.matches && el.matches('input[type=checkbox],input[type=radio]')) input=el;
      else if(el.control && /^(checkbox|radio)$/.test(el.control.type)) input=el.control;
      var role=el.getAttribute && el.getAttribute('role');
      // Only explicit custom controls may delegate state to an inner input.
      // A chapter link or course card containing one checkbox is still a link/card.
      if(!input && (role==='checkbox' || role==='radio') && el.querySelectorAll){
        var controls=el.querySelectorAll('input[type=checkbox],input[type=radio]');
        if(controls.length>1) return {supported:false};
        input=controls[0]||null;
      }
      var kind=input?input.type:role;
      if(kind!=='checkbox' && kind!=='radio') return {supported:false};
      var state=input?!!input.checked:el.getAttribute('aria-checked');
      if(!input && state!=='true' && state!=='false') return {supported:false};
      return {supported:true,kind:kind,connected:!!el.isConnected,
        checked:input?state:state==='true', disabled:input?input.disabled:el.getAttribute('aria-disabled')==='true'};
    }"#
  }), session).await;
  let _ = page.conn.call("Runtime.releaseObject", json!({ "objectId": object }), session).await;
  let value = result?;
  if value.get("exceptionDetails").is_some() { return Err("读取选项状态失败，请重新读取页面".into()); }
  value.pointer("/result/value").cloned().ok_or_else(|| "读取选项状态失败".into())
}

pub(super) async fn wait_checked(page: &PageBind, backend: i64, session: Option<&str>, checked: bool) -> Result<bool, String> {
  let started = std::time::Instant::now();
  let mut confirmed = 0;
  loop {
    let state = check_node_state(page, backend, session).await?;
    if state["connected"] != true { return Err("选项节点已替换，请重新读取页面后确认".into()); }
    if state["checked"].as_bool() == Some(checked) { confirmed += 1; } else { confirmed = 0; }
    if confirmed >= 2 { return Ok(true); }
    if started.elapsed() >= std::time::Duration::from_millis(1500) { return Ok(false); }
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
  }
}

pub async fn cdp_set_checked(app: AppHandle, id: String, backend: i64, session: Option<String>, checked: bool) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let sid = session.or_else(|| page.session.clone());
  let state = check_node_state(&page, backend, sid.as_deref()).await?;
  if state["supported"] != true || state["connected"] != true { return Ok(json!({"ok":false,"error":"目标不是可读取状态的复选框或单选框"})); }
  if state["checked"].as_bool() == Some(checked) { return Ok(json!({"ok":true,"checked":checked,"already":true})); }
  if state["disabled"] == true { return Ok(json!({"ok":false,"error":"选项已禁用"})); }
  if state["kind"] == "radio" && !checked { return Ok(json!({"ok":false,"error":"单选项不能直接取消，请选择同组另一项"})); }
  let result = cdp_click_node(app, id, backend, sid.clone(), None, None).await?;
  if !result.ok { return Ok(json!({"ok":false,"error":result.error})); }
  let ok = wait_checked(&page, backend, sid.as_deref(), checked).await?;
  Ok(json!({"ok":ok,"checked":if ok {Some(checked)} else {None},"error":if ok {None} else {Some("点击后未达到预期选中状态，请重新读取页面确认，不要盲目重复点击")} }))
}

pub async fn cdp_click_node(
  _app: AppHandle,
  id: String,
  backend: i64,
  session: Option<String>,
  button: Option<String>,
  click_count: Option<i64>,
) -> Result<CdpActResult, String> {
  if backend <= 0 {
    return Ok(miss("缺少 backendNodeId".into()));
  }
  let page = bind_page(&id).await?;
  let sid = session
    .filter(|s| !s.is_empty())
    .or_else(|| page.session.clone());
  let _ = page.conn.call("DOM.enable", json!({}), sid.as_deref()).await;
  // 定位会把每个同名候选都滚进视野量一遍，选中的那颗可能已经被滚出视口。
  let _ = page
    .conn
    .call("DOM.scrollIntoViewIfNeeded", json!({ "backendNodeId": backend }), sid.as_deref())
    .await;
  // 页面滚动/布局未稳定时不投递鼠标事件，避免点到移动中的其它选项。
  let started = std::time::Instant::now();
  let mut previous: Option<Vec<f64>> = None;
  let nums = loop {
    let model = page.conn.call("DOM.getBoxModel", json!({ "backendNodeId": backend }), sid.as_deref()).await?;
    let nums: Vec<f64> = model.pointer("/model/content").and_then(Value::as_array)
      .map(|quad| quad.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
    if nums.len() != 8 { return Ok(miss("元素没有可点的盒子".into())); }
    if previous.as_ref().is_some_and(|before| before.iter().zip(&nums).all(|(a,b)| (a-b).abs() < 0.5)) { break nums; }
    if started.elapsed() >= std::time::Duration::from_millis(1000) { return Ok(miss("元素位置尚未稳定，请重新定位后再点".into())); }
    previous = Some(nums);
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
  };
  let x = (nums[0] + nums[2] + nums[4] + nums[6]) / 4.0;
  let y = (nums[1] + nums[3] + nums[5] + nums[7]) / 4.0;
  let vis = page
    .conn
    .evaluate("document.visibilityState", sid.as_deref())
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or_default();
  if vis == "hidden" {
    return Ok(miss("浏览器当前不可见，点击不会送达".into()));
  }
  if let Some(cover) = click_landed_elsewhere(&page.conn, sid.as_deref(), backend, x, y).await {
    return Ok(miss(format!("点击没有打进目标，落在了{cover}")));
  }
  let btn = if button.as_deref() == Some("right") { "right" } else { "left" };
  let count = click_count.unwrap_or(1).clamp(1, 2);
  let before = check_node_state(&page, backend, sid.as_deref()).await?;
  dispatch_click(&page.conn, x, y, sid.as_deref(), btn, count).await?;
  if btn == "left" && count == 1 && before["supported"] == true {
    let want = before["kind"] == "radio" || before["checked"] != true;
    if !wait_checked(&page, backend, sid.as_deref(), want).await? {
      return Ok(miss("鼠标事件已发送，但选项状态未改变；请重新读取页面确认".into()));
    }
  }
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: None,
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub async fn cdp_type_focused(_app: AppHandle, id: String, text: String) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let probe = "(function(){ var el=document.activeElement; if(!el) return {ok:false}; var tag=String(el.tagName||'').toLowerCase(); return {ok: tag==='input'||tag==='textarea'||!!el.isContentEditable}; })()";
  let mut session = page.session.clone();
  let focused = page.conn.evaluate(probe, session.as_deref()).await.unwrap_or(Value::Null);
  if focused.get("ok").and_then(|v| v.as_bool()) != Some(true) {
    if let Ok(targets) = page.conn.pages().await {
      for t in targets {
        let Some(tid) = t.get("targetId").and_then(|v| v.as_str()) else { continue };
        if !is_child_target(&t, &page.target_id, &page.url) {
          continue;
        }
        if let Ok(sid) = page.conn.attach(tid).await {
          let _ = page.conn.call("Runtime.enable", json!({}), Some(&sid)).await;
          if let Ok(v) = page.conn.evaluate(probe, Some(&sid)).await {
            if v.get("ok").and_then(|x| x.as_bool()) == Some(true) {
              session = Some(sid);
              break;
            }
          }
        }
      }
    }
  }
  // 先全选：type 的语义是「填成这个」，不是「接着敲」。不选中就会把用户名敲成两遍、密码越敲越长。
  let _ = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return false; try { if (typeof el.select === 'function') { el.select(); return true; } } catch (e) {} try { if (el.isContentEditable) { var r=document.createRange(); r.selectNodeContents(el); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } catch (e2) {} return false; })()",
      session.as_deref(),
    )
    .await;
  type_focused(&page.conn, session.as_deref(), &text).await?;
  tokio::time::sleep(std::time::Duration::from_millis(60)).await;
  let check = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return {filled:false,length:0}; var got=el.isContentEditable?String(el.textContent||''):String(el.value||''); return {filled:got.length>0,length:got.length}; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "filled": false, "length": 0 }));
  let filled = check.get("filled").and_then(|v| v.as_bool()).unwrap_or(false);
  let length = check.get("length").and_then(|v| v.as_i64()).unwrap_or(0);
  Ok(CdpActResult {
    ok: filled,
    error: if filled { None } else { Some("焦点不在输入框，或页面没吃到输入".into()) },
    text: if filled { Some(text) } else { None },
    snapshot: None,
    filled: Some(filled),
    length: Some(length),
    hint: None,
  })
}
