//! 把 CEF 浏览器嵌进主窗口，并实现与 WK 路径相同的 Tauri 命令。
#![cfg(target_os = "macos")]

use crate::app_browser::{
  emit_load, emit_opened, emit_state, format_eval_error, is_course_entry_url, is_iframe_document_url,
  is_space_list_url, new_browser_id, popup_should_drop, prepare_eval_script, remember_url,
  remembered_url, CdpActResult,
};
use crate::cdp_client::{connect_loop, CdpConn};
use futures_util::future::join_all;
use std::time::Duration;
use crate::cef_runtime;
use cef::{self, *};
use objc2::rc::Retained;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadOnly};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::cell::Cell;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const CHROME_UA_NOTE: &str = "浏览内核已换 Chromium，学习通需重新登录。";

/// 开源 CEF 无 H.264：伪装 canPlayType，并把 mp4 指到本机边转边播的 WebM。
const CLAIM_H264: &str = r#"(function(){
  if (window.__ZE_H264__ === 5) return;
  var origCan = HTMLMediaElement.prototype.canPlayType;
  try {
    var probe = document.createElement('video');
    if (origCan.call(probe, 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"')) {
      window.__ZE_H264__ = 5;
      window.__ZE_H264_NATIVE__ = true;
      return;
    }
  } catch (e) {}
  window.__ZE_H264__ = 5;
  window.__ZE_H264_CLAIM__ = true;
  try { window.isStuH5Page = true; } catch (e) {}
  try { window.flashChecker = function () { return { hasFlash: 0, version: 0 }; }; } catch (e) {}
  var orig = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (type) {
    var t = String(type || '');
    if (/avc1|mp4a|video\/mp4|audio\/mp4|video\/webm|vp8|opus/i.test(t)) return 'probably';
    return orig.call(this, type);
  };
  try {
    if (window.MediaSource && MediaSource.isTypeSupported) {
      var origMs = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function (type) {
        var t = String(type || '');
        if (/avc1|mp4a|video\/mp4|audio\/mp4|video\/webm|vp8|opus/i.test(t)) return true;
        return origMs(type);
      };
    }
  } catch (e) {}
  try {
    var nativeDur = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration');
    if (nativeDur && nativeDur.get) {
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
        configurable: true,
        enumerable: true,
        get: function () {
          try {
            var n = nativeDur.get.call(this);
            if (isFinite(n) && n > 0) return n;
            return this.__zeDuration > 0 ? this.__zeDuration : n;
          } catch (e) {
            return this.__zeDuration > 0 ? this.__zeDuration : NaN;
          }
        }
      });
    }
  } catch (e) {}
  var hintDur = function (el) {
    if (!el) return;
    var src = '';
    try { src = el.currentSrc || el.src || ''; } catch (e) {}
    var i = src.indexOf('u=');
    if (i < 0) return;
    var u = src.slice(i + 2).split('&')[0];
    fetch('http://127.0.0.1:1430/meta?u=' + u).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.duration > 0 && el.__zeDuration !== j.duration) {
        el.__zeDuration = j.duration;
        try { el.dispatchEvent(new Event('durationchange')); } catch (e) {}
      }
    }).catch(function () {});
  };
  var watchMeta = function (el) {
    if (!el || el.__zeMetaWatch) return;
    el.__zeMetaWatch = true;
    var n = 0;
    var tick = function () {
      hintDur(el);
      n += 1;
      if (el.__zeDuration > 0 || n > 50) return;
      setTimeout(tick, 300);
    };
    tick();
  };
  var proxy = 'http://127.0.0.1:1430/play?u=';
  var wrap = function (url) {
    url = String(url || '');
    if (!url || url.indexOf('127.0.0.1:1430') >= 0 || url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return url;
    if (!/mp4|m3u8|mpegurl|cldisk|ananas|chaoxing|aliyuncs|aliyunvod|noteynb/i.test(url)) return url;
    return proxy + encodeURIComponent(url);
  };
  var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (desc && desc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) {
        try { this.preload = 'none'; } catch (e) {}
        desc.set.call(this, wrap(v));
        watchMeta(this);
      }
    });
  }
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'src' && (this.tagName === 'SOURCE' || this.tagName === 'VIDEO')) {
      value = wrap(value);
    }
    if (String(name).toLowerCase() === 'preload' && (this.tagName === 'VIDEO' || this.tagName === 'AUDIO')) {
      value = 'none';
    }
    return setAttr.call(this, name, value);
  };
  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try { this.preload = 'auto'; } catch (e) {}
    watchMeta(this);
    return origPlay.apply(this, arguments);
  };
  var list = document.querySelectorAll('video');
  for (var i = 0; i < list.length; i++) {
    try { list[i].preload = 'none'; } catch (e) {}
    var src = list[i].currentSrc || list[i].src || '';
    if (src && src.indexOf('127.0.0.1:1430') < 0) list[i].src = wrap(src);
    watchMeta(list[i]);
  }
  var bustFlash = function () {
    try {
      var html = (document.documentElement && document.documentElement.innerHTML) || '';
      if (!/没有安装flash|flashplayer|Adobe Flash/i.test(html)) return;
      var n = Number(sessionStorage.getItem('__ze_h264_rl') || 0);
      if (n >= 2) return;
      sessionStorage.setItem('__ze_h264_rl', String(n + 1));
      location.reload();
    } catch (e) {}
  };
  if (document.body) bustFlash();
  else document.addEventListener('DOMContentLoaded', bustFlash);
  setTimeout(bustFlash, 600);
  setTimeout(bustFlash, 1800);
})()"#;

#[derive(Clone, Copy)]
struct ViewPtr(*mut c_void);
unsafe impl Send for ViewPtr {}
unsafe impl Sync for ViewPtr {}

struct Tab {
  id: String,
  wrapper: ViewPtr,
  browser_id: i32,
  url: String,
  title: String,
  hidden: bool,
  zoom: f64,
}

struct Registry {
  tabs: HashMap<String, Tab>,
  by_browser: HashMap<i32, String>,
}

fn registry() -> &'static Mutex<Registry> {
  static REG: OnceLock<Mutex<Registry>> = OnceLock::new();
  REG.get_or_init(|| Mutex::new(Registry { tabs: HashMap::new(), by_browser: HashMap::new() }))
}

fn app_handle() -> &'static Mutex<Option<AppHandle>> {
  static H: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();
  H.get_or_init(|| Mutex::new(None))
}

fn cdp() -> &'static Mutex<Option<CdpConn>> {
  static C: OnceLock<Mutex<Option<CdpConn>>> = OnceLock::new();
  C.get_or_init(|| Mutex::new(None))
}

fn retain_client(client: &Client) {
  std::mem::forget(client.clone());
}

fn remember_handle(app: &AppHandle) {
  if let Ok(mut g) = app_handle().lock() {
    *g = Some(app.clone());
  }
}

fn parent_nsview(window: &tauri::Window) -> Result<*mut c_void, String> {
  match window.window_handle().map_err(|e| e.to_string())?.as_raw() {
    RawWindowHandle::AppKit(handle) => Ok(handle.ns_view.as_ptr()),
    _ => Err("主窗口不是 AppKit".into()),
  }
}

unsafe fn frame_in_parent(parent: &NSView, x: f64, y: f64, width: f64, height: f64) -> NSRect {
  let width = width.max(1.0);
  let height = height.max(1.0);
  let origin = if parent.isFlipped() {
    NSPoint::new(x, y)
  } else {
    let h = parent.frame().size.height;
    NSPoint::new(x, h - y - height)
  };
  NSRect::new(origin, NSSize::new(width, height))
}

/// CEF 洞口：AppKit 一改真实尺寸就 was_resized。
/// 不要把网页布局交给 JS 防抖；拖窗口/分栏时 JS 只对齐位置，不负责通知 Chromium。
struct ZeCefHoleIvars {
  last_w: Cell<f64>,
  last_h: Cell<f64>,
  browser_id: Cell<i32>,
  ticking: Cell<bool>,
  pending: Cell<bool>,
}

define_class!(
  #[unsafe(super(NSView))]
  #[thread_kind = MainThreadOnly]
  #[name = "ZeCefHoleView"]
  #[ivars = ZeCefHoleIvars]
  struct ZeCefHoleView;

  impl ZeCefHoleView {
    #[unsafe(method(setFrameSize:))]
    fn set_frame_size(&self, size: NSSize) {
      let _: () = unsafe { msg_send![super(self), setFrameSize: size] };
      // 创建浏览器和 JS setFrame 都走这里。这里同步动 CEF 会把主线程卡死。
      self.ivars().last_w.set(size.width);
      self.ivars().last_h.set(size.height);
    }

    #[unsafe(method(resizeWithOldSuperviewSize:))]
    fn resize_with_old_superview_size(&self, old_superview_size: NSSize) {
      let _: () = unsafe { msg_send![super(self), resizeWithOldSuperviewSize: old_superview_size] };
      hole_size_tick(self);
    }

    #[unsafe(method(zeFlushWasResized))]
    fn ze_flush_was_resized(&self) {
      HOLE_RESIZE_PENDING.store(false, Ordering::SeqCst);
      let bid = self.ivars().browser_id.get();
      if bid > 0 {
        notify_browser_resized(bid);
      }
    }
  }
);

impl ZeCefHoleView {
  fn create(mtm: MainThreadMarker, frame: NSRect) -> Retained<Self> {
    let this = Self::alloc(mtm).set_ivars(ZeCefHoleIvars {
      last_w: Cell::new(frame.size.width),
      last_h: Cell::new(frame.size.height),
      browser_id: Cell::new(0),
      ticking: Cell::new(false),
      pending: Cell::new(false),
    });
    unsafe { msg_send![super(this), initWithFrame: frame] }
  }
}

fn hole_size_tick(view: &ZeCefHoleView) {
  if view.ivars().ticking.get() {
    return;
  }
  view.ivars().ticking.set(true);
  let ns: &NSView = view;
  let size = ns.bounds().size;
  let last_w = view.ivars().last_w.get();
  let last_h = view.ivars().last_h.get();
  let changed = (size.width - last_w).abs() >= 0.5 || (size.height - last_h).abs() >= 0.5;
  if changed {
    view.ivars().last_w.set(size.width);
    view.ivars().last_h.set(size.height);
  }
  let bid = view.ivars().browser_id.get();
  view.ivars().ticking.set(false);
  // 禁止在 setFrameSize 里同步 was_resized / 改子 view：会和 AppKit、CEF 布局重入，整窗卡死。
  if changed && bid > 0 {
    schedule_was_resized(view, bid);
  }
}

static HOLE_RESIZE_PENDING: AtomicBool = AtomicBool::new(false);

fn schedule_was_resized(view: &ZeCefHoleView, _bid: i32) {
  if HOLE_RESIZE_PENDING.swap(true, Ordering::SeqCst) {
    return;
  }
  // 已在主线程。不要 run_on_main_thread，下一圈再 was_resized，避免和 AppKit 布局重入。
  unsafe {
    let _: () = msg_send![
      view,
      performSelector: sel!(zeFlushWasResized)
      withObject: std::ptr::null::<objc2::runtime::AnyObject>()
      afterDelay: 0.0f64
    ];
  }
}

fn bind_hole_browser(ptr: ViewPtr, bid: i32) {
  if ptr.0.is_null() || bid <= 0 {
    return;
  }
  unsafe {
    (*(ptr.0 as *const ZeCefHoleView)).ivars().browser_id.set(bid);
  }
}

fn create_wrapper(parent_ptr: *mut c_void, x: f64, y: f64, w: f64, h: f64) -> Result<ViewPtr, String> {
  unsafe {
    let parent = &*(parent_ptr as *const NSView);
    let frame = frame_in_parent(parent, x, y, w, h);
    let mtm = MainThreadMarker::new().ok_or_else(|| "必须在主线程创建浏览区".to_string())?;
    let view = ZeCefHoleView::create(mtm, frame);
    view.setHidden(false);
    view.setClipsToBounds(true);
    view.setAutoresizingMask(stretch_mask());
    // 盖在铺满窗口的 WKWebView 上面，否则只能看到 Vue 里空的 .browser-host（白屏）
    parent.addSubview_positioned_relativeTo(&view, objc2_app_kit::NSWindowOrderingMode::Above, None);
    eprintln!(
      "[cef] wrapper frame origin=({:.0},{:.0}) size=({:.0}x{:.0}) parentH={:.0} flipped={}",
      frame.origin.x,
      frame.origin.y,
      frame.size.width,
      frame.size.height,
      parent.frame().size.height,
      parent.isFlipped()
    );
    Ok(ViewPtr(Retained::into_raw(view) as *mut c_void))
  }
}

fn wrapper_view(ptr: ViewPtr) -> *const NSView {
  ptr.0 as *const NSView
}

fn stretch_mask() -> NSAutoresizingMaskOptions {
  NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable
}

fn apply_stretch_mask(view: &NSView) {
  view.setAutoresizingMask(stretch_mask());
}

fn stretch_wrapper_children(ptr: ViewPtr) {
  unsafe {
    let view = &*wrapper_view(ptr);
    apply_stretch_mask(view);
    view.setClipsToBounds(true);
    fit_cef_children(view);
  }
}

fn fit_cef_children(view: &NSView) {
  let inner = view.bounds();
  for sub in view.subviews() {
    apply_stretch_mask(&sub);
    if !frames_close(sub.frame(), inner) {
      sub.setFrame(inner);
    }
  }
}

fn frames_close(a: NSRect, b: NSRect) -> bool {
  (a.origin.x - b.origin.x).abs() < 0.5
    && (a.origin.y - b.origin.y).abs() < 0.5
    && (a.size.width - b.size.width).abs() < 0.5
    && (a.size.height - b.size.height).abs() < 0.5
}

fn wrapper_in_live_resize(ptr: ViewPtr) -> bool {
  unsafe {
    let view = &*wrapper_view(ptr);
    view.window().is_some_and(|w| w.inLiveResize())
  }
}

fn apply_wrapper_bounds(ptr: ViewPtr, x: f64, y: f64, w: f64, h: f64) {
  apply_wrapper_bounds_ex(ptr, x, y, w, h, false);
}

/// `raise=true` 时才重排 z-order；拖窗口改尺寸时不要 addSubview，否则会卡。
fn apply_wrapper_bounds_ex(ptr: ViewPtr, x: f64, y: f64, w: f64, h: f64, raise: bool) {
  unsafe {
    let view = &*wrapper_view(ptr);
    view.setClipsToBounds(true);
    apply_stretch_mask(view);
    if let Some(parent) = view.superview() {
      // 拖窗口：autoresizing 已经在跟手改真实尺寸。JS 坐标慢一拍，套上去会来回拽。
      if !raise && view.window().is_some_and(|w| w.inLiveResize()) {
        return;
      }
      let frame = frame_in_parent(&parent, x, y, w, h);
      if !frames_close(view.frame(), frame) {
        view.setFrame(frame);
      }
      fit_cef_children(view);
      if raise {
        parent.addSubview_positioned_relativeTo(view, objc2_app_kit::NSWindowOrderingMode::Above, None);
      }
    }
  }
}

fn notify_browser_resized(browser_id: i32) {
  if browser_id <= 0 {
    return;
  }
  if let Some(browser) = browser_by_id(browser_id) {
    if let Some(host) = browser.host() {
      host.was_resized();
    }
  }
}

fn set_wrapper_hidden(ptr: ViewPtr, hidden: bool) {
  unsafe {
    let view = &*wrapper_view(ptr);
    view.setHidden(hidden);
    if !hidden {
      if let Some(parent) = view.superview() {
        parent.addSubview_positioned_relativeTo(
          view,
          objc2_app_kit::NSWindowOrderingMode::Above,
          None,
        );
      }
    }
  }
}

wrap_life_span_handler! {
  pub struct ZeLifeSpan;

  impl LifeSpanHandler {
    fn on_after_created(&self, browser: Option<&mut Browser>) {
      let Some(browser) = browser else { return };
      let bid = browser.identifier();
      eprintln!("[cef] on_after_created browser={bid}");
      if let Ok(mut reg) = registry().lock() {
        if let Some(tab) = reg.tabs.values_mut().find(|t| t.browser_id == 0) {
          tab.browser_id = bid;
          let id = tab.id.clone();
          let wrapper = tab.wrapper;
          reg.by_browser.insert(bid, id);
          drop(reg);
          bind_hole_browser(wrapper, bid);
          stretch_wrapper_children(wrapper);
          return;
        }
      }
    }

    fn on_before_popup(
      &self,
      browser: Option<&mut Browser>,
      _frame: Option<&mut Frame>,
      _popup_id: i32,
      target_url: Option<&CefString>,
      _target_frame_name: Option<&CefString>,
      _target_disposition: WindowOpenDisposition,
      _user_gesture: i32,
      _popup_features: Option<&PopupFeatures>,
      _window_info: Option<&mut WindowInfo>,
      _client: Option<&mut Option<Client>>,
      _settings: Option<&mut BrowserSettings>,
      _extra_info: Option<&mut Option<DictionaryValue>>,
      _no_javascript_access: Option<&mut i32>,
    ) -> i32 {
      let raw = target_url.map(|u| u.to_string()).unwrap_or_default();
      let opener = browser
        .as_ref()
        .and_then(|b| b.main_frame())
        .map(|frame| CefString::from(&frame.url()).to_string())
        .unwrap_or_default();
      eprintln!("[cef] popup opener={opener} url={raw}");
      if popup_should_drop(&opener, &raw) {
        eprintln!("[cef] popup drop {raw}");
        return 1;
      }
      let id = browser.as_ref().and_then(|b| {
        let bid = b.identifier();
        registry()
          .lock()
          .ok()
          .and_then(|reg| reg.by_browser.get(&bid).cloned())
      });
      // 进课：当前标签打开；其它顶层弹出：新标签 + 前端自动选中
      if is_course_entry_url(&raw) {
        if let Some(id) = id {
          navigate_tab(&id, &raw);
        } else if let Ok(reg) = registry().lock() {
          if let Some(tab) = reg.tabs.values().next() {
            let id = tab.id.clone();
            drop(reg);
            navigate_tab(&id, &raw);
          }
        }
        return 1;
      }
      if let Ok(h) = app_handle().lock() {
        if let Some(app) = h.as_ref() {
          let new_id = new_browser_id();
          eprintln!("[cef] popup open tab {new_id} → {raw}");
          emit_opened(app, &new_id, raw);
        }
      }
      1
    }

    fn on_before_close(&self, browser: Option<&mut Browser>) {
      let Some(browser) = browser else { return };
      let bid = browser.identifier();
      if let Ok(mut reg) = registry().lock() {
        if let Some(id) = reg.by_browser.remove(&bid) {
          reg.tabs.remove(&id);
        }
      }
    }
  }
}

wrap_load_handler! {
  pub struct ZeLoad;

  impl LoadHandler {
    fn on_load_start(
      &self,
      browser: Option<&mut Browser>,
      frame: Option<&mut Frame>,
      _transition_type: TransitionType,
    ) {
      let main = frame.as_ref().map(|item| item.is_main() == 1).unwrap_or(false);
      if main {
        if let Some(browser) = browser.as_ref() {
          let bid = browser.identifier();
          if let Ok(reg) = registry().lock() {
            if let Some(id) = reg.by_browser.get(&bid).cloned() {
              drop(reg);
              forget_target(&id);
            }
          }
        }
        emit_tab_load(browser, "started");
      }
    }

    fn on_load_end(
      &self,
      browser: Option<&mut Browser>,
      frame: Option<&mut Frame>,
      _http_status_code: i32,
    ) {
      if let Some(frame) = frame {
        if frame.is_main() == 1 {
          let url = CefString::from(&frame.url()).to_string();
          if let Some(browser) = browser {
            let bid = browser.identifier();
            if let Ok(mut reg) = registry().lock() {
              if let Some(id) = reg.by_browser.get(&bid).cloned() {
                let zoom = if let Some(tab) = reg.tabs.get_mut(&id) {
                  tab.url = url.clone();
                  tab.zoom
                } else {
                  1.0
                };
                remember_url(&id, &url);
                drop(reg);
                apply_browser_zoom(bid, zoom);
                if let Ok(h) = app_handle().lock() {
                  if let Some(app) = h.as_ref() {
                    emit_load(app, &id, "finished", url.clone());
                    emit_state(app, &id, url, String::new());
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

fn emit_tab_load(browser: Option<&mut Browser>, phase: &str) {
  let Some(browser) = browser else { return };
  let bid = browser.identifier();
  let url = browser
    .main_frame()
    .map(|f| CefString::from(&f.url()).to_string())
    .unwrap_or_default();
  if let Ok(reg) = registry().lock() {
    if let Some(id) = reg.by_browser.get(&bid) {
      if let Ok(h) = app_handle().lock() {
        if let Some(app) = h.as_ref() {
          emit_load(app, id, phase, url);
        }
      }
    }
  }
}

wrap_client! {
  pub struct ZeClient {
    life: LifeSpanHandler,
    load: LoadHandler,
  }

  impl Client {
    fn life_span_handler(&self) -> Option<LifeSpanHandler> {
      Some(self.life.clone())
    }
    fn load_handler(&self) -> Option<LoadHandler> {
      Some(self.load.clone())
    }
  }
}

fn make_client() -> Client {
  ZeClient::new(ZeLifeSpan::new(), ZeLoad::new())
}

pub fn parent_window_nsview(app: &AppHandle) -> Result<*mut c_void, String> {
  let window = parent_window(app)?;
  parent_nsview(&window)
}

pub fn tab_is_visible(id: &str) -> bool {
  registry()
    .lock()
    .ok()
    .and_then(|reg| reg.tabs.get(id).map(|tab| !tab.hidden))
    .unwrap_or(false)
}

pub fn tab_css_frame(id: &str) -> Option<(f64, f64, f64, f64)> {
  let reg = registry().lock().ok()?;
  let tab = reg.tabs.get(id)?;
  if tab.hidden {
    return None;
  }
  unsafe {
    let view = &*wrapper_view(tab.wrapper);
    let frame = view.frame();
    let w = frame.size.width;
    let h = frame.size.height;
    let y = if let Some(parent) = view.superview() {
      if parent.isFlipped() {
        frame.origin.y
      } else {
        parent.frame().size.height - frame.origin.y - h
      }
    } else {
      frame.origin.y
    };
    Some((frame.origin.x, y, w, h))
  }
}

pub async fn eval_main_json(id: &str, expression: &str) -> Result<Value, String> {
  let page = bind_page(id).await?;
  match page.conn.evaluate(expression, page.session.as_deref()).await {
    Ok(value) => Ok(value),
    Err(err) => {
      forget_bind(id);
      forget_target(id);
      if err.contains("超时") {
        return Err(err);
      }
      let page = bind_page(id).await?;
      page.conn.evaluate(expression, page.session.as_deref()).await.map_err(|_| err)
    }
  }
}

pub async fn cookie_header(id: &str, url: &str) -> Result<String, String> {
  let page = bind_page(id).await?;
  let _ = page
    .conn
    .call("Network.enable", json!({}), page.session.as_deref())
    .await;
  let mut urls = vec![url.to_string(), "https://mooc1.chaoxing.com/".into()];
  if let Ok(parsed) = url::Url::parse(url) {
    if let Some(host) = parsed.host_str() {
      urls.push(format!("https://{host}/"));
    }
  }
  let result = page
    .conn
    .call(
      "Network.getCookies",
      json!({ "urls": urls }),
      page.session.as_deref(),
    )
    .await
    .unwrap_or(Value::Null);
  let cookies = result
    .get("cookies")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  Ok(
    cookies
      .iter()
      .filter_map(|c| {
        let name = c.get("name")?.as_str()?;
        let value = c.get("value")?.as_str()?;
        Some(format!("{name}={value}"))
      })
      .collect::<Vec<_>>()
      .join("; "),
  )
}

fn parent_window(app: &AppHandle) -> Result<tauri::Window, String> {
  app
    .get_webview("main")
    .map(|w| w.window())
    .ok_or_else(|| "主窗口不存在".into())
}

fn on_main<T: Send + 'static>(app: &AppHandle, job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
  // 已在主线程再 run_on_main_thread + recv，会自己等自己，进课/开页整窗卡死。
  if MainThreadMarker::new().is_some() {
    return Ok(job());
  }
  let (tx, rx) = std::sync::mpsc::channel();
  app
    .run_on_main_thread(move || {
      let _ = tx.send(job());
    })
    .map_err(|e| e.to_string())?;
  rx.recv().map_err(|e| e.to_string())
}

fn hide_other(keep: &str) {
  if let Ok(mut reg) = registry().lock() {
    for (id, tab) in reg.tabs.iter_mut() {
      if id != keep {
        set_wrapper_hidden(tab.wrapper, true);
        tab.hidden = true;
      }
    }
  }
}

pub async fn open(
  app: AppHandle,
  id: String,
  url: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  if is_space_list_url(&url) {
    return Err("禁止顶层打开课表地址。只点 iframe 里的「我学的课」页签。".into());
  }
  remember_handle(&app);
  remember_url(&id, &url);
  let exists = registry()
    .lock()
    .ok()
    .is_some_and(|r| r.tabs.contains_key(&id));
  if exists {
    return show_at(&app, &id, x, y, width, height);
  }
  let parsed = crate::app_browser::parse_browser_url(&url)?;
  let target = cef_target_url(&app, &url, &parsed)?;
  let app2 = app.clone();
  let id2 = id.clone();
  on_main(&app, move || -> Result<(), String> {
    // CefInitialize / CreateBrowser 必须在同一条 UI 线程上，否则永远没有 on_after_created
    cef_runtime::ensure(&app2)?;
    let window = parent_window(&app2)?;
    let parent = parent_nsview(&window)?;
    hide_other(&id2);
    let wrapper = create_wrapper(parent, x, y, width, height)?;
    let parent_handle = wrapper.0 as cef::sys::cef_window_handle_t;
    let bounds = Rect {
      x: 0,
      y: 0,
      width: width.max(1.0) as i32,
      height: height.max(1.0) as i32,
    };
    let mut info = WindowInfo::default().set_as_child(parent_handle, &bounds);
    info.runtime_style = RuntimeStyle::ALLOY;
    let mut client = make_client();
    retain_client(&client);
    let mut settings = BrowserSettings::default();
    settings.background_color = 0xFFFF_FFFF;
    let cef_url = CefString::from(target.as_str());
    if let Ok(mut reg) = registry().lock() {
      reg.tabs.insert(
        id2.clone(),
        Tab {
          id: id2.clone(),
          wrapper,
          browser_id: 0,
          url: target.clone(),
          title: String::new(),
          hidden: false,
          zoom: 1.0,
        },
      );
    }
    eprintln!("[cef] create_browser {target} bounds={}x{}", bounds.width, bounds.height);
    let created = browser_host_create_browser(
      Some(&info),
      Some(&mut client),
      Some(&cef_url),
      Some(&settings),
      None,
      None,
    );
    if created != 1 {
      return Err("创建 CEF 浏览器失败".into());
    }
    for _ in 0..40 {
      cef_runtime::pump_now();
    }
    let bid = registry()
      .lock()
      .ok()
      .and_then(|r| r.tabs.get(&id2).map(|t| t.browser_id))
      .unwrap_or(0);
    eprintln!("[cef] after pump browser_id={bid}");
    Ok(())
  })??;
  ensure_cdp().await.ok();
  Ok(())
}

fn show_at(app: &AppHandle, id: &str, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
  crate::macos_video_overlay::hide_others(app, id);
  let id = id.to_string();
  on_main(app, move || {
    hide_other(&id);
    let (wrapper, bid) = {
      let Ok(mut reg) = registry().lock() else {
        return Ok(());
      };
      let Some(tab) = reg.tabs.get_mut(&id) else {
        return Ok(());
      };
      tab.hidden = false;
      (tab.wrapper, tab.browser_id)
    };
    apply_wrapper_bounds_ex(wrapper, x, y, w, h, true);
    set_wrapper_hidden(wrapper, false);
    notify_browser_resized(bid);
    Ok(())
  })?
}

pub fn set_bounds(
  app: AppHandle,
  id: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
  _notify: bool,
) -> Result<(), String> {
  on_main(&app, move || {
    let Some((wrapper, bid, live, hidden)) = (|| {
      let reg = registry().lock().ok()?;
      let tab = reg.tabs.get(&id)?;
      Some((
        tab.wrapper,
        tab.browser_id,
        wrapper_in_live_resize(tab.wrapper),
        tab.hidden,
      ))
    })() else {
      return Ok(());
    };
    // 先放手再 setFrame。hole_size_tick / was_resized 不能再抢同一把锁。
    apply_wrapper_bounds_ex(wrapper, x, y, width, height, false);
    if hidden {
      if let Ok(mut reg) = registry().lock() {
        if let Some(tab) = reg.tabs.get_mut(&id) {
          tab.hidden = false;
        }
      }
      set_wrapper_hidden(wrapper, false);
    }
    if bid > 0 && !live {
      notify_browser_resized(bid);
    }
    Ok(())
  })?
}

pub fn show(app: AppHandle, id: String) -> Result<(), String> {
  crate::macos_video_overlay::hide_others(&app, &id);
  on_main(&app, move || {
    hide_other(&id);
    if let Ok(mut reg) = registry().lock() {
      if let Some(tab) = reg.tabs.get_mut(&id) {
        set_wrapper_hidden(tab.wrapper, false);
        tab.hidden = false;
      }
    }
    Ok(())
  })?
}

pub fn hide(app: AppHandle, id: String) -> Result<(), String> {
  crate::macos_video_overlay::hide_tab(&app, &id);
  on_main(&app, move || {
    if let Ok(mut reg) = registry().lock() {
      if let Some(tab) = reg.tabs.get_mut(&id) {
        set_wrapper_hidden(tab.wrapper, true);
        tab.hidden = true;
      }
    }
    Ok(())
  })?
}

pub fn hide_all(app: AppHandle) -> Result<(), String> {
  crate::macos_video_overlay::hide_all(&app);
  on_main(&app, || {
    if let Ok(mut reg) = registry().lock() {
      for tab in reg.tabs.values_mut() {
        set_wrapper_hidden(tab.wrapper, true);
        tab.hidden = true;
      }
    }
    Ok(())
  })?
}

pub fn close(app: AppHandle, id: String) -> Result<(), String> {
  crate::macos_video_overlay::hide_tab(&app, &id);
  on_main(&app, move || {
    if let Ok(mut reg) = registry().lock() {
      if let Some(tab) = reg.tabs.remove(&id) {
        reg.by_browser.remove(&tab.browser_id);
        unsafe {
          (*wrapper_view(tab.wrapper)).removeFromSuperview();
          let _ = Retained::from_raw(tab.wrapper.0 as *mut NSView);
        }
      }
    }
    Ok(())
  })?
}

fn navigate_tab(id: &str, url: &str) {
  remember_url(id, url);
  let url = url.to_string();
  let id = id.to_string();
  if let Ok(h) = app_handle().lock() {
    if let Some(app) = h.clone() {
      let _ = on_main(&app, move || {
        if let Ok(reg) = registry().lock() {
          if let Some(tab) = reg.tabs.get(&id) {
            if let Some(browser) = browser_by_id(tab.browser_id) {
              if let Some(frame) = browser.main_frame() {
                let u = CefString::from(url.as_str());
                frame.load_url(Some(&u));
              }
            }
          }
        }
        Ok::<(), String>(())
      });
    }
  }
}

fn browser_by_id(id: i32) -> Option<Browser> {
  browser_host_get_browser_by_identifier(id)
}

pub fn navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
  if is_space_list_url(&url) {
    return Err("禁止顶层打开课表地址。只点 iframe 里的「我学的课」页签。".into());
  }
  if is_iframe_document_url(&url) {
    return Err("这是学习通 iframe 里的页面，不能当顶层打开。留在当前课页，在页面里点章节/作业。".into());
  }
  let parsed = crate::app_browser::parse_browser_url(&url)?;
  let target = cef_target_url(&app, &url, &parsed)?;
  let from_home = crate::app_browser::is_home(&remembered_url(&id));
  remember_url(&id, &target);
  remember_handle(&app);
  let id2 = id.clone();
  let target2 = target.clone();
  tauri::async_runtime::spawn(async move {
    if let Ok((conn, session)) = page_session(&id2).await {
      if from_home && !crate::app_browser::is_home(&target2) {
        let js = format!(
          "(function(){{var m=document.querySelector('meta[name=\"referrer\"]');if(!m){{m=document.createElement('meta');m.name='referrer';document.head.appendChild(m);}}m.content='no-referrer';location.replace({});}})()",
          serde_json::to_string(&target2).unwrap_or_else(|_| format!("\"{target2}\""))
        );
        let _ = conn.evaluate(&js, session.as_deref()).await;
      } else {
        let _ = conn
          .call("Page.navigate", json!({ "url": target2 }), session.as_deref())
          .await;
      }
      if let Ok(h) = app_handle().lock() {
        if let Some(app) = h.as_ref() {
          emit_load(app, &id2, "started", target2);
        }
      }
    }
  });
  Ok(())
}

pub fn reload(_app: AppHandle, id: String) -> Result<(), String> {
  forget_target(&id);
  tauri::async_runtime::spawn(async move {
    if let Ok((conn, session)) = page_session(&id).await {
      let _ = conn.call("Page.reload", json!({}), session.as_deref()).await;
    }
    forget_target(&id);
  });
  Ok(())
}

pub fn go_back(_app: AppHandle, id: String) -> Result<(), String> {
  tauri::async_runtime::spawn(async move {
    if let Ok((conn, session)) = page_session(&id).await {
      let _ = conn.evaluate("history.back()", session.as_deref()).await;
    }
  });
  Ok(())
}

pub fn go_forward(_app: AppHandle, id: String) -> Result<(), String> {
  tauri::async_runtime::spawn(async move {
    if let Ok((conn, session)) = page_session(&id).await {
      let _ = conn.evaluate("history.forward()", session.as_deref()).await;
    }
  });
  Ok(())
}

fn scale_to_zoom_level(scale: f64) -> f64 {
  let scale = if scale.is_finite() { scale.clamp(0.25, 5.0) } else { 1.0 };
  if (scale - 1.0).abs() < 0.001 {
    0.0
  } else {
    scale.ln() / 1.2_f64.ln()
  }
}

fn apply_browser_zoom(browser_id: i32, scale: f64) {
  if browser_id <= 0 {
    return;
  }
  if let Some(browser) = browser_by_id(browser_id) {
    if let Some(host) = browser.host() {
      host.set_zoom_level(scale_to_zoom_level(scale));
    }
  }
}

pub fn set_zoom(app: AppHandle, id: String, zoom: f64) -> Result<(), String> {
  let zoom = if zoom.is_finite() { zoom.clamp(0.25, 5.0) } else { 1.0 };
  on_main(&app, move || {
    let bid = registry().lock().ok().and_then(|mut reg| {
      let tab = reg.tabs.get_mut(&id)?;
      tab.zoom = zoom;
      Some(tab.browser_id)
    });
    if let Some(bid) = bid {
      apply_browser_zoom(bid, zoom);
    }
    Ok::<(), String>(())
  })?
}

pub async fn get_state(_app: AppHandle, id: String) -> Result<crate::app_browser::BrowserPageState, String> {
  let mut url = remembered_url(&id);
  // pageHeader 等同页参数切换不一定触发地址事件，补一次 live location
  if let Ok(page) = bind_page(&id).await {
    if let Ok(live) = page
      .conn
      .evaluate("location.href", page.session.as_deref())
      .await
    {
      if let Some(href) = live.as_str().filter(|s| !s.is_empty()) {
        remember_url(&id, href);
        url = href.to_string();
      }
    }
  }
  let title = registry()
    .lock()
    .ok()
    .and_then(|r| r.tabs.get(&id).map(|t| t.title.clone()))
    .unwrap_or_default();
  Ok(crate::app_browser::BrowserPageState {
    id,
    url,
    title,
  })
}

fn cef_target_url(app: &AppHandle, raw: &str, parsed: &url::Url) -> Result<String, String> {
  if crate::app_browser::is_home(raw) {
    if cfg!(debug_assertions) {
      return Ok("http://localhost:1420/browser-home.html".into());
    }
    if let Ok(dir) = app.path().resource_dir() {
      let file = dir.join("browser-home.html");
      if file.is_file() {
        return Ok(url::Url::from_file_path(&file)
          .map(|u| u.to_string())
          .unwrap_or_else(|_| parsed.to_string()));
      }
    }
  }
  let out = parsed.to_string();
  if out.starts_with("tauri://") || out.contains("tauri.localhost") {
    return Ok("http://localhost:1420/browser-home.html".into());
  }
  Ok(out)
}

struct PageBind {
  conn: CdpConn,
  session: Option<String>,
  target_id: String,
  url: String,
}

fn remembered_targets() -> &'static Mutex<HashMap<String, String>> {
  static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_target(id: &str, target_id: &str) {
  if id.is_empty() || target_id.is_empty() {
    return;
  }
  if let Ok(mut map) = remembered_targets().lock() {
    map.insert(id.to_string(), target_id.to_string());
  }
}

fn remembered_target(id: &str) -> String {
  remembered_targets()
    .lock()
    .ok()
    .and_then(|map| map.get(id).cloned())
    .unwrap_or_default()
}

fn forget_target(id: &str) {
  if let Ok(mut map) = remembered_targets().lock() {
    map.remove(id);
  }
  forget_bind(id);
}

#[derive(Clone)]
struct BindSession {
  target_id: String,
  session: String,
}

fn bind_sessions() -> &'static Mutex<HashMap<String, BindSession>> {
  static MAP: OnceLock<Mutex<HashMap<String, BindSession>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_bind(id: &str) -> Option<BindSession> {
  bind_sessions().lock().ok()?.get(id).cloned()
}

fn remember_bind(id: &str, target_id: &str, session: &str) {
  if id.is_empty() || target_id.is_empty() || session.is_empty() {
    return;
  }
  if let Ok(mut map) = bind_sessions().lock() {
    map.insert(
      id.to_string(),
      BindSession {
        target_id: target_id.to_string(),
        session: session.to_string(),
      },
    );
  }
}

fn forget_bind(id: &str) {
  if let Ok(mut map) = bind_sessions().lock() {
    map.remove(id);
  }
}

fn is_page_target(t: &Value) -> bool {
  t.get("type").and_then(|x| x.as_str()) == Some("page")
}

fn pick_page_target<'a>(pages: &'a [Value], id: &str, skip: &str) -> Option<&'a Value> {
  let cached = remembered_target(id);
  if !cached.is_empty() {
    if let Some(hit) = pages.iter().find(|t| {
      is_page_target(t)
        && t.get("targetId").and_then(|v| v.as_str()) == Some(cached.as_str())
        && (skip.is_empty() || t.get("targetId").and_then(|v| v.as_str()) != Some(skip))
    }) {
      return Some(hit);
    }
  }
  let want = remembered_url(id);
  let want_base = want.split('#').next().unwrap_or(&want);
  if !want_base.is_empty() {
    if let Some(hit) = pages.iter().find(|t| {
      is_page_target(t)
        && t.get("targetId").and_then(|v| v.as_str()).unwrap_or("") != skip
        && t.get("url")
          .and_then(|x| x.as_str())
          .unwrap_or("")
          .contains(want_base)
    }) {
      return Some(hit);
    }
  }
  pages.iter().find(|t| {
    is_page_target(t) && t.get("targetId").and_then(|v| v.as_str()).unwrap_or("") != skip
  })
}

async fn bind_page(id: &str) -> Result<PageBind, String> {
  let conn = ensure_cdp().await?;
  if let Some(cached) = cached_bind(id) {
    return Ok(PageBind {
      conn,
      session: Some(cached.session),
      target_id: cached.target_id,
      url: remembered_url(id),
    });
  }
  let pages = conn.pages().await.unwrap_or_default();
  let mut skip = String::new();
  for _ in 0..2 {
    let page = pick_page_target(&pages, id, &skip);
    let target_id = page
      .and_then(|t| t.get("targetId").and_then(|v| v.as_str()))
      .unwrap_or("")
      .to_string();
    let url = page
      .and_then(|t| t.get("url").and_then(|v| v.as_str()))
      .unwrap_or("")
      .to_string();
    if target_id.is_empty() {
      break;
    }
    match conn.attach(&target_id).await {
      Ok(sid) => {
        remember_target(id, &target_id);
        let _ = conn.call("Runtime.enable", json!({}), Some(&sid)).await;
        let _ = conn.call("Page.enable", json!({}), Some(&sid)).await;
        let _ = conn
          .call(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": CLAIM_H264 }),
            Some(&sid),
          )
          .await;
        let _ = conn.evaluate(CLAIM_H264, Some(&sid)).await;
        remember_bind(id, &target_id, &sid);
        // 不要在每次 eval 里 attach 全部 iframe。studentstudy 常有 20+ 框（视频/作业/讨论），
        // 任一子 target 卡住，章节轮询就永远回不来，面板会一直停在「加载中」。
        return Ok(PageBind { conn, session: Some(sid), target_id, url });
      }
      Err(_) => {
        forget_target(id);
        skip = target_id;
      }
    }
  }
  Ok(PageBind {
    conn,
    session: None,
    target_id: String::new(),
    url: String::new(),
  })
}

async fn page_session(id: &str) -> Result<(CdpConn, Option<String>), String> {
  let page = bind_page(id).await?;
  Ok((page.conn, page.session))
}

async fn ensure_cdp() -> Result<CdpConn, String> {
  if let Ok(g) = cdp().lock() {
    if let Some(c) = g.clone() {
      return Ok(c);
    }
  }
  let port = cef_runtime::debug_port();
  if port <= 0 {
    return Err("CDP 尚未就绪".into());
  }
  let conn = connect_loop(port).await?;
  let _ = conn
    .call(
      "Target.setDiscoverTargets",
      json!({ "discover": true }),
      None,
    )
    .await;
  let _ = conn
    .call(
      "Target.setAutoAttach",
      json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true }),
      None,
    )
    .await;
  if let Ok(mut g) = cdp().lock() {
    *g = Some(conn.clone());
  }
  Ok(conn)
}

fn eval_score(v: &Value) -> i32 {
  if let Some(flag) = v.as_bool() {
    return if flag { 8 } else { -1 };
  }
  if v.is_null() || *v == json!({ "ok": false }) {
    return -1;
  }
  let len = |key: &str| v.get(key).and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
  let extras = v
    .get("extras")
    .and_then(|x| x.as_array())
    .map(|a| {
      a.iter()
        .map(|e| {
          e.get("questions").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0)
            + e.get("works").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0)
        })
        .sum::<usize>()
    })
    .unwrap_or(0);
  let filled = v.get("filledCount").and_then(|x| x.as_i64()).unwrap_or(0) as usize;
  let jobs = len("jobs") + len("unfinished");
  let question_li = v.get("questionLi").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
  let work_li = v.get("workLi").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
  let catalog_li = v.get("catalogLi").and_then(|x| x.as_u64()).unwrap_or(0) as usize;
  let catalog_score = if question_li > 0 { 0 } else { catalog_li * 8 };
  let has_progress = usize::from(
    v.get("hasProgress").and_then(|x| x.as_bool()).unwrap_or(false)
      || v
        .get("text")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .contains("已完成任务点"),
  ) * 50;
  let text_bonus = {
    let text = v.get("text").and_then(|x| x.as_str()).unwrap_or("");
    if catalog_li > 0 || has_progress > 0 {
      (text.len() / 800).min(40) as usize
    } else {
      0
    }
  };
  let question_score = if question_li > 0 {
    200 + question_li * 20
  } else {
    0
  };
  let url = v.get("url").and_then(|x| x.as_str()).unwrap_or("");
  let work_url_bonus = if question_li == 0
    && (url.contains("doHomeWork")
      || url.contains("work/do")
      || url.contains("workPreview")
      || url.contains("mooc-ans/work"))
  {
    40
  } else {
    0
  };
  let has_video = usize::from(
    v.get("hasVideo").and_then(|x| x.as_bool()).unwrap_or(false)
      && (v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0) > 1.0
        || v.get("current").and_then(|x| x.as_f64()).unwrap_or(0.0) > 0.2
        || v.get("ready").and_then(|x| x.as_u64()).unwrap_or(0) >= 1
        || !(v.get("paused").and_then(|x| x.as_bool()).unwrap_or(true))),
  );
  let tab_count = v
    .get("tabCount")
    .and_then(|x| x.as_u64())
    .unwrap_or(0) as usize;
  let tabs = if tab_count > 0 { tab_count } else { len("steps") };
  let tab_bonus = if tabs > 1 { 22 } else { 0 };
  let ok = usize::from(v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false));
  let found = usize::from(v.get("found").and_then(|x| x.as_bool()).unwrap_or(false));
  let point = usize::from(
    v.get("x").and_then(|x| x.as_f64()).is_some() && v.get("y").and_then(|x| x.as_f64()).is_some(),
  );
  (len("questions") * 10
    + len("works") * 5
    + extras * 4
    + filled
    + jobs * 3
    + question_score
    + work_url_bonus
    + work_li * 2
    + catalog_score
    + has_progress
    + text_bonus
    + has_video * 15
    + tab_bonus
    + ok
    + found * 8
    + point * 20
    + 1) as i32
}

async fn eval_all_frames(id: &str, expression: &str) -> Result<Value, String> {
  let report = match tokio::time::timeout(Duration::from_millis(2200), eval_frames_inner(id, expression)).await {
    Ok(Ok(value)) => value,
    Ok(Err(err)) => return Err(err),
    Err(_) => json!({
      "frames": [],
      "result": Value::Null,
      "error": "扫帧超时",
    }),
  };
  if let Some(best) = report.get("result").cloned() {
    if !best.is_null() {
      return Ok(best);
    }
  }
  if let Some(err) = report.get("error").and_then(|v| v.as_str()) {
    if !err.is_empty() {
      return Err(err.to_string());
    }
  }
  Ok(Value::Null)
}

async fn eval_one_target(
  conn: &CdpConn,
  session: Option<&str>,
  expression: &str,
  url_hint: &str,
) -> (String, Result<Value, String>) {
  match conn.evaluate_ms(expression, session, 600).await {
    Ok(value) => (url_hint.to_string(), Ok(value)),
    Err(err) => (url_hint.to_string(), Err(err)),
  }
}

fn skip_child_eval_url(url: &str) -> bool {
  let raw = url.trim();
  raw.is_empty()
    || raw.eq_ignore_ascii_case("about:blank")
    || raw.starts_with("about:blank")
    || raw.starts_with("chrome-error:")
    || raw.starts_with("devtools:")
    || raw.starts_with("chrome-extension:")
}

async fn probe_child_frame(
  conn: CdpConn,
  tid: String,
  hint: String,
  expression: String,
) -> (String, Result<Value, String>) {
  let sid = match conn.attach_ms(&tid, 350).await {
    Ok(sid) => sid,
    Err(err) => return (hint, Err(err)),
  };
  match conn.evaluate_ms(&expression, Some(&sid), 600).await {
    Ok(value) => (hint, Ok(value)),
    Err(err) => (hint, Err(err)),
  }
}

async fn eval_child_targets(
  page: &PageBind,
  expression: &str,
) -> Vec<(String, Result<Value, String>)> {
  let targets = match tokio::time::timeout(Duration::from_millis(500), page.conn.pages()).await {
    Ok(Ok(list)) => list,
    _ => return Vec::new(),
  };
  let mut jobs = Vec::new();
  for t in targets {
    if jobs.len() >= 12 {
      break;
    }
    let Some(tid) = t.get("targetId").and_then(|v| v.as_str()) else {
      continue;
    };
    if tid == page.target_id {
      continue;
    }
    if !is_child_target(&t, &page.target_id, &page.url) {
      continue;
    }
    let hint = t.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if skip_child_eval_url(hint) {
      continue;
    }
    jobs.push(probe_child_frame(
      page.conn.clone(),
      tid.to_string(),
      hint.to_string(),
      expression.to_string(),
    ));
  }
  if jobs.is_empty() {
    return Vec::new();
  }
  match tokio::time::timeout(Duration::from_millis(1600), join_all(jobs)).await {
    Ok(rows) => rows,
    Err(_) => Vec::new(),
  }
}

async fn eval_frames_inner(id: &str, expression: &str) -> Result<Value, String> {
  let page = bind_page(id).await?;
  let mut rows: Vec<(String, Result<Value, String>)> = Vec::new();
  rows.push(
    eval_one_target(
      &page.conn,
      page.session.as_deref(),
      expression,
      &page.url,
    )
    .await,
  );
  let children = eval_child_targets(&page, expression).await;
  rows.extend(children);

  let mut frames: Vec<Value> = Vec::new();
  let mut best = Value::Null;
  let mut best_score = -1;
  let mut last_err = String::new();
  let mut seen: HashSet<String> = HashSet::new();
  for (url, result) in rows {
    if !url.is_empty() && !seen.insert(url.clone()) {
      if let Ok(ref v) = result {
        let score = eval_score(v);
        if score > best_score {
          best = v.clone();
          best_score = score;
          if let Some(slot) = frames
            .iter_mut()
            .find(|f| f.get("url").and_then(|x| x.as_str()) == Some(url.as_str()))
          {
            *slot = json!({ "url": url, "result": v, "error": Value::Null });
          }
        }
      }
      continue;
    }
    match result {
      Ok(v) => {
        let score = eval_score(&v);
        if score > best_score {
          best = v.clone();
          best_score = score;
        }
        frames.push(json!({ "url": url, "result": v, "error": Value::Null }));
      }
      Err(err) => {
        let nice = format_eval_error(&err);
        last_err = nice.clone();
        frames.push(json!({ "url": url, "result": Value::Null, "error": nice }));
      }
    }
  }

  Ok(json!({
    "frames": frames,
    "result": best,
    "error": if best_score < 0 { last_err } else { String::new() },
  }))
}

pub async fn eval_script(_app: AppHandle, id: String, script: String) -> Result<String, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  let value = eval_all_frames(&id, &prepare_eval_script(script)).await?;
  Ok(value.to_string())
}

/// 只跑顶层 page，不扫每个 iframe。任务点/进度从 top 自己下钻即可。
pub async fn eval_script_main(_app: AppHandle, id: String, script: String) -> Result<String, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  let value = eval_main_json(&id, &prepare_eval_script(script)).await?;
  Ok(value.to_string())
}

pub async fn eval_script_frames(_app: AppHandle, id: String, script: String) -> Result<Value, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  if script.len() > 20_000 {
    return Err("脚本过长（上限 20000 字）".into());
  }
  if script.contains("location.href=")
    || script.contains("location.replace")
    || script.contains("location.assign")
  {
    return Err("禁止用 eval 改 location。跳转用 browser_navigate / click。".into());
  }
  let touches_iframe = script.contains("contentDocument")
    || script.contains("contentWindow")
    || script.contains(".frames[");
  let mut report = match tokio::time::timeout(
    Duration::from_millis(2200),
    eval_frames_inner(&id, &prepare_eval_script(script)),
  ).await {
    Ok(Ok(value)) => value,
    Ok(Err(err)) => return Err(err),
    Err(_) => json!({
      "frames": [],
      "result": Value::Null,
      "error": "扫帧超时",
    }),
  };
  let hint = if touches_iframe {
    "检测到 iframe.contentDocument / contentWindow。CDP 已在每个 frame 内执行同一脚本，请直接用 document，不要跨框取 DOM。"
  } else {
    "脚本已在顶层和各 iframe 各跑一遍。写 document.querySelector 即可；不要 iframe.contentDocument。"
  };
  if let Some(obj) = report.as_object_mut() {
    obj.insert("hint".into(), json!(hint));
  }
  Ok(report)
}

const FIND_CLICK: &str = r#"(function(){
  var want = __WANT__;
  var t = String(want || '').replace(/\s+/g, '');
  if (t === '已学的课') t = '我学的课';
  if (!t) return null;
  function labelOk(label){
    var compact = String(label || '').replace(/\s+/g, '');
    if (!compact) return false;
    if (compact.indexOf('删除') >= 0 && t.indexOf('删除') < 0) return false;
    if ((compact === '已学的课' || compact === '我学的课') && (t === '我学的课' || t === '已学的课')) return true;
    return compact === t || compact.indexOf(t) === 0;
  }
  function frameDocs(doc, ox, oy, depth){
    var out = [{ doc: doc, ox: ox || 0, oy: oy || 0 }];
    if ((depth || 0) > 4 || !doc) return out;
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e) { return out; }
    for (var i = 0; i < list.length; i++) {
      var child = null;
      try { child = list[i].contentDocument; } catch (e2) {}
      if (!child) continue;
      var r = { left: 0, top: 0 };
      try { r = list[i].getBoundingClientRect(); } catch (e3) {}
      out = out.concat(frameDocs(child, (ox || 0) + r.left, (oy || 0) + r.top, (depth || 0) + 1));
    }
    return out;
  }
  function boxOf(el, ox, oy){
    if (!el) return null;
    var raw = el;
    var climb = el.closest ? (el.closest('a,button,[role="tab"],[role="button"],[role="link"],[onclick],[data-url],[data-href],[coursetype],.tab-item') || el) : el;
    var r0 = raw.getBoundingClientRect();
    var r = climb.getBoundingClientRect();
    if (r.width * r.height > Math.max(r0.width * r0.height, 4) * 4 && r0.width >= 2 && r0.height >= 2) {
      climb = raw;
      r = r0;
    }
    if (r.width < 2 || r.height < 2) return null;
    try { climb.scrollIntoView({ block: 'center', inline: 'nearest' }); r = climb.getBoundingClientRect(); } catch (e) {}
    if (r.width < 2 || r.height < 2) return null;
    var pts = [[r.left + r.width/2, r.top + r.height/2], [r.left + r.width*0.3, r.top + r.height*0.3], [r.left + r.width*0.7, r.top + r.height*0.7]];
    var pick = pts[0];
    var view = (climb.ownerDocument && climb.ownerDocument.defaultView) || window;
    for (var i = 0; i < pts.length; i++) {
      var top = null;
      try { top = view.document.elementFromPoint(pts[i][0], pts[i][1]); } catch (e2) {}
      if (top && (climb === top || climb.contains(top) || (top.contains && top.contains(climb)))) { pick = pts[i]; break; }
    }
    var label = String(climb.innerText || climb.getAttribute('title') || climb.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim().slice(0,80);
    var compact = label.replace(/\s+/g, '');
    var x = pick[0];
    var y = pick[1];
    var win = view;
    var topWin = null;
    try { topWin = (win && win.top) || win; } catch (eT) { topWin = win; }
    var reached = !win || !topWin || win === topWin;
    for (var g = 0; win && topWin && win !== topWin && g < 8; g++) {
      var frame = null;
      try { frame = win.frameElement; } catch (eF) { break; }
      if (!frame) break;
      var fr = null;
      try { fr = frame.getBoundingClientRect(); } catch (eFr) {}
      if (!fr) break;
      x += fr.left + (Number(frame.clientLeft) || 0);
      y += fr.top + (Number(frame.clientTop) || 0);
      try { win = win.parent; } catch (eP) { win = null; break; }
      if (win === topWin) reached = true;
    }
    return { x: x, y: y, space: reached ? 'page' : 'frame', text: label, exact: labelOk(label) || labelOk(compact), area: r.width * r.height };
  }
  var frames = frameDocs(document, 0, 0, 0);
  var best = null;
  var bestScore = 1e9;
  for (var d = 0; d < frames.length; d++) {
    var doc = frames[d].doc;
    if (!doc || !doc.body) continue;
    var walker = null;
    try { walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null); } catch (eW) { continue; }
    var n, seen = 0;
    while ((n = walker.nextNode())) {
      if (++seen > 5000) break;
      var tx = String(n.nodeValue || '').replace(/\s+/g, '');
      if (!tx || tx.length > 64) continue;
      if (tx.indexOf('删除') >= 0 && t.indexOf('删除') < 0) continue;
      var hit = tx === t;
      var near = !hit && tx.length <= t.length + 8 && tx.indexOf(t) >= 0;
      if (!hit && !near) continue;
      var el = n.parentElement;
      if (!el) continue;
      var walkHref = '';
      try { walkHref = String(el.getAttribute('href') || el.href || ''); } catch (eH2) {}
      if ((t === '我学的课' || t === '我教的课') && /visit\/(?:courses|interaction)|courselist/i.test(walkHref)) continue;
      var kids = 0;
      try { kids = el.childElementCount || 0; } catch (e4) {}
      if (kids > 12) continue;
      var b = boxOf(el, frames[d].ox, frames[d].oy);
      if (!b) continue;
      if (!labelOk(b.text) && !labelOk(tx)) continue;
      var score = (hit ? 0 : 100) + b.area + kids;
      if (score < bestScore) { b.exact = hit; best = b; bestScore = score; }
      if (hit && kids <= 1 && b.area < 8000) break;
    }
  }
  return best;
})()"#;

const FIND_SEL: &str = r#"(function(){
  var sel = __SEL__;
  function frameDocs(doc, ox, oy, depth){
    var out = [{ doc: doc, ox: ox || 0, oy: oy || 0 }];
    if ((depth || 0) > 4 || !doc) return out;
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e) { return out; }
    for (var i = 0; i < list.length; i++) {
      var child = null;
      try { child = list[i].contentDocument; } catch (e2) {}
      if (!child) continue;
      var r = { left: 0, top: 0 };
      try { r = list[i].getBoundingClientRect(); } catch (e3) {}
      out = out.concat(frameDocs(child, (ox || 0) + r.left, (oy || 0) + r.top, (depth || 0) + 1));
    }
    return out;
  }
  var frames = frameDocs(document, 0, 0, 0);
  var el = null;
  var ox = 0;
  var oy = 0;
  for (var f = 0; f < frames.length; f++) {
    try { el = frames[f].doc.querySelector(sel); } catch (e) { el = null; }
    if (el) { ox = frames[f].ox; oy = frames[f].oy; break; }
  }
  if (!el) return null;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e1) {}
  var r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  var pts = [[r.left + r.width/2, r.top + r.height/2], [r.left + r.width*0.3, r.top + r.height*0.3], [r.left + r.width*0.7, r.top + r.height*0.7]];
  var pick = pts[0];
  var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  for (var i = 0; i < pts.length; i++) {
    var top = null;
    try { top = view.document.elementFromPoint(pts[i][0], pts[i][1]); } catch (e2) {}
    if (top && (el === top || el.contains(top) || (top.contains && top.contains(el)))) { pick = pts[i]; break; }
  }
  var label = '';
  try { label = String(el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim().slice(0,80); } catch (e3) {}
  var x = pick[0];
  var y = pick[1];
  var win = view;
  var topWin = null;
  try { topWin = (win && win.top) || win; } catch (eT) { topWin = win; }
  var reached = !win || !topWin || win === topWin;
  for (var g = 0; win && topWin && win !== topWin && g < 8; g++) {
    var frame = null;
    try { frame = win.frameElement; } catch (eF) { break; }
    if (!frame) break;
    var fr = null;
    try { fr = frame.getBoundingClientRect(); } catch (eFr) {}
    if (!fr) break;
    x += fr.left + (Number(frame.clientLeft) || 0);
    y += fr.top + (Number(frame.clientTop) || 0);
    try { win = win.parent; } catch (eP) { win = null; break; }
    if (win === topWin) reached = true;
  }
  return { x: x, y: y, space: reached ? 'page' : 'frame', text: label };
})()"#;

const COLLECT_DOM: &str = r#"(function(){
  var out = [];
  var seen = {};
  function hookOf(el){
    try { return String(el.getAttribute('data-url') || el.getAttribute('href') || el.getAttribute('onclick') || el.href || ''); } catch (e) { return ''; }
  }
  function pseudo(el){
    try {
      var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      var pick = function(st){
        var c = String((st && st.content) || '').trim();
        if (!c || c === 'none' || c === 'normal') return '';
        return c.replace(/^["']|["']$/g, '');
      };
      return (pick(view.getComputedStyle(el, '::before')) + pick(view.getComputedStyle(el, '::after'))).replace(/\s+/g, '');
    } catch (e) { return ''; }
  }
  function nameOf(el){
    var name = '';
    try { name = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || ''); } catch (e) {}
    if (!name) {
      try {
        var img = el.querySelector && el.querySelector('img[alt]');
        if (img) name = String(img.getAttribute('alt') || '');
      } catch (e2) {}
    }
    if (!name) {
      try { name = String(el.innerText || el.textContent || ''); } catch (e3) {}
    }
    if (!name) name = pseudo(el);
    name = String(name || '').replace(/\s+/g, ' ').trim();
    var hook = hookOf(el);
    if (name.indexOf('删除') >= 0 || /[?&]del=/.test(hook)) return '';
    if (/visit\/(?:courses|interaction)|courselist/i.test(hook) && !/stucoursemiddle|mycourse\/stu|courseid=/i.test(hook)) return '';
    var courseType = '';
    try { courseType = String(el.getAttribute('coursetype') || ''); } catch (eT) {}
    if (courseType === '1') name = name || '我学的课';
    if (courseType === '0') name = name || '我教的课';
    if (name === '已学的课') name = '我学的课';
    return name;
  }
  function add(el, role){
    var name = nameOf(el);
    if (!name || name.length > 64 || seen[name]) return;
    seen[name] = 1;
    out.push({ role: role || 'generic', name: name.slice(0, 80) });
  }
  function scan(doc){
    if (!doc) return;
    var nodes = [];
    try { nodes = doc.querySelectorAll('a, button, input, select, textarea, [role="tab"], [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [title], [aria-label], [onclick], [data-url], [coursetype], .tab-item, [class*="tab"], [class*="Tab"]'); } catch (e) { return; }
    for (var i = 0; i < nodes.length && out.length < 220; i++) {
      var el = nodes[i];
      var tag = String(el.tagName || '').toLowerCase();
      var role = el.getAttribute && el.getAttribute('role');
      if (!role) role = tag === 'a' ? 'link' : tag === 'button' ? 'button' : (tag === 'input' || tag === 'textarea' ? 'textbox' : 'button');
      add(el, role);
    }
    if (!doc.body) return;
    var walker = null;
    try { walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null); } catch (eW) { return; }
    var n, seenN = 0;
    while ((n = walker.nextNode())) {
      if (++seenN > 3000) break;
      var tx = String(n.nodeValue || '').replace(/\s+/g, '');
      if (tx !== '我学的课' && tx !== '我教的课' && tx !== '已学的课') continue;
      if (tx === '已学的课') tx = '我学的课';
      if (seen[tx]) continue;
      seen[tx] = 1;
      out.push({ role: 'button', name: tx });
    }
  }
  function walk(doc, depth){
    scan(doc);
    if ((depth || 0) > 4 || !doc) return;
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      try {
        var child = list[i].contentDocument;
        if (child) walk(child, (depth || 0) + 1);
      } catch (e2) {}
    }
  }
  walk(document, 0);
  return out;
})()"#;

const VIRTUAL_MOUSE: &str = include_str!("../../src/services/browser/engine/virtualMouse.inject.js");

fn virtual_mouse_script(kind: &str, x: f64, y: f64, label: &str) -> String {
  let kind = serde_json::to_string(kind).unwrap_or_else(|_| "\"click\"".into());
  let label = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".into());
  format!(
    "(function(){{\n{VIRTUAL_MOUSE}\n  var x = {x};\n  var y = {y};\n  __zeEnsureMouse().act({kind}, x, y, {label});\n  return true;\n}})()"
  )
}

async fn show_virtual_mouse(
  conn: &CdpConn,
  session: Option<&str>,
  kind: &str,
  x: f64,
  y: f64,
  label: &str,
) {
  let _ = conn
    .evaluate(&virtual_mouse_script(kind, x, y, label), session)
    .await;
}

/// Playwright 式真实点击：先画出虚拟鼠标，再按下 / 抬起。
/// x/y 是顶层 page 视口 CSS 像素（与 getBoundingClientRect 换算到 top 后一致）。
async fn click_point(
  conn: &CdpConn,
  x: f64,
  y: f64,
  session: Option<&str>,
  label: &str,
) -> Result<(), String> {
  show_virtual_mouse(conn, session, "click", x, y, label).await;
  tokio::time::sleep(std::time::Duration::from_millis(240)).await;
  let _ = conn
    .evaluate(
      "(function(){ var t=window.top||window; var m=t.__ZE_MOUSE__; if(m&&m.cover) m.cover(false); var r=t.document.getElementById('__ze_mouse_root'); if(r) r.style.visibility='hidden'; return true; })()",
      session,
    )
    .await;
  let ev = |ty: &str, button: &str, buttons: u32| {
    json!({
      "type": ty,
      "x": x,
      "y": y,
      "button": button,
      "buttons": buttons,
      "clickCount": 1,
      "pointerType": "mouse",
    })
  };
  conn.call("Input.dispatchMouseEvent", ev("mouseMoved", "none", 0), session).await?;
  tokio::time::sleep(std::time::Duration::from_millis(16)).await;
  conn.call("Input.dispatchMouseEvent", ev("mousePressed", "left", 1), session).await?;
  tokio::time::sleep(std::time::Duration::from_millis(24)).await;
  conn.call("Input.dispatchMouseEvent", ev("mouseReleased", "left", 0), session).await?;
  let _ = conn
    .evaluate(
      "(function(){ var t=window.top||window; var m=t.__ZE_MOUSE__; if(m&&m.cover) m.cover(true); var r=t.document.getElementById('__ze_mouse_root'); if(r) r.style.visibility='visible'; return true; })()",
      session,
    )
    .await;
  Ok(())
}

async fn key_event(
  conn: &CdpConn,
  session: Option<&str>,
  ty: &str,
  key: &str,
  code: &str,
  modifiers: u32,
  vk: i64,
) -> Result<(), String> {
  conn
    .call(
      "Input.dispatchKeyEvent",
      json!({
        "type": ty,
        "key": key,
        "code": code,
        "windowsVirtualKeyCode": vk,
        "nativeVirtualKeyCode": vk,
        "modifiers": modifiers,
      }),
      session,
    )
    .await
    .map(|_| ())
}

async fn select_all(conn: &CdpConn, session: Option<&str>) -> Result<(), String> {
  // macOS：Command+A
  key_event(conn, session, "keyDown", "a", "KeyA", 4, 65).await?;
  key_event(conn, session, "keyUp", "a", "KeyA", 4, 65).await?;
  Ok(())
}

async fn type_focused(conn: &CdpConn, session: Option<&str>, text: &str) -> Result<(), String> {
  select_all(conn, session).await.ok();
  conn
    .call("Input.insertText", json!({ "text": text }), session)
    .await
    .map(|_| ())
}

fn is_child_target(t: &Value, main_tid: &str, main_url: &str) -> bool {
  let ty = t.get("type").and_then(|v| v.as_str()).unwrap_or("");
  if ty != "iframe" && ty != "page" {
    return false;
  }
  let tid = t.get("targetId").and_then(|v| v.as_str()).unwrap_or("");
  if tid.is_empty() || (!main_tid.is_empty() && tid == main_tid) {
    return false;
  }
  let url = t.get("url").and_then(|v| v.as_str()).unwrap_or("");
  if url.starts_with("devtools://")
    || url.starts_with("chrome-extension://")
    || url.contains("browser-home.html")
    || url.starts_with("zerror://")
  {
    return false;
  }
  if ty == "iframe" {
    return true;
  }
  let main = main_url.split('#').next().unwrap_or(main_url);
  let other = url.split('#').next().unwrap_or(url);
  !other.is_empty() && other != main
}

fn box_score(v: &Value) -> i32 {
  let has_point = v.get("x").and_then(|x| x.as_f64()).is_some()
    && v.get("y").and_then(|x| x.as_f64()).is_some();
  if !has_point {
    return -1;
  }
  let exact = i32::from(v.get("exact").and_then(|x| x.as_bool()).unwrap_or(false));
  let area = v.get("area").and_then(|x| x.as_f64()).unwrap_or(20_000.0);
  let area_score = if area < 2_000.0 {
    20
  } else if area < 20_000.0 {
    10
  } else {
    0
  };
  exact * 50 + area_score
}

fn click_session_for_box(page: &PageBind, boxv: &Value, found: Option<String>) -> Option<String> {
  match boxv.get("space").and_then(|v| v.as_str()) {
    Some("frame") => found,
    _ => page.session.clone(),
  }
}

fn fail_rank(v: &Value) -> i32 {
  match v.get("reason").and_then(|x| x.as_str()) {
    Some("ambiguous") => 50,
    Some("disabled") => 40,
    Some("readonly") => 35,
    Some("covered") => 25,
    Some("hidden") => 20,
    Some("unstable") => 15,
    Some("not_found") => 2,
    Some("invalid") => 1,
    _ => 0,
  }
}

fn consider_locate(v: Value, best_hit: &mut (Value, i32), best_fail: &mut (Value, i32)) {
  let score = box_score(&v);
  if score > best_hit.1 {
    *best_hit = (v, score);
    return;
  }
  if score < 0 {
    let rank = fail_rank(&v);
    if rank > best_fail.1 {
      *best_fail = (v, rank);
    }
  }
}

async fn locate_in_frames(page: &PageBind, expr: &str) -> Value {
  let mut best_hit = (Value::Null, -1);
  let mut best_fail = (
    json!({ "ok": false, "reason": "not_found", "retry": true, "error": "没有找到元素" }),
    0,
  );
  if let Ok(v) = page.conn.evaluate(expr, page.session.as_deref()).await {
    consider_locate(v, &mut best_hit, &mut best_fail);
  }
  // 顶层没点到就返回。不要再 attach 每个 iframe 重跑定位脚本。
  if best_hit.1 >= 0 {
    let mut out = best_hit.0;
    if let Some(obj) = out.as_object_mut() {
      obj.insert("ok".into(), json!(true));
    }
    return out;
  }
  best_fail.0
}

pub async fn cdp_locate(_app: AppHandle, id: String, script: String) -> Result<Value, String> {
  let script = script.trim();
  if script.is_empty() {
    return Ok(json!({
      "ok": false,
      "reason": "invalid",
      "retry": false,
      "error": "缺少定位脚本"
    }));
  }
  let page = bind_page(&id).await?;
  Ok(locate_in_frames(&page, script).await)
}

async fn find_box_in_frames(page: &PageBind, expr: &str) -> (Value, Option<String>) {
  let best = page.conn.evaluate(expr, page.session.as_deref()).await.unwrap_or(Value::Null);
  // 学习通 locate 已从顶层 walk 同源 iframe，并回 page 坐标。
  // 没点到也不要 attach 20+ 子 target：切章时页面正在重载，每个 iframe 再跑一遍会卡死整窗。
  let session = click_session_for_box(page, &best, page.session.clone());
  (best, session)
}

fn miss(error: String) -> CdpActResult {
  CdpActResult {
    ok: false,
    error: Some(error),
    text: None,
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  }
}

fn compact_label(raw: &str) -> String {
  raw.chars().filter(|c| !c.is_whitespace()).collect()
}

fn is_student_tab(raw: &str) -> bool {
  let c = compact_label(raw);
  c == "我学的课" || c == "已学的课"
}

fn click_label_matches(want: &str, label: &str) -> bool {
  let a = compact_label(want);
  let b = compact_label(label);
  if a.is_empty() || b.is_empty() {
    return false;
  }
  if b.contains("删除") && !a.contains("删除") {
    return false;
  }
  if is_student_tab(&a) && is_student_tab(&b) {
    return true;
  }
  b == a || b.starts_with(&a)
}

fn looks_like_selector(raw: &str) -> bool {
  let t = raw.trim();
  t.starts_with('#') || t.starts_with('.') || t.starts_with('[') || t.contains('>') || t.contains(':')
}

async fn click_found(
  conn: &CdpConn,
  boxv: Value,
  session: Option<String>,
  fallback: &str,
  verify_label: bool,
) -> Result<CdpActResult, String> {
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let label = boxv
    .get("text")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let Some((x, y)) = x.zip(y) else {
    return Ok(miss(format!("没有找到「{fallback}」")));
  };
  if verify_label && !looks_like_selector(fallback) && !label.is_empty() && !click_label_matches(fallback, &label) {
    return Ok(miss(format!("点到的是「{label}」，不是「{fallback}」")));
  }
  click_point(conn, x, y, session.as_deref(), &label).await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: Some(if label.is_empty() { fallback.to_string() } else { label }),
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub async fn cdp_click_text(_app: AppHandle, id: String, text: String) -> Result<CdpActResult, String> {
  cdp_click(_app, id, Some(text), None).await
}

pub async fn cdp_click(
  _app: AppHandle,
  id: String,
  text: Option<String>,
  selector: Option<String>,
) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let (expr, label) = if let Some(sel) = selector.as_deref().filter(|s| !s.is_empty()) {
    (
      FIND_SEL.replace("__SEL__", &serde_json::to_string(sel).unwrap_or_else(|_| "\"\"".into())),
      sel.to_string(),
    )
  } else {
    let want = text.unwrap_or_default();
    if want.trim().is_empty() {
      return Ok(miss("缺少点击目标".into()));
    }
    (
      FIND_CLICK.replace("__WANT__", &serde_json::to_string(&want).unwrap_or_else(|_| "\"\"".into())),
      want,
    )
  };
  let (boxv, session) = find_box_in_frames(&page, &expr).await;
  click_found(&page.conn, boxv, session, &label, selector.is_none()).await
}

pub async fn cdp_fill(_app: AppHandle, id: String, selector: String, text: String) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let expr = FIND_SEL.replace("__SEL__", &serde_json::to_string(&selector).unwrap_or_else(|_| "\"\"".into()));
  let (boxv, session) = find_box_in_frames(&page, &expr).await;
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let Some((x, y)) = x.zip(y) else {
    return Ok(CdpActResult {
      ok: false,
      error: Some("没有找到输入框".into()),
      text: None,
      snapshot: None,
      filled: Some(false),
      length: Some(0),
      hint: None,
    });
  };
  click_point(&page.conn, x, y, session.as_deref(), "输入").await?;
  type_focused(&page.conn, session.as_deref(), &text).await?;
  tokio::time::sleep(std::time::Duration::from_millis(80)).await;
  let check = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return {filled:false,length:0}; var got=el.isContentEditable?String(el.textContent||''):String(el.value||''); return {filled:got.length>0,length:got.length}; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "filled": false, "length": 0 }));
  let filled = check.get("filled").and_then(|v| v.as_bool()).unwrap_or(false);
  let length = check.get("length").and_then(|v| v.as_i64()).unwrap_or(0);
  Ok(CdpActResult {
    ok: filled,
    error: if filled { None } else { Some("输入框还是空的，页面没吃到这次填写".into()) },
    text: if filled { Some(text) } else { None },
    snapshot: None,
    filled: Some(filled),
    length: Some(length),
    hint: None,
  })
}

pub async fn cdp_click_box(_app: AppHandle, id: String, script: String) -> Result<CdpActResult, String> {
  let script = script.trim();
  if script.is_empty() {
    return Ok(miss("缺少定位脚本".into()));
  }
  let page = bind_page(&id).await?;
  let (boxv, session) = find_box_in_frames(&page, script).await;
  click_found(&page.conn, boxv, session, "目标", false).await
}

pub async fn cdp_fill_box(
  _app: AppHandle,
  id: String,
  script: String,
  text: String,
) -> Result<CdpActResult, String> {
  let script = script.trim();
  if script.is_empty() {
    return Ok(miss("缺少定位脚本".into()));
  }
  let page = bind_page(&id).await?;
  let (boxv, session) = find_box_in_frames(&page, script).await;
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let Some((x, y)) = x.zip(y) else {
    return Ok(CdpActResult {
      ok: false,
      error: Some("没有找到输入框".into()),
      text: None,
      snapshot: None,
      filled: Some(false),
      length: Some(0),
      hint: None,
    });
  };
  click_point(&page.conn, x, y, session.as_deref(), "输入").await?;
  tokio::time::sleep(std::time::Duration::from_millis(40)).await;
  type_focused(&page.conn, session.as_deref(), &text).await?;
  tokio::time::sleep(std::time::Duration::from_millis(80)).await;
  let check = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return {filled:false,length:0}; var got=el.isContentEditable?String(el.textContent||''):String(el.value||''); return {filled:got.length>0,length:got.length}; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "filled": false, "length": 0 }));
  let filled = check.get("filled").and_then(|v| v.as_bool()).unwrap_or(false);
  let length = check.get("length").and_then(|v| v.as_i64()).unwrap_or(0);
  Ok(CdpActResult {
    ok: filled,
    error: if filled { None } else { Some("输入框还是空的，页面没吃到这次填写".into()) },
    text: if filled { Some(text) } else { None },
    snapshot: None,
    filled: Some(filled),
    length: Some(length),
    hint: None,
  })
}

pub async fn cdp_hover(
  _app: AppHandle,
  id: String,
  text: Option<String>,
  selector: Option<String>,
) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let (expr, label) = if let Some(sel) = selector.as_deref().filter(|s| !s.is_empty()) {
    (
      FIND_SEL.replace("__SEL__", &serde_json::to_string(sel).unwrap_or_else(|_| "\"\"".into())),
      sel.to_string(),
    )
  } else {
    let want = text.unwrap_or_default();
    if want.trim().is_empty() {
      return Ok(miss("缺少悬停目标".into()));
    }
    (
      FIND_CLICK.replace("__WANT__", &serde_json::to_string(&want).unwrap_or_else(|_| "\"\"".into())),
      want,
    )
  };
  let (boxv, session) = find_box_in_frames(&page, &expr).await;
  let x = boxv.get("x").and_then(|v| v.as_f64());
  let y = boxv.get("y").and_then(|v| v.as_f64());
  let Some((x, y)) = x.zip(y) else {
    return Ok(miss(format!("没有找到「{label}」")));
  };
  show_virtual_mouse(&page.conn, session.as_deref(), "move", x, y, &label).await;
  page.conn
    .call(
      "Input.dispatchMouseEvent",
      json!({
        "type": "mouseMoved",
        "x": x,
        "y": y,
        "button": "none",
        "buttons": 0,
        "pointerType": "mouse",
      }),
      session.as_deref(),
    )
    .await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: Some(label),
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub async fn cdp_scroll(_app: AppHandle, id: String, amount: f64) -> Result<CdpActResult, String> {
  let (conn, session) = page_session(&id).await?;
  let pos = conn
    .evaluate(
      "(function(){ return { x: Math.floor((window.innerWidth||800)/2), y: Math.floor((window.innerHeight||600)/2) }; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "x": 400, "y": 300 }));
  let x = pos.get("x").and_then(|v| v.as_f64()).unwrap_or(400.0);
  let y = pos.get("y").and_then(|v| v.as_f64()).unwrap_or(300.0);
  show_virtual_mouse(&conn, session.as_deref(), "scroll", x, y, "滚动").await;
  conn
    .call(
      "Input.dispatchMouseEvent",
      json!({
        "type": "mouseWheel",
        "x": x,
        "y": y,
        "deltaX": 0,
        "deltaY": amount,
        "pointerType": "mouse",
      }),
      session.as_deref(),
    )
    .await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: None,
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

fn key_spec(raw: &str) -> Option<(&'static str, &'static str, i64)> {
  Some(match raw {
    "Enter" | "Return" => ("Enter", "Enter", 13),
    "Tab" => ("Tab", "Tab", 9),
    "Escape" | "Esc" => ("Escape", "Escape", 27),
    "Backspace" => ("Backspace", "Backspace", 8),
    "Delete" => ("Delete", "Delete", 46),
    "ArrowUp" | "Up" => ("ArrowUp", "ArrowUp", 38),
    "ArrowDown" | "Down" => ("ArrowDown", "ArrowDown", 40),
    "ArrowLeft" | "Left" => ("ArrowLeft", "ArrowLeft", 37),
    "ArrowRight" | "Right" => ("ArrowRight", "ArrowRight", 39),
    "Space" | " " => (" ", "Space", 32),
    _ => return None,
  })
}

pub async fn cdp_press(_app: AppHandle, id: String, key: String) -> Result<CdpActResult, String> {
  let (conn, session) = page_session(&id).await?;
  let Some((name, code, vk)) = key_spec(key.trim()) else {
    return Ok(miss(format!("还不支持按「{key}」")));
  };
  key_event(&conn, session.as_deref(), "keyDown", name, code, 0, vk).await?;
  key_event(&conn, session.as_deref(), "keyUp", name, code, 0, vk).await?;
  Ok(CdpActResult {
    ok: true,
    error: None,
    text: Some(key),
    snapshot: None,
    filled: None,
    length: None,
    hint: None,
  })
}

pub async fn cdp_type_focused(_app: AppHandle, id: String, text: String) -> Result<CdpActResult, String> {
  let page = bind_page(&id).await?;
  let probe = "(function(){ var el=document.activeElement; if(!el) return {ok:false}; var tag=String(el.tagName||'').toLowerCase(); return {ok: tag==='input'||tag==='textarea'||!!el.isContentEditable}; })()";
  let mut session = page.session.clone();
  let focused = page.conn.evaluate(probe, session.as_deref()).await.unwrap_or(Value::Null);
  if focused.get("ok").and_then(|v| v.as_bool()) != Some(true) {
    if let Ok(targets) = page.conn.pages().await {
      for t in targets {
        let Some(tid) = t.get("targetId").and_then(|v| v.as_str()) else { continue };
        if !is_child_target(&t, &page.target_id, &page.url) {
          continue;
        }
        if let Ok(sid) = page.conn.attach(tid).await {
          let _ = page.conn.call("Runtime.enable", json!({}), Some(&sid)).await;
          if let Ok(v) = page.conn.evaluate(probe, Some(&sid)).await {
            if v.get("ok").and_then(|x| x.as_bool()) == Some(true) {
              session = Some(sid);
              break;
            }
          }
        }
      }
    }
  }
  type_focused(&page.conn, session.as_deref(), &text).await?;
  tokio::time::sleep(std::time::Duration::from_millis(60)).await;
  let check = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return {filled:false,length:0}; var got=el.isContentEditable?String(el.textContent||''):String(el.value||''); return {filled:got.length>0,length:got.length}; })()",
      session.as_deref(),
    )
    .await
    .unwrap_or(json!({ "filled": false, "length": 0 }));
  let filled = check.get("filled").and_then(|v| v.as_bool()).unwrap_or(false);
  let length = check.get("length").and_then(|v| v.as_i64()).unwrap_or(0);
  Ok(CdpActResult {
    ok: filled,
    error: if filled { None } else { Some("焦点不在输入框，或页面没吃到输入".into()) },
    text: if filled { Some(text) } else { None },
    snapshot: None,
    filled: Some(filled),
    length: Some(length),
    hint: None,
  })
}

fn push_named_ref(
  lines: &mut Vec<String>,
  refs: &mut Vec<Value>,
  seen: &mut HashSet<String>,
  role: &str,
  name: &str,
  limit: usize,
) {
  if refs.len() >= limit {
    return;
  }
  let raw = name.trim();
  let name = if raw.is_empty() {
    if !matches!(role, "button" | "link" | "textbox" | "tab" | "checkbox") {
      return;
    }
    "(无文案)"
  } else if raw.len() > 64 {
    return;
  } else {
    raw
  };
  let key = format!("{role}:{name}");
  if !seen.insert(key) {
    return;
  }
  if !matches!(
    role,
    "button" | "link" | "textbox" | "heading" | "tab" | "checkbox" | "menuitem" | "listitem"
  ) {
    return;
  }
  let id = format!("e{}", refs.len() + 1);
  lines.push(format!("- {role} \"{name}\" [ref={id}]"));
  refs.push(json!({
    "id": id,
    "role": role,
    "name": name,
    "locator": { "by": "text", "value": name, "exact": true },
  }));
}

fn push_ax_nodes(
  nodes: &[Value],
  lines: &mut Vec<String>,
  refs: &mut Vec<Value>,
  seen: &mut HashSet<String>,
  limit: usize,
) {
  for node in nodes {
    if refs.len() >= limit {
      break;
    }
    let name = node
      .get("name")
      .and_then(|v| v.get("value"))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .trim()
      .to_string();
    let role = node
      .get("role")
      .and_then(|v| v.get("value"))
      .and_then(|v| v.as_str())
      .unwrap_or("generic");
    push_named_ref(lines, refs, seen, role, &name, limit);
  }
}

fn push_dom_nodes(
  nodes: &Value,
  lines: &mut Vec<String>,
  refs: &mut Vec<Value>,
  seen: &mut HashSet<String>,
  limit: usize,
) {
  let Some(list) = nodes.as_array() else { return };
  for node in list {
    let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("button");
    push_named_ref(lines, refs, seen, role, name, limit);
  }
}

async fn ax_of(conn: &CdpConn, session: Option<&str>) -> Vec<Value> {
  let tree = conn
    .call("Accessibility.getFullAXTree", json!({}), session)
    .await
    .unwrap_or(json!({}));
  tree.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default()
}

fn frame_snap_priority(url: &str) -> i32 {
  let u = url.to_ascii_lowercase();
  if u.contains("studentcourse") {
    return 100;
  }
  if u.contains("/knowledge/cards") {
    return 95;
  }
  if u.contains("dohomework") || u.contains("dowork") || u.contains("/work/do") || u.contains("work/list") {
    return 90;
  }
  if u.contains("studentstudy") {
    return 80;
  }
  if u.contains("ananas") || u.contains("insertvideo") {
    return 40;
  }
  if u.contains("mycourse/stu") || u.contains("stucoursemiddle") {
    return 20;
  }
  if u.contains("visit/courses") || u.contains("visit/interaction") {
    return 55;
  }
  10
}

struct FrameSnap {
  url: String,
  lines: Vec<String>,
  refs: Vec<Value>,
  priority: i32,
}

async fn collect_frame_snap(
  conn: &CdpConn,
  session: Option<&str>,
  url_hint: &str,
  limit: usize,
) -> FrameSnap {
  let url = conn
    .evaluate("location.href", session)
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or_else(|| url_hint.to_string());
  let mut lines = Vec::new();
  let mut refs = Vec::new();
  let mut seen = HashSet::new();
  let _ = conn.call("Accessibility.enable", json!({}), session).await;
  push_ax_nodes(&ax_of(conn, session).await, &mut lines, &mut refs, &mut seen, limit);
  if let Ok(dom) = conn.evaluate(COLLECT_DOM, session).await {
    push_dom_nodes(&dom, &mut lines, &mut refs, &mut seen, limit);
  }
  let priority = frame_snap_priority(&url);
  FrameSnap {
    url,
    lines,
    refs,
    priority,
  }
}

pub async fn cdp_snapshot(_app: AppHandle, id: String) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let mut frames: Vec<FrameSnap> = Vec::new();

  // 子 frame 优先采集；课程目录 / 作业常在跨域 iframe
  if let Ok(targets) = page.conn.pages().await {
    for t in targets {
      if !is_child_target(&t, &page.target_id, &page.url) {
        continue;
      }
      let Some(tid) = t.get("targetId").and_then(|v| v.as_str()) else { continue };
      let hint = t.get("url").and_then(|v| v.as_str()).unwrap_or("");
      if let Ok(sid) = page.conn.attach(tid).await {
        let _ = page.conn.call("Runtime.enable", json!({}), Some(&sid)).await;
        frames.push(collect_frame_snap(&page.conn, Some(&sid), hint, 160).await);
      }
    }
  }
  frames.push(collect_frame_snap(&page.conn, page.session.as_deref(), &page.url, 120).await);
  frames.sort_by(|a, b| b.priority.cmp(&a.priority));

  // 合并：高优先级 frame 的 ref 在前，并给 Agent 看分段 snapshot
  let mut lines = Vec::new();
  let mut refs = Vec::new();
  let mut seen = HashSet::new();
  let mut frame_out = Vec::new();
  for (i, frame) in frames.iter().enumerate() {
    if frame.lines.is_empty() && frame.refs.is_empty() {
      continue;
    }
    lines.push(format!("# frame[{i}] {}", frame.url));
    let mut local_lines = Vec::new();
    for node in &frame.refs {
      if refs.len() >= 280 {
        break;
      }
      let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
      let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("button");
      if name.is_empty() {
        continue;
      }
      let key = format!("{i}:{name}");
      if !seen.insert(key) {
        continue;
      }
      let id = format!("e{}", refs.len() + 1);
      let line = format!("- {role} \"{name}\" [ref={id}]");
      lines.push(line.clone());
      local_lines.push(line);
      refs.push(json!({
        "id": id,
        "role": role,
        "name": name,
        "frame": frame.url,
        "locator": { "by": "text", "value": name, "exact": true },
      }));
    }
    frame_out.push(json!({
      "url": frame.url,
      "priority": frame.priority,
      "snapshot": local_lines.join("\n"),
      "refCount": local_lines.len(),
    }));
  }

  let iframes = page.conn
    .evaluate(
      r#"(function(){
        var out = [];
        try {
          var list = document.querySelectorAll('iframe[src]');
          for (var i = 0; i < list.length && out.length < 8; i++) {
            var el = list[i];
            var live = '';
            try { live = String((el.contentWindow && el.contentWindow.location && el.contentWindow.location.href) || ''); } catch (e) {}
            out.push({ id: el.id || '', src: live || el.src || '' });
          }
        } catch (e) {}
        return out;
      })()"#,
      page.session.as_deref(),
    )
    .await
    .unwrap_or(json!([]));
  let url = frames
    .last()
    .map(|f| f.url.clone())
    .unwrap_or_else(|| page.url.clone());
  // 顶层 url：优先记主文档
  let top_url = page
    .conn
    .evaluate("location.href", page.session.as_deref())
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or(url);
  let title = page
    .conn
    .evaluate("document.title", page.session.as_deref())
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or_default();
  let preferred = frame_out.first().cloned().unwrap_or(json!({}));
  Ok(json!({
    "url": top_url,
    "title": title,
    "snapshot": lines.join("\n"),
    "refs": refs,
    "captcha": false,
    "iframes": iframes,
    "frames": frame_out,
    "preferredFrame": preferred,
    "hint": CHROME_UA_NOTE,
  }))
}

pub async fn cdp_screenshot(_app: AppHandle, id: String) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let session = page.session.clone();
  let sid = session.as_deref();
  let _ = page.conn.call("Page.enable", json!({}), sid).await;
  let first = page
    .conn
    .call(
      "Page.captureScreenshot",
      json!({ "format": "jpeg", "quality": 55, "fromSurface": true }),
      sid,
    )
    .await;
  let shot = match first {
    Ok(value)
      if value
        .get("data")
        .and_then(|item| item.as_str())
        .map(|item| !item.is_empty())
        .unwrap_or(false) =>
    {
      value
    }
    _ => {
      page
        .conn
        .call("Page.captureScreenshot", json!({ "format": "jpeg", "quality": 55 }), sid)
        .await?
    }
  };
  let data = shot
    .get("data")
    .and_then(|item| item.as_str())
    .unwrap_or("")
    .to_string();
  if data.is_empty() {
    return Err("截图为空".into());
  }
  Ok(json!({
    "url": page.url,
    "image": format!("data:image/jpeg;base64,{}", data),
  }))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn click_label_rejects_deleted_course() {
    assert!(!click_label_matches("我学的课", "已删除课程"));
    assert!(click_label_matches("我学的课", "我学的课"));
    assert!(click_label_matches("我学的课", "已学的课"));
    assert!(click_label_matches("作业", "作业2（0915）"));
  }

  #[test]
  fn child_target_is_any_other_document() {
    let main = json!({ "type": "page", "targetId": "main", "url": "https://a.example/base" });
    let frame = json!({ "type": "iframe", "targetId": "f1", "url": "https://b.example/list" });
    let other_page = json!({ "type": "page", "targetId": "p2", "url": "https://b.example/list" });
    let home = json!({ "type": "page", "targetId": "h", "url": "http://localhost:1420/browser-home.html" });
    assert!(!is_child_target(&main, "main", "https://a.example/base"));
    assert!(is_child_target(&frame, "main", "https://a.example/base"));
    assert!(is_child_target(&other_page, "main", "https://a.example/base"));
    assert!(!is_child_target(&home, "main", "https://a.example/base"));
  }
}
