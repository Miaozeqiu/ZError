//! 用 CDP DOM / Accessibility 定位，不往页里跑 locate 脚本。
#![cfg(target_os = "macos")]

use crate::cdp_client::CdpConn;
use crate::cef::{bind_page, dispatch_click, owner_of_session_exact};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[derive(Clone)]
struct Locator {
  by: String,
  value: String,
  name: String,
  exact: bool,
  nth: i64,
  frame: String,
  frame_path: String,
  frame_id: String,
  loader_id: String,
  backend: i64,
}

impl Locator {
  fn from_value(raw: &Value) -> Self {
    Self {
      by: raw.get("by").and_then(|v| v.as_str()).unwrap_or("css").to_string(),
      value: raw.get("value").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      name: raw.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      exact: raw.get("exact").and_then(|v| v.as_bool()).unwrap_or(false),
      nth: raw.get("nth").and_then(|v| v.as_i64()).unwrap_or(0),
      frame: raw.get("frame").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      frame_path: raw.get("framePath").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      frame_id: raw.get("frameId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
      loader_id: raw.get("loaderId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
      backend: raw.get("backend").and_then(Value::as_i64).unwrap_or(0),
    }
  }

  fn sig(&self) -> String {
    format!("{}:{}:{}:{}:{}:{}:{}:{}:{}", self.by, self.value, self.name, self.nth, self.frame, self.frame_path, self.frame_id, self.loader_id, self.backend)
  }
}

fn compact(raw: &str) -> String {
  raw.chars().filter(|c| !c.is_whitespace()).collect()
}

pub(crate) fn ax_name_ok(want: &str, got: &str, exact: bool) -> bool {
  let a = compact(want);
  let b = compact(got);
  if a.is_empty() || b.is_empty() {
    return false;
  }
  if b.contains("删除") && !a.contains("删除") {
    return false;
  }
  if exact {
    return a == b;
  }
  a == b || b.starts_with(&a) || (b.len() <= a.len() + 8 && b.contains(&a))
}

fn fail(reason: &str, extra: Value) -> Value {
  let retry = matches!(reason, "not_found" | "hidden" | "covered" | "unstable" | "readonly");
  let mut out = extra;
  if let Some(obj) = out.as_object_mut() {
    obj.insert("ok".into(), json!(false));
    obj.insert("reason".into(), json!(reason));
    obj.insert("retry".into(), json!(retry));
    if !obj.contains_key("error") {
      obj.insert(
        "error".into(),
        json!(match reason {
          "not_found" => "没有找到元素",
          "hidden" => "元素不可见",
          "covered" => "元素被挡住",
          "disabled" => "元素已禁用",
          "readonly" => "输入框不可编辑",
          "unstable" => "元素还在动",
          "ambiguous" => "匹配到多个元素",
          "timeout" => "等待超时",
          _ => "定位失败",
        }),
      );
    }
  }
  out
}

fn ax_str(node: &Value, key: &str) -> String {
  node
    .get(key)
    .and_then(|v| v.get("value"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string()
}

fn ax_bool(node: &Value, name: &str) -> bool {
  let Some(props) = node.get("properties").and_then(|v| v.as_array()) else {
    return false;
  };
  props.iter().any(|prop| {
    prop.get("name").and_then(|v| v.as_str()) == Some(name)
      && prop.get("value").and_then(|v| v.get("value")).and_then(|v| v.as_bool()).unwrap_or(false)
  })
}

fn last_boxes() -> &'static Mutex<HashMap<String, String>> {
  static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_box(id: &str, loc: &Locator, box_key: &str) -> bool {
  let key = format!("{}:{}", id, loc.sig());
  if let Ok(mut map) = last_boxes().lock() {
    if let Some(prev) = map.get(&key) {
      if prev != box_key {
        map.insert(key, box_key.to_string());
        return false;
      }
    }
    map.insert(key, box_key.to_string());
  }
  true
}

#[cfg(test)]
fn frame_hint_ok(hint: &str, url: &str, name: &str, target_id: &str) -> bool {
  let w = compact(hint).to_ascii_lowercase();
  if w.is_empty() {
    return true;
  }
  if !name.is_empty() && compact(name).eq_ignore_ascii_case(&w) {
    return true;
  }
  [url, target_id].into_iter().any(|item| {
    let v = item.to_ascii_lowercase();
    !v.is_empty() && v.contains(&w)
  })
}

async fn enable_dom(conn: &CdpConn, session: Option<&str>) {
  let _ = conn.call("DOM.enable", json!({}), session).await;
  let _ = conn.call("Accessibility.enable", json!({}), session).await;
}

/// `DOM.getDocument` 会作废之前所有 nodeId，一次定位里只能调一次。
async fn root_id(conn: &CdpConn, session: Option<&str>) -> Option<i64> {
  let doc = conn
    .call("DOM.getDocument", json!({ "depth": 0 }), session)
    .await
    .ok()?;
  doc.get("root").and_then(|v| v.get("nodeId")).and_then(|v| v.as_i64())
}

/// 一个可查询的文档根：主文档或同进程 iframe 的 contentDocument。
#[derive(Clone)]
struct DocRoot {
  node_id: i64,
  /// 空串表示主文档；子文档带 frameId 给 AX 树用。
  frame_id: String,
}

async fn css_nodes(conn: &CdpConn, session: Option<&str>, root: i64, selector: &str) -> Vec<i64> {
  let raw = conn
    .call("DOM.querySelectorAll", json!({ "nodeId": root, "selector": selector }), session)
    .await
    .unwrap_or(Value::Null);
  raw
    .get("nodeIds")
    .and_then(|v| v.as_array())
    .map(|list| list.iter().filter_map(|v| v.as_i64()).collect())
    .unwrap_or_default()
}

async fn ax_nodes(conn: &CdpConn, session: Option<&str>, frame_id: &str) -> Vec<Value> {
  let params = if frame_id.is_empty() {
    json!({})
  } else {
    json!({ "frameId": frame_id })
  };
  let tree = conn
    .call("Accessibility.getFullAXTree", params, session)
    .await
    .unwrap_or(json!({}));
  tree.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default()
}

async fn push_backend(conn: &CdpConn, session: Option<&str>, backend: i64) -> Option<i64> {
  let raw = conn
    .call(
      "DOM.pushNodesByBackendIdsToFrontend",
      json!({ "backendNodeIds": [backend] }),
      session,
    )
    .await
    .ok()?;
  raw
    .get("nodeIds")
    .and_then(|v| v.as_array())
    .and_then(|list| list.first())
    .and_then(|v| v.as_i64())
    .filter(|id| *id > 0)
}

fn collect_ax(loc: &Locator, nodes: &[Value]) -> Vec<(i64, String, bool, bool)> {
  let mut out = Vec::new();
  let want = compact(&loc.value);
  let want_name = compact(&loc.name);
  for node in nodes {
    if node.get("ignored").and_then(|v| v.as_bool()).unwrap_or(false) {
      continue;
    }
    let role = ax_str(node, "role").to_ascii_lowercase();
    let name = ax_str(node, "name");
    let backend = node.get("backendDOMNodeId").and_then(|v| v.as_i64()).unwrap_or(0);
    if backend <= 0 {
      continue;
    }
    let hit = match loc.by.as_str() {
      "role" => {
        role == loc.value.to_ascii_lowercase()
          && (want_name.is_empty() || ax_name_ok(&loc.name, &name, loc.exact))
      }
      "label" | "text" => ax_name_ok(&loc.value, &name, loc.exact) && !want.is_empty(),
      _ => false,
    };
    if !hit {
      continue;
    }
    out.push((backend, name, ax_bool(node, "disabled"), ax_bool(node, "readonly")));
  }
  out
}

async fn node_box(conn: &CdpConn, session: Option<&str>, node_id: i64) -> Option<(f64, f64, f64)> {
  // 这里只量盒子，不滚动。同名按钮有多颗时，挨个滚会把选中的那颗滚出视口。
  if let Ok(quads) = conn
    .call("DOM.getContentQuads", json!({ "nodeId": node_id }), session)
    .await
  {
    if let Some(list) = quads.get("quads").and_then(|v| v.as_array()) {
      if let Some(q) = list.first().and_then(|v| v.as_array()) {
        if q.len() >= 8 {
          let nums: Vec<f64> = q.iter().filter_map(|v| v.as_f64()).collect();
          if nums.len() >= 8 {
            let x = (nums[0] + nums[2] + nums[4] + nums[6]) / 4.0;
            let y = (nums[1] + nums[3] + nums[5] + nums[7]) / 4.0;
            let w = (nums[2] - nums[0]).abs();
            let h = (nums[5] - nums[1]).abs();
            if w >= 2.0 && h >= 2.0 {
              return Some((x, y, w * h));
            }
          }
        }
      }
    }
  }
  let model = conn
    .call("DOM.getBoxModel", json!({ "nodeId": node_id }), session)
    .await
    .ok()?;
  let content = model.get("model").and_then(|v| v.get("content")).and_then(|v| v.as_array())?;
  let nums: Vec<f64> = content.iter().filter_map(|v| v.as_f64()).collect();
  if nums.len() < 8 {
    return None;
  }
  let x = (nums[0] + nums[2] + nums[4] + nums[6]) / 4.0;
  let y = (nums[1] + nums[3] + nums[5] + nums[7]) / 4.0;
  let w = (nums[2] - nums[0]).abs();
  let h = (nums[5] - nums[1]).abs();
  if w < 2.0 || h < 2.0 {
    return None;
  }
  Some((x, y, w * h))
}

/// 边框盒 (x1, y1, x2, y2)，视口坐标。
async fn border_rect(conn: &CdpConn, session: Option<&str>, node_id: i64) -> Option<(f64, f64, f64, f64)> {
  let model = conn
    .call("DOM.getBoxModel", json!({ "nodeId": node_id }), session)
    .await
    .ok()?;
  let border = model.get("model").and_then(|v| v.get("border")).and_then(|v| v.as_array())?;
  let nums: Vec<f64> = border.iter().filter_map(|v| v.as_f64()).collect();
  if nums.len() < 8 {
    return None;
  }
  let xs = [nums[0], nums[2], nums[4], nums[6]];
  let ys = [nums[1], nums[3], nums[5], nums[7]];
  let min = |arr: &[f64; 4]| arr.iter().cloned().fold(f64::INFINITY, f64::min);
  let max = |arr: &[f64; 4]| arr.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
  Some((min(&xs), min(&ys), max(&xs), max(&ys)))
}

fn rect_inside(inner: (f64, f64, f64, f64), outer: (f64, f64, f64, f64), slack: f64) -> bool {
  inner.0 >= outer.0 - slack
    && inner.1 >= outer.1 - slack
    && inner.2 <= outer.2 + slack
    && inner.3 <= outer.3 + slack
}

/// 目标中心点命中的若是别的节点，先看它的盒子是否整个落在目标盒子里。
/// 落在里面的多半是自己的文字 span / 图标（`.posCatalog_select` 里的 `.posCatalog_name`），不算挡；
/// 伸出目标盒子的才是真正的遮罩 / 弹层。
/// 目标是文字节点（AX StaticText）时，命中的是包着它的元素，盒子反过来包住文字，也不算挡。
async fn covered(
  conn: &CdpConn,
  session: Option<&str>,
  backend: i64,
  node_id: i64,
  is_text: bool,
  x: f64,
  y: f64,
) -> Option<String> {
  crate::cef::click_landed_elsewhere(conn, session, backend, x, y).await
}

struct Ready {
  x: f64,
  y: f64,
  text: String,
  backend: i64,
  frame_id: String,
}

async fn ready_of(
  conn: &CdpConn,
  session: Option<&str>,
  node_id: i64,
  backend: i64,
  is_text: bool,
  text: &str,
  disabled: bool,
  readonly: bool,
) -> Result<Ready, Value> {
  if disabled {
    return Err(fail("disabled", json!({ "text": text, "retry": false })));
  }
  if readonly {
    return Err(fail("readonly", json!({ "text": text })));
  }
  let backend = crate::cef::visible_control_backend(conn, session, backend).await
    .map_err(|error| fail("invalid", json!({"error":error})))?;
  let node_id = push_backend(conn, session, backend).await
    .ok_or_else(|| fail("invalid", json!({"error":"目标节点已失效"})))?;
  // 只滚动已确定的这一颗节点，布局稳定后由点击阶段再次验证。
  let _ = conn.call("DOM.scrollIntoViewIfNeeded", json!({"backendNodeId":backend}), session).await;
  let Some((x, y, _area)) = node_box(conn, session, node_id).await else {
    return Err(fail("hidden", json!({ "text": text })));
  };
  if let Some(cover) = covered(conn, session, backend, node_id, is_text, x, y).await {
    return Err(fail("covered", json!({ "text": text, "cover": cover })));
  }
  Ok(Ready {
    x,
    y,
    text: text.to_string(),
    backend,
    frame_id: String::new(),
  })
}

/// 在一个文档根里按 css 找；命中就量盒子。
fn select_candidates<T>(rows: Vec<T>, nth: i64) -> Result<Vec<T>, Value> {
  if nth <= 0 { return Ok(rows); }
  rows.into_iter().nth((nth - 1) as usize).map(|row| vec![row])
    .ok_or_else(|| fail("not_found", json!({ "error": format!("第 {nth} 个元素不存在") })))
}

async fn css_in_root(conn: &CdpConn, session: Option<&str>, root: i64, loc: &Locator) -> Vec<Result<Ready, Value>> {
  let mut ready = Vec::new();
  let nodes = match select_candidates(css_nodes(conn, session, root, &loc.value).await, loc.nth.max(1)) {
    Ok(nodes) => nodes, Err(error) => return vec![Err(error)],
  };
  for node_id in nodes {
    let backend = conn
      .call("DOM.describeNode", json!({ "nodeId": node_id }), session)
      .await
      .ok()
      .and_then(|v| v.get("node").and_then(|n| n.get("backendNodeId")).and_then(|b| b.as_i64()))
      .unwrap_or(0);
    ready.push(ready_of(conn, session, node_id, backend, false, &loc.value, false, false).await);
  }
  ready
}

/// 在一个文档（主文档或某个 iframe）的 AX 树里按文案 / 角色找。
async fn ax_in_root(conn: &CdpConn, session: Option<&str>, frame_id: &str, loc: &Locator) -> Vec<Result<Ready, Value>> {
  let nodes = ax_nodes(conn, session, frame_id).await;
  let mut ready = Vec::new();
  let candidates = match select_candidates(collect_ax(loc, &nodes), loc.nth) {
    Ok(rows) => rows, Err(error) => return vec![Err(error)],
  };
  for (backend, name, disabled, readonly) in candidates {
    let Some(node_id) = push_backend(conn, session, backend).await else {
      continue;
    };
    // StaticText 对应 DOM 文字节点（nodeType 3），中心点命中的会是父元素。
    let is_text = conn
      .call("DOM.describeNode", json!({ "nodeId": node_id }), session)
      .await
      .ok()
      .and_then(|v| v.get("node").and_then(|n| n.get("nodeType")).and_then(|t| t.as_i64()))
      == Some(3);
    ready.push(ready_of(conn, session, node_id, backend, is_text, &name, disabled, readonly).await);
  }
  ready
}

async fn rows_in_doc(conn: &CdpConn, session: Option<&str>, doc: &DocRoot, loc: &Locator) -> Vec<Result<Ready, Value>> {
  let mut rows = if loc.backend > 0 {
    // frame / loader 身份已在 cdp_find 中验证。ref 指向这一颗节点，不能再按同名 nth 改找别的。
    let Some(node_id) = push_backend(conn, session, loc.backend).await else {
      return vec![Err(fail("invalid", json!({ "error": "快照节点已移除，请重新读取页面" })))];
    };
    let partial = conn.call("Accessibility.getPartialAXTree", json!({ "backendNodeId": loc.backend, "fetchRelatives": false }), session).await.unwrap_or(Value::Null);
    let node = partial["nodes"].as_array().and_then(|nodes| nodes.iter().find(|n| n["backendDOMNodeId"].as_i64() == Some(loc.backend)));
    vec![ready_of(conn, session, node_id, loc.backend, false, if loc.name.is_empty() { &loc.value } else { &loc.name },
      node.is_some_and(|n| ax_bool(n, "disabled")), node.is_some_and(|n| ax_bool(n, "readonly"))).await]
  } else if loc.by == "css" {
    css_in_root(conn, session, doc.node_id, loc).await
  } else {
    ax_in_root(conn, session, &doc.frame_id, loc).await
  };
  for hit in rows.iter_mut().filter_map(|r| r.as_mut().ok()) { hit.frame_id = doc.frame_id.clone(); }
  rows
}

/// 已解析的 frame：同进程取 owner.contentDocument，OOPIF 取自己的文档根。
async fn locate_frame(conn: &CdpConn, session: Option<&str>, loc: &Locator) -> Result<Vec<Result<Ready, Value>>, Value> {
  enable_dom(conn, session).await;
  let Some(root) = root_id(conn, session).await else {
    return Err(fail("not_found", json!({ "error": "文档还没就绪" })));
  };
  let tree = conn.call("Page.getFrameTree", json!({}), session).await.unwrap_or(Value::Null);
  let own_id = tree.pointer("/frameTree/frame/id").and_then(Value::as_str).unwrap_or("");
  let doc = if own_id == loc.frame_id {
    DocRoot { node_id: root, frame_id: loc.frame_id.clone() }
  } else {
    let owner = conn.call("DOM.getFrameOwner", json!({ "frameId": loc.frame_id }), session).await
      .map_err(|_| fail("invalid", json!({ "error": "目标 frame 已移除，请重新读取页面快照" })))?;
    let described = conn.call("DOM.describeNode", json!({ "backendNodeId": owner["backendNodeId"] }), session).await
      .map_err(|_| fail("invalid", json!({ "error": "目标 frame 尚未就绪" })))?;
    let backend = described.pointer("/node/contentDocument/backendNodeId").and_then(Value::as_i64).unwrap_or(0);
    let node_id = push_backend(conn, session, backend).await
      .ok_or_else(|| fail("invalid", json!({ "error": "目标 frame 文档已失效，请重新读取页面快照" })))?;
    DocRoot { node_id, frame_id: loc.frame_id.clone() }
  };
  let rows = rows_in_doc(conn, session, &doc, loc).await;
  if rows.is_empty() { Err(fail("not_found", json!({}))) } else { Ok(rows) }
}

fn pick_ready(rows: Vec<Result<Ready, Value>>, loc: &Locator) -> Result<Ready, Value> {
  // nth 已在 DOM/AX 候选中选择；目标不可点时返回它的真实错误，不能跳到下一颗。
  if loc.nth > 0 {
    return rows.into_iter().next().unwrap_or_else(|| Err(fail("not_found", json!({}))));
  }
  // 元素在页上但量不到 / 被挡，要把真实原因带出去，不能一律说 not_found。
  let first_err = rows.iter().find_map(|row| row.as_ref().err().cloned());
  let ok: Vec<Ready> = rows.into_iter().filter_map(|row| row.ok()).collect();
  if ok.is_empty() {
    return Err(first_err.unwrap_or_else(|| fail("not_found", json!({}))));
  }
  if ok.len() == 1 {
    return Ok(ok.into_iter().next().unwrap());
  }
  // css 选择器多命中时按文档顺序取第一个（与 querySelector 一致）。
  // `[id*=x] .name, [id*=x]` 这类「外盒 + 内文」组合本来就是同一个目标，不算歧义。
  if loc.by == "css" {
    return Ok(ok.into_iter().next().unwrap());
  }
  let want = compact(if loc.name.is_empty() { &loc.value } else { &loc.name });
  let exact: Vec<Ready> = ok
    .iter()
    .filter(|row| compact(&row.text) == want)
    .cloned()
    .collect();
  if exact.len() == 1 {
    return Ok(exact.into_iter().next().unwrap());
  }
  // 文案完全相同的多个可点节点（「下一节」在上下两条栏各一个）按 AX 顺序取第一个，
  // 与旧的按文本节点精确匹配一致；文案不同才算歧义。
  if exact.len() > 1 {
    return Ok(exact.into_iter().next().unwrap());
  }
  let names: Vec<Value> = ok
    .iter()
    .take(6)
    .map(|row| json!({ "text": row.text, "reason": "ambiguous" }))
    .collect();
  Err(fail("ambiguous", json!({ "retry": false, "candidates": names })))
}

impl Clone for Ready {
  fn clone(&self) -> Self {
    Self {
      x: self.x,
      y: self.y,
      text: self.text.clone(),
      backend: self.backend,
      frame_id: self.frame_id.clone(),
    }
  }
}

fn locators_of(raw: &Value) -> Vec<Locator> {
  let list = if let Some(rows) = raw.as_array() {
    rows.iter().collect::<Vec<_>>()
  } else {
    vec![raw]
  };
  list
    .into_iter()
    .map(Locator::from_value)
    .filter(|item| !item.value.is_empty())
    .collect()
}

async fn finish_find(
  id: &str,
  loc: &Locator,
  session: Option<String>,
  rows: Vec<Result<Ready, Value>>,
) -> Result<Value, String> {
  let picked = match pick_ready(rows, loc) {
    Ok(ready) => ready,
    Err(err) => return Ok(err),
  };
  let box_key = format!("{},{}", picked.x.round() as i64, picked.y.round() as i64);
  if !remember_box(id, loc, &box_key) {
    return Ok(fail("unstable", json!({ "text": picked.text, "box": box_key })));
  }
  Ok(json!({
    "ok": true,
    "x": picked.x,
    "y": picked.y,
    "space": "page",
    "text": picked.text,
    "backend": picked.backend,
    "frameId": picked.frame_id,
    "loaderId": loc.loader_id,
    "session": session.unwrap_or_default(),
  }))
}

pub async fn cdp_find(_app: AppHandle, id: String, locator: Value) -> Result<Value, String> {
  let locs = locators_of(&locator);
  if locs.is_empty() {
    return Ok(fail("invalid", json!({ "retry": false })));
  }
  let page = bind_page(&id).await?;
  // getDocument → nodeId 链路要独占，否则被并发的整帧读 HTML 作废 nodeId。
  let lock = crate::cef::dom_lock(&id);
  let _held = lock.lock().await;
  let contexts = crate::cef::frames::contexts(&page).await?;
  let mut last = fail("not_found", json!({}));
  let mut settled: Option<Value> = None;
  for loc in &locs {
    let mut candidates = Vec::new();
    if !loc.frame_id.is_empty() {
      match crate::cef::frames::select(&contexts, &json!({ "frameId": loc.frame_id, "loaderId": loc.loader_id })) {
        Ok(Some(frame)) => candidates.push(frame),
        Err(error) => return Ok(fail("invalid", json!({ "error": error }))),
        _ => {},
      }
    } else {
      for frame in &contexts {
        if !loc.frame_path.is_empty() && frame.path != loc.frame_path { continue; }
        if !loc.frame.is_empty() && !crate::cef::frames::hint_matches(&page, &contexts, frame, &loc.frame).await { continue; }
        candidates.push(frame);
      }
    }
    let mut visible_count = 0;
    for frame in candidates {
      if !crate::cef::frames::visible(&page, &contexts, frame).await {
        last = fail("hidden", json!({}));
        continue;
      }
      visible_count += 1;
      if visible_count > crate::cef::frames::MAX_FRAMES { break; }
      let mut target = loc.clone();
      target.frame_id = frame.id.clone();
      target.loader_id = frame.loader_id.clone();
      match locate_frame(&page.conn, frame.session.as_deref(), &target).await {
        Ok(rows) => {
          let hit = finish_find(&id, &target, frame.session.clone(), rows).await?;
          if hit["ok"].as_bool() == Some(true) || find_wait_done(&hit) { return Ok(hit); }
          if settled.is_none() && hit["reason"].as_str() != Some("not_found") { settled = Some(hit.clone()); }
          last = hit;
        }
        Err(err) => last = err,
      }
    }
  }
  Ok(settled.unwrap_or(last))
}

fn find_wait_done(hit: &Value) -> bool {
  if hit.get("ok").and_then(|v| v.as_bool()) == Some(true) {
    return true;
  }
  matches!(
    hit.get("reason").and_then(|v| v.as_str()).unwrap_or(""),
    "disabled" | "ambiguous" | "invalid"
  )
}

fn is_find_wait_event(method: &str) -> bool {
  matches!(
    method,
    "Page.frameStoppedLoading"
      | "Page.frameNavigated"
      | "Network.loadingFinished"
      | "DOM.documentUpdated"
      | "Accessibility.nodesUpdated"
  )
}

fn event_for_browser(event: &Value, id: &str, page_sid: &str) -> bool {
  let sid = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
  if sid.is_empty() {
    return false;
  }
  if !page_sid.is_empty() && sid == page_sid {
    return true;
  }
  owner_of_session_exact(sid) == id
}

fn timeout_find(last: &Value) -> Value {
  // 等到点了元素还是不在，原因仍是没找到 / 看不见。只有一直没落定才叫超时。
  let reason = last.get("reason").and_then(|v| v.as_str()).unwrap_or("");
  if matches!(reason, "not_found" | "hidden" | "covered" | "readonly") {
    return last.clone();
  }
  let mut extra = json!({
    "cover": last.get("cover").cloned().unwrap_or(Value::Null),
    "candidates": last.get("candidates").cloned().unwrap_or(Value::Null),
    "text": last.get("text").cloned().unwrap_or(Value::Null),
  });
  if let Some(obj) = extra.as_object_mut() {
    obj.retain(|_, v| !v.is_null());
  }
  fail("timeout", extra)
}

/// 事件到了先歇一下让 DOM 落定，再合并这段时间里挤进来的其它事件。
const FIND_WAIT_DEBOUNCE: Duration = Duration::from_millis(60);
/// 两次 find 至少隔这么久。studentstudy 的 Network / AX 事件很密，不限速会比 120ms 轮询更重。
const FIND_WAIT_MIN_GAP: Duration = Duration::from_millis(150);
/// 事件不齐时的稀疏兜底。
const FIND_WAIT_FALLBACK: Duration = Duration::from_millis(250);

fn needs_ax(locs: &[Locator]) -> bool {
  locs.iter().any(|loc| loc.by == "text" || !loc.name.is_empty())
}

pub async fn cdp_find_wait(
  app: AppHandle,
  id: String,
  locator: Value,
  timeout_ms: Option<u64>,
) -> Result<Value, String> {
  let timeout = timeout_ms.unwrap_or(8000).clamp(400, 20_000);
  let first = cdp_find(app.clone(), id.clone(), locator.clone()).await?;
  if find_wait_done(&first) {
    return Ok(first);
  }
  let page = bind_page(&id).await?;
  let sid = page.session.clone();
  let _ = page.conn.call("DOM.enable", json!({}), sid.as_deref()).await;
  // AX 树常驻很贵，只有 text / name 定位才开。Network 不在这里开：watch_network 开了就顺带用。
  if needs_ax(&locators_of(&locator)) {
    let _ = page
      .conn
      .call("Accessibility.enable", json!({}), sid.as_deref())
      .await;
  }
  let mut rx = page.conn.subscribe();
  let deadline = Instant::now() + Duration::from_millis(timeout);
  let mut last = first;
  let mut last_find = Instant::now();
  loop {
    let now = Instant::now();
    if now >= deadline {
      return Ok(timeout_find(&last));
    }
    let remain = deadline - now;
    let mut poke = false;
    tokio::select! {
      ev = rx.recv() => {
        match ev {
          Ok(event) => {
            let method = event.get("method").and_then(|v| v.as_str()).unwrap_or("");
            if is_find_wait_event(method) && event_for_browser(&event, &id, sid.as_deref().unwrap_or("")) {
              poke = true;
            }
          }
          Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => poke = true,
          Err(tokio::sync::broadcast::error::RecvError::Closed) => {
            return Ok(timeout_find(&last));
          }
        }
      }
      _ = tokio::time::sleep(remain.min(FIND_WAIT_FALLBACK)) => {
        poke = true;
      }
    }
    if !poke {
      continue;
    }
    // 防抖 + 限速：等 DOM 落定，同时保证距上次 find 不少于 MIN_GAP。
    let settle = FIND_WAIT_DEBOUNCE.max(FIND_WAIT_MIN_GAP.saturating_sub(last_find.elapsed()));
    tokio::time::sleep(settle.min(deadline.saturating_duration_since(Instant::now()))).await;
    while rx.try_recv().is_ok() {}
    last = cdp_find(app.clone(), id.clone(), locator.clone())
      .await
      .unwrap_or(last);
    last_find = Instant::now();
    if find_wait_done(&last) {
      return Ok(last);
    }
  }
}

pub async fn cdp_click_at(
  _app: AppHandle,
  id: String,
  x: f64,
  y: f64,
  button: Option<String>,
  click_count: Option<i64>,
  session: Option<String>,
) -> Result<crate::app_browser::CdpActResult, String> {
  let page = bind_page(&id).await?;
  let btn = if button.as_deref() == Some("right") { "right" } else { "left" };
  let count = click_count.unwrap_or(1).clamp(1, 2);
  let sid = session
    .as_deref()
    .map(str::trim)
    .filter(|item| !item.is_empty())
    .or(page.session.as_deref());
  dispatch_click(&page.conn, x, y, sid, btn, count).await?;
  Ok(crate::app_browser::CdpActResult {
    ok: true,
    error: None,
    text: None,
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

/// 聚焦、选择、输入和回读都固定在同一节点/target，不扫描全局 activeElement。
pub async fn cdp_fill_node(id: String, backend: i64, session: Option<String>, text: String) -> Result<Value, String> {
  if backend <= 0 { return Ok(fail("invalid", json!({}))); }
  let page = bind_page(&id).await?;
  let sid = session.filter(|s| !s.is_empty()).or(page.session.clone());
  let resolved = page.conn.call("DOM.resolveNode", json!({ "backendNodeId": backend }), sid.as_deref()).await?;
  let object = resolved.pointer("/object/objectId").and_then(Value::as_str).ok_or("输入节点已失效，请重新读取页面")?;
  let result = async {
    let selected = page.conn.call("Runtime.callFunctionOn", json!({
      "objectId": object, "returnByValue": true, "functionDeclaration": r#"function(){
        if (!this.isConnected || this.disabled || this.readOnly) return false;
        var tag = this.tagName.toLowerCase();
        if (tag !== 'input' && tag !== 'textarea' && !this.isContentEditable) return false;
        this.scrollIntoView({block:'center',inline:'nearest'}); this.focus();
        if (this.ownerDocument.activeElement !== this) return false;
        if (this.isContentEditable) {
          var r=this.ownerDocument.createRange(); r.selectNodeContents(this);
          var s=this.ownerDocument.defaultView.getSelection(); s.removeAllRanges(); s.addRange(r);
        } else this.select();
        return true;
      }"#,
    }), sid.as_deref()).await?;
    if selected.pointer("/result/value").and_then(Value::as_bool) != Some(true) {
      return Ok(fail("invalid", json!({ "error": "输入节点不可编辑或无法聚焦" })));
    }
    // insertText('') 不保证删除当前选择，清空用 Backspace。
    if text.is_empty() {
      for kind in ["keyDown", "keyUp"] {
        page.conn.call("Input.dispatchKeyEvent", json!({ "type": kind, "key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8 }), sid.as_deref()).await?;
      }
    } else {
      page.conn.call("Input.insertText", json!({ "text": text }), sid.as_deref()).await?;
    }
    tokio::time::sleep(Duration::from_millis(80)).await;
    let check = page.conn.call("Runtime.callFunctionOn", json!({
      "objectId": object, "returnByValue": true, "arguments": [{ "value": text }],
      "functionDeclaration": r#"function(want){
        var got=this.isContentEditable?String(this.textContent||''):String(this.value||'');
        var password=String(this.type||'').toLowerCase()==='password';
        var ok=this.isConnected && got===want;
        return {ok:ok,filled:ok,length:got.length,password:password,text:password?undefined:got,
          error:ok?undefined:'目标输入框内容与要求不一致，请重新读取页面'};
      }"#,
    }), sid.as_deref()).await?;
    if let Some(error) = check.get("exceptionDetails") { return Err(error.to_string()); }
    Ok(check.pointer("/result/value").cloned().unwrap_or_else(|| fail("invalid", json!({}))))
  }.await;
  let _ = page.conn.call("Runtime.releaseObject", json!({ "objectId": object }), sid.as_deref()).await;
  result
}

#[cfg(test)]
mod tests {
  use super::ax_name_ok;

  #[test]
  fn nth_selects_before_actionability_filtering() {
    let rows: Vec<Result<i32, &str>> = vec![Err("covered"), Ok(2), Ok(3)];
    let selected = super::select_candidates(rows, 2).unwrap();
    assert_eq!(selected, vec![Ok(2)]);
    let rows: Vec<Result<i32, &str>> = vec![Err("hidden"), Ok(2)];
    assert_eq!(super::select_candidates(rows, 1).unwrap(), vec![Err("hidden")]);
    assert!(super::select_candidates(vec![1, 2], 3).is_err());
  }

  #[test]
  fn frame_hint_name_exact_url_substring() {
    assert!(super::frame_hint_ok("cards", "https://mooc1.chaoxing.com/knowledge/cards", "", ""));
    assert!(super::frame_hint_ok("iframe", "", "iframe", ""));
    assert!(!super::frame_hint_ok("iframe", "", "iframe-player", ""));
    assert!(!super::frame_hint_ok("2288", "", "2288751884001591094233845", ""));
  }

  #[test]
  fn exact_and_prefix() {
    assert!(ax_name_ok("确定", "确定", true));
    assert!(!ax_name_ok("确定", "确定提交", true));
    assert!(ax_name_ok("确定", "确定提交", false));
    assert!(!ax_name_ok("作业", "删除作业", false));
  }

  #[test]
  fn ax_only_for_text_or_name() {
    let css = super::locators_of(&serde_json::json!([{ "by": "css", "value": "#ok" }]));
    assert!(!super::needs_ax(&css));
    let text = super::locators_of(&serde_json::json!([{ "by": "text", "value": "确定" }]));
    assert!(super::needs_ax(&text));
    let named = super::locators_of(&serde_json::json!([{ "by": "css", "value": "button", "name": "提交" }]));
    assert!(super::needs_ax(&named));
  }

  #[test]
  fn wait_done_stops_on_ok_or_hard_fail() {
    assert!(super::find_wait_done(&serde_json::json!({ "ok": true, "x": 1, "y": 2 })));
    assert!(super::find_wait_done(&serde_json::json!({ "ok": false, "reason": "disabled" })));
    assert!(super::find_wait_done(&serde_json::json!({ "ok": false, "reason": "ambiguous" })));
    assert!(super::find_wait_done(&serde_json::json!({ "ok": false, "reason": "invalid" })));
    assert!(!super::find_wait_done(&serde_json::json!({ "ok": false, "reason": "not_found" })));
    assert!(!super::find_wait_done(&serde_json::json!({ "ok": false, "reason": "hidden" })));
  }

  #[test]
  fn wait_timeout_keeps_not_found() {
    let missed = super::timeout_find(&serde_json::json!({
      "ok": false,
      "reason": "not_found",
      "error": "没有找到元素",
      "retry": true
    }));
    assert_eq!(missed.get("reason").and_then(|v| v.as_str()), Some("not_found"));
    let moving = super::timeout_find(&serde_json::json!({ "ok": false, "reason": "unstable" }));
    assert_eq!(moving.get("reason").and_then(|v| v.as_str()), Some("timeout"));
  }
}
