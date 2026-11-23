use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{LogicalPosition, LogicalSize, Rect, Webview};
use tokio::sync::oneshot;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::Win32::{Foundation::HWND, UI::Input::KeyboardAndMouse::EnableWindow};
use windows_core::{Interface, PCWSTR};
use zeroize::Zeroizing;

use crate::browser_geometry::{PAGE_H, PAGE_W};

pub(crate) async fn call(
    webview: &Webview,
    method: &'static str,
    params: Zeroizing<String>,
    error: &'static str,
) -> Result<Value, String> {
    call_ms(webview, method, params, error, 5000).await
}

pub(crate) async fn call_ms(
    webview: &Webview,
    method: &'static str,
    params: Zeroizing<String>,
    error: &'static str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let (send, receive) = oneshot::channel();
    let permit = crate::browser_control::current_permit();
    webview
        .with_webview(move |platform| {
            if send.is_closed() {
                return;
            }
            if let Some(error) = permit.as_ref().and_then(|permit| permit.check().err()) {
                let _ = send.send(Err(error));
                return;
            }
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                let _ = send.send(Err(error.into()));
                return;
            };
            let method: Vec<u16> = method.encode_utf16().chain([0]).collect();
            let params = Zeroizing::new(params.encode_utf16().chain([0]).collect::<Vec<_>>());
            let completion = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |result, payload| {
                    let parsed = result
                        .ok()
                        .and_then(|_| serde_json::from_str::<Value>(&payload).ok())
                        .filter(|value| value.get("exceptionDetails").is_none())
                        .ok_or_else(|| error.into());
                    let _ = send.send(parsed);
                    Ok(())
                },
            ));
            // The callback is dropped on a synchronous COM failure, which closes receive.
            let _ = unsafe {
                core.CallDevToolsProtocolMethod(
                    PCWSTR(method.as_ptr()),
                    PCWSTR(params.as_ptr()),
                    &completion,
                )
            };
        })
        .map_err(|_| error)?;
    tokio::time::timeout(Duration::from_millis(timeout_ms.clamp(80, 35000)), receive)
        .await
        .map_err(|_| error)?
        .map_err(|_| error)?
}

static PREVIEWS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub(crate) async fn set_audio_muted(webview: &Webview, muted: bool) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
    let (send, receive) = oneshot::channel();
    webview.with_webview(move |platform| {
        let result = unsafe {
            platform.controller().CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_8>())
                .and_then(|core| core.SetIsMuted(muted))
        }.map_err(|err| format!("无法设置 Windows 浏览器静音: {err}"));
        let _ = send.send(result);
    }).map_err(|err| err.to_string())?;
    receive.await.map_err(|err| err.to_string())?
}

pub(crate) async fn screenshot(webview: &Webview) -> Result<Value, String> {
    let shot = call(webview, "Page.captureScreenshot", Zeroizing::new(json!({
        "format": "jpeg", "quality": 55, "fromSurface": true,
        "captureBeyondViewport": false,
    }).to_string()), "Windows 浏览器截图失败").await?;
    let data = shot["data"].as_str().filter(|data| !data.is_empty()).ok_or("截图为空")?;
    Ok(json!({
        "url": webview.url().map_err(|err| err.to_string())?.as_str(),
        "image": format!("data:image/jpeg;base64,{data}"),
    }))
}

fn previews() -> &'static Mutex<HashSet<String>> {
    PREVIEWS.get_or_init(Default::default)
}

pub(crate) fn forget_preview(id: &str) {
    previews()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(id);
}

fn browser_host(platform: &tauri::webview::PlatformWebview) -> Result<HWND, String> {
    let mut host = Default::default();
    unsafe { platform.controller().ParentWindow(&mut host) }.map_err(|err| err.to_string())?;
    Ok(HWND(host.0 as isize))
}

fn apply_input(host: HWND, id: &str, preview: bool) {
    let enabled = !preview && crate::browser_control::user_input_allowed(id);
    let _ = unsafe { EnableWindow(host, enabled) };
}

pub(crate) async fn refresh_browser_input(webview: &Webview, id: String) -> Result<(), String> {
    let (send, receive) = oneshot::channel();
    webview
        .with_webview(move |platform| {
            let result = browser_host(&platform).map(|host| {
                let preview = previews()
                    .lock()
                    .unwrap_or_else(|err| err.into_inner())
                    .contains(&id);
                apply_input(host, &id, preview);
            });
            let _ = send.send(result);
        })
        .map_err(|err| err.to_string())?;
    receive.await.map_err(|err| err.to_string())?
}

pub(crate) async fn set_browser_bounds(
    webview: &Webview,
    id: String,
    (x, y, width, height): (f64, f64, f64, f64),
    preview: bool,
) -> Result<(), String> {
    let width = width.max(1.0);
    let height = height.max(1.0);
    let scale = (width / PAGE_W).min(height / PAGE_H);
    let fitted_width = PAGE_W * scale;
    let fitted_height = PAGE_H * scale;
    let params = json!({
        "width": PAGE_W as u32,
        "height": PAGE_H as u32,
        "deviceScaleFactor": 0,
        "mobile": false,
        "scale": scale,
        "dontSetVisibleSize": true,
    });
    // CSS layout dimensions stay fixed; the scale only affects presentation.
    call(
        webview,
        "Emulation.setDeviceMetricsOverride",
        Zeroizing::new(params.to_string()),
        "无法设置 Windows 浏览器的固定视口",
    )
    .await?;
    webview
        .set_bounds(Rect {
            position: LogicalPosition::new(
                (x + (width - fitted_width) / 2.0).max(0.0),
                (y + (height - fitted_height) / 2.0).max(0.0),
            )
            .into(),
            size: LogicalSize::new(fitted_width, fitted_height).into(),
        })
        .map_err(|err| err.to_string())?;

    let (send, receive) = oneshot::channel();
    webview
        .with_webview(move |platform| {
            let result = browser_host(&platform).and_then(|host| {
                if preview {
                    previews()
                        .lock()
                        .unwrap_or_else(|err| err.into_inner())
                        .insert(id.clone());
                } else {
                    forget_preview(&id);
                }
                apply_input(host, &id, preview);
                set_preview_region(host, preview)
            });
            let _ = send.send(result);
        })
        .map_err(|err| err.to_string())?;
    receive.await.map_err(|err| err.to_string())?
}

fn set_preview_region(host: HWND, preview: bool) -> Result<(), String> {
    use windows::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn, HRGN},
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::GetWindowRect},
    };

    // Match the CSS preview radius in device pixels. The native child sits
    // above that CSS container, so the HWND must apply its own clip.
    const PREVIEW_RADIUS: f64 = 12.0;
    unsafe {
        let region = if preview {
            let mut bounds = RECT::default();
            GetWindowRect(host, &mut bounds).map_err(|err| err.to_string())?;
            let width = bounds.right - bounds.left;
            let height = bounds.bottom - bounds.top;
            let dpi_scale = f64::from(GetDpiForWindow(host)) / 96.0;
            let diameter = ((2.0 * PREVIEW_RADIUS * dpi_scale).round() as i32)
                .min(width.min(height))
                .max(1);
            let region = CreateRoundRectRgn(0, 0, width, height, diameter, diameter);
            if region.is_invalid() {
                return Err("无法创建 Windows 浏览器预览的圆角区域".into());
            }
            region
        } else {
            HRGN::default()
        };
        if SetWindowRgn(host, region, true) == 0 {
            if preview {
                let _ = DeleteObject(region);
            }
            return Err("无法裁剪 Windows 浏览器预览".into());
        }
    }
    Ok(())
}

// Read live page identity for the handoff without exposing DOM or form values.
pub(crate) async fn snapshot(webview: &Webview) -> Result<Value, String> {
    let tree = call(
        webview,
        "Page.getFrameTree",
        Zeroizing::new("{}".into()),
        "无法确认 Windows 浏览器的当前页面",
    )
    .await?;
    let frame = tree
        .pointer("/frameTree/frame")
        .ok_or("浏览器页面尚未就绪")?;
    let frame_id = frame["id"].as_str().ok_or("缺少浏览器页面身份")?;
    let loader_id = frame["loaderId"].as_str().ok_or("缺少浏览器文档身份")?;
    let url = frame["url"].as_str().ok_or("缺少浏览器页面地址")?;
    Ok(json!({
        "url": url,
        "frames": [{"frameId": frame_id, "loaderId": loader_id, "framePath": "", "url": url}],
    }))
}
