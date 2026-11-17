//! Isolated native WKWebView harness. No database, browser agent or model calls.
//! Run `bash scripts/cargo.sh run --offline --example scroll_smoke` with Vite running.
#[cfg(all(target_os = "macos", debug_assertions))]
#[path = "../src/macos_wheel.rs"]
mod macos_wheel;

#[cfg(all(target_os = "macos", debug_assertions))]
#[tauri::command]
fn scroll_smoke_diagnostics() -> serde_json::Value { macos_wheel::debug_snapshot() }

#[cfg(all(target_os = "macos", debug_assertions))]
#[tauri::command]
async fn scroll_smoke_input(window: tauri::WebviewWindow, y: i32, precise: bool) -> Result<serde_json::Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window.run_on_main_thread(move || { let _ = tx.send(macos_wheel::debug_input(y, precise)); }).map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}
#[cfg(all(target_os = "macos", debug_assertions))]
#[tauri::command]
fn scroll_smoke_report(app: tauri::AppHandle, report: serde_json::Value) {
    println!("WKWEBVIEW_SCROLL_REPORT={report}");
    app.exit(if report["passed"] == true { 0 } else { 1 });
}
#[cfg(all(target_os = "macos", debug_assertions))]
fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.zerror.scroll-smoke".into();
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scroll_smoke_diagnostics, scroll_smoke_input, scroll_smoke_report])
        .setup(|app| {
            let window = tauri::WebviewWindowBuilder::new(app, "main",
                tauri::WebviewUrl::External("http://localhost:1420/testdata/browser/chat-scroll-smoke.html?autorun=1".parse()?))
                .title("WKWebView 滚动验证")
                .inner_size(1000.0, 700.0).focused(false).build()?;
            // Test events go directly to this window; physical input must not
            // interfere with the automated run or capture the user's mouse.
            window.set_ignore_cursor_events(true)?;
            macos_wheel::install(&window)?;
            Ok(())
        })
        .build(context).expect("WKWebView smoke harness");
    std::process::exit(app.run_return(|_, _| {}));
}
#[cfg(not(all(target_os = "macos", debug_assertions)))]
fn main() { eprintln!("This harness requires a macOS debug build."); }
