//! 按帧取 outerHTML。不 getDocument depth -1，只 pierce 到指定 iframe 的 contentDocument。
#![cfg(target_os = "macos")]

use crate::cef::bind_page;
use serde_json::{json, Value};
use tauri::AppHandle;

fn text_of(v: &Value, key: &str) -> String {
  v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn walk_frames<'a>(node: &'a Value, out: &mut Vec<&'a Value>) {
  out.push(node);
  if let Some(kids) = node.get("childFrames").and_then(|v| v.as_array()) {
    for kid in kids {
      walk_frames(kid, out);
    }
  }
}

pub fn pick_frame<'a>(tree: &'a Value, want: &str) -> Option<&'a Value> {
  let root = tree.get("frameTree").unwrap_or(tree);
  let mut frames = Vec::new();
  walk_frames(root, &mut frames);
  let needle = want.trim().to_ascii_lowercase();
  if needle.is_empty() || needle == "main" {
    return frames.first().copied();
  }
  frames.into_iter().find(|node| {
    let frame = node.get("frame").unwrap_or(node);
    let url = text_of(frame, "url").to_ascii_lowercase();
    let name = text_of(frame, "name").to_ascii_lowercase();
    url.contains(&needle) || name.contains(&needle)
  })
}

async fn outer_html_by_node(conn: &crate::cdp_client::CdpConn, sid: Option<&str>, node_id: u64, backend: bool) -> String {
  if node_id == 0 {
    return String::new();
  }
  let params = if backend {
    json!({ "backendNodeId": node_id })
  } else {
    json!({ "nodeId": node_id })
  };
  conn
    .call("DOM.getOuterHTML", params, sid)
    .await
    .ok()
    .and_then(|v| v.get("outerHTML").and_then(|x| x.as_str()).map(str::to_string))
    .unwrap_or_default()
}

pub async fn dom_frame_html(_app: AppHandle, id: String, frame: Option<String>) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let lock = crate::cef::dom_lock(&id);
  let _held = lock.lock().await;
  let sid = page.session.as_deref();
  let _ = page.conn.call("DOM.enable", json!({}), sid).await;
  let _ = page.conn.call("Page.enable", json!({}), sid).await;
  let tree = page
    .conn
    .call("Page.getFrameTree", json!({}), sid)
    .await
    .unwrap_or(Value::Null);
  let want = frame.unwrap_or_else(|| "main".into());
  let Some(hit) = pick_frame(&tree, &want) else {
    return Ok(json!({ "ok": false, "error": "没有匹配的帧", "html": "" }));
  };
  let frame_obj = hit.get("frame").unwrap_or(hit);
  let frame_id = text_of(frame_obj, "id");
  let url = text_of(frame_obj, "url");
  if frame_id.is_empty() {
    return Ok(json!({ "ok": false, "error": "帧没有 id", "html": "" }));
  }
  let is_main = want.trim().is_empty() || want == "main" || pick_frame(&tree, "main").and_then(|n| n.get("frame")).map(|f| text_of(f, "id") == frame_id).unwrap_or(false);
  let html = if is_main {
    let doc = page.conn.call("DOM.getDocument", json!({ "depth": 0 }), sid).await.unwrap_or(Value::Null);
    let nid = doc.get("root").and_then(|r| r.get("nodeId")).and_then(|x| x.as_u64()).unwrap_or(0);
    outer_html_by_node(&page.conn, sid, nid, false).await
  } else {
    let owner = page
      .conn
      .call("DOM.getFrameOwner", json!({ "frameId": frame_id }), sid)
      .await
      .ok();
    let backend = owner
      .as_ref()
      .and_then(|v| v.get("backendNodeId"))
      .and_then(|x| x.as_u64())
      .unwrap_or(0);
    let described = if backend > 0 {
      page
        .conn
        .call("DOM.describeNode", json!({ "backendNodeId": backend, "pierce": true, "depth": 1 }), sid)
        .await
        .ok()
    } else {
      None
    };
    let content = described.as_ref().and_then(|v| v.get("node")).and_then(|n| n.get("contentDocument"));
    let content_backend = content.and_then(|d| d.get("backendNodeId")).and_then(|x| x.as_u64()).unwrap_or(0);
    let content_node = content.and_then(|d| d.get("nodeId")).and_then(|x| x.as_u64()).unwrap_or(0);
    if content_backend > 0 {
      outer_html_by_node(&page.conn, sid, content_backend, true).await
    } else {
      outer_html_by_node(&page.conn, sid, content_node, false).await
    }
  };
  Ok(json!({
    "ok": !html.is_empty(),
    "html": html,
    "url": url,
    "frameId": frame_id,
  }))
}

#[cfg(test)]
mod tests {
  use super::pick_frame;
  use serde_json::json;

  #[test]
  fn picks_main_and_url_substring() {
    let tree = json!({
      "frameTree": {
        "frame": { "id": "1", "url": "https://mooc1.chaoxing.com/mycourse/studentstudy" },
        "childFrames": [
          { "frame": { "id": "2", "url": "https://mooc1.chaoxing.com/nodedetailcontroller/visitnodedetail?coursetree=1" } },
          { "frame": { "id": "3", "url": "https://mooc1.chaoxing.com/knowledge/cards?mid=1" } }
        ]
      }
    });
    assert_eq!(pick_frame(&tree, "main").unwrap()["frame"]["id"], "1");
    assert_eq!(pick_frame(&tree, "coursetree").unwrap()["frame"]["id"], "2");
    assert_eq!(pick_frame(&tree, "knowledge/cards").unwrap()["frame"]["id"], "3");
    assert!(pick_frame(&tree, "missing").is_none());
  }
}
