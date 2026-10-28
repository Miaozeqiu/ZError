//! A separate user-only boundary for revealing/copying saved credentials.
//! No IPC-supplied success flag or reusable unlock token can bypass OS verification.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::Zeroizing;

static AUTHENTICATING: AtomicBool = AtomicBool::new(false);
struct AuthenticationGuard;
impl Drop for AuthenticationGuard {
    fn drop(&mut self) {
        AUTHENTICATING.store(false, Ordering::Release);
    }
}
#[derive(Clone, Copy)]
enum Action {
    Reveal,
    Copy,
}
impl Action {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "reveal" => Ok(Self::Reveal),
            "copy" => Ok(Self::Copy),
            _ => Err("不支持的凭据操作".into()),
        }
    }
    fn reason(self) -> &'static str {
        match self {
            Self::Reveal => "查看已保存的密码或 API Key",
            Self::Copy => "复制已保存的密码或 API Key",
        }
    }
}
fn authenticated_read(
    reference: &str,
    authenticate: impl FnOnce() -> Result<(), String>,
    read: impl Fn(&str) -> Result<Zeroizing<String>, String>,
) -> Result<Zeroizing<String>, String> {
    let before = read(reference)?;
    authenticate()?;
    let current = read(reference)?;
    if before.as_str() != current.as_str() {
        return Err("凭据已更改，请重新验证".into());
    }
    Ok(current)
}

#[cfg(target_os = "macos")]
fn authenticate(reason: &str) -> Result<(), String> {
    use block2::RcBlock;
    use objc2::{
        msg_send,
        rc::{autoreleasepool, Retained},
        runtime::{AnyClass, AnyObject, Bool},
    };
    use objc2_foundation::NSString;
    // Load the framework before resolving LAContext dynamically, avoiding a new SDK dependency.
    #[link(name = "LocalAuthentication", kind = "framework")]
    extern "C" {}
    autoreleasepool(|_| unsafe {
        let class = AnyClass::get(c"LAContext").ok_or("系统身份验证不可用")?;
        let context: Retained<AnyObject> = msg_send![class, new];
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let reply = RcBlock::new(move |success: Bool, error: *mut AnyObject| {
            let result = if success.as_bool() {
                Ok(())
            } else {
                let code: isize = if error.is_null() {
                    0
                } else {
                    msg_send![error, code]
                };
                Err(if [-2, -4, -9].contains(&code) {
                    "已取消系统验证，未显示或复制凭据"
                } else {
                    "系统身份验证未通过，请重试"
                }
                .to_string())
            };
            let _ = send.send(result);
        });
        let reason = NSString::from_str(reason);
        // LAPolicyDeviceOwnerAuthentication = 2: Touch ID / system sign-in password.
        let _: () = msg_send![&*context, evaluatePolicy: 2_isize, localizedReason: &*reason, reply: &*reply];
        let result = receive
            .recv_timeout(std::time::Duration::from_secs(120))
            .map_err(|_| "系统身份验证超时，请重试".to_string())
            .and_then(|r| r);
        let _: () = msg_send![&*context, invalidate];
        result
    })
}
#[cfg(not(target_os = "macos"))]
fn authenticate(_: &str) -> Result<(), String> {
    Err("当前平台尚未接入系统身份验证，已阻止显示或复制已保存的凭据".into())
}

#[tauri::command]
pub async fn secure_secret_action(
    window: tauri::WebviewWindow,
    reference: String,
    action: String,
) -> Result<Value, String> {
    crate::secret_vault::trusted_window(&window)?;
    if !window.is_focused().unwrap_or(false) {
        return Err("请在软件前台点击查看或复制凭据".into());
    }
    let action = Action::parse(&action)?;
    if AUTHENTICATING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("请先完成当前的系统验证".into());
    }
    let guard = AuthenticationGuard;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let value = authenticated_read(
            &reference,
            || authenticate(action.reason()),
            crate::secret_vault::value_for_verified_user,
        )?;
        match action {
            Action::Reveal => Ok(json!({"value":value.as_str()})),
            Action::Copy => {
                app.clipboard()
                    .write_text(value.as_str())
                    .map_err(|_| "无法写入剪贴板")?;
                Ok(json!({"copied":true}))
            }
        }
    })
    .await
    .map_err(|_| "凭据验证任务中断".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_authentication_framework_is_loaded_without_prompting() {
        assert!(objc2::runtime::AnyClass::get(c"LAContext").is_some());
    }
    #[test]
    fn cancelled_auth_never_reads_again_or_returns_a_value() {
        let reads = Cell::new(0);
        let result = authenticated_read(
            "reference",
            || Err("cancelled".into()),
            |_| {
                reads.set(reads.get() + 1);
                Ok(Zeroizing::new("synthetic-secret".into()))
            },
        );
        assert_eq!(result.unwrap_err(), "cancelled");
        assert_eq!(reads.get(), 1);
    }
    #[test]
    fn changed_or_deleted_credentials_cannot_be_revealed_by_an_older_verification() {
        let reads = Cell::new(0);
        let result = authenticated_read(
            "reference",
            || Ok(()),
            |_| {
                reads.set(reads.get() + 1);
                Ok(Zeroizing::new(
                    if reads.get() == 1 { "old" } else { "new" }.into(),
                ))
            },
        );
        assert!(result.is_err());
        let reads = Cell::new(0);
        assert!(authenticated_read(
            "reference",
            || Ok(()),
            |_| {
                reads.set(reads.get() + 1);
                if reads.get() > 1 {
                    Err("deleted".into())
                } else {
                    Ok(Zeroizing::new("old".into()))
                }
            }
        )
        .is_err());
    }
    #[test]
    fn every_operation_requires_fresh_verification_and_rejects_unknown_actions() {
        let verified = Cell::new(0);
        for _ in 0..2 {
            assert_eq!(
                authenticated_read(
                    "reference",
                    || {
                        verified.set(verified.get() + 1);
                        Ok(())
                    },
                    |_| Ok(Zeroizing::new("synthetic".into()))
                )
                .unwrap()
                .as_str(),
                "synthetic"
            );
        }
        assert_eq!(verified.get(), 2);
        assert!(Action::parse("unlock-all").is_err());
    }
}
