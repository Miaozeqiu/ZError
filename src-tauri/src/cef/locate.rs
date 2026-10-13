//! 用 CDP DOM / Accessibility 定位，不往页里跑 locate 脚本。
#![cfg(target_os = "macos")]

use crate::cdp_client::CdpConn;
use crate::cef::{bind_page, dispatch_click, is_child_target, owner_of_session_exact};
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
    }
  }

  fn sig(&self) -> String {
    format!("{}:{}:{}:{}:{}:{}", self.by, self.value, self.name, self.nth, self.frame, self.frame_path)
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

fn flatten_frames(tree: &Value, out: &mut Vec<(String, String, String)>) {
  let frame = tree.get("frame").cloned().unwrap_or(Value::Null);
  let id = frame.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
  let url = frame.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
  let name = frame.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
  if !id.is_empty() || !url.is_empty() {
    out.push((id, url, name));
  }
  if let Some(kids) = tree.get("childFrames").and_then(|v| v.as_array()) {
    for kid in kids {
      flatten_frames(kid, out);
    }
  }
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
  /// ananas 播放器帧：只有 css 定位（播放/暂停键）会进去，文案定位跳过。
  player: bool,
}

fn attr_map(node: &Value) -> HashMap<String, String> {
  let mut out = HashMap::new();
  if let Some(attrs) = node.get("attributes").and_then(|v| v.as_array()) {
    let mut it = attrs.iter();
    while let (Some(k), Some(v)) = (it.next(), it.next()) {
      if let (Some(k), Some(v)) = (k.as_str(), v.as_str()) {
        out.insert(k.to_ascii_lowercase(), v.to_string());
      }
    }
  }
  out
}

/// 同进程 iframe 不是独立 target，`Target.getTargets` 里没有它，只能从父文档一层层 pierce 进去。
/// 学习通播放页：main → `#iframe`(knowledge/cards) → ananas video，都在一个进程里。
/// `hint` 为空收集全部子文档（文档顺序）；非空只收 id / name / mid / data-mid / src / frameId 含 hint 的。
const FRAME_WALK_BUDGET: usize = 28;

async fn child_docs(
  conn: &CdpConn,
  session: Option<&str>,
  root: i64,
  hint: &str,
  depth: u8,
  budget: &mut usize,
  out: &mut Vec<DocRoot>,
) {
  if depth > 3 || *budget == 0 {
    return;
  }
  let raw = conn
    .call("DOM.querySelectorAll", json!({ "nodeId": root, "selector": "iframe, frame" }), session)
    .await
    .unwrap_or(Value::Null);
  let ids: Vec<i64> = raw
    .get("nodeIds")
    .and_then(|v| v.as_array())
    .map(|list| list.iter().filter_map(|v| v.as_i64()).collect())
    .unwrap_or_default();
  let want = compact(hint).to_ascii_lowercase();
  for node_id in ids {
    if *budget == 0 {
      return;
    }
    *budget -= 1;
    let Ok(described) = conn
      .call("DOM.describeNode", json!({ "nodeId": node_id, "depth": 0 }), session)
      .await
    else {
      continue;
    };
    let node = described.get("node").cloned().unwrap_or(Value::Null);
    let attrs = attr_map(&node);
    let src = attrs.get("src").cloned().unwrap_or_default();
    if src.is_empty() || src == "about:blank" || src.starts_with("javascript:") {
      continue;
    }
    let frame_id = node.get("frameId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let content = node.get("contentDocument").cloned().unwrap_or(Value::Null);
    let backend = content.get("backendNodeId").and_then(|v| v.as_i64()).unwrap_or(0);
    if backend <= 0 {
      // 跨进程 / 还没挂文档：走不进去，交给 pick_frame_session 的 target 路径。
      continue;
    }
    let ident_hit = ["id", "name", "mid", "data-mid"].iter().filter_map(|k| attrs.get(*k)).any(|v| {
      compact(v).eq_ignore_ascii_case(&want)
    });
    let src_hit = attrs
      .get("src")
      .map(|v| v.to_ascii_lowercase().contains(&want))
      .unwrap_or(false)
      || (!frame_id.is_empty() && frame_id.to_ascii_lowercase().contains(&want));
    let matched = want.is_empty() || ident_hit || src_hit;
    let Some(doc_id) = push_backend(conn, session, backend).await else {
      continue;
    };
    if matched {
      let player = src.contains("ananas/modules/video") || src.contains("insertvideo");
      out.push(DocRoot { node_id: doc_id, frame_id: frame_id.clone(), player });
      if !want.is_empty() {
        continue;
      }
    }
    Box::pin(child_docs(conn, session, doc_id, hint, depth + 1, budget, out)).await;
  }
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
  let hit = conn
    .call(
      "DOM.getNodeForLocation",
      json!({ "x": x.round() as i64, "y": y.round() as i64, "includeUserAgentShadowDOM": false }),
      session,
    )
    .await
    .ok()?;
  let found = hit.get("backendNodeId").and_then(|v| v.as_i64()).unwrap_or(0);
  if found <= 0 || found == backend {
    return None;
  }
  let target = border_rect(conn, session, node_id).await?;
  let hit_node = match hit.get("nodeId").and_then(|v| v.as_i64()).filter(|id| *id > 0) {
    Some(id) => id,
    None => push_backend(conn, session, found).await?,
  };
  let Some(hit_rect) = border_rect(conn, session, hit_node).await else {
    return None;
  };
  if rect_inside(hit_rect, target, 2.0) {
    return None;
  }
  if is_text && rect_inside(target, hit_rect, 2.0) {
    return None;
  }
  let name = conn
    .call("DOM.describeNode", json!({ "nodeId": hit_node }), session)
    .await
    .ok()
    .and_then(|v| {
      let node = v.get("node")?;
      let tag = node.get("localName").and_then(|x| x.as_str()).unwrap_or("").to_string();
      let attrs = node.get("attributes").and_then(|x| x.as_array())?;
      let mut out = tag;
      let mut it = attrs.iter();
      while let (Some(k), Some(v)) = (it.next(), it.next()) {
        match k.as_str() {
          Some("id") => out.push_str(&format!("#{}", v.as_str().unwrap_or(""))),
          Some("class") => out.push_str(&format!(".{}", v.as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join("."))),
          _ => {}
        }
      }
      Some(out)
    })
    .unwrap_or_default();
  Some(name)
}

struct Ready {
  x: f64,
  y: f64,
  text: String,
  backend: i64,
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
  })
}

/// 在一个文档根里按 css 找；命中就量盒子。
async fn css_in_root(conn: &CdpConn, session: Option<&str>, root: i64, loc: &Locator) -> Vec<Result<Ready, Value>> {
  let mut ready = Vec::new();
  for node_id in css_nodes(conn, session, root, &loc.value).await {
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
  for (backend, name, disabled, readonly) in collect_ax(loc, &nodes) {
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

/// 快照上的序号链 `0/2/1`：按 iframe 在父文档里的顺序往下 pierce。
async fn doc_at_path(conn: &CdpConn, session: Option<&str>, root: i64, path: &str) -> Option<DocRoot> {
  let parts: Vec<usize> = path.split('/').filter_map(|part| part.parse::<usize>().ok()).collect();
  if parts.is_empty() || parts.len() > 4 {
    return None;
  }
  let mut current = root;
  for (step, index) in parts.iter().enumerate() {
    let ids = css_nodes(conn, session, current, "iframe, frame").await;
    let node_id = *ids.get(*index)?;
    let described = conn
      .call("DOM.describeNode", json!({ "nodeId": node_id, "depth": 0 }), session)
      .await
      .ok()?;
    let node = described.get("node")?;
    let attrs = attr_map(node);
    let src = attrs.get("src").cloned().unwrap_or_default();
    let frame_id = node.get("frameId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let backend = node
      .get("contentDocument")
      .and_then(|v| v.get("backendNodeId"))
      .and_then(|v| v.as_i64())
      .unwrap_or(0);
    if backend <= 0 {
      return None;
    }
    let doc_id = push_backend(conn, session, backend).await?;
    let player = src.contains("ananas/modules/video") || src.contains("insertvideo");
    if step + 1 == parts.len() {
      return Some(DocRoot { node_id: doc_id, frame_id, player });
    }
    current = doc_id;
  }
  None
}

async fn rows_in_doc(conn: &CdpConn, session: Option<&str>, doc: &DocRoot, loc: &Locator) -> Vec<Result<Ready, Value>> {
  if loc.by == "css" {
    css_in_root(conn, session, doc.node_id, loc).await
  } else {
    ax_in_root(conn, session, &doc.frame_id, loc).await
  }
}

/// `frame` 提示落到同进程 iframe 时（target 列表里没有它，session 还是主页），
/// 或没提示但主文档里没有时，往同进程子文档里 pierce。
async fn locate_in_session(
  conn: &CdpConn,
  session: Option<&str>,
  loc: &Locator,
  frame_resolved: bool,
) -> Result<Vec<Result<Ready, Value>>, Value> {
  enable_dom(conn, session).await;
  let Some(root) = root_id(conn, session).await else {
    return Err(fail("not_found", json!({ "error": "文档还没就绪" })));
  };
  // 提示已经命中独立 target（跨进程 iframe），该 session 的主文档就是目标帧。
  let hint = if frame_resolved { "" } else { loc.frame.as_str() };
  let frame_path = if frame_resolved { "" } else { loc.frame_path.as_str() };
  if !frame_path.is_empty() {
    if let Some(doc) = doc_at_path(conn, session, root, frame_path).await {
      let rows = rows_in_doc(conn, session, &doc, loc).await;
      if rows.iter().any(|row| row.is_ok()) || hint.is_empty() {
        return if rows.is_empty() {
          Err(fail("not_found", json!({ "error": format!("指定框 {frame_path} 里没有找到元素") })))
        } else {
          Ok(rows)
        };
      }
    } else if hint.is_empty() {
      return Err(fail("not_found", json!({ "error": format!("没有序号为 {frame_path} 的帧") })));
    }
  }
  let mut roots: Vec<DocRoot> = Vec::new();
  if hint.is_empty() {
    roots.push(DocRoot { node_id: root, frame_id: String::new(), player: false });
  } else {
    let mut budget = FRAME_WALK_BUDGET;
    child_docs(conn, session, root, hint, 0, &mut budget, &mut roots).await;
    if roots.is_empty() {
      return Err(fail("not_found", json!({ "error": format!("没有匹配「{}」的帧", loc.frame) })));
    }
  }
  let mut fallback_walked = false;
  let mut idx = 0;
  // 某帧里有节点但全是 hidden / covered（叠着的四个播放器只有一个可见），继续看下一帧，
  // 最后没一个可点的再把第一份失败原因带回去。
  let mut only_errs: Option<Vec<Result<Ready, Value>>> = None;
  while idx < roots.len() {
    let doc = roots[idx].clone();
    idx += 1;
    let rows = if loc.by == "css" {
      css_in_root(conn, session, doc.node_id, loc).await
    } else {
      ax_in_root(conn, session, &doc.frame_id, loc).await
    };
    if rows.iter().any(|row| row.is_ok()) {
      return Ok(rows);
    }
    if !rows.is_empty() && only_errs.is_none() {
      only_errs = Some(rows);
    }
    // 主文档没命中且没给帧提示：按文档顺序进同进程 iframe 再找一遍（播放器、作业都在 iframe 里）。
    // 文案定位每帧都要拉一棵 AX 树，很贵：只看前几帧，且跳过播放器帧（里面没有可点文案）。
    if hint.is_empty() && !fallback_walked {
      fallback_walked = true;
      let mut budget = if loc.by == "css" { FRAME_WALK_BUDGET } else { 10 };
      let mut more = Vec::new();
      child_docs(conn, session, root, "", 0, &mut budget, &mut more).await;
      if loc.by != "css" {
        more.retain(|doc| !doc.player);
      }
      roots.extend(more);
    }
  }
  if let Some(rows) = only_errs {
    return Ok(rows);
  }
  Err(fail("not_found", json!({})))
}

fn pick_ready(rows: Vec<Result<Ready, Value>>, loc: &Locator) -> Result<Ready, Value> {
  // 元素在页上但量不到 / 被挡，要把真实原因带出去，不能一律说 not_found。
  let first_err = rows.iter().find_map(|row| row.as_ref().err().cloned());
  let ok: Vec<Ready> = rows.into_iter().filter_map(|row| row.ok()).collect();
  if ok.is_empty() {
    return Err(first_err.unwrap_or_else(|| fail("not_found", json!({}))));
  }
  if loc.nth > 0 {
    let idx = (loc.nth - 1) as usize;
    return ok.get(idx).cloned().ok_or_else(|| {
      fail("not_found", json!({ "error": format!("第 {} 个元素不存在", loc.nth), "retry": true }))
    });
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
    }
  }
}

async fn pick_frame_session(page: &crate::cef::PageBind, hint: &str) -> Option<String> {
  if hint.is_empty() {
    return page.session.clone();
  }
  let tree = page
    .conn
    .call("Page.getFrameTree", json!({}), page.session.as_deref())
    .await
    .ok()?;
  let mut frames = Vec::new();
  flatten_frames(tree.get("frameTree").unwrap_or(&tree), &mut frames);
  let matched: Vec<(String, String, String)> = frames
    .into_iter()
    .filter(|(_, url, name)| frame_hint_ok(hint, url, name, ""))
    .collect();
  if matched.is_empty() {
    return None;
  }
  let want_url = matched[0].1.clone();
  let targets = page.conn.pages().await.ok()?;
  let mut count = 0;
  for t in targets {
    if !is_child_target(&t, &page.target_id, &page.url) {
      continue;
    }
    let url = t.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let tid = t.get("targetId").and_then(|v| v.as_str()).unwrap_or("");
    if !frame_hint_ok(hint, url, "", tid) && !(!want_url.is_empty() && url.contains(&want_url)) {
      continue;
    }
    count += 1;
    if count > 4 {
      break;
    }
    if let Ok(sid) = page.conn.attach(tid).await {
      let _ = page.conn.call("DOM.enable", json!({}), Some(&sid)).await;
      return Some(sid);
    }
  }
  page.session.clone()
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
  let mut sessions: HashMap<String, Option<String>> = HashMap::new();
  let mut last = fail("not_found", json!({}));
  // 某个定位已经给出终局结论（歧义 / 禁用），后面的备选又只是 not_found 时，
  // 要把终局结论带回去，否则 find_wait 会为一个永远不会出现的备选空等到超时。
  let mut settled: Option<Value> = None;
  for loc in &locs {
    let picked = if let Some(found) = sessions.get(&loc.frame) {
      found.clone()
    } else {
      let found = pick_frame_session(&page, &loc.frame).await;
      sessions.insert(loc.frame.clone(), found.clone());
      found
    };
    // 提示命中了独立 target 才算「帧已解析」；同进程 iframe 或按 mid 提示的，回到主 session 里 pierce。
    let frame_resolved = !loc.frame.is_empty()
      && picked.is_some()
      && picked != page.session;
    let session = picked.or_else(|| page.session.clone());
    match locate_in_session(&page.conn, session.as_deref(), loc, frame_resolved).await {
      Ok(rows) => {
        let hit = finish_find(&id, loc, session, rows).await?;
        if hit.get("ok").and_then(|v| v.as_bool()) == Some(true) {
          return Ok(hit);
        }
        if settled.is_none() && find_wait_done(&hit) {
          settled = Some(hit.clone());
        }
        last = hit;
      }
      Err(err) => last = err,
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

#[cfg(test)]
mod tests {
  use super::ax_name_ok;

  #[test]
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
