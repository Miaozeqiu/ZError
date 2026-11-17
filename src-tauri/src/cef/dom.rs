//! 按统一的 frame 身份读取 outerHTML，支持跨域和跨进程嵌套。
#![cfg(target_os = "macos")]

use crate::cef::bind_page;
use serde_json::{json, Value};
use tauri::AppHandle;

fn matches(frame: &crate::cef::frames::FrameContext, want: &str) -> bool {
  if want.is_empty() || want == "main" { frame.path.is_empty() }
  else { frame.id == want || frame.path == want || frame.name == want || frame.url.contains(want) }
}

pub async fn dom_frame_html(_app: AppHandle, id: String, frame: Option<String>) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let frames = crate::cef::frames::contexts(&page).await?;
  let want = frame.unwrap_or_else(|| "main".into());
  let hits: Vec<_> = frames.iter().filter(|frame| matches(frame, &want)).collect();
  if hits.len() != 1 {
    return Ok(json!({ "ok": false, "error": "目标帧不存在或不唯一", "html": "" }));
  }
  let target = hits[0];
  let frame_id = target.id.clone();
  let url = target.url.clone();
  let html = crate::cef::frames::evaluate(&page, target, "document.documentElement.outerHTML").await?
    .as_str().unwrap_or("").to_string();
  Ok(json!({
    "ok": !html.is_empty(),
    "html": html,
    "url": url,
    "frameId": frame_id,
  }))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn repeated_urls_require_identity_instead_of_first_match() {
    let mut rows = Vec::new();
    crate::cef::frames::flatten(&json!({ "frame": { "id": "root" }, "childFrames": [
      { "frame": { "id": "first", "url": "https://example.com/video" } },
      { "frame": { "id": "second", "url": "https://example.com/video" } }
    ] }), "", None, &mut rows);
    assert_eq!(rows.iter().filter(|f| matches(f, "main")).count(), 1);
    assert_eq!(rows.iter().filter(|f| matches(f, "video")).count(), 2);
    assert_eq!(rows.iter().find(|f| matches(f, "second")).unwrap().path, "1");
  }
}
