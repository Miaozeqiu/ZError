//! A document that has received credentials may be observed through redacted
//! snapshots, but not arbitrary eval or full screenshots. A fresh document resets it.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
static DOCUMENTS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
#[cfg(target_os = "macos")]
pub async fn loader(id: &str) -> Result<String, String> {
    let page = crate::cef::bind_page(id).await?;
    let tree = page
        .conn
        .call(
            "Page.getFrameTree",
            serde_json::json!({}),
            page.session.as_deref(),
        )
        .await?;
    tree.pointer("/frameTree/frame/loaderId")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or("无法验证页面文档身份".into())
}
pub fn mark(id: &str, loader: &str) {
    DOCUMENTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id.into(), loader.into());
}
pub async fn guard(id: &str) -> Result<(), String> {
    let previous = DOCUMENTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .cloned();
    let Some(previous) = previous else {
        return Ok(());
    };
    #[cfg(target_os = "macos")]
    if let Ok(current) = loader(id).await {
        if !previous.is_empty() && current != previous {
            DOCUMENTS
                .get()
                .unwrap()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(id);
            return Ok(());
        }
    }
    Err("当前登录文档已填写敏感凭据，禁止任意脚本和整页截图。请使用脱敏快照、原生点击或提交；登录跳转到新文档后自动恢复。".into())
}
