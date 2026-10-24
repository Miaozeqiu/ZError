//! 浏览器操作权按对话共享。原生用户输入先接管，旧的自动操作租约随即失效。
use serde::Serialize;
use std::{collections::HashMap, future::Future, sync::{Mutex, OnceLock}};
use tauri::{AppHandle, Emitter};

pub const CONTROL_PAUSED: &str = "BROWSER_USER_CONTROL: 用户正在操作浏览器，Agent 已暂停；交还控制权后先重新读取页面";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlState {
  pub session_id: String,
  pub owner: String,
  pub epoch: u64,
}
#[derive(Default)]
struct Controls { groups: HashMap<String, String>, states: HashMap<String, ControlState> }
fn controls() -> &'static Mutex<Controls> {
  static STATE: OnceLock<Mutex<Controls>> = OnceLock::new();
  STATE.get_or_init(|| Mutex::new(Controls::default()))
}
fn state_for(state: &mut Controls, id: &str) -> ControlState {
  let group = state.groups.get(id).cloned().unwrap_or_else(|| id.to_string());
  state.states.entry(group.clone()).or_insert_with(|| ControlState { session_id: group, owner: "agent".into(), epoch: 0 }).clone()
}

pub fn set_owner(app: &AppHandle, id: &str, owner: &str) -> Result<ControlState, String> {
  if owner != "agent" && owner != "user" { return Err("无效的浏览器操作权".into()); }
  let (next, changed) = {
    let mut all = controls().lock().map_err(|_| "操作权状态不可用")?;
    let mut next = state_for(&mut all, id);
    let changed = next.owner != owner;
    if changed { next.owner = owner.into(); next.epoch += 1; all.states.insert(next.session_id.clone(), next.clone()); }
    (next, changed)
  };
  if changed { let _ = app.emit("app-browser-control", &next); }
  Ok(next)
}
#[tauri::command]
pub fn browser_control_register(id: String, session_id: String) -> Result<ControlState, String> {
  let mut all = controls().lock().map_err(|_| "操作权状态不可用")?;
  let previous = state_for(&mut all, &id);
  all.groups.insert(id.clone(), session_id);
  let mut next = state_for(&mut all, &id);
  if previous.owner == "user" && next.owner != "user" {
    next.owner = "user".into(); next.epoch += 1;
    all.states.insert(next.session_id.clone(), next.clone());
  }
  Ok(next)
}
#[tauri::command]
pub fn browser_control_set(app: AppHandle, id: String, owner: String) -> Result<ControlState, String> {
  set_owner(&app, &id, &owner)
}

#[derive(Clone, Debug)]
pub struct Permit { group: String, epoch: u64 }
impl Permit {
  pub fn check(&self) -> Result<(), String> {
    let all = controls().lock().map_err(|_| "操作权状态不可用")?;
    match all.states.get(&self.group) {
      Some(state) if state.owner == "agent" && state.epoch == self.epoch => Ok(()),
      _ => Err(CONTROL_PAUSED.into()),
    }
  }
}
tokio::task_local! { static PERMIT: Option<Permit>; }
pub fn current_permit() -> Option<Permit> { PERMIT.try_with(Clone::clone).ok().flatten() }
pub fn check_current() -> Result<(), String> { current_permit().map_or(Ok(()), |permit| permit.check()) }
pub fn guard_cdp(permit: &Option<Permit>, method: &str, params: &mut serde_json::Value) -> Result<(), String> {
  if let Some(permit) = permit {
    if let Err(error) = permit.check() {
      // 已按下的合成按键必须释放；鼠标在页面外释放，避免补发原目标的 click。
      match (method, params.get("type").and_then(|value| value.as_str())) {
        ("Input.dispatchKeyEvent", Some("keyUp")) => return Ok(()),
        ("Input.dispatchMouseEvent", Some("mouseReleased")) => {
          params["x"] = serde_json::json!(-1); params["y"] = serde_json::json!(-1);
          params["clickCount"] = serde_json::json!(0); return Ok(());
        }
        _ => return Err(error),
      }
    }
  }
  Ok(())
}
fn acquire(id: &str) -> Result<Permit, String> {
  let mut all = controls().lock().map_err(|_| "操作权状态不可用")?;
  let state = state_for(&mut all, id);
  if state.owner != "agent" { return Err(CONTROL_PAUSED.into()); }
  Ok(Permit { group: state.session_id, epoch: state.epoch })
}
pub async fn run<T>(id: &str, user: bool, job: impl Future<Output = Result<T, String>>) -> Result<T, String> {
  run_at(id, user, None, job).await
}
pub async fn run_at<T>(id: &str, user: bool, expected: Option<u64>, job: impl Future<Output = Result<T, String>>) -> Result<T, String> {
  let permit = if user { None } else { Some(current_permit().unwrap_or(acquire(id)?)) };
  if let Some(permit) = &permit {
    permit.check()?;
    if expected.is_some_and(|epoch| epoch != permit.epoch) { return Err(CONTROL_PAUSED.into()); }
  }
  let completed = permit.clone();
  let result = PERMIT.scope(permit, job).await;
  if let Some(permit) = completed { permit.check()?; }
  result
}

#[cfg(test)]
mod tests {
  use super::*;
  fn change(id: &str, owner: &str) {
    let mut all = controls().lock().unwrap();
    let mut next = state_for(&mut all, id); next.owner = owner.into(); next.epoch += 1;
    all.states.insert(next.session_id.clone(), next);
  }
  #[tokio::test]
  async fn user_takeover_blocks_sibling_tabs_and_invalidates_old_lease_after_resume() {
    browser_control_register("control-one".into(), "test-shared".into()).unwrap();
    browser_control_register("control-two".into(), "test-shared".into()).unwrap();
    let permit = acquire("control-one").unwrap();
    change("control-two", "user");
    assert!(permit.check().is_err());
    assert!(acquire("control-one").is_err());
    change("control-two", "agent");
    assert!(permit.check().is_err());
    assert!(acquire("control-one").is_ok());
    assert!(acquire("unrelated-control").is_ok());
  }
  #[tokio::test]
  async fn physical_user_commands_are_allowed_while_automation_is_suspended() {
    change("user-manual-control", "user");
    assert!(run("user-manual-control", false, async { Ok(()) }).await.is_err());
    assert!(run("user-manual-control", true, async { check_current() }).await.is_ok());
  }
  #[test]
  fn queued_input_is_blocked_and_pressed_buttons_are_released_off_page() {
    let permit = Some(acquire("queued-control-test").unwrap());
    change("queued-control-test", "user");
    let mut press = serde_json::json!({"type":"mousePressed","x":100,"y":200});
    assert!(guard_cdp(&permit, "Input.dispatchMouseEvent", &mut press).is_err());
    let mut release = serde_json::json!({"type":"mouseReleased","x":100,"y":200});
    assert!(guard_cdp(&permit, "Input.dispatchMouseEvent", &mut release).is_ok());
    assert_eq!(release["x"], -1); assert_eq!(release["y"], -1);
    assert!(guard_cdp(&permit, "Input.insertText", &mut serde_json::json!({"text":"old"})).is_err());
    change("queued-control-test", "agent");
    assert!(guard_cdp(&permit, "Input.dispatchMouseEvent", &mut press).is_err());
  }
  #[test]
  fn registering_an_existing_user_tab_does_not_restore_agent_control() {
    change("remap-control-tab", "user");
    let state = browser_control_register("remap-control-tab".into(), "remap-control-session".into()).unwrap();
    assert_eq!(state.owner, "user");
    assert!(acquire("remap-control-tab").is_err());
  }
}
