//! 页内推送：视频进度 / 作业点选经 Runtime.bindingCalled 进 Rust，再广播给前端。
//! 钩子 JS 在 js/ze-tick.js；绑定名每个进程随机，页内只多一个不可枚举守卫。
#![cfg(target_os = "macos")]

use crate::cdp_client::CdpConn;
use crate::cef::{app_handle, owner_of_session_exact};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Emitter;

const HOOK_TEMPLATE: &str = include_str!("../../js/ze-tick.js");

pub fn binding_name() -> &'static str {
  static NAME: OnceLock<String> = OnceLock::new();
  NAME.get_or_init(|| {
    let raw = uuid::Uuid::new_v4().simple().to_string();
    format!("__ze{}", &raw[..8])
  })
}

fn hook_source() -> &'static str {
  static SRC: OnceLock<String> = OnceLock::new();
  SRC.get_or_init(|| HOOK_TEMPLATE.replace("__ZE_BINDING__", binding_name()))
}

#[derive(Clone)]
struct CachedTick {
  at: Instant,
  tick: Value,
}

impl CachedTick {
  fn playing(&self) -> bool {
    self.tick.get("paused").and_then(|v| v.as_bool()) == Some(false)
  }

  fn visible(&self) -> bool {
    self.tick.get("visible").and_then(|v| v.as_bool()) == Some(true)
  }

  fn has_video(&self) -> bool {
    self.tick.get("hasVideo").and_then(|v| v.as_bool()) == Some(true)
  }
}

/// browser id → mid → 最新 tick。叠着的多视频页每条各留一份，谁在播谁优先。
type TickMap = HashMap<String, HashMap<String, CachedTick>>;

fn ticks() -> &'static Mutex<TickMap> {
  static T: OnceLock<Mutex<TickMap>> = OnceLock::new();
  T.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn install_push(conn: &CdpConn, sid: Option<&str>) -> Result<(), String> {
  let _ = conn
    .call("Runtime.addBinding", json!({ "name": binding_name() }), sid)
    .await;
  let _ = conn
    .call(
      "Page.addScriptToEvaluateOnNewDocument",
      json!({ "source": hook_source() }),
      sid,
    )
    .await;
  let _ = conn.evaluate(hook_source(), sid).await;
  Ok(())
}

fn hw_ticks() -> &'static Mutex<HashMap<String, CachedTick>> {
  static H: OnceLock<Mutex<HashMap<String, CachedTick>>> = OnceLock::new();
  H.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn forget(id: &str) {
  if id.is_empty() {
    return;
  }
  if let Ok(mut map) = ticks().lock() {
    map.remove(id);
  }
  if let Ok(mut map) = hw_ticks().lock() {
    map.remove(id);
  }
}

pub fn forget_all() {
  if let Ok(mut map) = ticks().lock() {
    map.clear();
  }
  if let Ok(mut map) = hw_ticks().lock() {
    map.clear();
  }
}

fn mid_of(tick: &Value) -> String {
  tick
    .get("mid")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string()
}

/// 没指定 mid 时挑一条：在播 > 可见且有播放器 > 有播放器 > 最新。同档取最新。
fn pick_best<'a>(rows: impl Iterator<Item = &'a CachedTick>) -> Option<&'a CachedTick> {
  rows.max_by_key(|row| {
    let rank = if row.playing() {
      3
    } else if row.visible() && row.has_video() {
      2
    } else if row.has_video() {
      1
    } else {
      0
    };
    (rank, std::cmp::Reverse(row.at.elapsed()))
  })
}

pub fn last_hw(id: &str) -> Value {
  let none = json!({ "ok": false, "ageMs": null, "kind": "hw" });
  let Ok(map) = hw_ticks().lock() else {
    return none;
  };
  let Some(row) = map.get(id) else {
    return none;
  };
  json!({
    "ok": true,
    "kind": "hw",
    "tick": row.tick,
    "ageMs": row.at.elapsed().as_millis() as u64,
  })
}

pub fn last_tick(id: &str, mid: Option<&str>) -> Value {
  let none = json!({ "ok": false, "ageMs": null });
  let Ok(map) = ticks().lock() else {
    return none;
  };
  let Some(rows) = map.get(id) else {
    return none;
  };
  let want = mid.map(str::trim).filter(|m| !m.is_empty());
  let hit = match want {
    Some(m) => rows.get(m),
    None => pick_best(rows.values()),
  };
  let Some(row) = hit else {
    return none;
  };
  json!({
    "ok": true,
    "kind": "video",
    "tick": row.tick,
    "ageMs": row.at.elapsed().as_millis() as u64,
  })
}

fn remember(id: &str, tick: Value) {
  if id.is_empty() {
    return;
  }
  if let Ok(mut map) = ticks().lock() {
    map
      .entry(id.to_string())
      .or_default()
      .insert(mid_of(&tick), CachedTick { at: Instant::now(), tick });
  }
}

fn emit_tick(id: &str, kind: &str, tick: &Value) {
  let Ok(guard) = app_handle().lock() else {
    return;
  };
  let Some(app) = guard.as_ref() else {
    return;
  };
  let _ = app.emit(
    "app-browser-tick",
    json!({
      "id": id,
      "kind": kind,
      "tick": tick,
    }),
  );
}

pub fn on_binding_called(session: &str, name: &str, payload: &str) {
  if name != binding_name() {
    return;
  }
  // 只认精确登记过的 session。多标签时兜底猜 owner 会把 A 页的进度写到 B 上。
  let owner = owner_of_session_exact(session);
  if owner.is_empty() {
    // 推送到了 Rust 却认不出是谁的：计到 unowned，/live 的 cdp 行能看到；不猜归属。
    crate::cdp_client::note_unowned();
    eprintln!("[push] 收到 tick 但 session 未登记 session={session}");
    return;
  }
  let parsed: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
  let kind = parsed
    .get("kind")
    .and_then(|v| v.as_str())
    .unwrap_or("video")
    .to_string();
  if kind == "video" {
    remember(&owner, parsed.clone());
  }
  if kind == "hw" {
    if let Ok(mut map) = hw_ticks().lock() {
      map.insert(
        owner.clone(),
        CachedTick {
          at: Instant::now(),
          tick: parsed.clone(),
        },
      );
    }
  }
  emit_tick(&owner, &kind, &parsed);
}

#[cfg(test)]
mod tests {
  use super::{pick_best, CachedTick};
  use serde_json::json;
  use std::time::{Duration, Instant};

  fn row(paused: bool, visible: bool, has_video: bool, age_ms: u64) -> CachedTick {
    CachedTick {
      at: Instant::now() - Duration::from_millis(age_ms),
      tick: json!({ "paused": paused, "visible": visible, "hasVideo": has_video }),
    }
  }

  #[test]
  fn playing_beats_newer_paused() {
    let rows = vec![row(true, true, true, 10), row(false, true, true, 3000)];
    let best = pick_best(rows.iter()).unwrap();
    assert!(best.playing());
  }

  #[test]
  fn visible_beats_hidden_when_both_paused() {
    let rows = vec![row(true, false, true, 10), row(true, true, true, 500)];
    let best = pick_best(rows.iter()).unwrap();
    assert!(best.visible());
  }

  #[test]
  fn same_rank_takes_newest() {
    let rows = vec![row(true, true, true, 2000), row(true, true, true, 20)];
    let best = pick_best(rows.iter()).unwrap();
    assert!(best.at.elapsed() < Duration::from_millis(1000));
  }

  #[test]
  fn hook_has_no_leftover_placeholder() {
    assert!(!super::hook_source().contains("__ZE_BINDING__"));
    assert!(super::hook_source().contains(super::binding_name()));
  }
}
