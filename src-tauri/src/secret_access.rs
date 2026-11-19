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

pub(crate) fn window_is_foreground(window: &tauri::Window) -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        // WebView2 can hold focus while its top-level app window is in front.
        window.hwnd().is_ok_and(|hwnd| {
            let foreground = unsafe { GetForegroundWindow() };
            foreground.0 != 0 && foreground.0 == hwnd.0 as isize
        })
    }
    #[cfg(not(windows))]
    window.is_focused().unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn authenticate(_: &tauri::Window, reason: &str) -> Result<(), String> {
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
#[cfg(windows)]
fn authenticate(window: &tauri::Window, reason: &str) -> Result<(), String> {
    use windows::{
        core::{factory, HSTRING},
        Foundation::{AsyncOperationCompletedHandler, AsyncStatus, IAsyncOperation},
        Security::Credentials::UI::{
            UserConsentVerificationResult as Consent, UserConsentVerifier,
        },
        Win32::{
            Foundation::HWND,
            System::WinRT::{
                IUserConsentVerifierInterop, RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED,
            },
            UI::WindowsAndMessaging::GetForegroundWindow,
        },
    };

    struct RuntimeApartment;
    impl Drop for RuntimeApartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    let handle = window.hwnd().map_err(|_| "无法获取系统验证窗口")?;
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
        .map_err(|_| "无法初始化 Windows 系统身份验证")?;
    let _apartment = RuntimeApartment;
    let (started, request) = tokio::sync::oneshot::channel();
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let reason = reason.to_owned();
    let hwnd_value = handle.0 as isize;
    // Launch the modal from its owner's UI thread. Only the worker waits for
    // completion, so the owner can keep processing activation and input.
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let hwnd = HWND(hwnd_value);
                if hwnd.0 == 0 || unsafe { GetForegroundWindow() } != hwnd {
                    return Err("请在软件前台点击查看或复制凭据");
                }
                // Wry has already initialized the UI thread's STA for WebView2.
                let verifier = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
                    .map_err(|_| "此 Windows 版本无法使用 Windows Hello 验证")?;
                let operation: IAsyncOperation<Consent> = unsafe {
                    verifier.RequestVerificationForWindowAsync(hwnd, &HSTRING::from(reason))
                }
                .map_err(|_| "无法打开 Windows Hello 验证，请检查 Windows 登录选项")?;
                if operation
                    .SetCompleted(&AsyncOperationCompletedHandler::new(move |_, status| {
                        let _ = send.try_send(status);
                        Ok(())
                    }))
                    .is_err()
                {
                    let _ = operation.Cancel();
                    return Err("无法等待 Windows Hello 验证");
                }
                Ok(operation)
            })();
            if let Err(Ok(operation)) = started.send(result) {
                let _ = operation.Cancel();
            }
        })
        .map_err(|_| "无法在主窗口发起 Windows Hello 验证")?;
    let operation = request
        .blocking_recv()
        .map_err(|_| "Windows Hello 验证未启动")??;
    match receive.recv_timeout(std::time::Duration::from_secs(120)) {
        Ok(status) if status == AsyncStatus::Canceled => {
            return Err("已取消系统验证，未显示或复制凭据".into());
        }
        Ok(_) => {}
        Err(_) => {
            let _ = operation.Cancel();
            return Err("Windows Hello 验证超时，请重试".into());
        }
    }
    let result = operation
        .GetResults()
        .map_err(|_| "Windows Hello 验证未完成")?;
    match result {
        Consent::Verified => Ok(()),
        Consent::Canceled => Err("已取消系统验证，未显示或复制凭据".into()),
        Consent::DeviceNotPresent | Consent::NotConfiguredForUser => {
            Err("请先在 Windows 登录选项中设置 Windows Hello".into())
        }
        Consent::DisabledByPolicy => Err("系统策略禁用了 Windows Hello 验证".into()),
        _ => Err("Windows Hello 身份验证未通过，请重试".into()),
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn authenticate(_: &tauri::Window, _: &str) -> Result<(), String> {
    Err("当前平台尚未接入系统身份验证，已阻止显示或复制已保存的凭据".into())
}

#[tauri::command]
pub async fn secure_secret_action(
    webview: tauri::Webview,
    reference: String,
    action: String,
) -> Result<Value, String> {
    crate::secret_vault::trusted_webview(&webview)?;
    let window = webview.window();
    if !window_is_foreground(&window) {
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
            || authenticate(&window, action.reason()),
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
