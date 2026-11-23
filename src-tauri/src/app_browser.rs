mod evaluation;
#[cfg(target_os = "linux")]
mod evaluation_linux;
pub use evaluation::*;
mod protocol;
mod documents;
pub use protocol::*;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use url::Url;

const LABEL_PREFIX: &str = "app-browser-";
const SAFARI_UA: &str =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

#[derive(Clone, Serialize)]
pub struct BrowserPageState {
  pub id: String,
  pub url: String,
  pub title: String,
}

#[derive(Clone, Serialize)]
pub struct BrowserLoadState {
  id: String,
  phase: String,
  url: String,
}

#[derive(Clone, Serialize)]
pub struct CdpActResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub text: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub snapshot: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub filled: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub length: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub hint: Option<String>,
}

fn label_for(id: &str) -> Result<String, String> {
  let id = id.trim();
  if id.is_empty()
    || !id
      .chars()
      .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '/' | ':'))
  {
    return Err("浏览器标识无效".into());
  }
  Ok(format!("{LABEL_PREFIX}{id}"))
}

fn id_from_label(label: &str) -> Option<&str> {
  label.strip_prefix(LABEL_PREFIX)
}

pub(crate) fn is_home(raw: &str) -> bool {
  let trimmed = raw.trim();
  trimmed.is_empty() || trimmed == "zerror://home" || trimmed.contains("browser-home.html")
}

fn home_webview_url() -> WebviewUrl {
  if cfg!(debug_assertions) {
    WebviewUrl::External("http://localhost:1420/browser-home.html".parse().unwrap())
  } else {
    WebviewUrl::App("/browser-home.html".into())
  }
}

fn home_nav_url() -> Url {
  if cfg!(debug_assertions) {
    "http://localhost:1420/browser-home.html".parse().unwrap()
  } else {
    Url::parse("tauri://localhost/browser-home.html")
      .or_else(|_| Url::parse("https://tauri.localhost/browser-home.html"))
      .expect("home url")
  }
}

pub fn parse_browser_url(raw: &str) -> Result<Url, String> {
  parse_url(raw)
}

pub(crate) fn parse_url(raw: &str) -> Result<Url, String> {
  if is_home(raw) {
    return Ok(home_nav_url());
  }
  let trimmed = raw.trim();
  let candidate = if trimmed.contains("://") {
    trimmed.to_string()
  } else {
    format!("https://{trimmed}")
  };
  let url = Url::parse(&candidate).map_err(|err| format!("地址无效: {err}"))?;
  match url.scheme() {
    "http" | "https" | "tauri" => Ok(url),
    _ => Err("只支持 http/https 地址".into()),
  }
}

fn open_webview_url(raw: &str) -> Result<WebviewUrl, String> {
  if is_home(raw) {
    return Ok(home_webview_url());
  }
  Ok(WebviewUrl::External(parse_url(raw)?))
}

fn parent_window(app: &AppHandle) -> Result<tauri::Window, String> {
  app
    .get_webview("main")
    .map(|webview| webview.window())
    .ok_or_else(|| "主窗口不存在".into())
}

pub(crate) fn find_browser(app: &AppHandle, id: &str) -> Result<tauri::Webview, String> {
  let label = label_for(id)?;
  app
    .get_webview(&label)
    .ok_or_else(|| "浏览器尚未打开".into())
}

fn shared_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|err| err.to_string())?
    .join("app-browsers")
    .join("profile");
  std::fs::create_dir_all(&dir).map_err(|err| format!("创建浏览器数据目录失败: {err}"))?;
  Ok(dir)
}

#[cfg(target_os = "macos")]
pub(crate) fn round_browser_view(view: &objc2_app_kit::NSView) {
  // Native child views sit above the app's WKWebView, so CSS overflow cannot clip them.
  // Match .browser-screen's 12px radius minus its 1px border; leave page scaling untouched.
  view.setWantsLayer(true);
  if let Some(layer) = view.layer() {
    layer.setCornerRadius(11.0);
    layer.setMasksToBounds(true);
  }
}

#[cfg(target_os = "macos")]
struct NativeInputView { view: usize, preview: bool }
#[cfg(target_os = "macos")]
fn fallback_input_views() -> &'static Mutex<HashMap<String, NativeInputView>> {
  static VIEWS: OnceLock<Mutex<HashMap<String, NativeInputView>>> = OnceLock::new();
  VIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}
#[cfg(target_os = "macos")]
pub(crate) fn fallback_user_input_target(event: &objc2_app_kit::NSEvent) -> Option<String> {
  let views = fallback_input_views().lock().ok()?;
  for (id, entry) in views.iter() {
    let view = unsafe { &*(entry.view as *const objc2_app_kit::NSView) };
    if entry.preview || view.isHiddenOrHasHiddenAncestor() { continue; }
    if crate::cef::native_event_targets_view(event, view) { return Some(id.clone()); }
  }
  None
}
#[cfg(target_os = "macos")]
pub(crate) fn clear_fallback_user_focus(app: &AppHandle, session: &str) -> Result<(), String> {
  let session = session.to_string();
  app.run_on_main_thread(move || {
    if let Ok(views) = fallback_input_views().lock() {
      for (id, entry) in views.iter() {
        if !crate::browser_control::session_owns_tab(&session, id) { continue; }
        let view = unsafe { &*(entry.view as *const objc2_app_kit::NSView) };
        if let Some(window) = view.window() {
          if let Some(responder) = window.firstResponder() {
            let is_view: bool = unsafe { objc2::msg_send![&*responder, isKindOfClass: objc2::class!(NSView)] };
            if is_view && unsafe { (&*(objc2::rc::Retained::as_ptr(&responder) as *const objc2_app_kit::NSView)).isDescendantOf(view) } {
              let _ = window.makeFirstResponder(None);
            }
          }
        }
      }
    }
  }).map_err(|error| error.to_string())
}

async fn apply_bounds(
  webview: &tauri::Webview, id: &str, bounds: (f64, f64, f64, f64), preview: bool,
) -> Result<(), String> {
  #[cfg(windows)]
  return crate::webview2::set_browser_bounds(webview, id.to_owned(), bounds, preview).await;
  #[cfg(not(windows))]
  {
  let (x, y, width, height) = bounds;
  let _ = (id, preview);
  let width = width.max(1.0);
  let height = height.max(1.0);
  // 一次 set_bounds，避免 set_position + set_size 各打一帧 setFrame，拖窗口时 WK 更容易白屏。
  webview
    .set_bounds(tauri::Rect {
      position: LogicalPosition::new(x.max(0.0), y.max(0.0)).into(),
      size: LogicalSize::new(width, height).into(),
    })
    .map_err(|err| err.to_string())?;
  Ok(())
  }
}

fn hidden_since() -> &'static Mutex<HashMap<String, Instant>> {
  static MAP: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn mark_shown(id: &str) {
  if let Ok(mut map) = hidden_since().lock() {
    map.remove(id);
  }
}

fn mark_hidden(id: &str) {
  if let Ok(mut map) = hidden_since().lock() {
    map.entry(id.to_string()).or_insert_with(Instant::now);
  }
}

pub(crate) fn forget_view(id: &str) {
  if let Ok(mut urls) = last_urls().lock() { urls.remove(id); }
  #[cfg(windows)]
  crate::webview2::forget_preview(id);
  if let Ok(mut map) = hidden_since().lock() {
    map.remove(id);
  }
}

fn hide_webview(webview: &tauri::Webview, id: &str) {
  let _ = webview.hide();
  mark_hidden(id);
}

fn browser_labels(app: &AppHandle) -> Vec<String> {
  app
    .webviews()
    .into_iter()
    .filter(|(label, _)| id_from_label(label).is_some())
    .map(|(label, _)| label)
    .collect()
}

#[cfg(windows)]
pub(crate) async fn refresh_browser_input(app: &AppHandle, session: &str) -> Result<(), String> {
  for label in browser_labels(app) {
    let Some(id) = id_from_label(&label) else { continue; };
    if crate::browser_control::session_owns_tab(session, id) {
      if let Some(webview) = app.get_webview(&label) {
        crate::webview2::refresh_browser_input(&webview, id.to_owned()).await?;
      }
    }
  }
  Ok(())
}

fn hide_other_browsers(app: &AppHandle, keep_label: &str) {
  for label in browser_labels(app) {
    if label == keep_label {
      continue;
    }
    if let Some(webview) = app.get_webview(&label) {
      if let Some(id) = id_from_label(&label) {
        hide_webview(&webview, id);
      }
    }
  }
}

fn hide_all_browsers(app: &AppHandle) {
  for label in browser_labels(app) {
    if let Some(webview) = app.get_webview(&label) {
      if let Some(id) = id_from_label(&label) {
        hide_webview(&webview, id);
      }
    }
  }
}

pub(crate) fn new_browser_id() -> String {
  format!(
    "{:x}{:x}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|value| value.as_nanos())
      .unwrap_or(0),
    std::process::id()
  )
}

pub(crate) fn emit_state(app: &AppHandle, id: &str, url: String, title: String) {
  let _ = app.emit(
    "app-browser-state",
    BrowserPageState {
      id: id.to_string(),
      url,
      title,
    },
  );
}

pub(crate) fn emit_load(app: &AppHandle, id: &str, phase: &str, url: String) {
  let _ = app.emit(
    "app-browser-load",
    BrowserLoadState {
      id: id.to_string(),
      phase: phase.to_string(),
      url,
    },
  );
}

pub(crate) fn emit_opened(app: &AppHandle, id: &str, url: String, opener_id: Option<&str>) {
  let _ = app.emit(
    "app-browser-opened",
    serde_json::json!({ "id": id, "url": url, "title": "", "openerId": opener_id }),
  );
}

fn last_urls() -> &'static Mutex<HashMap<String, String>> {
  static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn remember_url(id: &str, url: &str) {
  if url.is_empty() {
    return;
  }
  if let Ok(mut map) = last_urls().lock() {
    map.insert(id.to_string(), url.to_string());
  }
}

pub(crate) fn remembered_url(id: &str) -> String {
  last_urls()
    .lock()
    .ok()
    .and_then(|map| map.get(id).cloned())
    .unwrap_or_default()
}

/// Popup protocol validation is generic; page navigation rules belong to packages.
pub(crate) fn popup_should_drop(_opener: &str, raw: &str) -> bool {
  !url::Url::parse(raw.trim()).is_ok_and(|url| matches!(url.scheme(), "https" | "http") && url.host_str().is_some() && url.username().is_empty() && url.password().is_none())
}

fn defer_off_webview(app: AppHandle, job: impl FnOnce(&AppHandle) + Send + 'static) {
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_millis(40));
    let _ = app.clone().run_on_main_thread(move || job(&app));
  });
}

fn handle_deferred_popup(app: &AppHandle, opener_id: &str, opener_url: &str, raw: &str) {
  if popup_should_drop(opener_url, raw) {
    return;
  }
  emit_opened(app, &new_browser_id(), raw.to_string(), Some(opener_id));
}

/// 导航页点卡片：立刻清空画面并通知宿主，再 no-referrer 跳转。
const BROWSER_HOME_LAUNCH: &str = r#"(function(){
  try {
    if (!/\/browser-home\.html(?:$|[?#])/i.test(String(location.href || ''))) return;
  } catch (e) { return; }
  if (window.__ZE_HOME_LAUNCH__) return;
  window.__ZE_HOME_LAUNCH__ = true;
  document.addEventListener('click', function(event) {
    if (event.defaultPrevented || event.button) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var node = event.target;
    var link = node && node.closest ? node.closest('a.site') : null;
    var href = link && link.href;
    if (!href || href === location.href) return;
    event.preventDefault();
    event.stopPropagation();
    try { document.title = 'ZRNAV:' + href; } catch (e2) {}
    try {
      if (document.body) document.body.replaceChildren();
    } catch (e3) {}
    try {
      var meta = document.querySelector('meta[name="referrer"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'referrer';
        document.head.appendChild(meta);
      }
      meta.content = 'no-referrer';
    } catch (e4) {}
    location.replace(href);
  }, true);
})();"#;

fn pending_evals() -> &'static Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>> {
  static MAP: OnceLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn take_eval(token: &str) -> Option<tokio::sync::oneshot::Sender<String>> {
  pending_evals().lock().ok()?.remove(token)
}

fn handle_title_change(app: &AppHandle, id: &str, url: String, title: String) {
  if let Some(rest) = title.strip_prefix("ZRRESULT:") {
    if let Some((token, payload)) = rest.split_once(':') {
      if let Some(tx) = take_eval(token) {
        let _ = tx.send(payload.to_string());
      }
    }
    return;
  }
  // 导航页卡片一点就先改标题，地址栏/进度条立刻跟上，不用等外站开始加载。
  if let Some(rest) = title.strip_prefix("ZRNAV:") {
    let target = rest.trim();
    if target.starts_with("http://") || target.starts_with("https://") {
      remember_url(id, target);
      emit_load(app, id, "started", target.to_string());
      emit_state(app, id, target.to_string(), String::new());
    }
    return;
  }
  emit_state(app, id, url, title);
}

#[tauri::command]
pub async fn browser_open(
  app: AppHandle,
  id: String,
  url: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
  hidden: Option<bool>,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::open(app, id, url, x, y, width, height, hidden.unwrap_or(false)).await;
  }
  {
  let label = label_for(&id)?;
  let parsed = open_webview_url(&url)?;
  if !hidden.unwrap_or(false) {
    hide_other_browsers(&app, &label);
  }
  if let Some(existing) = app.get_webview(&label) {
    if hidden.unwrap_or(false) { return Ok(()); }
    apply_bounds(&existing, &id, (x, y, width, height), false).await?;
    existing.show().map_err(|err| err.to_string())?;
    mark_shown(&id);
    return Ok(());
  }

  let window = parent_window(&app)?;
  let data_dir = shared_data_dir(&app)?;
  let state_id = id.clone();
  let title_id = id.clone();
  let popup_app = app.clone();
  let popup_id = id.clone();
  remember_url(&id, &url);

  let builder = WebviewBuilder::new(&label, parsed)
    .data_directory(data_dir)
    .focused(!hidden.unwrap_or(false))
    .accept_first_mouse(true)
    .user_agent(SAFARI_UA)
    .initialization_script_for_all_frames(BROWSER_HOME_LAUNCH)
    .on_new_window(move |url, _features| {
      if url.scheme() != "http" && url.scheme() != "https" {
        return NewWindowResponse::Deny;
      }
      let raw = url.to_string();
      let opener_url = remembered_url(&popup_id);
      let opener_id = popup_id.clone();
      defer_off_webview(popup_app.clone(), move |app| {
        handle_deferred_popup(app, &opener_id, &opener_url, &raw);
      });
      NewWindowResponse::Deny
    })
    .on_page_load(move |webview, payload| {
      let next = payload.url().to_string();
      remember_url(&state_id, &next);
      match payload.event() {
        PageLoadEvent::Started => {
          emit_load(webview.app_handle(), &state_id, "started", next.clone());
          if !next.is_empty() && !next.starts_with("about:") {
            emit_state(webview.app_handle(), &state_id, next, String::new());
          }
        }
        PageLoadEvent::Finished => {
          emit_load(webview.app_handle(), &state_id, "finished", next.clone());
          emit_state(webview.app_handle(), &state_id, next, String::new());
        }
      }
    })
    .on_document_title_changed(move |webview, title| {
      let url = webview
        .url()
        .map(|value| value.to_string())
        .unwrap_or_default();
      if !title.starts_with("ZR") {
        remember_url(&title_id, &url);
      }
      handle_title_change(webview.app_handle(), &title_id, url, title);
    });

  #[cfg(target_os = "linux")]
  let builder = builder.extensions_path(crate::linux_documents::extension_directory(&app)?);

  #[cfg(debug_assertions)]
  let builder = builder.devtools(true);

  let webview = match window.add_child(
    builder,
    LogicalPosition::new(x.max(0.0), y.max(0.0)),
    LogicalSize::new(width.max(1.0), height.max(1.0)),
  ) {
    Ok(webview) => webview,
    Err(err) => {
      let msg = err.to_string();
      if msg.contains("already exists") {
        if let Some(existing) = app.get_webview(&label) {
          if hidden.unwrap_or(false) { return Ok(()); }
          apply_bounds(&existing, &id, (x, y, width, height), false).await?;
          existing.show().map_err(|e| e.to_string())?;
          mark_shown(&id);
          return Ok(());
        }
      }
      return Err(msg);
    }
  };
  #[cfg(windows)]
  {
    crate::browser_theme::apply_webview(&webview)?;
    if let Err(error) = crate::webview2::set_audio_muted(&webview, true).await {
      let _ = webview.close();
      return Err(error);
    }
    if let Err(error) = apply_bounds(&webview, &id, (x, y, width, height), false).await {
      let _ = webview.close();
      return Err(error);
    }
  }
  #[cfg(target_os = "macos")]
  webview.with_webview({ let id = id.clone(); move |platform| unsafe {
    round_browser_view(&*(platform.inner() as *const objc2_app_kit::NSView));
    // Retain until close so a late native event never sees a freed view.
    let retained = objc2::rc::Retained::retain(platform.inner() as *mut objc2_app_kit::NSView).expect("native browser view");
    let old = fallback_input_views().lock().unwrap().insert(id, NativeInputView { view: objc2::rc::Retained::into_raw(retained) as usize, preview: false });
    if let Some(old) = old { drop(objc2::rc::Retained::from_raw(old.view as *mut objc2_app_kit::NSView)); }
    crate::cef::install_user_input_monitor();
  }
  }).map_err(|err| err.to_string())?;
  if hidden.unwrap_or(false) {
    hide_webview(&webview, &id);
  } else {
    webview.show().map_err(|err| err.to_string())?;
    mark_shown(&id);
  }
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_set_bounds(
  app: AppHandle,
  id: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
  notify: Option<bool>,
  layout: Option<crate::browser_geometry::BrowserViewportLayout>,
  preview: Option<bool>,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::set_bounds(app, id, x, y, width, height, notify.unwrap_or(false), layout, preview.unwrap_or(false));
  }
  {
  let webview = find_browser(&app, &id)?;
  #[cfg(target_os = "macos")]
  if let Ok(mut views) = fallback_input_views().lock() {
    if let Some(view) = views.get_mut(&id) { view.preview = preview.unwrap_or(false); }
  }
  #[cfg(not(target_os = "macos"))]
  let _ = (notify, layout);
  apply_bounds(&webview, &id, (x, y, width, height), preview.unwrap_or(false)).await?;
  // 拖窗口时不要每帧 show（很卡）；白屏修复交给前端 settle 后的 browser_show。
  mark_shown(&id);
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_show(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::show(app, id);
  }
  {
  let label = label_for(&id)?;
  hide_other_browsers(&app, &label);
  find_browser(&app, &id)?
    .show()
    .map_err(|err| err.to_string())?;
  mark_shown(&id);
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_hide(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::hide(app, id);
  }
  {
  if let Ok(webview) = find_browser(&app, &id) {
    hide_webview(&webview, &id);
  }
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_hide_all(app: AppHandle) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::hide_all(app);
  }
  {
  hide_all_browsers(&app);
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::close(app, id).await;
  }
  {
  #[cfg(target_os = "macos")]
  {
    let id = id.clone();
    app.run_on_main_thread(move || {
      if let Ok(mut views) = fallback_input_views().lock() {
        if let Some(view) = views.remove(&id) { unsafe { drop(objc2::rc::Retained::from_raw(view.view as *mut objc2_app_kit::NSView)); } }
      }
    }).map_err(|error| error.to_string())?;
  }
  if let Ok(webview) = find_browser(&app, &id) {
    webview.close().map_err(|err| err.to_string())?;
  }
  forget_view(&id);
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: String, url: String, user_initiated: Option<bool>, expected_epoch: Option<u64>) -> Result<(), String> {
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, user_initiated.unwrap_or(false), expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::navigate(app, id, url).await;
  }
  {
  let webview = find_browser(&app, &id)?;
  let current = remembered_url(&id);
  let target = parse_url(&url)?;
  let target_raw = target.to_string();
  remember_url(&id, &url);
  // 导航页跑在 localhost / tauri://localhost。原生 navigate 会带 Referer，
  // 学习通会跳到「localhost 该域名未授权」。从首页离开时用页内跳转并配合 no-referrer。
  if is_home(&current) && !is_home(&url) {
    let js = format!(
      "(function(){{var m=document.querySelector('meta[name=\"referrer\"]');if(!m){{m=document.createElement('meta');m.name='referrer';document.head.appendChild(m);}}m.content='no-referrer';location.replace({});}})()",
      serde_json::to_string(&target_raw).unwrap_or_else(|_| format!("\"{target_raw}\""))
    );
    return webview.eval(&js).map_err(|err| err.to_string());
  }
  webview.navigate(target).map_err(|err| err.to_string())
  }

  }).await
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, id: String, user_initiated: Option<bool>, expected_epoch: Option<u64>) -> Result<(), String> {
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, user_initiated.unwrap_or(false), expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::reload(app, id);
  }
  {
  find_browser(&app, &id)?
    .reload()
    .map_err(|err| err.to_string())
  }

  }).await
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, id: String, user_initiated: Option<bool>, expected_epoch: Option<u64>) -> Result<(), String> {
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, user_initiated.unwrap_or(false), expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::go_back(app, id).await;
  }
  {
  find_browser(&app, &id)?
    .eval("history.back()")
    .map_err(|err| err.to_string())
  }

  }).await
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, id: String, user_initiated: Option<bool>, expected_epoch: Option<u64>) -> Result<(), String> {
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, user_initiated.unwrap_or(false), expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::go_forward(app, id).await;
  }
  {
  find_browser(&app, &id)?
    .eval("history.forward()")
    .map_err(|err| err.to_string())
  }

  }).await
}

#[tauri::command]
pub async fn browser_set_zoom(app: AppHandle, id: String, zoom: f64) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::set_zoom(app, id, zoom);
  }
  {
  let zoom = if zoom.is_finite() {
    zoom.clamp(0.25, 5.0)
  } else {
    1.0
  };
  find_browser(&app, &id)?
    .set_zoom(zoom)
    .map_err(|err| err.to_string())
  }
}

#[tauri::command]
pub async fn browser_set_audio_muted(app: AppHandle, id: String, muted: bool) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::set_audio_muted(app, id, muted);
  }
  #[cfg(windows)]
  return crate::webview2::set_audio_muted(&find_browser(&app, &id)?, muted).await;
  #[cfg(not(windows))]
  {
    let _ = (app, id, muted);
    Err("当前浏览器引擎暂不支持整页静音".into())
  }
}

#[tauri::command]
pub async fn browser_get_state(app: AppHandle, id: String) -> Result<BrowserPageState, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::get_state(app, id).await;
  }
  {
  let webview = find_browser(&app, &id)?;
  Ok(BrowserPageState {
    id,
    url: webview
      .url()
      .map(|value| value.to_string())
      .unwrap_or_default(),
    title: String::new(),
  })
  }
}

#[tauri::command]
pub async fn browser_set_app_above_page(
  _app: AppHandle,
  _above: bool,
  _id: Option<String>,
) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
pub async fn browser_engine() -> Result<String, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return Ok("cef".into());
  }
  Ok("webview".into())
}

#[tauri::command]
pub fn browser_capabilities() -> serde_json::Value {
  #[cfg(not(target_os = "macos"))]
  let cef = false;
  #[cfg(target_os = "macos")]
  let cef = crate::cef_runtime::cef_enabled();
  let chromium = cef || cfg!(windows);
  serde_json::json!({
    "secureFill": chromium,
    "secureFillInFrames": cef,
    "audioMute": chromium,
    "snapshotViaScript": !cef,
    "pageScriptActions": !cef,
  })
}

#[tauri::command]
pub async fn browser_cdp_click_text(
  app: AppHandle,
  id: String,
  text: String,
) -> Result<CdpActResult, String> {
  browser_cdp_click(app, id, Some(text), None).await
}

#[tauri::command]
pub async fn browser_cdp_click(
  app: AppHandle,
  id: String,
  text: Option<String>,
  selector: Option<String>,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_click(app, id, text, selector).await;
  }
  {
    let _ = (app, id, text, selector);
    Err("当前平台浏览区不是 Chromium".into())
  }
}

#[tauri::command]
pub async fn browser_cdp_fill(
  app: AppHandle,
  id: String,
  selector: String,
  text: String,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_fill(app, id, selector, text).await;
  }
  {
    let _ = (app, id, selector, text);
    Err("当前平台浏览区不是 Chromium".into())
  }
}

#[tauri::command]
pub async fn browser_cdp_find(
  app: AppHandle,
  id: String,
  locator: serde_json::Value,
) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_find(app, id, locator).await;
  }
  let _ = (app, id, locator);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_find_wait(
  app: AppHandle,
  id: String,
  locator: serde_json::Value,
  timeout_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_find_wait(app, id, locator, timeout_ms).await;
  }
  let _ = (app, id, locator, timeout_ms);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_push_last(
  app: AppHandle,
  id: String,
  mid: Option<String>,
  kind: Option<String>,
) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let _ = app;
    if kind.as_deref() == Some("hw") {
      return Ok(crate::cef::last_hw(&id));
    }
    return Ok(crate::cef::last_tick(&id, mid.as_deref()));
  }
  let _ = (app, id, mid, kind);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_dom_html(
  app: AppHandle,
  id: String,
  frame: Option<String>,
) -> Result<serde_json::Value, String> {
  crate::secret_browser::guard(&app, &id).await?;
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::dom_frame_html(app, id, frame).await;
  }
  let _ = (app, id, frame);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_stats(app: AppHandle) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let _ = app;
    return Ok(crate::cdp_client::snapshot_stats());
  }
  let _ = app;
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_click_at(
  app: AppHandle,
  id: String,
  x: f64,
  y: f64,
  button: Option<String>,
  click_count: Option<i64>,
  session: Option<String>,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_click_at(app, id, x, y, button, click_count, session).await;
  }
  let _ = (app, id, x, y, button, click_count, session);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_locate(
  app: AppHandle,
  id: String,
  script: String,
) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_locate(app, id, script).await;
  }
  let _ = (app, id, script);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_click_box(
  app: AppHandle,
  id: String,
  script: String,
  button: Option<String>,
  click_count: Option<i64>,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_click_box(app, id, script, button, click_count).await;
  }
  let _ = (app, id, script, button, click_count);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_fill_box(
  app: AppHandle,
  id: String,
  script: String,
  text: String,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_fill_box(app, id, script, text).await;
  }
  let _ = (app, id, script, text);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_hover(
  app: AppHandle,
  id: String,
  text: Option<String>,
  selector: Option<String>,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_hover(app, id, text, selector).await;
  }
  let _ = (app, id, text, selector);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_scroll(
  app: AppHandle,
  id: String,
  amount: f64,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_scroll(app, id, amount).await;
  }
  let _ = (app, id, amount);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_press(
  app: AppHandle,
  id: String,
  key: String,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_press(app, id, key).await;
  }
  let _ = (app, id, key);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_focus_node(
  app: AppHandle,
  id: String,
  backend: i64,
  session: Option<String>,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_focus_node(app, id, backend, session).await;
  }
  let _ = (app, id, backend, session);
  Err("当前引擎不支持 focus_node".into())
}

pub async fn browser_cdp_click_node(
  app: AppHandle,
  id: String,
  backend: i64,
  session: Option<String>,
  button: Option<String>,
  click_count: Option<i64>,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_click_node(app, id, backend, session, button, click_count).await;
  }
  let _ = (app, id, backend, session, button, click_count);
  Err("当前引擎不支持 click_node".into())
}

pub async fn browser_cdp_type_focused(
  app: AppHandle,
  id: String,
  text: String,
) -> Result<CdpActResult, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_type_focused(app, id, text).await;
  }
  let _ = (app, id, text);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_cdp_snapshot(
  app: AppHandle,
  id: String,
) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_snapshot(
      app,
      id,
      crate::cef::SnapshotQuery {
        frame: None,
        max_frames: 8,
        acted: false,
      },
    )
    .await;
  }
  #[cfg(windows)]
  return crate::webview2::snapshot(&find_browser(&app, &id)?).await;
  #[cfg(not(windows))]
  {
    let _ = (app, id);
    Err("当前平台浏览区不是 Chromium".into())
  }
}

#[tauri::command]
pub async fn browser_screenshot(
  app: AppHandle,
  id: String,
) -> Result<serde_json::Value, String> {
  #[cfg(windows)]
  let _operation = crate::webview2_secrets::lock(&id).await;
  crate::secret_browser::guard(&app, &id).await?;
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_screenshot(app, id).await;
  }
  #[cfg(windows)]
  return crate::webview2::screenshot(&find_browser(&app, &id)?).await;
  #[cfg(not(windows))]
  {
    let _ = (app, id);
    Err("当前平台浏览区不是 Chromium".into())
  }
}

#[tauri::command]
pub async fn browser_cookies(
  app: AppHandle,
  id: String,
  url: Option<String>,
) -> Result<serde_json::Value, String> {
  let target = {
    let raw = url.unwrap_or_default();
    if raw.trim().is_empty() {
      remembered_url(&id)
    } else {
      raw
    }
  };
  if target.trim().is_empty() {
    return Ok(serde_json::json!({
      "ok": true,
      "url": "",
      "header": "",
      "cookies": [],
    }));
  }
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let cookies = crate::cef::cookies_json(&id, &target).await?;
    let header = crate::cef::cookie_header_from(&cookies);
    return Ok(serde_json::json!({
      "ok": true,
      "url": target,
      "header": header,
      "cookies": cookies,
    }));
  }
  let _ = app;
  Err("当前平台浏览区不是 Chromium".into())
}

#[cfg(target_os = "macos")]
fn cookie_target(id: &str, url: Option<String>) -> String {
  let raw = url.unwrap_or_default();
  if raw.trim().is_empty() {
    remembered_url(id)
  } else {
    raw
  }
}

#[tauri::command]
pub async fn browser_set_cookies(
  app: AppHandle,
  id: String,
  cookies: Vec<serde_json::Value>,
  url: Option<String>, expected_epoch: Option<u64>) -> Result<serde_json::Value, String> {
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, false, expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let target = cookie_target(&id, url);
    return crate::cef::set_cookies(&id, cookies, &target).await;
  }
  let _ = (app, cookies, url, id);
  Err("当前平台浏览区不是 Chromium".into())

  }).await
}

#[tauri::command]
pub async fn browser_network_watch(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::watch_network(&id).await;
  }
  let _ = (app, id);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_network_recent(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let _ = app;
    return Ok(crate::cef::recent_network(&id));
  }
  let _ = (app, id);
  Err("当前平台浏览区不是 Chromium".into())
}

#[tauri::command]
pub async fn browser_clear_cookies(
  app: AppHandle,
  id: String,
  url: Option<String>,
  name: Option<String>,
  domain: Option<String>, expected_epoch: Option<u64>) -> Result<serde_json::Value, String> {
  let control_id = id.clone();
  crate::browser_control::run_at(&control_id, false, expected_epoch, async move {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let target = cookie_target(&id, url);
    return crate::cef::clear_cookies(&id, &target, name, domain).await;
  }
  let _ = (app, name, domain, url, id);
  Err("当前平台浏览区不是 Chromium".into())

  }).await
}


#[cfg(not(target_os = "linux"))]
async fn eval_wait_title(
  webview: &tauri::Webview,
  token: String,
  script: String,
) -> Result<String, String> {
  let (tx, rx) = tokio::sync::oneshot::channel();
  pending_evals()
    .lock()
    .map_err(|_| "执行通道被占用".to_string())?
    .insert(token.clone(), tx);
  if let Err(err) = webview.eval(&script) {
    let _ = take_eval(&token);
    return Err(err.to_string());
  }
  match tokio::time::timeout(Duration::from_secs(10), rx).await {
    Ok(Ok(payload)) => Ok(payload),
    Ok(Err(_)) => Err("执行结果丢失".into()),
    Err(_) => {
      let _ = take_eval(&token);
      Err("执行超时".into())
    }
  }
}


async fn dispatch_browser_protocol(
  app: AppHandle,
  id: String,
  op: String,
  args: serde_json::Value,
) -> Result<serde_json::Value, String> {
  match op.as_str() {
    "website_document" => documents::dispatch(&app, &id, &args).await,
    #[cfg(windows)]
    "login_observe" => crate::webview2_secrets::login_observe(&app, &id, &args).await,
    #[cfg(not(windows))]
    "login_observe" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        return crate::cef::login::observe(&id, &args).await;
      }
      Ok(serde_json::json!({"unsupported": true}))
    }
    #[cfg(windows)]
    "login_action" => crate::webview2_secrets::login_action(&app, &id, &args).await,
    #[cfg(windows)]
    "fill_secret" => {
      let reference = args["secret_ref"].as_str().ok_or("缺少凭据变量")?;
      crate::webview2_secrets::fill(&app, &id, &args["locator"], reference).await
    }
    #[cfg(not(windows))]
    "fill_secret" => {
      #[cfg(target_os="macos")]
      if crate::cef_runtime::cef_enabled() {
        return crate::cef::cdp_fill_secret(app,id,args.get("locator").cloned().unwrap_or_default(),protocol_arg_str(&args,"secret_ref").unwrap_or_default()).await;
      }
      Err("当前浏览器引擎不支持安全凭据填写".into())
    }
    "frame_eval" => {
      crate::secret_browser::guard(&app, &id).await?;
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        return crate::cef::frames::evaluate_hint(id,
          protocol_arg_str(&args, "frame").unwrap_or_default(), args.get("locator").cloned().unwrap_or_default(),
          protocol_arg_str(&args, "script").unwrap_or_default()).await;
      }
      Err("当前平台浏览区不是 Chromium".into())
    }
    "media_tick" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        return crate::cef::frames::media_tick(id, args.get("locator").cloned().unwrap_or_default(),
          protocol_arg_str(&args, "mid").unwrap_or_default()).await;
      }
      Err("当前平台浏览区不是 Chromium".into())
    }
    "attachment_frames" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        return crate::cef::frames::attachment_frames(&id, args.get("locator").cloned().unwrap_or_default()).await;
      }
      Err("当前浏览器引擎不支持课件框定位".into())
    }
    "set_checked" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        let checked = args.get("checked").and_then(serde_json::Value::as_bool).ok_or("缺少 checked 布尔值")?;
        return crate::cef::cdp_set_checked(app, id,
          args.get("backend").and_then(serde_json::Value::as_i64).unwrap_or(0),
          protocol_arg_str(&args, "session"), checked).await;
      }
      Err("当前引擎不支持选项状态操作".into())
    }
    "fill_node" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        if let Err(error) = crate::cef::frames::verify_action_node(&id, &args).await {
          return Ok(serde_json::json!({ "ok": false, "reason": "invalid", "retry": false,
            "requiresRefresh": true, "error": error }));
        }
        return crate::cef::cdp_fill_node(
          id, args.get("backend").and_then(|v| v.as_i64()).unwrap_or(0),
          protocol_arg_str(&args, "session"), protocol_arg_str(&args, "text").unwrap_or_default(),
        ).await;
      }
      Err("当前平台浏览区不是 Chromium".into())
    }
    "find" => {
      browser_cdp_find(app, id, args.get("locator").cloned().unwrap_or(serde_json::Value::Null)).await
    }
    "find_wait" => {
      let timeout = args
        .get("timeoutMs")
        .or_else(|| args.get("timeout_ms"))
        .and_then(|v| v.as_u64());
      browser_cdp_find_wait(
        app,
        id,
        args.get("locator").cloned().unwrap_or(serde_json::Value::Null),
        timeout,
      )
      .await
    }
    "locate" => browser_cdp_locate(app, id, protocol_arg_str(&args, "script").unwrap_or_default()).await,
    "click_at" => protocol_json(
      browser_cdp_click_at(
        app,
        id,
        protocol_arg_f64(&args, "x"),
        protocol_arg_f64(&args, "y"),
        protocol_arg_str(&args, "button"),
        args
          .get("clickCount")
          .or_else(|| args.get("click_count"))
          .and_then(|v| v.as_i64()),
        protocol_arg_str(&args, "session"),
      )
      .await?,
    ),
    "click" => protocol_json(
      browser_cdp_click(app, id, protocol_arg_str(&args, "text"), protocol_arg_str(&args, "selector")).await?,
    ),
    "type_focused" => {
      protocol_json(browser_cdp_type_focused(app, id, protocol_arg_str(&args, "text").unwrap_or_default()).await?)
    }
    "focus_node" => protocol_json(
      browser_cdp_focus_node(
        app,
        id,
        args
          .get("backend")
          .or_else(|| args.get("backendNodeId"))
          .and_then(|v| v.as_i64())
          .unwrap_or(0),
        protocol_arg_str(&args, "session"),
      )
      .await?,
    ),
    "click_node" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        if let Err(error) = crate::cef::frames::verify_action_node(&id, &args).await {
          return Ok(serde_json::json!({ "ok": false, "reason": "invalid", "retry": false,
            "requiresRefresh": true, "error": error }));
        }
      }
      protocol_json(
      browser_cdp_click_node(
        app,
        id,
        args
          .get("backend")
          .or_else(|| args.get("backendNodeId"))
          .and_then(|v| v.as_i64())
          .unwrap_or(0),
        protocol_arg_str(&args, "session"),
        protocol_arg_str(&args, "button"),
        args
          .get("clickCount")
          .or_else(|| args.get("click_count"))
          .and_then(|v| v.as_i64()),
      )
      .await?,
      )
    },
    "hover" => protocol_json(
      browser_cdp_hover(app, id, protocol_arg_str(&args, "text"), protocol_arg_str(&args, "selector")).await?,
    ),
    "scroll" => protocol_json(browser_cdp_scroll(app, id, protocol_arg_f64(&args, "amount")).await?),
    "press" => protocol_json(browser_cdp_press(app, id, protocol_arg_str(&args, "key").unwrap_or_default()).await?),
    "rebind" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        crate::cef::drop_page_bind(&id);
      }
      Ok(serde_json::json!({ "ok": true }))
    }
    "snapshot" => {
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        return crate::cef::cdp_snapshot(
          app,
          id,
          crate::cef::SnapshotQuery {
            frame: protocol_arg_str(&args, "frame"),
            max_frames: args
              .get("maxFrames")
              .or_else(|| args.get("max_frames"))
              .and_then(|v| v.as_u64())
              .unwrap_or(8) as usize,
            acted: args.get("acted").and_then(|v| v.as_bool()).unwrap_or(false),
          },
        )
        .await;
      }
      browser_cdp_snapshot(app, id).await
    }
    "evaluate" => {
      crate::secret_browser::guard(&app, &id).await?;
      let script = protocol_arg_str(&args, "script").unwrap_or_default();
      #[cfg(target_os = "macos")]
      if crate::cef_runtime::cef_enabled() {
        return crate::cef::eval_main_json(&id, &script).await;
      }
      let _ = (app, script);
      Err("当前平台浏览区不是 Chromium".into())
    }
    "dom_html" => browser_dom_html(app, id, protocol_arg_str(&args, "frame")).await,
    "push_last" => {
      browser_push_last(app, id, protocol_arg_str(&args, "mid"), protocol_arg_str(&args, "kind")).await
    }
    "cdp_stats" => browser_cdp_stats(app).await,
    "cookies" => {
      let action = protocol_arg_str(&args, "action").unwrap_or_else(|| "list".into());
      let url = protocol_arg_str(&args, "url");
      match action.as_str() {
        "set" => {
          let cookies = args
            .get("cookies")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
          browser_set_cookies(app, id, cookies, url, None).await
        }
        "clear" => {
          browser_clear_cookies(
            app,
            id,
            url,
            protocol_arg_str(&args, "name"),
            protocol_arg_str(&args, "domain"),
            None,
          )
          .await
        }
        _ => browser_cookies(app, id, url).await,
      }
    }
    "network" => {
      let action = protocol_arg_str(&args, "action").unwrap_or_else(|| "recent".into());
      if action == "watch" {
        browser_network_watch(app, id).await
      } else {
        browser_network_recent(app, id).await
      }
    }
    other => Err(format!("未知协议动作 {other}")),
  }
}

#[cfg(test)]
mod tests {
  use super::popup_should_drop;
  #[test]
  fn popups_validate_protocol_without_website_routes() {
    assert!(!popup_should_drop("https://example.org/", "https://example.org/embedded/content"));
    assert!(!popup_should_drop("https://example.org/", "https://other.example/courses?courseid=1"));
    for url in ["", "about:blank", "javascript:alert(1)", "file:///tmp/a", "https://user:secret@example.org/"] {
      assert!(popup_should_drop("https://example.org/", url));
    }
  }

  #[test]
  fn prepare_eval_wraps_return_and_expression() {
    use super::prepare_eval_script;
    assert!(prepare_eval_script("return 1").starts_with("(function()"));
    assert!(prepare_eval_script("document.title").contains("return (document.title)"));
    assert_eq!(
      prepare_eval_script("(function(){ return 1 })()"),
      "(function(){ return 1 })()"
    );
    let nested = "JSON.stringify([1].map(function(v){return v;}))";
    let wrapped = prepare_eval_script(nested);
    assert!(wrapped.contains("return (JSON.stringify"), "{wrapped}");
    assert!(!wrapped.contains("\nJSON.stringify"), "{wrapped}");
  }

  #[test]
  fn format_eval_error_illegal_return() {
    use super::format_eval_error;
    let msg = format_eval_error(
      r#"{"exception":{"description":"SyntaxError: Illegal return statement"}}"#,
    );
    assert!(msg.contains("return"));
  }
}
