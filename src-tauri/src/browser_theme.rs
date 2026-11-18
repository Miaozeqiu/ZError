//! Publish the app's appearance through the browser engine's native media preference.
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserTheme {
    #[default]
    Auto,
    Light,
    Dark,
}

static THEME: Mutex<BrowserTheme> = Mutex::new(BrowserTheme::Auto);

#[cfg(any(windows, target_os = "macos"))]
fn current() -> BrowserTheme {
    *THEME.lock().unwrap_or_else(|err| err.into_inner())
}

#[cfg(target_os = "macos")]
pub fn apply_cef() {
    use cef::{request_context_get_global_context, ColorVariant, ImplRequestContext};
    if let Some(context) = request_context_get_global_context() {
        let variant = match current() {
            BrowserTheme::Auto => ColorVariant::SYSTEM,
            BrowserTheme::Light => ColorVariant::LIGHT,
            BrowserTheme::Dark => ColorVariant::DARK,
        };
        if context.chrome_color_scheme_mode() != variant {
            context.set_chrome_color_scheme(variant, 0);
        }
    }
}

#[cfg(windows)]
pub fn apply_webview(webview: &tauri::Webview) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows_core::Interface;
    webview
        .with_webview(|platform| unsafe {
            let scheme = match current() {
                BrowserTheme::Auto => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_AUTO,
                BrowserTheme::Light => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
                BrowserTheme::Dark => COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
            };
            let result = platform
                .controller()
                .CoreWebView2()
                .and_then(|view| view.cast::<ICoreWebView2_13>())
                .and_then(|view| view.Profile())
                .and_then(|profile| profile.SetPreferredColorScheme(scheme));
            if let Err(err) = result {
                eprintln!("[browser] WebView2 theme: {err}");
            }
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn browser_set_theme(
    app: AppHandle,
    window: tauri::Window,
    theme: BrowserTheme,
) -> Result<(), String> {
    *THEME.lock().unwrap_or_else(|err| err.into_inner()) = theme;
    let native = match theme {
        BrowserTheme::Auto => None,
        BrowserTheme::Light => Some(tauri::Theme::Light),
        BrowserTheme::Dark => Some(tauri::Theme::Dark),
    };
    window.set_theme(native).map_err(|err| err.to_string())?;
    #[cfg(target_os = "macos")]
    if crate::cef_runtime::is_ready() {
        app.run_on_main_thread(apply_cef)
            .map_err(|err| err.to_string())?;
    }
    #[cfg(windows)]
    {
        use tauri::Manager;
        for (label, view) in app.webviews() {
            if label.starts_with("app-browser-") {
                apply_webview(&view)?;
            }
        }
    }
    #[cfg(target_os = "linux")]
    app.set_theme(native);
    Ok(())
}
