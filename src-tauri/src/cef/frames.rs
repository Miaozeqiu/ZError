//! Frame 身份、所属 target 和只读执行上下文。路径只用于发现，动作绑定 frameId/loaderId。
#![cfg(target_os = "macos")]

use crate::cef::PageBind;
use serde_json::{json, Value};

pub const MAX_FRAME_DEPTH: usize = 16;
pub const MAX_FRAMES: usize = 128;
pub const MAX_DISCOVERED_FRAMES: usize = 2048;

#[derive(Clone, Debug)]
pub struct FrameContext {
  pub id: String,
  pub loader_id: String,
  pub url: String,
  pub name: String,
  pub path: String,
  pub session: Option<String>,
}

fn string(v: &Value, key: &str) -> String {
  v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

pub fn flatten(tree: &Value, path: &str, session: Option<&str>, out: &mut Vec<FrameContext>) {
  if path.split('/').filter(|p| !p.is_empty()).count() > MAX_FRAME_DEPTH || out.len() >= MAX_DISCOVERED_FRAMES {
    return;
  }
  let frame = tree.get("frame").unwrap_or(tree);
  let id = string(frame, "id");
  if id.is_empty() { return; }
  let row = FrameContext {
    id: id.clone(), loader_id: string(frame, "loaderId"), url: string(frame, "url"),
    name: string(frame, "name"), path: path.to_string(), session: session.map(str::to_string),
  };
  if let Some(prev) = out.iter_mut().find(|row| row.id == id) { *prev = row; }
  else { out.push(row); }
  if let Some(children) = tree.get("childFrames").and_then(Value::as_array) {
    for (index, child) in children.iter().enumerate() {
      let path = if path.is_empty() { index.to_string() } else { format!("{path}/{index}") };
      flatten(child, &path, session, out);
    }
  }
}

pub(crate) async fn contexts(page: &PageBind) -> Result<Vec<FrameContext>, String> {
  let _ = page.conn.call("DOM.enable", json!({}), page.session.as_deref()).await;
  let tree = page.conn.call("Page.getFrameTree", json!({}), page.session.as_deref()).await?;
  let mut rows = Vec::new();
  flatten(tree.get("frameTree").unwrap_or(&tree), "", page.session.as_deref(), &mut rows);
  // 只 attach 当前 frame 树中的 target，不把其他标签的 iframe 混进来。
  let targets = page.conn.pages().await?;
  let mut attached = std::collections::HashSet::new();
  loop {
    let next = targets.iter().filter(|target| {
      let id = string(target, "targetId");
      string(target, "type") == "iframe" && !attached.contains(&id) && rows.iter().any(|f| f.id == id)
    }).min_by_key(|target| rows.iter().find(|f| f.id == string(target, "targetId"))
      .map(|f| f.path.split('/').count()).unwrap_or(usize::MAX));
    let Some(target) = next else { break };
    let id = string(target, "targetId");
    attached.insert(id.clone());
    let Some(path) = rows.iter().find(|f| f.id == id).map(|f| f.path.clone()) else { continue };
    let Ok((sid, tree)) = target_tree(page, &id).await else {
      rows.retain(|f| f.path != path && !f.path.starts_with(&format!("{path}/")));
      continue;
    };
    flatten(tree.get("frameTree").unwrap_or(&tree), &path, Some(&sid), &mut rows);
  }
  Ok(rows)
}

pub fn select<'a>(rows: &'a [FrameContext], locator: &Value) -> Result<Option<&'a FrameContext>, String> {
  let id = string(locator, "frameId");
  if id.is_empty() { return Ok(None); }
  let row = rows.iter().find(|f| f.id == id).ok_or("目标 frame 已移除，请重新读取页面快照")?;
  let loader = string(locator, "loaderId");
  if !loader.is_empty() && row.loader_id != loader {
    return Err("目标 frame 文档已更换，请重新读取页面快照".into());
  }
  Ok(Some(row))
}

pub(crate) async fn evaluate(page: &PageBind, frame: &FrameContext, expression: &str) -> Result<Value, String> {
  let world = page.conn.call("Page.createIsolatedWorld", json!({
    "frameId": frame.id, "worldName": "zerror-frame-read",
  }), frame.session.as_deref()).await?;
  let context = world.get("executionContextId").and_then(Value::as_i64).ok_or("frame 尚未就绪")?;
  let raw = page.conn.call("Runtime.evaluate", json!({
    "expression": expression, "contextId": context, "returnByValue": true, "awaitPromise": false,
  }), frame.session.as_deref()).await?;
  if let Some(error) = raw.get("exceptionDetails") { return Err(error.to_string()); }
  Ok(raw.get("result").and_then(|v| v.get("value")).cloned().unwrap_or(Value::Null))
}

pub async fn evaluate_hint(id: String, hint: String, script: String) -> Result<Value, String> {
  let page = crate::cef::bind_page(&id).await?;
  let rows = contexts(&page).await?;
  let mut hits: Vec<_> = rows.iter().filter(|f| {
    f.id == hint || f.path == hint || (!f.name.is_empty() && f.name == hint) || f.url.contains(&hint)
  }).collect();
  if hits.is_empty() {
    for row in &rows {
      if owner_mid(&page, &rows, row).await == hint { hits.push(row); }
    }
  }
  if hits.len() != 1 { return Err("目标 frame 不存在或不唯一，请使用快照中的 frameId".into()); }
  Ok(json!({ "ok": true, "result": evaluate(&page, hits[0], &script).await? }))
}

/// 在父 target 查询 iframe 自身，跨域时也不需要访问它的 contentDocument。
pub(crate) async fn owner_mid(page: &PageBind, rows: &[FrameContext], frame: &FrameContext) -> String {
  let mut path = frame.path.clone();
  while !path.is_empty() {
    let Some(child) = rows.iter().find(|f| f.path == path) else { break };
    let parent_path = path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
    let Some(parent) = rows.iter().find(|f| f.path == parent_path) else { break };
    if let Ok(owner) = page.conn.call("DOM.getFrameOwner", json!({ "frameId": child.id }), parent.session.as_deref()).await {
      if let Some(backend) = owner.get("backendNodeId").and_then(Value::as_i64) {
        if let Ok(node) = page.conn.call("DOM.describeNode", json!({ "backendNodeId": backend }), parent.session.as_deref()).await {
          if let Some(attrs) = node.get("node").and_then(|n| n.get("attributes")).and_then(Value::as_array) {
            for pair in attrs.chunks_exact(2) {
              if matches!(pair[0].as_str(), Some("mid" | "data-mid")) {
                let mid = pair[1].as_str().unwrap_or("");
                if !mid.is_empty() { return mid.to_string(); }
              }
            }
            for pair in attrs.chunks_exact(2) {
              if pair[0].as_str() == Some("data") {
                if let Ok(data) = serde_json::from_str::<Value>(pair[1].as_str().unwrap_or("")) {
                  let mid = string(&data, "mid");
                  if !mid.is_empty() { return mid; }
                }
              }
            }
          }
        }
      }
    }
    path = parent_path.to_string();
  }
  String::new()
}

pub(crate) async fn hint_matches(page: &PageBind, rows: &[FrameContext], frame: &FrameContext, hint: &str) -> bool {
  if frame.id == hint || frame.path == hint || frame.name == hint || frame.url.to_lowercase().contains(&hint.to_lowercase()) { return true; }
  let parent_path = frame.path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
  if frame.path.is_empty() { return false; }
  let Some(parent) = rows.iter().find(|f| f.path == parent_path) else { return false };
  let Ok(owner) = page.conn.call("DOM.getFrameOwner", json!({ "frameId": frame.id }), parent.session.as_deref()).await else { return false };
  let Ok(node) = page.conn.call("DOM.describeNode", json!({ "backendNodeId": owner["backendNodeId"] }), parent.session.as_deref()).await else { return false };
  if let Some(attrs) = node.pointer("/node/attributes").and_then(Value::as_array) {
    for pair in attrs.chunks_exact(2) {
      let key = pair[0].as_str().unwrap_or("");
      let value = pair[1].as_str().unwrap_or("");
      if matches!(key, "id" | "name" | "mid" | "data-mid") && value.eq_ignore_ascii_case(hint) { return true; }
      if key == "src" && value.to_lowercase().contains(&hint.to_lowercase()) { return true; }
    }
  }
  !hint.is_empty() && owner_mid(page, rows, frame).await == hint
}

async fn target_tree(page: &PageBind, target: &str) -> Result<(String, Value), String> {
  use std::sync::{Mutex, OnceLock};
  static SESSIONS: OnceLock<Mutex<std::collections::HashMap<String, String>>> = OnceLock::new();
  let cache = SESSIONS.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
  let key = format!("{}:{}:{target}", page.target_id, page.session.as_deref().unwrap_or(""));
  let cached = cache.lock().ok().and_then(|map| map.get(&key).cloned());
  if let Some(sid) = cached {
    if let Ok(tree) = page.conn.call("Page.getFrameTree", json!({}), Some(&sid)).await { return Ok((sid, tree)); }
  }
  let sid = page.conn.attach(target).await?;
  let _ = page.conn.call("DOM.enable", json!({}), Some(&sid)).await;
  let tree = page.conn.call("Page.getFrameTree", json!({}), Some(&sid)).await?;
  if let Ok(mut map) = cache.lock() {
    if map.len() >= 256 { map.clear(); }
    map.insert(key, sid.clone());
  }
  Ok((sid, tree))
}

pub(crate) async fn visible(page: &PageBind, rows: &[FrameContext], frame: &FrameContext) -> bool {
  let mut path = frame.path.as_str();
  while !path.is_empty() {
    let Some(child) = rows.iter().find(|f| f.path == path) else { return false };
    let parent_path = path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
    let Some(parent) = rows.iter().find(|f| f.path == parent_path) else { return false };
    let Ok(owner) = page.conn.call("DOM.getFrameOwner", json!({ "frameId": child.id }), parent.session.as_deref()).await else { return false };
    let Ok(resolved) = page.conn.call("DOM.resolveNode", json!({ "backendNodeId": owner["backendNodeId"] }), parent.session.as_deref()).await else { return false };
    let Some(object) = resolved.pointer("/object/objectId").and_then(Value::as_str) else { return false };
    let raw = page.conn.call("Runtime.callFunctionOn", json!({ "objectId": object, "returnByValue": true,
      "functionDeclaration": "function(){var r=this.getBoundingClientRect(),s=this.ownerDocument.defaultView.getComputedStyle(this);return this.isConnected&&r.width>=2&&r.height>=2&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0;}"
    }), parent.session.as_deref()).await;
    let _ = page.conn.call("Runtime.releaseObject", json!({ "objectId": object }), parent.session.as_deref()).await;
    if raw.ok().and_then(|v| v.pointer("/result/value").and_then(Value::as_bool)) != Some(true) { return false; }
    path = parent_path;
  }
  true
}

pub async fn media_tick(id: String, locator: Value, mid: String) -> Result<Value, String> {
  let page = crate::cef::bind_page(&id).await?;
  let rows = contexts(&page).await?;
  let selected = select(&rows, &locator)?;
  let nth = locator.get("nth").and_then(Value::as_u64).unwrap_or(1).max(1);
  let tag = match locator.get("value").and_then(Value::as_str) {
    Some("audio") => "audio", Some("video") => "video", _ => "video, audio",
  };
  let script = format!(r#"(function(){{
    var list=document.querySelectorAll({tag:?}); var best=null;
    for(var i=0;i<list.length;i++){{
      if ({pinned} && i!=={index}) continue;
      var v=list[i], r=v.getBoundingClientRect(), st=getComputedStyle(v);
      if(r.width<2||r.height<2||st.display==='none'||st.visibility==='hidden') continue;
      var current=Number(v.currentTime)||0, duration=Number(v.duration)||0;
      var score=(v.paused?0:4)+(v.ended?0:2)+(current>0?1:0);
      if(!best||score>best.score) best={{hasVideo:true,current:current,duration:duration,paused:v.paused,
        ended:v.ended,src:String(v.currentSrc||v.src||''),score:score,nth:Array.from(document.querySelectorAll(v.tagName.toLowerCase())).indexOf(v)+1,value:v.tagName.toLowerCase()}};
    }}
    return best||{{hasVideo:false}};
  }})()"#, pinned = selected.is_some(), index = nth - 1);
  let mut best = json!({ "hasVideo": false });
  let mut best_score = -1;
  for frame in &rows {
    if selected.map(|f| f.id != frame.id).unwrap_or(false) { continue; }
    let frame_mid = if mid.is_empty() { String::new() } else { owner_mid(&page, &rows, frame).await };
    if !mid.is_empty() && frame_mid != mid { continue; }
    let Ok(mut tick) = evaluate(&page, frame, &script).await else { continue };
    if tick["hasVideo"].as_bool() != Some(true) { continue; }
    if !visible(&page, &rows, frame).await { continue; }
    let score = tick["score"].as_i64().unwrap_or(0);
    if score <= best_score { continue; }
    best_score = score;
    if let Some(obj) = tick.as_object_mut() {
      obj.insert("frameId".into(), json!(frame.id));
      obj.insert("loaderId".into(), json!(frame.loader_id));
      let actual_mid = if mid.is_empty() { owner_mid(&page, &rows, frame).await } else { frame_mid };
      obj.insert("mid".into(), json!(actual_mid));
    }
    best = tick;
  }
  Ok(best)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn identity_survives_reorder_but_rejects_document_replacement() {
    let mut rows = Vec::new();
    flatten(&json!({ "frame": { "id": "main" }, "childFrames": [
      { "frame": { "id": "video", "loaderId": "new", "url": "https://example.com/video" } }
    ] }), "", Some("session"), &mut rows);
    assert_eq!(select(&rows, &json!({ "frameId": "video", "loaderId": "new" })).unwrap().unwrap().path, "0");
    assert!(select(&rows, &json!({ "frameId": "video", "loaderId": "old" })).is_err());
    assert!(select(&rows, &json!({ "frameId": "removed" })).is_err());
  }

  #[test]
  fn nested_oopif_keeps_its_own_session_and_path() {
    let mut rows = Vec::new();
    flatten(&json!({ "frame": { "id": "main" }, "childFrames": [
      { "frame": { "id": "cards" }, "childFrames": [
        { "frame": { "id": "video", "loaderId": "video-doc" } }
      ] }
    ] }), "", Some("main-session"), &mut rows);
    flatten(&json!({ "frame": { "id": "cards" }, "childFrames": [
      { "frame": { "id": "video", "loaderId": "video-doc" } }
    ] }), "0", Some("cards-session"), &mut rows);
    flatten(&json!({ "frame": { "id": "video", "loaderId": "video-doc" } }), "0/0", Some("video-session"), &mut rows);
    let video = select(&rows, &json!({ "frameId": "video", "loaderId": "video-doc" })).unwrap().unwrap();
    assert_eq!(video.session.as_deref(), Some("video-session"));
    assert_eq!(video.path, "0/0");
    assert_eq!(rows.len(), 3);
  }

  #[test]
  fn deep_frames_and_late_visible_frames_keep_identity() {
    let mut tree = json!({ "frame": { "id": "leaf", "loaderId": "doc" } });
    for i in 0..6 { tree = json!({ "frame": { "id": format!("parent-{i}") }, "childFrames": [tree] }); }
    let mut rows = Vec::new();
    flatten(&tree, "", Some("main"), &mut rows);
    assert_eq!(rows.last().unwrap().path, "0/0/0/0/0/0");
    let children: Vec<_> = (0..200).map(|i| json!({ "frame": { "id": format!("frame-{i}") } })).collect();
    rows.clear();
    flatten(&json!({ "frame": { "id": "root" }, "childFrames": children }), "", None, &mut rows);
    assert!(select(&rows, &json!({ "frameId": "frame-199" })).unwrap().is_some());
  }
}
