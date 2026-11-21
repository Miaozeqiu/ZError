//! 把 CEF 浏览器嵌进主窗口，并实现与 WK 路径相同的 Tauri 命令。
//! H.264 在 cef_h264.rs。前端标签 / eval 在 src/services/browser/appBrowser.ts。学习通不在本文件。
#![cfg(target_os = "macos")]

mod layout;
pub(crate) use layout::*;
mod cookies;
pub use cookies::*;
mod network;
pub use network::*;
mod tabs;
pub use tabs::*;
mod sessions;
pub(crate) use sessions::*;
mod evaluation;
pub use evaluation::*;
mod interaction;
pub use interaction::*;
mod snapshot;
pub use snapshot::*;

use crate::app_browser::{
  emit_load, emit_opened, emit_state, format_eval_error_near, new_browser_id, popup_should_drop, prepare_eval_script, remember_url,
  remembered_url, CdpActResult,
};
use crate::cdp_client::{connect_loop, CdpConn};
use crate::browser_geometry::{AnchoredBrowserGeometry, BrowserViewportLayout, PAGE_W, PAGE_H};
use futures_util::future::join_all;
use std::time::Duration;
use crate::cef::h264::claim_h264_bundle;
use crate::cef_runtime;
use cef::{self, *};
use objc2::rc::Retained;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadOnly};
use objc2::MainThreadMarker;
use objc2_app_kit::{
  NSAutoresizingMaskOptions, NSBorderType, NSClipView, NSColor, NSScrollElasticity, NSScrollView, NSView,
};
use objc2_foundation::{ns_string, NSArray, NSNumber, NSPoint, NSRect, NSRunLoopCommonModes, NSSize};
use objc2_quartz_core::CATransaction;
use std::cell::Cell;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const CHROME_UA_NOTE: &str = "浏览内核已换 Chromium，学习通需重新登录。";


#[derive(Clone, Copy)]
struct ViewPtr(*mut c_void);
unsafe impl Send for ViewPtr {}
unsafe impl Sync for ViewPtr {}

struct Tab {
  id: String,
  wrapper: ViewPtr,
  /// CEF 的父舞台。小窗和展开态共用网页渲染尺寸。
  stage: ViewPtr,
  browser_id: i32,
  locator_boxes: Arc<tokio::sync::Mutex<crate::cef::locate::LocatorBoxes>>,
  close_waiters: Vec<tokio::sync::oneshot::Sender<()>>,
  /// 原生 Browser 对应的 DevTools target，独立于网址、跳转和 WebSocket 会话。
  target_id: String,
  url: String,
  title: String,
  hidden: bool,
  zoom: f64,
  audio_muted: bool,
}

pub(super) fn locator_boxes(id: &str) -> Result<Arc<tokio::sync::Mutex<crate::cef::locate::LocatorBoxes>>, String> {
  registry().lock().map_err(|_| "浏览器注册表不可用".to_string())?
    .tabs.get(id).map(|tab| tab.locator_boxes.clone()).ok_or_else(|| "浏览器标签已关闭".to_string())
}

struct Registry {
  tabs: HashMap<String, Tab>,
  by_browser: HashMap<i32, String>,
}

fn registry() -> &'static Mutex<Registry> {
  static REG: OnceLock<Mutex<Registry>> = OnceLock::new();
  REG.get_or_init(|| Mutex::new(Registry { tabs: HashMap::new(), by_browser: HashMap::new() }))
}

pub(crate) fn app_handle() -> &'static Mutex<Option<AppHandle>> {
  static H: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();
  H.get_or_init(|| Mutex::new(None))
}

fn cdp() -> &'static Mutex<Option<CdpConn>> {
  static C: OnceLock<Mutex<Option<CdpConn>>> = OnceLock::new();
  C.get_or_init(|| Mutex::new(None))
}


fn remember_handle(app: &AppHandle) {
  if let Ok(mut g) = app_handle().lock() {
    *g = Some(app.clone());
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

/// CEF 洞口：只决定把 1920x1080 缩放到多大。网页布局尺寸不跟洞口走。
/// 不要把网页布局交给 JS 防抖；拖窗口/分栏时 JS 只对齐位置，不负责通知 Chromium。
struct ZeCefHoleIvars {
  control_id: String,
  last_w: Cell<f64>,
  last_h: Cell<f64>,
  browser_id: Cell<i32>,
  ticking: Cell<bool>,
  pending: Cell<bool>,
  scroll: Cell<ViewPtr>,
  stage: Cell<ViewPtr>,
  /// 用户页面缩放。小窗的图层比例不计入页面 zoom。
  user_zoom: Cell<f64>,
  /// 页面到洞口的显示缩放。小窗单独缩放原生图层。
  fit: Cell<f64>,
  stage_w: Cell<f64>,
  stage_h: Cell<f64>,
  layout: Cell<Option<AnchoredBrowserGeometry>>,
  preview: Cell<bool>,
  live_resize: Cell<bool>,
  preview_renderer_size: Cell<Option<(f64, f64)>>,
  presentation_dirty: Cell<bool>,
}

define_class!(
  #[unsafe(super(NSView))]
  #[thread_kind = MainThreadOnly]
  #[name = "ZeCefHoleView"]
  #[ivars = ZeCefHoleIvars]
  struct ZeCefHoleView;

  impl ZeCefHoleView {
    #[unsafe(method(hitTest:))]
    fn hit_test(&self, point: NSPoint) -> *mut NSView {
      // Let the WKWebView button underneath receive miniature clicks. The live
      // Chromium view keeps drawing, but cannot receive mouse/scroll input.
      if self.ivars().preview.get() { return std::ptr::null_mut(); }
      let hit: *mut NSView = unsafe { msg_send![super(self), hitTest: point] };
      if !hit.is_null() && !crate::browser_control::user_input_allowed(&self.ivars().control_id) {
        // Keep physical focus/drop targeting on the inert wrapper, never on
        // the CEF subtree. CDP input doesn't use AppKit hit testing.
        return self as *const Self as *mut NSView;
      }
      hit
    }

    #[unsafe(method(setFrameSize:))]
    fn set_frame_size(&self, size: NSSize) {
      let prev_w = self.ivars().last_w.get();
      let prev_h = self.ivars().last_h.get();
      let _: () = unsafe { msg_send![super(self), setFrameSize: size] };
      // 创建浏览器和 JS setFrame 都走这里。这里同步动 CEF 会把主线程卡死。
      self.ivars().last_w.set(size.width);
      self.ivars().last_h.set(size.height);
      let changed = (size.width - prev_w).abs() >= 0.5 || (size.height - prev_h).abs() >= 0.5;
      // 舞台挂载前不更新。拖动时只合成图层，其余情况下一圈再改 CEF 子视图。
      if changed && !self.ivars().stage.get().0.is_null() {
        update_hole_presentation(self);
      }
    }

    #[unsafe(method(viewWillStartLiveResize))]
    fn view_will_start_live_resize(&self) {
      let _: () = unsafe { msg_send![super(self), viewWillStartLiveResize] };
      self.ivars().live_resize.set(true);
    }

    #[unsafe(method(viewDidEndLiveResize))]
    fn view_did_end_live_resize(&self) {
      let _: () = unsafe { msg_send![super(self), viewDidEndLiveResize] };
      self.ivars().live_resize.set(false);
      if !self.isHidden() { schedule_hole_layout(self); }
    }

    #[unsafe(method(resizeWithOldSuperviewSize:))]
    fn resize_with_old_superview_size(&self, old_superview_size: NSSize) {
      // 直接在 AppKit 的 autoresize 回调计算洞口，避开 DOM/IPC 的一帧往返。
      // 只设置洞口 frame，Chromium 布局留到鼠标松手后的下一圈。
      if let Some(layout) = self.ivars().layout.get() {
        let view: &NSView = self;
        if let Some(parent) = unsafe { view.superview() } {
          let size = parent.bounds().size;
          let (x, y, w, h) = layout.bounds(size.width, size.height);
          let frame = unsafe { frame_in_parent(&parent, x, y, w, h) };
          if !frames_close(view.frame(), frame) { view.setFrame(frame); }
          hole_size_tick(self);
          return;
        }
      }
      let _: () = unsafe { msg_send![super(self), resizeWithOldSuperviewSize: old_superview_size] };
      hole_size_tick(self);
    }

    #[unsafe(method(zeFlushLayout))]
    fn ze_flush_layout(&self) {
      self.ivars().pending.set(false);
      let ns: &NSView = self;
      let iv = self.ivars();
      let mode_changed = iv.presentation_dirty.replace(false);
      if ns.isHidden() && !mode_changed {
        return;
      }
      let size = ns.bounds().size;
      let preview = iv.preview.get();
      let live_resize = iv.live_resize.get();
      let (w, h) = renderer_size(size, preview, live_resize, iv.preview_renderer_size.get(), (iv.stage_w.get(), iv.stage_h.get()));
      let renderer_fit = page_fit(w, h);
      let resized = (w - iv.stage_w.get()).abs() >= 0.5 || (h - iv.stage_h.get()).abs() >= 0.5;
      iv.stage_w.set(w);
      iv.stage_h.set(h);
      if !live_resize {
        resize_stage(iv.stage.get(), w, h);
      }
      present_hole_stage(iv, size, preview || live_resize);
      let bid = iv.browser_id.get();
      if bid > 0 && resized {
        apply_browser_zoom(bid, iv.user_zoom.get() * renderer_fit);
      }
    }
  }
);

/// 文档比可视区域小时居中，多出来的一边留白。
struct ZeCenterClipIvars {
  _unused: Cell<u8>,
}

define_class!(
  #[unsafe(super(NSClipView))]
  #[thread_kind = MainThreadOnly]
  #[name = "ZeCenterClipView"]
  #[ivars = ZeCenterClipIvars]
  struct ZeCenterClipView;

  impl ZeCenterClipView {
    #[unsafe(method(constrainBoundsRect:))]
    fn constrain_bounds_rect(&self, proposed: NSRect) -> NSRect {
      let mut constrained: NSRect = unsafe { msg_send![super(self), constrainBoundsRect: proposed] };
      let doc: Option<Retained<NSView>> = unsafe { msg_send![self, documentView] };
      let Some(doc) = doc else { return constrained };
      let frame = doc.frame();
      if constrained.size.width > frame.size.width {
        constrained.origin.x = (frame.size.width - constrained.size.width) / 2.0;
      }
      if constrained.size.height > frame.size.height {
        constrained.origin.y = (frame.size.height - constrained.size.height) / 2.0;
      }
      constrained
    }
  }
);

impl ZeCenterClipView {
  fn create(mtm: MainThreadMarker, frame: NSRect) -> Retained<Self> {
    let this = Self::alloc(mtm).set_ivars(ZeCenterClipIvars { _unused: Cell::new(0) });
    unsafe { msg_send![super(this), initWithFrame: frame] }
  }
}

/// 网页舞台。左上角为原点，CEF 子 view 铺满它。尺寸只在刷新时改。
struct ZeCefStageIvars {
  _unused: Cell<u8>,
}

define_class!(
  #[unsafe(super(NSView))]
  #[thread_kind = MainThreadOnly]
  #[name = "ZeCefStage"]
  #[ivars = ZeCefStageIvars]
  struct ZeCefStage;

  impl ZeCefStage {
    #[unsafe(method(isFlipped))]
    fn is_flipped(&self) -> bool {
      true
    }
  }
);

impl ZeCefStage {
  fn create(mtm: MainThreadMarker, frame: NSRect) -> Retained<Self> {
    let this = Self::alloc(mtm).set_ivars(ZeCefStageIvars { _unused: Cell::new(0) });
    unsafe { msg_send![super(this), initWithFrame: frame] }
  }
}

impl ZeCefHoleView {
  fn create(mtm: MainThreadMarker, frame: NSRect, control_id: String) -> Retained<Self> {
    let this = Self::alloc(mtm).set_ivars(ZeCefHoleIvars {
      control_id,
      last_w: Cell::new(frame.size.width),
      last_h: Cell::new(frame.size.height),
      browser_id: Cell::new(0),
      ticking: Cell::new(false),
      pending: Cell::new(false),
      scroll: Cell::new(ViewPtr(std::ptr::null_mut())),
      stage: Cell::new(ViewPtr(std::ptr::null_mut())),
      user_zoom: Cell::new(1.0),
      fit: Cell::new(1.0),
      stage_w: Cell::new(0.0),
      stage_h: Cell::new(0.0),
      layout: Cell::new(None),
      preview: Cell::new(false),
      live_resize: Cell::new(false),
      preview_renderer_size: Cell::new(None),
      presentation_dirty: Cell::new(false),
    });
    unsafe { msg_send![super(this), initWithFrame: frame] }
  }
}


struct WrapperViews {
  hole: ViewPtr,
  stage: ViewPtr,
}


wrap_life_span_handler! {
  pub struct ZeLifeSpan { tab_id: String }

  impl LifeSpanHandler {
    fn on_after_created(&self, browser: Option<&mut Browser>) {
      let Some(browser) = browser else { return };
      let bid = browser.identifier();
      eprintln!("[cef] on_after_created browser={bid}");
      if let Ok(mut reg) = registry().lock() {
        if let Some(tab) = reg.tabs.get_mut(&self.tab_id) {
          tab.browser_id = bid;
          let id = tab.id.clone();
          let wrapper = tab.wrapper;
          let stage = tab.stage;
          let closing = !tab.close_waiters.is_empty();
          reg.by_browser.insert(bid, id);
          drop(reg);
          if closing {
            if let Some(host) = browser.host() {
              host.close_browser(1);
            }
            return;
          }
          bind_hole_browser(wrapper, bid);
          stretch_wrapper_children(wrapper, stage);
          apply_browser_zoom(bid, hole_renderer_zoom(wrapper));
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
        registry().lock().ok().and_then(|reg| reg.by_browser.get(&b.identifier()).cloned())
      });
      if let Ok(h) = app_handle().lock() {
        if let Some(app) = h.as_ref() {
          let new_id = new_browser_id();
          eprintln!("[cef] popup open tab {new_id} → {raw}");
          emit_opened(app, &new_id, raw, id.as_deref());
        }
      }
      1
    }

    fn do_close(&self, browser: Option<&mut Browser>) -> i32 {
      let Some(browser) = browser else { return 1 };
      let bid = browser.identifier();
      let app = app_handle().lock().ok().and_then(|handle| handle.clone());
      if let Some(app) = app {
        // 默认 macOS 通知会关掉承载网页的主窗口。下一次主线程调度只移除 CEF 的子视图。
        tauri::async_runtime::spawn(async move {
          let _ = on_main(&app, move || {
            let Some(host) = browser_by_id(bid).and_then(|browser| browser.host()) else { return };
            let view = host.window_handle().cast::<NSView>();
            if !view.is_null() {
              unsafe { let _: () = msg_send![view, removeFromSuperview]; }
            }
          });
        });
      }
      1
    }

    fn on_before_close(&self, browser: Option<&mut Browser>) {
      let Some(browser) = browser else { return };
      let bid = browser.identifier();
      let closed = if let Ok(mut reg) = registry().lock() {
        reg.by_browser.remove(&bid).and_then(|id| reg.tabs.remove(&id))
      } else { None };
      if let Some(tab) = closed {
        forget_target(&tab.id);
        crate::app_browser::forget_view(&tab.id);
        remove_wrapper(tab.wrapper);
        for waiter in tab.close_waiters {
          let _ = waiter.send(());
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
          let tab = registry().lock().ok().and_then(|reg| {
            let id = reg.by_browser.get(&bid)?;
            Some((id.clone(), reg.tabs.get(id)?.audio_muted))
          });
          if let Some((id, muted)) = tab {
            // The main document has committed. Apply the tab's preference to
            // its attached WebContents before page scripts start media.
            if let Some(host) = browser.host() {
              host.set_audio_muted(i32::from(muted));
            }
            forget_target(&id);
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
                let (zoom, wrapper) = if let Some(tab) = reg.tabs.get_mut(&id) {
                  tab.url = url.clone();
                  (tab.zoom, tab.wrapper)
                } else {
                  (1.0, ViewPtr(std::ptr::null_mut()))
                };
                remember_url(&id, &url);
                drop(reg);
                set_hole_user_zoom(wrapper, zoom);
                apply_browser_zoom(bid, hole_renderer_zoom(wrapper));
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

wrap_drag_handler! {
  struct ZeDragHandler { id: String }
  impl DragHandler {
    fn on_drag_enter(&self, _browser: Option<&mut Browser>, _data: Option<&mut DragData>, _mask: DragOperationsMask) -> i32 {
      // External file/link drops have a separate native route from mouse events.
      let visible_full = registry().lock().ok().and_then(|reg| reg.tabs.get(&self.id).map(|tab| {
        !tab.hidden && !tab.wrapper.0.is_null() && !unsafe { (*(tab.wrapper.0 as *const ZeCefHoleView)).ivars().preview.get() }
      })).unwrap_or(false);
      i32::from(!visible_full || !crate::browser_control::user_input_allowed(&self.id))
    }
  }
}

wrap_client! {
  pub struct ZeClient {
    life: LifeSpanHandler,
    load: LoadHandler,
    drag: DragHandler,
  }

  impl Client {
    fn life_span_handler(&self) -> Option<LifeSpanHandler> {
      Some(self.life.clone())
    }
    fn load_handler(&self) -> Option<LoadHandler> {
      Some(self.load.clone())
    }
    fn drag_handler(&self) -> Option<DragHandler> { Some(self.drag.clone()) }
  }
}

fn make_client(tab_id: &str) -> Client {
  ZeClient::new(ZeLifeSpan::new(tab_id.to_string()), ZeLoad::new(), ZeDragHandler::new(tab_id.to_string()))
}

fn clear_focus_in_hole(hole: &ZeCefHoleView) {
  let Some(window) = hole.window() else { return };
  let Some(responder) = window.firstResponder() else { return };
  let is_view: bool = unsafe { msg_send![&*responder, isKindOfClass: objc2::class!(NSView)] };
  if is_view && unsafe { (&*(Retained::as_ptr(&responder) as *const NSView)).isDescendantOf(hole) } {
    let _ = window.makeFirstResponder(None);
  }
}

pub fn clear_user_focus(app: &AppHandle, session: &str) -> Result<(), String> {
  let session = session.to_string();
  on_main(app, move || {
    let reg = registry().lock().map_err(|_| "浏览器状态不可用")?;
    for tab in reg.tabs.values() {
      if tab.wrapper.0.is_null() || !crate::browser_control::session_owns_tab(&session, &tab.id) { continue; }
      let hole = unsafe { &*(tab.wrapper.0 as *const ZeCefHoleView) };
      // Ownership is shared by the session; locked descendants cannot retain
      // a text responder/IME after control is handed back to the Agent.
      if crate::browser_control::user_input_allowed(&tab.id) { continue; }
      clear_focus_in_hole(hole);
    }
    Ok(())
  })?
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

fn set_hole_user_zoom(ptr: ViewPtr, zoom: f64) {
  if ptr.0.is_null() {
    return;
  }
  unsafe {
    let hole = &*(ptr.0 as *const ZeCefHoleView);
    hole.ivars().user_zoom.set(zoom);
  }
}

fn hole_renderer_zoom(ptr: ViewPtr) -> f64 {
  if ptr.0.is_null() {
    return 1.0;
  }
  unsafe {
    let iv = (*(ptr.0 as *const ZeCefHoleView)).ivars();
    iv.user_zoom.get() * page_fit(iv.stage_w.get(), iv.stage_h.get())
  }
}

pub fn drop_page_bind(id: &str) {
  forget_target(id);
}

fn channel_or(err: String) -> String {
  if crate::cdp_client::is_session_dead(&err) {
    crate::cdp_client::HOST_CHANNEL_DOWN.to_string()
  } else {
    err
  }
}

pub async fn eval_main_json(id: &str, expression: &str) -> Result<Value, String> {
  let run = |page: PageBind| {
    let expression = expression.to_string();
    async move {
      if page.session.is_none() {
        return Err("CDP 未附着到页面会话，无法 evaluate".into());
      }
      page
        .conn
        .evaluate_ms(&expression, page.session.as_deref(), 1500)
        .await
    }
  };
  let page = bind_page(id).await?;
  match run(page).await {
    Ok(value) => Ok(value),
    Err(err) if crate::cdp_client::is_session_dead(&err) || !err.contains("超时") => {
      drop_page_bind(id);
      let page = bind_page(id).await?;
      if page.session.is_none() {
        return Err(channel_or(err));
      }
      run(page).await.map_err(channel_or)
    }
    Err(err) => Err(err),
  }
}


#[derive(Clone)]
struct NetHit {
  url: String,
  status: i64,
  mime: String,
  kind: String,
  method: String,
  at: i64,
}

struct NetworkLog {
  pump: bool,
  last_browser: String,
  owner: HashMap<String, String>,
  targets: HashMap<String, String>,
  /// session → targetId。attachedToTarget 到得比 remember_bind 早时，先记下来，
  /// 事件来了再按 target 精确反查 owner，不猜。
  session_targets: HashMap<String, String>,
  hits: HashMap<String, VecDeque<NetHit>>,
}


pub(crate) struct PageBind {
  pub conn: CdpConn,
  pub session: Option<String>,
  pub target_id: String,
  pub url: String,
}


type TargetReply = Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<String, String>>>>>;

wrap_dev_tools_message_observer! {
  struct NativeTargetObserver { message_id: i32, reply: TargetReply }

  impl DevToolsMessageObserver {
    fn on_dev_tools_method_result(
      &self, _browser: Option<&mut Browser>, message_id: i32, success: i32, result: Option<&[u8]>,
    ) {
      if message_id != self.message_id { return; }
      if let Ok(mut reply) = self.reply.lock() {
        if let Some(tx) = reply.take() {
          let _ = tx.send(native_target_result(success, result.unwrap_or(b"{}")));
        }
      }
    }
  }
}


#[derive(Clone)]
struct BindSession {
  target_id: String,
  session: String,
}


const FIND_CLICK: &str = r#"(function(){
  var want = __WANT__;
  var t = String(want || '').replace(/\s+/g, '');
  if (!t) return null;
  function labelOk(label){
    var compact = String(label || '').replace(/\s+/g, '');
    if (!compact) return false;
    if (compact.indexOf('删除') >= 0 && t.indexOf('删除') < 0) return false;
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

  function locatorOf(el){
    var parts=[];
    for(var n=el;n && n.nodeType===1;n=n.parentElement){
      var tag=n.tagName.toLowerCase(), i=1;
      for(var prev=n.previousElementSibling;prev;prev=prev.previousElementSibling) if(prev.tagName===n.tagName) i++;
      parts.unshift(tag+':nth-of-type('+i+')');
    }
    return {by:'css',value:parts.join(' > ')};
  }
  function painted(el){
    var st=(el.ownerDocument.defaultView||window).getComputedStyle(el), r=el.getBoundingClientRect();
    return st.display!=='none' && st.visibility!=='hidden' && st.visibility!=='collapse' && r.width>=2 && r.height>=2;
  }
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
    if (!name) {
      var tagName = '';
      try { tagName = String(el.tagName || '').toLowerCase(); } catch (e4) {}
      if (tagName === 'input' || tagName === 'textarea') {
        try { name = String(el.getAttribute('placeholder') || ''); } catch (e5) {}
        if (!name) {
          var inputType = '';
          try { inputType = String(el.type || '').toLowerCase(); } catch (e6) {}
          if (inputType && inputType !== 'text' && inputType !== 'hidden' && inputType !== 'submit' && inputType !== 'button') name = inputType;
        }
      }
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
    var cap = (role === 'treeitem' || role === 'listitem' || role === 'option') ? 120 : 96;
    if (!painted(el) || !name || name.length > cap) return;
    var locator=locatorOf(el);
    if (seen[locator.value]) return;
    seen[locator.value]=1;
    var row = { role: role || 'generic', name: name.slice(0, cap), locator:locator, disabled:el.matches(':disabled') || el.getAttribute('aria-disabled')==='true' };
    if(role==='checkbox'||role==='radio') row.checked=el.checked===true || el.getAttribute('aria-checked')==='true';
    if (role === 'treeitem' || role === 'listitem' || role === 'link' || role === 'tab') {
      var mark = markOf(el);
      if (mark) row.mark = mark;
    }
    out.push(row);
  }
  function classTokens(el){
    var bag = '';
    try { bag += ' ' + String(el.className || ''); } catch (e) {}
    var kids = [];
    try { kids = el.querySelectorAll('[class]'); } catch (e2) { kids = []; }
    for (var i = 0; i < kids.length && i < 24; i++) {
      try { bag += ' ' + String(kids[i].className || ''); } catch (e3) {}
    }
    return bag.toLowerCase().split(/[^a-z0-9]+/);
  }
  function hasToken(tokens, words){
    for (var i = 0; i < tokens.length; i++) {
      if (words.indexOf(tokens[i]) >= 0) return true;
    }
    return false;
  }
  function markOf(el){
    if (!el) return '';
    var selected = '', current = '', checked = '', title = '';
    try { selected = String(el.getAttribute('aria-selected') || ''); } catch (e) {}
    try { current = String(el.getAttribute('aria-current') || ''); } catch (e2) {}
    try { checked = String(el.getAttribute('aria-checked') || ''); } catch (e3) {}
    try { title = String(el.getAttribute('title') || ''); } catch (e4) {}
    var tokens = classTokens(el);
    var locked = hasToken(tokens, ['lock', 'locked']) || /锁定|未解锁/.test(title);
    if (locked) return 'locked';
    var done = hasToken(tokens, ['done', 'finish', 'finished', 'complete', 'completed', 'pass', 'passed']) || /已完成|已学完/.test(title);
    var cur = selected === 'true' || (current && current !== 'false') || checked === 'true' || hasToken(tokens, ['active', 'current', 'cur']) || /当前|正在学/.test(title);
    if (cur) return 'current';
    if (done) return 'done';
    return '';
  }
  function clockOf(sec){
    if (!(sec >= 0) || !isFinite(sec)) return '';
    sec = Math.floor(sec);
    var s = sec % 60;
    var m = Math.floor(sec / 60) % 60;
    var h = Math.floor(sec / 3600);
    var pad = function(n){ return (n < 10 ? '0' : '') + n; };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }
  function nearbyTitle(el, fallback){
    var name = '';
    try { name = String(el.getAttribute('aria-label') || el.getAttribute('title') || ''); } catch (e) {}
    name = name.replace(/\s+/g, ' ').trim();
    if (name) return name.slice(0, 40);
    var node = el;
    for (var i = 0; i < 4 && node; i++) {
      var prev = node.previousElementSibling;
      if (prev) {
        var text = '';
        try { text = String(prev.innerText || prev.textContent || '').replace(/\s+/g, ' ').trim(); } catch (e2) {}
        if (text && text.length <= 40) return text;
      }
      node = node.parentElement;
    }
    return fallback;
  }
  function addMedia(doc){
    var list = [];
    try { list = doc.querySelectorAll('video, audio'); } catch (e) { return; }
    var view = doc.defaultView || window;
    var videoNth = 0, audioNth = 0;
    for (var i = 0; i < list.length && out.length < 220; i++) {
      var el = list[i];
      var tag = String(el.tagName || '').toLowerCase();
      var isAudio = tag === 'audio';
      if (isAudio) audioNth++; else videoNth++;
      var box = { width: 0, height: 0 };
      try { box = el.getBoundingClientRect(); } catch (e2) {}
      if (box.width < 8 || box.height < 8) continue;
      var total = el.duration;
      if (!(total > 0)) {
        try {
          var winD = Number(view.duration);
          if (winD > 0) total = winD;
        } catch (e3) {}
      }
      var now = Number(el.currentTime) || 0;
      var state = el.ended ? 'ended' : (el.paused ? 'paused' : 'playing');
      var clock = clockOf(now);
      var end = total > 0 ? clockOf(total) : '';
      var media = state + (clock ? ' ' + clock + (end ? '/' + end : '') : '');
      var role = isAudio ? 'audio' : 'video';
      var name = nearbyTitle(el, isAudio ? '音频' : '视频');
      var nth = isAudio ? audioNth : videoNth;
      var key = role + ':' + nth + ':' + name;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({ role: role, name: name.slice(0, 40), media: media, nth: nth });
    }
  }
  function scan(doc){
    if (!doc) return;
    var nodes = [];
    try { nodes = doc.querySelectorAll('a, button, input, select, textarea, [role="tab"], [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="treeitem"], [role="listitem"], [role="option"], [title], [aria-label], [onclick], [data-url], [coursetype], .tab-item, [class*="tab"], [class*="Tab"], .el-tree-node__content'); } catch (e) { return; }
    var primary = [];
    var secondary = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var tag = String(el.tagName || '').toLowerCase();
      var role = el.getAttribute && el.getAttribute('role');
      if (!role) {
        if (tag === 'a') role = 'link';
        else if (tag === 'button') role = 'button';
        else if (tag === 'input' && /^(checkbox|radio)$/.test(el.type)) role=el.type;
        else if (tag === 'input' || tag === 'textarea') role = 'textbox';
        else if (tag === 'select') role='combobox';
        else if (el.classList && el.classList.contains('el-tree-node__content')) role = 'treeitem';
        else if (el.hasAttribute('onclick') || el.hasAttribute('data-url') || el.hasAttribute('coursetype') || /(?:^|\s)tab-item(?:\s|$)/.test(el.className||'')) role='button';
        else continue;
      }
      if (role === 'treeitem' || (el.classList && el.classList.contains('el-tree-node__content'))) {
        var tree = el.closest && el.closest('[role="treeitem"]');
        if (tree) { el = tree; role = 'treeitem'; }
      }
      if (role === 'treeitem' || role === 'listitem' || role === 'option') primary.push({ el: el, role: role });
      else secondary.push({ el: el, role: role });
    }
    var ordered = primary.concat(secondary);
    for (var j = 0; j < ordered.length && out.length < 220; j++) add(ordered[j].el, ordered[j].role);
    addMedia(doc);
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
  scan(document);
  return out;
})()"#;

/// 同进程 iframe 不是独立 target。从主文档 pierce，按序号链把每一框的可点节点分开。
const COLLECT_FRAMES: &str = r#"(function(){

  function locatorOf(el){
    var parts=[];
    for(var n=el;n && n.nodeType===1;n=n.parentElement){
      var tag=n.tagName.toLowerCase(), i=1;
      for(var prev=n.previousElementSibling;prev;prev=prev.previousElementSibling) if(prev.tagName===n.tagName) i++;
      parts.unshift(tag+':nth-of-type('+i+')');
    }
    return {by:'css',value:parts.join(' > ')};
  }
  function painted(el){
    if (!el || !el.ownerDocument) return false;
    try {
      var st = (el.ownerDocument.defaultView || window).getComputedStyle(el);
      if (!st || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    } catch (e) { return false; }
  }
  function scan(doc){
    var out = [];
    var seen = {};
    var nodes = [];
    var videoNth = 0;
    var audioNth = 0;
    try {
      nodes = doc.querySelectorAll('a, button, input, select, textarea, video, audio, [role="tab"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="treeitem"], [role="listitem"], [title], [aria-label]');
    } catch (e) { return out; }
    for (var i = 0; i < nodes.length && out.length < 110; i++) {
      var el = nodes[i];
      if (!painted(el)) continue;
      var tag = String(el.tagName || '').toLowerCase();
      var role = '';
      try { role = String(el.getAttribute('role') || '').toLowerCase(); } catch (eR) {}
      if (!role) {
        if (tag === 'a') role = 'link';
        else if (tag === 'button') role = 'button';
        else if (tag === 'input' && /^(checkbox|radio)$/.test(el.type)) role=el.type;
        else if (tag === 'input' || tag === 'textarea') role = 'textbox';
        else if (tag === 'select') role = 'combobox';
        else if (tag === 'video') role = 'video';
        else if (tag === 'audio') role = 'audio';
        else continue;
      }
      var name = '';
      try { name = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText || el.textContent || ''); } catch (eN) {}
      name = name.replace(/\s+/g, ' ').trim();
      if (!name && (tag === 'input' || tag === 'textarea')) {
        var inputType = '';
        try { inputType = String(el.type || '').toLowerCase(); } catch (eT) {}
        if (inputType && inputType !== 'text' && inputType !== 'hidden') name = inputType;
      }
      if (!name && role === 'video') name = '视频';
      if (!name && role === 'audio') name = '音频';
      if (!name || name.length > 96) continue;
      var row = { role: role, name: name.slice(0, 96), locator:locatorOf(el), disabled:el.matches(':disabled') || el.getAttribute('aria-disabled')==='true' };
      if(role==='checkbox'||role==='radio') row.checked=el.checked===true || el.getAttribute('aria-checked')==='true';
      if (role === 'video' || role === 'audio') {
        var total = el.duration;
        if (!(total > 0)) {
          try { var winD = Number((el.ownerDocument.defaultView || window).duration); if (winD > 0) total = winD; } catch (eD) {}
        }
        var now = Number(el.currentTime) || 0;
        var state = el.ended ? 'ended' : (el.paused ? 'paused' : 'playing');
        var clock = function(sec){
          if (!(sec >= 0) || !isFinite(sec)) return '';
          sec = Math.floor(sec);
          var s = sec % 60;
          var m = Math.floor(sec / 60) % 60;
          var h = Math.floor(sec / 3600);
          var p = function(n){ return (n < 10 ? '0' : '') + n; };
          return h > 0 ? (h + ':' + p(m) + ':' + p(s)) : (m + ':' + p(s));
        };
        var media = state;
        var left = clock(now);
        var right = total > 0 ? clock(total) : '';
        if (left) media += ' ' + left + (right ? '/' + right : '');
        row.media = media;
        if (role === 'audio') row.nth = ++audioNth;
        else row.nth = ++videoNth;
      }
      if (role === 'treeitem' || role === 'listitem' || role === 'link' || role === 'tab') {
        var bag = '';
        try { bag = String(el.className || ''); } catch (eC) {}
        var kids = [];
        try { kids = el.querySelectorAll('[class]'); } catch (eK) { kids = []; }
        for (var k = 0; k < kids.length && k < 12; k++) {
          try { bag += ' ' + String(kids[k].className || ''); } catch (eBag) {}
        }
        var tokens = bag.toLowerCase().split(/[^a-z0-9]+/);
        var title = '';
        try { title = String(el.getAttribute('title') || ''); } catch (eTitle) {}
        var selected = '', ariaCur = '';
        try { selected = String(el.getAttribute('aria-selected') || ''); } catch (eSel) {}
        try { ariaCur = String(el.getAttribute('aria-current') || ''); } catch (eCur) {}
        var hit = function(word){ return tokens.indexOf(word) >= 0; };
        if (hit('lock') || hit('locked') || /锁定|未解锁/.test(title)) row.mark = 'locked';
        else if (selected === 'true' || (ariaCur && ariaCur !== 'false') || hit('active') || hit('current') || hit('cur')) row.mark = 'current';
        else if (hit('done') || hit('finish') || hit('finished') || hit('complete') || hit('completed') || hit('pass') || /已完成|已学完/.test(title)) row.mark = 'done';
      }
      var key = role + ':' + name + ':' + (row.nth || out.length);
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(row);
    }
    return out;
  }
  var visibleCount = 0;
  var visitedCount = 0;
  function walk(win, path, depth, out){
    if (!win || depth >= 16 || visibleCount >= 128 || visitedCount >= 2048) return;
    var doc = null;
    try { doc = win.document; } catch (e) { return; }
    if (!doc) return;
    var list = [];
    try { list = doc.querySelectorAll('iframe, frame'); } catch (eList) { return; }
    for (var i = 0; i < list.length && visibleCount < 128 && visitedCount < 2048; i++) {
      visitedCount += 1;
      var fe = list[i];
      var childPath = path ? (path + '/' + i) : String(i);
      var id = fe.id || '';
      var name = fe.name || '';
      var mid = '';
      try { mid = fe.getAttribute('mid') || fe.getAttribute('data-mid') || ''; } catch (eMid) {}
      var srcAttr = '';
      try { srcAttr = fe.getAttribute('src') || ''; } catch (eSrc) {}
      var label = mid || id || name || '';
      if (!painted(fe)) {
        out.push({ path: childPath, label: label, src: srcAttr, cross: false, hidden: true, nodes: [] });
        continue;
      }
      var child = null, href = '', cross = false;
      try {
        child = fe.contentWindow;
        href = String((child && child.location && child.location.href) || '');
      } catch (eCross) { cross = true; }
      if (!child || cross) {
        visibleCount += 1;
        out.push({ path: childPath, label: label || srcAttr, src: srcAttr, cross: true, hidden: false, nodes: [] });
        continue;
      }
      var ready = 'loading', filled = false;
      try { ready = child.document.readyState; } catch (eReady) { ready = 'loading'; }
      var blank = !href || href === 'about:blank' || /^(?:about:|javascript:)/i.test(href);
      if (blank) {
        try { filled = !!(child.document.body && child.document.body.childElementCount); } catch (eFill) {}
      }
      if (ready === 'loading' || (blank && !filled)) continue;
      visibleCount += 1;
      out.push({ path: childPath, label: label, src: href || srcAttr, cross: false, hidden: false, nodes: scan(child.document) });
      walk(child, childPath, depth + 1, out);
    }
  }
  var out = [];
  walk(window, '', 0, out);
  return out;
})()"#;

const VIRTUAL_MOUSE: &str = include_str!("../../../src/services/browser/engine/virtualMouse.inject.js");


struct InputField {
  id: String,
  name: String,
  placeholder: String,
  title: String,
  aria: String,
  used: bool,
}


const INPUT_FIELDS: &str = r#"(function(){
  var out = [];
  var nodes = [];
  try { nodes = document.querySelectorAll('input, textarea'); } catch (e) { return out; }
  for (var i = 0; i < nodes.length && out.length < 40; i++) {
    var el = nodes[i];
    var type = '';
    try { type = String(el.type || 'text').toLowerCase(); } catch (e2) { type = 'text'; }
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio' || type === 'image' || type === 'file') continue;
    out.push({
      id: el.id || '',
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      title: el.getAttribute('title') || '',
      aria: el.getAttribute('aria-label') || ''
    });
  }
  return out;
})()"#;


pub struct SnapshotQuery {
  pub frame: Option<String>,
  pub max_frames: usize,
  pub acted: bool,
}


struct FrameSnap {
  url: String,
  path: String,
  label: String,
  lines: Vec<String>,
  refs: Vec<Value>,
  priority: i32,
  /// 标签页自己的文档。它的网址不能写进 locator.frame，否则查找会去子 frame 里找，主文档上的输入框直接丢失。
  top: bool,
  cross: bool,
  identity: Option<crate::cef::frames::FrameContext>,
}


#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::HashSet;

  #[test]
  fn snapshot_merges_ax_dom_without_inventing_second_button() {
    let mut refs = Vec::new();
    let mut lines = Vec::new();
    let mut seen = HashSet::new();
    push_ax_nodes(&vec![json!({ "role":{"value":"button"}, "name":{"value":"提交"}, "backendDOMNodeId":17,
      "properties":[{"name":"disabled","value":{"value":true}}] })], &mut lines, &mut refs, &mut seen, 20);
    push_dom_nodes(&json!([{ "role":"button", "name":"提交", "locator":{"by":"css","value":"body > button"} }]), &mut lines, &mut refs, &mut seen, 20);
    assign_nth(&mut refs);
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0]["locator"]["backend"], 17);
    assert!(refs[0]["locator"].get("nth").is_none());
    assert_eq!(refs[0]["disabled"], true);
  }

  #[test]
  fn snapshot_keeps_same_name_controls_with_distinct_backends() {
    let mut refs = Vec::new();
    let mut lines = Vec::new();
    let mut seen = HashSet::new();
    let nodes: Vec<_> = [17, 23].into_iter().map(|id| json!({ "role":{"value":"button"}, "name":{"value":"提交"}, "backendDOMNodeId":id })).collect();
    push_ax_nodes(&nodes, &mut lines, &mut refs, &mut seen, 20);
    assign_nth(&mut refs);
    assert_eq!(refs.len(), 2);
    assert_ne!(refs[0]["locator"]["backend"], refs[1]["locator"]["backend"]);
    assert!(refs.iter().all(|r| r["locator"].get("nth").is_none()));
  }

  #[test]
  fn snapshot_ignores_hidden_ax_and_preserves_checkbox_state() {
    let mut refs = Vec::new();
    push_ax_nodes(&vec![
      json!({ "ignored":true, "role":{"value":"button"}, "name":{"value":"隐藏提交"}, "backendDOMNodeId":17 }),
      json!({ "role":{"value":"checkbox"}, "name":{"value":"A"}, "backendDOMNodeId":23,
        "properties":[{"name":"checked","value":{"value":"true"}}] }),
    ], &mut Vec::new(), &mut refs, &mut HashSet::new(), 20);
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0]["locator"]["backend"], 23);
    assert_eq!(refs[0]["checked"], true);
  }

  #[test]
  fn fit_scale_fits_the_whole_page_on_the_smaller_axis() {
    assert!((fit_scale(1280.0, 800.0) - 1280.0 / 1920.0).abs() < 1e-9);
    assert!((fit_scale(1920.0, 1080.0) - 1.0).abs() < 1e-9);
    assert!((fit_scale(1919.0, 2000.0) - 1919.0 / 1920.0).abs() < 1e-9);
    assert!((fit_scale(960.0, 540.0) - 0.5).abs() < 1e-9);
    assert_eq!(fit_scale(0.0, 1080.0), 1.0);
    assert_eq!(fit_scale(f64::NAN, 1080.0), 1.0);
  }

  #[test]
  fn toggling_preview_keeps_the_expanded_renderer_size() {
    let miniature = NSSize::new(224.0, 126.0);
    for (width, height) in [(777.0, 654.0), (1280.0, 800.0), (3840.0, 2160.0)] {
      let expanded = NSSize::new(width, height);
      let warm_stage = (960.0, 540.0);
      let preview = renderer_size(miniature, true, false, Some((width, height)), warm_stage);
      let large = renderer_size(expanded, false, false, None, preview);
      assert_eq!(preview, large);
      assert_eq!(renderer_size(miniature, true, false, None, large), large);
    }
  }

  #[test]
  fn live_resize_holds_the_renderer_while_dragging_and_resolves_the_final_size() {
    let current = (960.0, 540.0);
    for (w, h) in [(1300.0, 800.0), (700.0, 500.0), (1480.0, 600.0)] {
      let hole = NSSize::new(w, h);
      for preview in [false, true] {
        assert_eq!(renderer_size(hole, preview, true, Some((w, h)), current), current);
      }
      let settled = renderer_size(hole, false, false, None, current);
      assert_eq!(settled, stage_points(w, h));
      assert_ne!(settled, current);
    }
  }

  #[test]
  fn native_layer_origin_does_not_add_half_a_window_when_expanded() {
    let zero = NSPoint::new(0.0, 0.0);
    assert_eq!(
      stage_layer_origin(false, zero, zero, 960.0, 540.0, 960.0, 540.0, 0.5),
      (0.0, 0.0)
    );
    assert_eq!(
      stage_layer_origin(false, NSPoint::new(7.0, 9.0), zero, 1280.0, 720.0, 1280.0, 800.0, 0.5),
      (7.0, 9.0)
    );
    assert_eq!(
      stage_layer_origin(true, zero, zero, 1920.0, 1080.0, 224.0, 126.0, 224.0 / 1920.0),
      (0.0, 0.0)
    );
    let (_, y) = stage_layer_origin(true, zero, zero, 1920.0, 1080.0, 224.0, 140.0, 224.0 / 1920.0);
    assert!((y - 7.0).abs() < 0.001);
    // AppKit has already centered the unscaled document when the hole grows.
    let clip_origin = NSPoint::new(-160.0, -130.0);
    let (x, y) = stage_layer_origin(true, zero, clip_origin, 960.0, 540.0, 1280.0, 800.0, 1280.0 / 960.0);
    assert!((x - clip_origin.x).abs() < 0.001);
    assert!((y - clip_origin.y - 40.0).abs() < 0.001);
  }

  #[test]
  fn long_ax_name_is_kept_truncated() {
    let mut lines = Vec::new();
    let mut refs = Vec::new();
    let mut seen = HashSet::new();
    let long = "章".repeat(200);
    push_named_ref(&mut lines, &mut refs, &mut seen, "treeitem", &long, 1, 10, "", "", "", 0);
    assert_eq!(refs.len(), 1);
    let name = refs[0]["name"].as_str().unwrap();
    assert!(name.ends_with('…'));
    assert!(name.chars().count() <= 120);
    assert!(!lines[0].is_empty());
  }

  #[test]
  fn acted_snapshot_only_includes_named_frame() {
    assert!(!usable_frame_url("about:blank"));
    assert!(!usable_frame_url(""));
    assert!(usable_frame_url("https://mooc1.chaoxing.com/knowledge/cards"));
    assert_eq!(
      child_frame_cap(&SnapshotQuery {
        frame: None,
        max_frames: 8,
        acted: true,
      }),
      0
    );
    assert_eq!(
      child_frame_cap(&SnapshotQuery {
        frame: Some("cards".into()),
        max_frames: 8,
        acted: true,
      }),
      1
    );
    assert_eq!(
      child_frame_cap(&SnapshotQuery {
        frame: None,
        max_frames: 40,
        acted: false,
      }),
      8
    );
    assert!(frame_url_matches(
      "https://mooc1.chaoxing.com/ananas/modules/video?mid=abc",
      "mid=abc"
    ));
  }

  #[test]
  fn link_snapshot_keeps_url() {
    let mut lines = Vec::new();
    let mut refs = Vec::new();
    let mut seen = HashSet::new();
    push_named_ref(
      &mut lines,
      &mut refs,
      &mut seen,
      "link",
      "请登录",
      4,
      10,
      "https://background.zjooc.cn/gxptLogin",
      "",
      "",
      0,
    );
    assert_eq!(
      lines,
      vec!["- link \"请登录\" [ref=e1] https://background.zjooc.cn/gxptLogin"]
    );
  }

  #[test]
  fn video_line_keeps_clock_and_done_mark() {
    let mut lines = Vec::new();
    let mut refs = Vec::new();
    let mut seen = HashSet::new();
    push_named_ref(
      &mut lines,
      &mut refs,
      &mut seen,
      "video",
      "概述：成衣的概念",
      0,
      10,
      "",
      "playing 0:07/17:18",
      "",
      1,
    );
    push_named_ref(
      &mut lines,
      &mut refs,
      &mut seen,
      "treeitem",
      "概述：成衣的概念",
      0,
      10,
      "",
      "",
      "done",
      0,
    );
    push_named_ref(
      &mut lines,
      &mut refs,
      &mut seen,
      "treeitem",
      "成衣生产",
      0,
      10,
      "",
      "",
      "current",
      0,
    );
    assert_eq!(lines[0], "- video \"概述：成衣的概念\" playing 0:07/17:18 [ref=e1]");
    assert_eq!(lines[1], "- treeitem \"概述：成衣的概念\" [ref=e2] [done]");
    assert_eq!(lines[2], "- treeitem \"成衣生产\" [ref=e3] [current]");
    assert_eq!(refs[0]["locator"]["value"], "video");
    assert_eq!(refs[0]["locator"]["nth"], 1);
  }

  #[test]
  fn eval_score_prefers_a_real_string_over_empty() {
    assert!(eval_score(&json!("[]")) < eval_score(&json!("[{\"paused\":false}]")));
    assert!(eval_score(&Value::Null) < 0);
  }

  #[test]
  fn textbox_without_name_uses_placeholder() {
    let mut refs = vec![json!({
      "role": "textbox",
      "name": "(无文案)",
      "locator": { "by": "role", "value": "textbox", "name": "(无文案)", "exact": true }
    })];
    let fields = json!([
      { "id": "", "name": "", "placeholder": "请输入用户名/手机号", "title": "", "aria": "" }
    ]);
    rewrite_textbox_refs(&mut refs, &fields);
    assert_eq!(refs[0]["name"], "请输入用户名/手机号");
  }

  #[test]
  fn textbox_snapshot_uses_placeholder_not_title() {
    let mut refs = vec![
      json!({
        "role": "textbox",
        "name": "用户名",
        "locator": { "by": "role", "value": "textbox", "name": "用户名", "exact": true }
      }),
      json!({
        "role": "textbox",
        "name": "验证码",
        "locator": { "by": "role", "value": "textbox", "name": "验证码", "exact": true }
      }),
      json!({
        "role": "button",
        "name": "登录",
        "locator": { "by": "role", "value": "button", "name": "登录", "exact": true }
      }),
    ];
    let fields = json!([
      { "id": "login_name", "name": "login_name", "placeholder": "请输入用户名/手机号", "title": "用户名", "aria": "" },
      { "id": "", "name": "captchaCode", "placeholder": "请输入验证码", "title": "验证码", "aria": "" }
    ]);
    rewrite_textbox_refs(&mut refs, &fields);
    assert_eq!(refs[0]["name"], "请输入用户名/手机号");
    assert_eq!(refs[0]["locator"]["by"], "css");
    assert_eq!(refs[0]["locator"]["value"], "#login_name");
    assert_eq!(refs[0]["locator"]["name"], "请输入用户名/手机号");
    assert_eq!(refs[1]["name"], "请输入验证码");
    assert_eq!(
      refs[1]["locator"]["value"],
      "input[placeholder=\"请输入验证码\"],textarea[placeholder=\"请输入验证码\"]"
    );
    assert_eq!(refs[2]["name"], "登录");
    assert_eq!(refs[2]["locator"]["by"], "role");
  }

  #[test]
  fn content_refs_keep_treeitems_ahead_of_footer_links() {
    let refs = vec![
      json!({ "role": "link", "name": "浙ICP备05018780号" }),
      json!({ "role": "link", "name": "首页" }),
      json!({ "role": "treeitem", "name": "1.1 成衣材料" }),
      json!({ "role": "treeitem", "name": "1.2 材料测试" }),
    ];
    let (taken, omitted) = prefer_content_refs(&refs, 2);
    assert_eq!(omitted, 0);
    assert_eq!(taken[0]["role"], "treeitem");
    assert_eq!(taken[1]["role"], "treeitem");
  }

  #[test]
  fn quota_keeps_child_frames_when_catalog_is_long() {
    let counts = take_counts(&[200, 3, 2], 0, 280);
    assert_eq!(counts, vec![140, 3, 2]);
  }

  #[test]
  fn frame_tree_paths_follow_iframe_order() {
    let tree = json!({
      "frame": { "id": "root", "url": "https://mooc1.chaoxing.com/studentstudy" },
      "childFrames": [
        { "frame": { "id": "cards", "url": "https://mooc1.chaoxing.com/knowledge/cards" }, "childFrames": [
          { "frame": { "id": "v1", "url": "https://mooc1.chaoxing.com/ananas/modules/video?mid=m1" } },
          { "frame": { "id": "v2", "url": "https://mooc1.chaoxing.com/ananas/modules/video?mid=m2" } }
        ]}
      ]
    });
    let mut rows = Vec::new();
    frame_tree_rows(&tree, "", 0, &mut rows);
    assert_eq!(rows[1].0, "0");
    assert_eq!(rows[2].0, "0/0");
    assert_eq!(rows[3].0, "0/1");
    assert!(rows[3].2.contains("mid=m2"));
  }

  #[test]
  fn duplicate_names_in_one_frame_get_nth() {
    let mut nodes = vec![
      json!({ "role": "button", "name": "播放", "locator": { "by": "role", "value": "button", "name": "播放" } }),
      json!({ "role": "button", "name": "播放", "locator": { "by": "role", "value": "button", "name": "播放" } }),
    ];
    assign_nth(&mut nodes);
    assert_eq!(nodes[0]["locator"]["nth"], 1);
    assert_eq!(nodes[1]["locator"]["nth"], 2);
  }

  #[test]
  fn frame_priority_prefers_interactive_refs() {
    assert!(frame_snap_priority("about:blank", 20) < frame_snap_priority("https://example.com/list", 3));
    assert_eq!(
      frame_snap_priority("https://mooc1.chaoxing.com/mycourse/studentstudy", 5),
      frame_snap_priority("https://example.com/page", 5)
    );
    assert!(frame_snap_priority("https://example.com/a", 2) < frame_snap_priority("https://example.com/b", 12));
  }

  #[test]
  fn click_label_rejects_deleted_course() {
    assert!(!click_label_matches("我学的课", "已删除课程"));
    assert!(click_label_matches("我学的课", "我学的课"));
    assert!(click_label_matches("我学的课", "已学的课"));
    assert!(click_label_matches("作业", "作业2（0915）"));
  }

  #[test]
  fn child_target_is_iframe_not_other_tab() {
    let main = json!({ "type": "page", "targetId": "main", "url": "https://www.zjooc.cn/" });
    let frame = json!({ "type": "iframe", "targetId": "f1", "url": "https://background.zjooc.cn/gxptLogin" });
    let leftover = json!({ "type": "page", "targetId": "p2", "url": "https://mooc1.chaoxing.com/mycourse/studentstudy" });
    let home = json!({ "type": "page", "targetId": "h", "url": "http://localhost:1420/browser-home.html" });
    assert!(!is_child_target(&main, "main", "https://www.zjooc.cn/"));
    assert!(is_child_target(&frame, "main", "https://www.zjooc.cn/"));
    assert!(!is_child_target(&leftover, "main", "https://www.zjooc.cn/"));
    assert!(!is_child_target(&home, "main", "https://www.zjooc.cn/"));
  }

  fn page(id: &str, url: &str) -> Value {
    json!({ "type": "page", "targetId": id, "url": url })
  }

  #[test]
  fn exact_target_handles_same_url_tabs_and_redirects() {
    let pages = vec![page("other", "https://example.com/login"), page("native", "https://example.com/login")];
    assert_eq!(target_id_of(exact_page_target(&pages, "native").unwrap()), "native");
    // URL 和旧缓存归属不参与选择；原生身份在跨站导航后依然有效。
    let redirected = vec![page("other", "https://example.com/login"), page("native", "https://another.test/home")];
    assert_eq!(target_id_of(exact_page_target(&redirected, "native").unwrap()), "native");
  }

  #[test]
  fn exact_target_never_steals_the_only_other_page() {
    let pages = vec![page("other", "https://example.com/login")];
    assert!(exact_page_target(&pages, "closed-native").is_none());
    assert!(exact_page_target(&pages, "").is_none());
    let frame = vec![json!({ "type": "iframe", "targetId": "native" })];
    assert!(exact_page_target(&frame, "native").is_none());
  }

  #[test]
  fn native_target_result_requires_successful_page_identity() {
    assert_eq!(native_target_result(1, br#"{"targetInfo":{"type":"page","targetId":"native"}}"#).unwrap(), "native");
    assert!(native_target_result(0, br#"{"message":"Target closed"}"#).is_err());
    assert!(native_target_result(1, br#"{"targetInfo":{"type":"iframe","targetId":"frame"}}"#).is_err());
    assert!(native_target_result(1, br#"{"targetInfo":{"type":"page","targetId":""}}"#).is_err());
  }
}
