//! protocol implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn protocol_arg_str(args: &serde_json::Value, key: &str) -> Option<String> {
  args.get(key).and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

pub(super) fn protocol_arg_f64(args: &serde_json::Value, key: &str) -> f64 {
  args
    .get(key)
    .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64)))
    .unwrap_or(0.0)
}

pub(super) fn protocol_json<T: serde::Serialize>(value: T) -> Result<serde_json::Value, String> {
  serde_json::to_value(value).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_protocol(
  app: AppHandle,
  id: String,
  op: String,
  args: Option<serde_json::Value>, expected_epoch: Option<u64>) -> Result<serde_json::Value, String> {
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, false, expected_epoch, async move {
  let args = args.unwrap_or(serde_json::Value::Null);
  let first = dispatch_browser_protocol(app.clone(), id.clone(), op.clone(), args.clone()).await.map(crate::secret_vault::redact_best_effort);
  #[cfg(target_os = "macos")]
  if let Err(err) = &first {
    if crate::cef_runtime::cef_enabled() && crate::cdp_client::is_session_dead(err) {
      crate::cef::drop_page_bind(&id);
      return match dispatch_browser_protocol(app, id, op, args).await {
        Err(again) if crate::cdp_client::is_session_dead(&again) => {
          Err(crate::cdp_client::HOST_CHANNEL_DOWN.into())
        }
        other => other.map(crate::secret_vault::redact_best_effort),
      };
    }
  }
  first

  }).await
}
