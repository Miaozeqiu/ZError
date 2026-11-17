//! CEF / CDP 驱动：标签、事件泵、定位、推送、DOM 读。
#![cfg(target_os = "macos")]

pub mod browser;
pub mod dom;
pub mod frames;
pub mod h264;
pub mod locate;
pub mod push;

pub use browser::*;
pub use dom::*;
pub use h264::*;
pub use locate::*;
pub use push::*;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// `DOM.getDocument` 会把这个 target 之前发出去的 nodeId 全部作废。
/// 定位（getDocument → querySelectorAll → 量盒子）和整帧读 HTML 若交错，nodeId 会半路失效，
/// 表现为「元素明明在页上却 not_found」。同一浏览器上的这类链路必须串行。
pub fn dom_lock(id: &str) -> Arc<tokio::sync::Mutex<()>> {
  static MAP: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
  let map = MAP.get_or_init(|| Mutex::new(HashMap::new()));
  let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
  guard
    .entry(id.to_string())
    .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
    .clone()
}
