//! 把 CEF 浏览器嵌进主窗口，并实现与 WK 路径相同的 Tauri 命令。
//! H.264 在 cef_h264.rs。前端标签 / eval 在 src/services/browser/appBrowser.ts。学习通不在本文件。
#![cfg(target_os = "macos")]

use crate::app_browser::{
  emit_load, emit_opened, emit_state, format_eval_error_near, is_course_entry_url, is_iframe_document_url,
  is_space_list_url, new_browser_id, popup_should_drop, prepare_eval_script, remember_url,
  remembered_url, CdpActResult,
};
use crate::cdp_client::{connect_loop, CdpConn};
use crate::browser_geometry::{AnchoredBrowserGeometry, BrowserViewportLayout};
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
use std::cell::Cell;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const CHROME_UA_NOTE: &str = "浏览内核已换 Chromium，学习通需重新登录。";

/// 网页布局永远按这个 CSS 视口。洞口只负责把整页缩放进可见区域，不改页面大小。
const PAGE_W: f64 = 1920.0;
const PAGE_H: f64 = 1080.0;

/// 取能把 1920x1080 整页放进洞口的缩放。小于 1 是缩小，大于 1 是放大。
fn fit_scale(hole_w: f64, hole_h: f64) -> f64 {
  if !hole_w.is_finite() || !hole_h.is_finite() || hole_w < 1.0 || hole_h < 1.0 {
    return 1.0;
  }
  (hole_w / PAGE_W).min(hole_h / PAGE_H)
}

fn renderer_stage_size() -> (f64, f64) {
  (PAGE_W, PAGE_H)
}
fn stage_points(hole_w: f64, hole_h: f64) -> (f64, f64) {
  let s = fit_scale(hole_w, hole_h);
  (
    (PAGE_W * s).floor().min(hole_w.floor()).max(1.0),
    (PAGE_H * s).floor().min(hole_h.floor()).max(1.0),
  )
}
fn page_fit(w: f64, h: f64) -> f64 {
  (w / PAGE_W).min(h / PAGE_H)
}

#[derive(Clone, Copy)]
struct ViewPtr(*mut c_void);
unsafe impl Send for ViewPtr {}
unsafe impl Sync for ViewPtr {}

struct Tab {
  id: String,
  wrapper: ViewPtr,
  /// CEF 的父舞台。小窗保留完整渲染尺寸，展开时沿用页面适配尺寸。
  stage: ViewPtr,
  browser_id: i32,
  /// 原生 Browser 对应的 DevTools target，独立于网址、跳转和 WebSocket 会话。
  target_id: String,
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

pub(crate) fn app_handle() -> &'static Mutex<Option<AppHandle>> {
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

/// CEF 洞口：只决定把 1920x1080 缩放到多大。网页布局尺寸不跟洞口走。
/// 不要把网页布局交给 JS 防抖；拖窗口/分栏时 JS 只对齐位置，不负责通知 Chromium。
struct ZeCefHoleIvars {
  last_w: Cell<f64>,
  last_h: Cell<f64>,
  browser_id: Cell<i32>,
  ticking: Cell<bool>,
  pending: Cell<bool>,
  scroll: Cell<ViewPtr>,
  stage: Cell<ViewPtr>,
  /// 用户页面缩放。小窗以图层缩放显示，不将 fit 乘到页面 zoom。
  user_zoom: Cell<f64>,
  /// 页面到洞口的显示缩放。小窗单独缩放原生图层。
  fit: Cell<f64>,
  stage_w: Cell<f64>,
  stage_h: Cell<f64>,
  layout: Cell<Option<AnchoredBrowserGeometry>>,
  preview: Cell<bool>,
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
      unsafe { msg_send![super(self), hitTest: point] }
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
      // 舞台还没挂上（initWithFrame）时不要排刷新。下一圈再改舞台，避免和 AppKit 布局重入。
      if changed && !self.ivars().stage.get().0.is_null() {
        schedule_was_resized(self, self.ivars().browser_id.get());
      }
    }

    #[unsafe(method(resizeWithOldSuperviewSize:))]
    fn resize_with_old_superview_size(&self, old_superview_size: NSSize) {
      // 直接在 AppKit 的 autoresize 回调计算洞口，避开 DOM/IPC 的一帧往返。
      // 只设置洞口 frame；舞台与 CEF 重绘仍排到 CommonModes 的下一圈，禁止同步重入。
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

    #[unsafe(method(zeFlushWasResized))]
    fn ze_flush_was_resized(&self) {
      self.ivars().pending.set(false);
      let ns: &NSView = self;
      let iv = self.ivars();
      let mode_changed = iv.presentation_dirty.replace(false);
      if ns.isHidden() && !mode_changed {
        return;
      }
      let size = ns.bounds().size;
      let preview = iv.preview.get();
      let (w, h) = if preview {
        renderer_stage_size()
      } else {
        stage_points(size.width, size.height)
      };
      let fit = if preview {
        fit_scale(size.width, size.height)
      } else {
        page_fit(w, h)
      };
      let resized = (w - iv.stage_w.get()).abs() >= 0.5 || (h - iv.stage_h.get()).abs() >= 0.5;
      iv.stage_w.set(w);
      iv.stage_h.set(h);
      iv.fit.set(fit);
      resize_stage(iv.stage.get(), w, h);
      present_stage_layer(iv.stage.get(), preview, size.width, size.height, fit);
      let bid = iv.browser_id.get();
      if bid > 0 {
        if resized {
          notify_browser_resized(bid);
        }
        apply_browser_zoom(bid, iv.user_zoom.get() * if preview { 1.0 } else { fit });
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
  fn create(mtm: MainThreadMarker, frame: NSRect) -> Retained<Self> {
    let this = Self::alloc(mtm).set_ivars(ZeCefHoleIvars {
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
      presentation_dirty: Cell::new(false),
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

fn schedule_was_resized(view: &ZeCefHoleView, _bid: i32) {
  if view.ivars().pending.replace(true) {
    return;
  }
  // 已在主线程。不要 run_on_main_thread，下一圈再 was_resized，避免和 AppKit 布局重入。
  // 拖窗口时 RunLoop 在事件跟踪模式，默认模式的 afterDelay 要等松手才跑。
  // CommonModes 同时覆盖默认模式和拖动模式，所以缩放能跟着边沿走。
  unsafe {
    let modes = NSArray::arrayWithObject(NSRunLoopCommonModes);
    let _: () = msg_send![
      view,
      performSelector: sel!(zeFlushWasResized),
      withObject: std::ptr::null::<objc2::runtime::AnyObject>(),
      afterDelay: 0.0f64,
      inModes: &*modes,
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

struct WrapperViews {
  hole: ViewPtr,
  stage: ViewPtr,
}

// AppKit 本地事件在发送给 CEF 子视图之前到达；CDP 的 Input.* 不经过这里。
fn install_user_input_monitor() {
  use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
  use std::ptr::NonNull;
  static INSTALLED: AtomicBool = AtomicBool::new(false);
  if INSTALLED.swap(true, Ordering::SeqCst) { return; }
  let mask = NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown
    | NSEventMask::LeftMouseDragged | NSEventMask::RightMouseDragged | NSEventMask::ScrollWheel | NSEventMask::KeyDown;
  let block = block2::RcBlock::new(move |raw: NonNull<NSEvent>| -> *mut NSEvent {
    let event = unsafe { raw.as_ref() };
    let id = (|| {
      let window = event.window(MainThreadMarker::new()?)?;
      let reg = registry().lock().ok()?;
      for tab in reg.tabs.values() {
        if tab.hidden || tab.wrapper.0.is_null() { continue; }
        // A click on the live miniature expands it; it is not a user takeover.
        if unsafe { (*(tab.wrapper.0 as *const ZeCefHoleView)).ivars().preview.get() } { continue; }
        let view = unsafe { &*wrapper_view(tab.wrapper) };
        if view.window()?.windowNumber() != window.windowNumber() { continue; }
        let inside = if event.r#type() == NSEventType::KeyDown {
          let responder = window.firstResponder()?;
          let is_view: bool = unsafe { msg_send![&*responder, isKindOfClass: objc2::class!(NSView)] };
          is_view && unsafe { (&*(Retained::as_ptr(&responder) as *const NSView)).isDescendantOf(view) }
        } else {
          let point = view.convertPoint_fromView(event.locationInWindow(), None);
          let bounds = view.bounds();
          point.x >= bounds.origin.x && point.y >= bounds.origin.y
            && point.x < bounds.origin.x + bounds.size.width && point.y < bounds.origin.y + bounds.size.height
        };
        if inside { return Some(tab.id.clone()); }
      }
      None
    })();
    if let Some(id) = id {
      let app = app_handle().lock().ok().and_then(|handle| handle.clone());
      if let Some(app) = app { let _ = crate::browser_control::set_owner(&app, &id, "user"); }
    }
    raw.as_ptr()
  });
  let token = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) };
  if let Some(token) = token { let _ = Retained::into_raw(token); } else { INSTALLED.store(false, Ordering::SeqCst); }
}

fn create_wrapper(parent_ptr: *mut c_void, x: f64, y: f64, w: f64, h: f64, hidden: bool) -> Result<WrapperViews, String> {
  install_user_input_monitor();
  unsafe {
    let parent = &*(parent_ptr as *const NSView);
    let frame = frame_in_parent(parent, x, y, w, h);
    let mtm = MainThreadMarker::new().ok_or_else(|| "必须在主线程创建浏览区".to_string())?;
    let view = ZeCefHoleView::create(mtm, frame);
    view.setHidden(hidden);
    view.setClipsToBounds(true);
    crate::app_browser::round_browser_view(&view);
    view.setAutoresizingMask(stretch_mask());

    let hole_size = NSSize::new(frame.size.width.max(1.0), frame.size.height.max(1.0));
    let scroll = NSScrollView::initWithFrame(
      mtm.alloc::<NSScrollView>(),
      NSRect::new(NSPoint::new(0.0, 0.0), hole_size),
    );
    scroll.setAutoresizingMask(stretch_mask());
    scroll.setHasHorizontalScroller(false);
    scroll.setHasVerticalScroller(false);
    scroll.setHorizontalScrollElasticity(NSScrollElasticity::None);
    scroll.setVerticalScrollElasticity(NSScrollElasticity::None);
    scroll.setAutomaticallyAdjustsContentInsets(false);
    scroll.setBorderType(NSBorderType::NoBorder);
    scroll.setDrawsBackground(true);
    scroll.setBackgroundColor(&NSColor::whiteColor());
    let content = scroll.contentView();
    let clip = ZeCenterClipView::create(mtm, content.frame());
    let clip_view: &NSClipView = &clip;
    scroll.setContentView(clip_view);

    let (page_w, page_h) = stage_points(hole_size.width, hole_size.height);
    let stage = ZeCefStage::create(
      mtm,
      NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(page_w, page_h)),
    );
    stage.setAutoresizingMask(NSAutoresizingMaskOptions::ViewNotSizable);
    let stage_view: &NSView = &stage;
    scroll.setDocumentView(Some(stage_view));
    recenter_stage(stage_view);

    let hole_view: &NSView = &view;
    hole_view.addSubview(&scroll);
    let scroll_ptr = ViewPtr(Retained::as_ptr(&scroll) as *mut c_void);
    let stage_ptr = ViewPtr(Retained::as_ptr(&stage) as *mut c_void);
    let iv = view.ivars();
    iv.scroll.set(scroll_ptr);
    iv.stage.set(stage_ptr);
    iv.fit.set(page_fit(page_w,page_h));
    iv.stage_w.set(page_w); iv.stage_h.set(page_h);
    iv.user_zoom.set(1.0);

    // 盖在铺满窗口的 WKWebView 上面，否则只能看到 Vue 里空的 .browser-host（白屏）
    parent.addSubview_positioned_relativeTo(&view, objc2_app_kit::NSWindowOrderingMode::Above, None);
    eprintln!(
      "[cef] wrapper frame origin=({:.0},{:.0}) size=({:.0}x{:.0}) stage=({:.0}x{:.0}) parentH={:.0} flipped={}",
      frame.origin.x,
      frame.origin.y,
      frame.size.width,
      frame.size.height,
      page_w,
      page_h,
      parent.frame().size.height,
      parent.isFlipped()
    );
    Ok(WrapperViews {
      hole: ViewPtr(Retained::into_raw(view) as *mut c_void),
      stage: stage_ptr,
    })
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

fn stretch_wrapper_children(hole: ViewPtr, stage: ViewPtr) {
  unsafe {
    let view = &*wrapper_view(hole);
    apply_stretch_mask(view);
    view.setClipsToBounds(true);
    fit_hole_scroll(hole);
    fit_stage_children(stage);
  }
}

/// 只把滚动视图拉满洞口。播放器浮层也挂在洞口上，不能一起被拉大。
fn fit_hole_scroll(ptr: ViewPtr) {
  if ptr.0.is_null() {
    return;
  }
  unsafe {
    let hole = &*wrapper_view(ptr);
    let scroll = (*(ptr.0 as *const ZeCefHoleView)).ivars().scroll.get();
    if scroll.0.is_null() {
      return;
    }
    let sub = &*wrapper_view(scroll);
    apply_stretch_mask(sub);
    let inner = hole.bounds();
    if !frames_close(sub.frame(), inner) {
      sub.setFrame(inner);
    }
  }
}

fn fit_stage_children(stage: ViewPtr) {
  if stage.0.is_null() {
    return;
  }
  unsafe {
    fit_cef_children(&*wrapper_view(stage));
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

fn resize_stage(stage: ViewPtr, w: f64, h: f64) {
  if stage.0.is_null() {
    return;
  }
  unsafe {
    let view = &*wrapper_view(stage);
    let old = view.frame().size;
    if (old.width - w).abs() >= 0.5 || (old.height - h).abs() >= 0.5 {
      view.setFrameSize(NSSize::new(w, h));
    }
    fit_cef_children(view);
    recenter_stage(view);
  }
}

// Core Animation changes only presentation. Unlike NSView/NSScrollView bounds
// magnification, Chromium does not reinterpret it as a renderer viewport resize.
// The miniature is read-only, so AppKit hit testing is passed to the expand button.
fn present_stage_layer(stage: ViewPtr, preview: bool, width: f64, height: f64, fit: f64) {
  if stage.0.is_null() {
    return;
  }
  unsafe {
    let view = &*wrapper_view(stage);
    view.setWantsLayer(true);
    if let Some(layer) = view.layer() {
      // NSView-backed layers default to a top-left (0,0) anchor, not CALayer's
      // usual (0.5,0.5). Keep the anchor explicit in both presentation modes.
      layer.setAnchorPoint(NSPoint::new(0.0, 0.0));
      let scale = NSNumber::numberWithDouble(if preview { fit } else { 1.0 });
      let _: () = msg_send![&*layer,setValue:&*scale,forKeyPath:ns_string!("transform.scale")];
      let f = view.frame();
      let (x, y) = stage_layer_origin(
        preview,
        f.origin.x,
        f.origin.y,
        f.size.width,
        f.size.height,
        width,
        height,
        fit,
      );
      layer.setPosition(NSPoint::new(x, y));
    }
  }
}

fn stage_layer_origin(
  preview: bool,
  x: f64,
  y: f64,
  w: f64,
  h: f64,
  hole_w: f64,
  hole_h: f64,
  fit: f64,
) -> (f64, f64) {
  if preview {
    (x + (hole_w - w * fit) / 2.0, y + (hole_h - h * fit) / 2.0)
  } else {
    (x, y)
  }
}

fn recenter_stage(stage: &NSView) {
  let Some(clip) = (unsafe { stage.superview() }) else { return };
  let origin = clip.bounds().origin;
  let _: () = unsafe { msg_send![&*clip, scrollToPoint: origin] };
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
      if !raise && wrapper_in_live_resize(ptr) {
        return;
      }
      // JS 的测量可能比原生窗口旧一帧；有锚点规则时按当前窗口尺寸重新计算。
      let layout = (*(ptr.0 as *const ZeCefHoleView)).ivars().layout.get();
      let (x, y, w, h) = layout.map(|layout| {
        let size = parent.bounds().size;
        layout.bounds(size.width, size.height)
      }).unwrap_or((x, y, w, h));
      let frame = frame_in_parent(&parent, x, y, w, h);
      if !frames_close(view.frame(), frame) {
        view.setFrame(frame);
      }
      fit_hole_scroll(ptr);
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
      let hole = &*(ptr.0 as *const ZeCefHoleView);
      schedule_was_resized(hole, hole.ivars().browser_id.get());
    }
    // 切走浏览页只藏起来，z-order 还在最上面。回来时不要 addSubview，否则整窗会卡一下。
  }
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
          reg.by_browser.insert(bid, id);
          drop(reg);
          bind_hole_browser(wrapper, bid);
          stretch_wrapper_children(wrapper, stage);
          notify_browser_resized(bid);
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
          emit_opened(app, &new_id, raw, id.as_deref());
        }
      }
      1
    }

    fn on_before_close(&self, browser: Option<&mut Browser>) {
      let Some(browser) = browser else { return };
      let bid = browser.identifier();
      let closed = if let Ok(mut reg) = registry().lock() {
        let id = reg.by_browser.remove(&bid);
        if let Some(id) = id.as_ref() { reg.tabs.remove(id); }
        id
      } else { None };
      if let Some(id) = closed { forget_target(&id); }
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

fn make_client(tab_id: &str) -> Client {
  ZeClient::new(ZeLifeSpan::new(tab_id.to_string()), ZeLoad::new())
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

/// 舞台左上角在窗口里的 CSS 坐标（已扣掉滚动），以及洞口裁剪矩形。
/// `scale` 是 1 个 CSS 像素对应多少点：用户缩放乘以放大倍数。
#[derive(Clone, Copy, Debug)]
pub struct PageOrigin {
  pub x: f64,
  pub y: f64,
  pub scale: f64,
  pub clip_x: f64,
  pub clip_y: f64,
  pub clip_w: f64,
  pub clip_h: f64,
}

pub fn tab_hole_view(id: &str) -> Option<*mut c_void> {
  let reg = registry().lock().ok()?;
  let tab = reg.tabs.get(id)?;
  if tab.hidden || tab.wrapper.0.is_null() {
    return None;
  }
  Some(tab.wrapper.0)
}

pub fn tab_page_origin(id: &str) -> Option<PageOrigin> {
  let (hole, stage, scale) = {
    let reg = registry().lock().ok()?;
    let tab = reg.tabs.get(id)?;
    if tab.hidden || tab.stage.0.is_null() {
      return None;
    }
    (tab.wrapper, tab.stage, hole_page_scale(tab.wrapper))
  };
  page_origin(hole, stage, scale)
}

fn page_origin(hole: ViewPtr, stage: ViewPtr, scale: f64) -> Option<PageOrigin> {
  unsafe {
    let hole_view = &*wrapper_view(hole);
    let stage_view = &*wrapper_view(stage);
    let parent = hole_view.superview()?;
    let top_left = stage_view.convertPoint_toView(NSPoint::new(0.0, 0.0), Some(&parent));
    let parent_h = parent.frame().size.height;
    let x = top_left.x;
    let y = if parent.isFlipped() { top_left.y } else { parent_h - top_left.y };
    let frame = hole_view.frame();
    let clip_w = frame.size.width;
    let clip_h = frame.size.height;
    let clip_y = if parent.isFlipped() {
      frame.origin.y
    } else {
      parent_h - frame.origin.y - clip_h
    };
    Some(PageOrigin {
      x,
      y,
      scale,
      clip_x: frame.origin.x,
      clip_y,
      clip_w,
      clip_h,
    })
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
    iv.user_zoom.get() * if iv.preview.get() { 1.0 } else { iv.fit.get() }
  }
}

fn hole_page_scale(ptr: ViewPtr) -> f64 {
  if ptr.0.is_null() {
    return 1.0;
  }
  unsafe {
    let hole = &*(ptr.0 as *const ZeCefHoleView);
    let iv = hole.ivars();
    let user = iv.user_zoom.get();
    let fit = iv.fit.get();
    let user = if user.is_finite() && user > 0.0 { user } else { 1.0 };
    let fit = if fit.is_finite() && fit > 0.0 { fit } else { 1.0 };
    user * fit
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

pub fn cookie_header_from(cookies: &[Value]) -> String {
  cookies
    .iter()
    .filter_map(|c| {
      let name = c.get("name")?.as_str()?;
      let value = c.get("value")?.as_str()?;
      Some(format!("{name}={value}"))
    })
    .collect::<Vec<_>>()
    .join("; ")
}

pub async fn cookie_header(id: &str, url: &str) -> Result<String, String> {
  Ok(cookie_header_from(&cookies_json(id, url).await?))
}

pub async fn set_cookies(id: &str, cookies: Vec<Value>, fallback_url: &str) -> Result<Value, String> {
  let page = bind_page(id).await?;
  let _ = page
    .conn
    .call("Network.enable", json!({}), page.session.as_deref())
    .await;
  let mut saved = 0i64;
  let mut errors: Vec<String> = Vec::new();
  for item in cookies {
    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
    let value = item.get("value").and_then(|v| v.as_str()).unwrap_or("");
    if name.is_empty() {
      errors.push("cookie 缺少 name".into());
      continue;
    }
    let mut payload = json!({ "name": name, "value": value });
    let url = item
      .get("url")
      .and_then(|v| v.as_str())
      .map(str::trim)
      .filter(|s| !s.is_empty())
      .unwrap_or(fallback_url);
    if !url.is_empty() {
      payload["url"] = json!(url);
    }
    if let Some(domain) = item.get("domain").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
      payload["domain"] = json!(domain);
    }
    if let Some(path) = item.get("path").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
      payload["path"] = json!(path);
    }
    if let Some(http_only) = item.get("httpOnly").and_then(|v| v.as_bool()) {
      payload["httpOnly"] = json!(http_only);
    }
    if let Some(secure) = item.get("secure").and_then(|v| v.as_bool()) {
      payload["secure"] = json!(secure);
    }
    if let Some(same_site) = item.get("sameSite").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
      payload["sameSite"] = json!(same_site);
    }
    if payload.get("url").is_none() && payload.get("domain").is_none() {
      errors.push(format!("{name}: 缺少 url 或 domain"));
      continue;
    }
    match page
      .conn
      .call("Network.setCookie", payload, page.session.as_deref())
      .await
    {
      Ok(res) if res.get("success").and_then(|v| v.as_bool()) != Some(false) => saved += 1,
      Ok(_) => errors.push(format!("{name}: 写入失败")),
      Err(err) => errors.push(format!("{name}: {err}")),
    }
  }
  Ok(json!({
    "ok": errors.is_empty(),
    "saved": saved,
    "error": if errors.is_empty() { Value::Null } else { json!(errors.join("；")) },
  }))
}

pub async fn clear_cookies(
  id: &str,
  url: &str,
  name: Option<String>,
  domain: Option<String>,
) -> Result<Value, String> {
  let page = bind_page(id).await?;
  let _ = page
    .conn
    .call("Network.enable", json!({}), page.session.as_deref())
    .await;
  if let Some(name) = name.filter(|s| !s.trim().is_empty()) {
    let mut payload = json!({ "name": name });
    if !url.is_empty() {
      payload["url"] = json!(url);
    }
    if let Some(domain) = domain.filter(|s| !s.trim().is_empty()) {
      payload["domain"] = json!(domain);
    }
    page
      .conn
      .call("Network.deleteCookies", payload, page.session.as_deref())
      .await?;
    return Ok(json!({ "ok": true, "cleared": 1 }));
  }
  let list = cookies_json(id, url).await?;
  let mut cleared = 0i64;
  for cookie in list {
    let Some(cname) = cookie.get("name").and_then(|v| v.as_str()) else { continue };
    let mut payload = json!({ "name": cname });
    if let Some(curl) = cookie.get("url").and_then(|v| v.as_str()) {
      payload["url"] = json!(curl);
    } else if !url.is_empty() {
      payload["url"] = json!(url);
    }
    if let Some(cdomain) = cookie.get("domain").and_then(|v| v.as_str()) {
      payload["domain"] = json!(cdomain);
    }
    if let Some(cpath) = cookie.get("path").and_then(|v| v.as_str()) {
      payload["path"] = json!(cpath);
    }
    if page
      .conn
      .call("Network.deleteCookies", payload, page.session.as_deref())
      .await
      .is_ok()
    {
      cleared += 1;
    }
  }
  Ok(json!({ "ok": true, "cleared": cleared }))
}

pub async fn cookies_json(id: &str, url: &str) -> Result<Vec<Value>, String> {
  let page = bind_page(id).await?;
  let _ = page
    .conn
    .call("Network.enable", json!({}), page.session.as_deref())
    .await;
  let mut urls = vec![url.to_string()];
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
  Ok(
    result
      .get("cookies")
      .and_then(|v| v.as_array())
      .cloned()
      .unwrap_or_default(),
  )
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

fn network_log() -> &'static Mutex<NetworkLog> {
  static LOG: OnceLock<Mutex<NetworkLog>> = OnceLock::new();
  LOG.get_or_init(|| {
    Mutex::new(NetworkLog {
      pump: false,
      last_browser: String::new(),
      owner: HashMap::new(),
      targets: HashMap::new(),
      session_targets: HashMap::new(),
      hits: HashMap::new(),
    })
  })
}

fn note_session_target(session: &str, target_id: &str) {
  if session.is_empty() || target_id.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    log.session_targets.insert(session.to_string(), target_id.to_string());
  }
}

pub(crate) fn note_network_session(id: &str, session: &str) {
  if id.is_empty() || session.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    log.owner.insert(session.to_string(), id.to_string());
    log.last_browser = id.to_string();
  }
}

fn note_target(id: &str, target_id: &str) {
  if id.is_empty() || target_id.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    log.targets.insert(target_id.to_string(), id.to_string());
  }
}

fn owner_of_target(target_id: &str) -> String {
  if target_id.is_empty() {
    return String::new();
  }
  network_log()
    .lock()
    .ok()
    .and_then(|log| log.targets.get(target_id).cloned())
    .unwrap_or_default()
}

fn forget_network(id: &str) {
  if let Ok(mut log) = network_log().lock() {
    log.owner.retain(|_, owner| owner != id);
    log.targets.retain(|_, owner| owner != id);
    log.hits.remove(id);
    if log.last_browser == id {
      log.last_browser.clear();
    }
  }
}

/// 只认登记过的 session；对不上再按 session→target→owner 精确反查，仍对不上返回空，不猜。推送归属用这个。
pub(crate) fn owner_of_session_exact(session: &str) -> String {
  if session.is_empty() {
    return String::new();
  }
  let Ok(mut log) = network_log().lock() else {
    return String::new();
  };
  if let Some(owner) = log.owner.get(session) {
    return owner.clone();
  }
  let via_target = log
    .session_targets
    .get(session)
    .and_then(|tid| log.targets.get(tid))
    .cloned()
    .unwrap_or_default();
  if !via_target.is_empty() {
    log.owner.insert(session.to_string(), via_target.clone());
  }
  via_target
}

pub(crate) fn owner_of_session(session: &str) -> String {
  owner_of_session_exact(session)
}

fn push_network_hit(id: &str, hit: NetHit) {
  if id.is_empty() || hit.url.is_empty() {
    return;
  }
  if let Ok(mut log) = network_log().lock() {
    let queue = log.hits.entry(id.to_string()).or_default();
    queue.push_back(hit);
    while queue.len() > 80 {
      queue.pop_front();
    }
  }
}

fn on_cdp_event(conn: &CdpConn, event: &Value) {
  let method = event.get("method").and_then(|v| v.as_str()).unwrap_or("");
  let params = event.get("params").cloned().unwrap_or(Value::Null);
  if method == "Runtime.bindingCalled" {
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let payload = params.get("payload").and_then(|v| v.as_str()).unwrap_or("");
    let session = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    crate::cef::on_binding_called(session, name, payload);
    return;
  }
  if method == "Target.attachedToTarget" {
    let sid = params
      .get("sessionId")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string();
    if sid.is_empty() {
      return;
    }
    let parent = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    let tid = params
      .get("targetInfo")
      .and_then(|t| t.get("targetId"))
      .and_then(|v| v.as_str())
      .unwrap_or("");
    note_session_target(&sid, tid);
    let mut owner = owner_of_session_exact(parent);
    if owner.is_empty() {
      owner = owner_of_target(tid);
    }
    if !owner.is_empty() {
      note_network_session(&owner, &sid);
      note_target(&owner, tid);
    }
    let conn = conn.clone();
    tokio::spawn(async move {
      let _ = conn.call("Network.enable", json!({}), Some(&sid)).await;
      let _ = conn.call("Page.enable", json!({}), Some(&sid)).await;
    });
    return;
  }
  if method == "Target.detachedFromTarget" {
    let sid = params.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    if let Ok(mut log) = network_log().lock() {
      log.session_targets.remove(sid);
    }
    forget_session(sid);
    return;
  }
  if method == "Target.targetDestroyed" || method == "Target.targetCrashed" {
    let tid = params.get("targetId").and_then(|v| v.as_str()).unwrap_or("");
    forget_by_target(tid);
    return;
  }
  if method == "Page.frameNavigated" || method == "Page.frameStoppedLoading" {
    let url = params
      .get("frame")
      .and_then(|f| f.get("url"))
      .and_then(|v| v.as_str())
      .unwrap_or("");
    let session = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    let owner = owner_of_session_exact(session);
    if !owner.is_empty() {
      // 主框架或 knowledge/cards 换页：上一节的 tick 全作废。
      // 不清的话新一节的空白监测会先吃到旧视频那条「还在播」的缓存，进度条停在旧数字上。
      let is_main = params
        .get("frame")
        .and_then(|f| f.get("parentId"))
        .and_then(|v| v.as_str())
        .map(|p| p.is_empty())
        .unwrap_or(true);
      if method == "Page.frameNavigated" && (is_main || url.contains("/knowledge/cards")) {
        crate::cef::forget(&owner);
      }
      emit_frame(&owner, url);
    }
    return;
  }
  if method != "Network.responseReceived" {
    return;
  }
  let session = event.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
  let response = params.get("response").cloned().unwrap_or(Value::Null);
  let url = response
    .get("url")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  if url.is_empty() || url.starts_with("data:") || url.starts_with("blob:") {
    return;
  }
  let hit = NetHit {
    url,
    status: response.get("status").and_then(|v| v.as_i64()).unwrap_or(0),
    mime: response
      .get("mimeType")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
    kind: params
      .get("type")
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
    method: response
      .get("headers")
      .and_then(|v| v.get("method"))
      .and_then(|v| v.as_str())
      .unwrap_or("")
      .to_string(),
    at: std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis() as i64)
      .unwrap_or(0),
  };
  let owner = owner_of_session_exact(session);
  if owner.is_empty() {
    crate::cdp_client::note_unowned();
    return;
  }
  push_network_hit(&owner, hit);
}

async fn ensure_event_pump() -> Result<(), String> {
  let conn = ensure_cdp().await?;
  {
    let Ok(mut log) = network_log().lock() else {
      return Err("网络观察锁失败".into());
    };
    if log.pump {
      return Ok(());
    }
    log.pump = true;
  }
  let mut rx = conn.subscribe();
  let pump_conn = conn.clone();
  tokio::spawn(async move {
    loop {
      tokio::select! {
        result = rx.recv() => match result {
          Ok(event) => on_cdp_event(&pump_conn, &event),
          Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
          Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        },
        // CdpConn 自身持有广播 sender，断线时不能仅靠 recv() 返回 Closed。
        _ = tokio::time::sleep(Duration::from_millis(250)) => {
          if !pump_conn.is_alive() { break; }
        }
      }
    }
    // 只由 ensure_cdp 在连接锁内重置断线状态。旧泵退出不能清掉刚建立的新连接。
  });
  Ok(())
}

pub async fn watch_network(id: &str) -> Result<Value, String> {
  ensure_event_pump().await?;
  let page = bind_page(id).await?;
  if let Some(sid) = page.session.as_deref() {
    note_network_session(id, sid);
    let _ = page.conn.call("Network.enable", json!({}), Some(sid)).await;
  }
  Ok(json!({ "ok": true }))
}

pub fn recent_network(id: &str) -> Value {
  let hits = network_log()
    .lock()
    .ok()
    .and_then(|log| log.hits.get(id).cloned())
    .unwrap_or_default();
  json!({
    "ok": true,
    "hits": hits.iter().map(|hit| json!({
      "url": hit.url,
      "status": hit.status,
      "mime": hit.mime,
      "type": hit.kind,
      "method": hit.method,
      "at": hit.at,
    })).collect::<Vec<_>>(),
  })
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
  hidden: bool,
) -> Result<(), String> {
  if is_space_list_url(&url) {
    return Err("禁止顶层打开课表地址。只点 iframe 里的「我学的课」页签。".into());
  }
  remember_handle(&app);
  let exists = registry()
    .lock()
    .ok()
    .is_some_and(|r| r.tabs.contains_key(&id));
  if exists {
    if hidden { return Ok(()); }
    return show_at(&app, &id, x, y, width, height);
  }
  remember_url(&id, &url);
  let parsed = crate::app_browser::parse_browser_url(&url)?;
  let target = cef_target_url(&app, &url, &parsed)?;
  let app2 = app.clone();
  let id2 = id.clone();
  on_main(&app, move || -> Result<(), String> {
    // CefInitialize / CreateBrowser 必须在同一条 UI 线程上，否则永远没有 on_after_created
    cef_runtime::ensure(&app2)?;
    let window = parent_window(&app2)?;
    let parent = parent_nsview(&window)?;
    if !hidden {
      hide_other(&id2);
    }
    let views = create_wrapper(parent, x, y, width, height, hidden)?;
    let parent_handle = views.stage.0 as cef::sys::cef_window_handle_t;
    let (page_w, page_h) = stage_points(width, height);
    let bounds = Rect {
      x: 0,
      y: 0,
      width: page_w.max(1.0) as i32,
      height: page_h.max(1.0) as i32,
    };
    let mut info = WindowInfo::default().set_as_child(parent_handle, &bounds);
    info.runtime_style = RuntimeStyle::ALLOY;
    let mut client = make_client(&id2);
    retain_client(&client);
    let mut settings = BrowserSettings::default();
    settings.background_color = 0xFFFF_FFFF;
    let cef_url = CefString::from(target.as_str());
    if let Ok(mut reg) = registry().lock() {
      reg.tabs.insert(
        id2.clone(),
        Tab {
          id: id2.clone(),
          wrapper: views.hole,
          stage: views.stage,
          browser_id: 0,
          target_id: String::new(),
          url: target.clone(),
          title: String::new(),
          hidden,
          zoom: 1.0,
        },
      );
    }
    eprintln!("[cef] create_browser {target} bounds={}x{} hidden={hidden}", bounds.width, bounds.height);
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
    // 预热时少泵几圈，剩下交给常驻消息泵，避免启动后首页跟着卡。
    let pumps = if hidden { 8 } else { 40 };
    for _ in 0..pumps {
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
    let wrapper = {
      let Ok(mut reg) = registry().lock() else {
        return Ok(());
      };
      let Some(tab) = reg.tabs.get_mut(&id) else {
        return Ok(());
      };
      tab.hidden = false;
      tab.wrapper
    };
    // 尺寸变化由 setFrameSize 排到下一圈刷新舞台。这里不要直接 was_resized，否则会按洞口重排网页。
    apply_wrapper_bounds_ex(wrapper, x, y, w, h, true);
    set_wrapper_hidden(wrapper, false);
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
  layout: Option<BrowserViewportLayout>,
  preview: bool,
) -> Result<(), String> {
  on_main(&app.clone(), move || {
    let Some(wrapper) = (|| {
      let reg = registry().lock().ok()?;
      let tab = reg.tabs.get(&id)?;
      Some(tab.wrapper)
    })() else {
      return Ok(());
    };
    unsafe {
      let hole = &*(wrapper.0 as *const ZeCefHoleView);
      let previous_preview = hole.ivars().preview.get();
      let entering_preview = preview && !previous_preview;
      if previous_preview != preview { hole.ivars().presentation_dirty.set(true); }
      hole.ivars().preview.set(preview);
      hole.ivars().layout.set(
        layout.and_then(|rule| AnchoredBrowserGeometry::new(rule, x, y, width, height)),
      );
      // A hidden caret must not keep accepting keyboard input after collapse.
      if entering_preview {
        if let Some(main) = app.get_webview("main") { let _ = main.set_focus(); }
      }
    }
    // 先放手再 setFrame。hole_size_tick / was_resized 不能再抢同一把锁。
    // 下一圈统一更新舞台/图层，禁止在 setFrameSize 回调里同步刷新 Chromium。
    apply_wrapper_bounds_ex(wrapper, x, y, width, height, false);
    unsafe { schedule_was_resized(&*(wrapper.0 as *const ZeCefHoleView),0); }
    // 位置同步不能唤醒已收起的网页，显示由 browser_show 单独控制。
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
    forget_target(&id);
    Ok(())
  })?
}

fn navigate_tab(id: &str, url: &str) {
  let permit = crate::browser_control::current_permit();
  // 先清 CDP 绑定，再 load_url。不要先 remember_url 成目标站：
  // bind_page 会按新 host 找 target，学习通播放页常有多个 page target，找不到就
  // Page.navigate 空会话，地址栏已是新站、主框架还停在旧页。
  forget_target(id);
  let url = url.to_string();
  let id = id.to_string();
  if let Ok(h) = app_handle().lock() {
    if let Some(app) = h.clone() {
      let _ = on_main(&app, move || {
        if let Some(permit) = permit { permit.check()?; }
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

pub async fn navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
  if is_space_list_url(&url) {
    return Err("禁止顶层打开课表地址。只点 iframe 里的「我学的课」页签。".into());
  }
  if is_iframe_document_url(&url) {
    return Err("这是学习通 iframe 里的页面，不能当顶层打开。留在当前课页，在页面里点章节/作业。".into());
  }
  let parsed = crate::app_browser::parse_browser_url(&url)?;
  let target = cef_target_url(&app, &url, &parsed)?;
  let from_home = crate::app_browser::is_home(&remembered_url(&id));
  remember_handle(&app);
  if from_home && !crate::app_browser::is_home(&target) {
    // 从应用首页离开：先绑当前首页会话再 location.replace，去掉 Referer。
    // remembered_url 仍是首页，bind_page 才能命中；失败再走主框架 load_url。
    if let Ok((conn, session)) = page_session(&id).await {
      let js = format!(
        "(function(){{var m=document.querySelector('meta[name=\"referrer\"]');if(!m){{m=document.createElement('meta');m.name='referrer';document.head.appendChild(m);}}m.content='no-referrer';location.replace({});}})()",
        serde_json::to_string(&target).map_err(|e| e.to_string())?
      );
      if conn.evaluate(&js, session.as_deref()).await.is_ok() {
        emit_load(&app, &id, "started", target);
        return Ok(());
      }
    }
    crate::browser_control::check_current()?;
  }
  navigate_tab(&id, &target);
  Ok(())
}

pub fn reload(app: AppHandle, id: String) -> Result<(), String> {
  let permit = crate::browser_control::current_permit();
  forget_target(&id);
  // 刷新是修复调试通道的恢复手段，不能反过来依赖已经损坏的 CDP 绑定。
  on_main(&app, move || {
    if let Some(permit) = permit { permit.check()?; }
    let bid = registry().lock().map_err(|_| "浏览器注册表不可用".to_string())?
      .tabs.get(&id).map(|tab| tab.browser_id).ok_or_else(|| "标签页已关闭".to_string())?;
    let browser = browser_by_id(bid).ok_or_else(|| "标签页尚未就绪".to_string())?;
    browser.reload();
    Ok(())
  })?
}

pub async fn go_back(_app: AppHandle, id: String) -> Result<(), String> {
  let (conn, session) = page_session(&id).await?;
  conn.evaluate("history.back()", session.as_deref()).await.map(|_| ())
}

pub async fn go_forward(_app: AppHandle, id: String) -> Result<(), String> {
  let (conn, session) = page_session(&id).await?;
  conn.evaluate("history.forward()", session.as_deref()).await.map(|_| ())
}

fn scale_to_zoom_level(scale: f64) -> f64 {
  // 下限留给「窗口缩小后的整页适配」。用户缩放本身仍在 set_zoom 里限制在 0.25–5 倍。
  let scale = if scale.is_finite() { scale.clamp(0.05, 16.0) } else { 1.0 };
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
    let found = registry().lock().ok().and_then(|mut reg| {
      let tab = reg.tabs.get_mut(&id)?;
      tab.zoom = zoom;
      Some((tab.browser_id, tab.wrapper))
    });
    if let Some((bid, wrapper)) = found {
      set_hole_user_zoom(wrapper, zoom);
      apply_browser_zoom(bid, hole_renderer_zoom(wrapper));
    }
    Ok::<(), String>(())
  })?
}

pub fn set_audio_muted(app: AppHandle, id: String, muted: bool) -> Result<(), String> {
  on_main(&app, move || {
    let bid = registry().lock().map_err(|_| "浏览器状态不可用".to_string())?
      .tabs.get(&id).map(|tab| tab.browser_id).ok_or_else(|| "浏览器标签页不存在".to_string())?;
    let browser = browser_by_id(bid).ok_or_else(|| "浏览器尚未就绪".to_string())?;
    let host = browser.host().ok_or_else(|| "浏览器音频控制不可用".to_string())?;
    host.set_audio_muted(if muted { 1 } else { 0 });
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

pub(crate) struct PageBind {
  pub conn: CdpConn,
  pub session: Option<String>,
  pub target_id: String,
  pub url: String,
}

fn native_target_result(success: i32, result: &[u8]) -> Result<String, String> {
  let value: Value = serde_json::from_slice(result).map_err(|e| format!("读取原生页面身份失败：{e}"))?;
  if success != 1 {
    return Err(format!("读取原生页面身份失败：{value}"));
  }
  value.get("targetInfo").filter(|t| is_page_target(t))
    .map(target_id_of).filter(|id| !id.is_empty()).map(str::to_string)
    .ok_or_else(|| "原生标签页没有返回有效的 page target".to_string())
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

/// 通过这个 Browser 自身的 DevTools 通道取身份，绝不按 URL 或页面数量猜另一个标签。
async fn native_page_target(id: &str) -> Result<String, String> {
  let (bid, known) = registry().lock().map_err(|_| "浏览器注册表不可用".to_string())?
    .tabs.get(id).map(|t| (t.browser_id, t.target_id.clone()))
    .ok_or_else(|| "标签页已关闭，请选择仍然打开的标签页".to_string())?;
  if bid == 0 { return Err("原生标签页尚未创建完成，请稍后重试".into()); }
  if !known.is_empty() { return Ok(known); }
  let app = app_handle().lock().ok().and_then(|h| h.clone())
    .ok_or_else(|| "浏览器尚未初始化".to_string())?;
  let (tx, rx) = tokio::sync::oneshot::channel();
  static NEXT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(1);
  let message_id = NEXT.fetch_add(1, Ordering::Relaxed);
  let registration = on_main(&app, move || -> Result<Registration, String> {
    let host = browser_by_id(bid).and_then(|b| b.host())
      .ok_or_else(|| "原生标签页不可用".to_string())?;
    let mut observer = NativeTargetObserver::new(message_id, Arc::new(Mutex::new(Some(tx))));
    let registration = host.add_dev_tools_message_observer(Some(&mut observer))
      .ok_or_else(|| "无法观察原生页面身份".to_string())?;
    let method = CefString::from("Target.getTargetInfo");
    if host.execute_dev_tools_method(message_id, Some(&method), None) == 0 {
      return Err("无法查询原生页面身份".into());
    }
    Ok(registration)
  })??;
  let result = tokio::time::timeout(Duration::from_secs(3), rx).await
    .map_err(|_| "读取原生页面身份超时".to_string())
    .and_then(|v| v.map_err(|_| "原生页面身份通道已关闭".to_string())).and_then(|v| v);
  on_main(&app, move || drop(registration))?;
  let target = result?;
  let mut reg = registry().lock().map_err(|_| "浏览器注册表不可用".to_string())?;
  let tab = reg.tabs.get_mut(id).filter(|t| t.browser_id == bid)
    .ok_or_else(|| "读取页面身份时标签页已关闭".to_string())?;
  tab.target_id = target.clone();
  Ok(target)
}

fn forget_target(id: &str) {
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
    map.retain(|tab, bind| tab == id || bind.target_id != target_id);
    map.insert(
      id.to_string(),
      BindSession {
        target_id: target_id.to_string(),
        session: session.to_string(),
      },
    );
  }
  note_network_session(id, session);
  note_target(id, target_id);
}

fn forget_bind(id: &str) {
  if let Ok(mut map) = bind_sessions().lock() {
    map.remove(id);
  }
  forget_network(id);
  crate::cef::forget(id);
}

fn is_page_target(t: &Value) -> bool {
  t.get("type").and_then(|x| x.as_str()) == Some("page")
}

fn target_id_of(t: &Value) -> &str {
  t.get("targetId").and_then(|v| v.as_str()).unwrap_or("")
}

fn target_url_of(t: &Value) -> &str {
  t.get("url").and_then(|v| v.as_str()).unwrap_or("")
}

fn session_of_target(target_id: &str) -> String {
  if target_id.is_empty() {
    return String::new();
  }
  network_log()
    .lock()
    .ok()
    .and_then(|log| {
      log
        .session_targets
        .iter()
        .find(|(_, tid)| tid.as_str() == target_id)
        .map(|(sid, _)| sid.clone())
    })
    .unwrap_or_default()
}

fn exact_page_target<'a>(pages: &'a [Value], target: &str) -> Option<&'a Value> {
  if target.is_empty() { return None; }
  pages.iter().find(|page| is_page_target(page) && target_id_of(page) == target)
}

async fn prepare_background_page(conn: &CdpConn, session: &str, id: &str) -> Result<(), String> {
  if !tab_is_visible(id) {
    // 收起的是原生展示层，不能同时关闭后台 Agent 的输入能力。
    // 使用 Chromium 的逻辑焦点，不显示 NSView、不抢系统窗口焦点；仍受自动化 epoch 检查。
    conn.call("Emulation.setFocusEmulationEnabled", json!({ "enabled": true }), Some(session)).await
      .map_err(|error| format!("激活后台浏览器失败：{error}"))?;
  }
  Ok(())
}

pub(crate) async fn bind_page(id: &str) -> Result<PageBind, String> {
  // 冷绑定串行，防止同一标签的并发快照/推送创建多个会话并互相覆盖缓存。
  static BIND: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
  let _guard = BIND.lock().await;
  let target_id = native_page_target(id).await?;
  let conn = ensure_cdp().await?;
  ensure_event_pump().await?;
  if let Some(cached) = cached_bind(id) {
    if cached.target_id == target_id && !cached.session.is_empty() {
      // detached 事件可能尚未处理；先确认会话确实仍然指向这个原生页面。
      if let Ok(info) = conn.call("Target.getTargetInfo", json!({}), Some(&cached.session)).await {
        if info.get("targetInfo").is_some_and(|t| is_page_target(t) && target_id_of(t) == target_id) {
          let url = target_url_of(&info["targetInfo"]).to_string();
          prepare_background_page(&conn, &cached.session, id).await?;
          return Ok(PageBind { conn, session: Some(cached.session), target_id, url });
        }
      }
    }
    forget_target(id);
  }
  let pages = conn.pages().await.map_err(|e| format!("读取 CDP 页面列表失败：{e}"))?;
  let page = exact_page_target(&pages, &target_id).ok_or_else(|| format!(
    "当前原生标签页暂未出现在 CDP 页面列表中（发现 {} 个页面），请稍后重试",
    pages.iter().filter(|p| is_page_target(p)).count()
  ))?;
  let url = target_url_of(page).to_string();
  let sid = match conn.attach(&target_id).await {
    Ok(sid) => sid,
    Err(error) => {
      let existing = session_of_target(&target_id);
      if existing.is_empty() { return Err(format!("附加当前标签页失败：{error}")); }
      existing
    }
  };
  conn.call("Page.enable", json!({}), Some(&sid)).await
    .map_err(|e| format!("当前标签页会话不可用：{e}"))?;
  conn.call("Runtime.enable", json!({}), Some(&sid)).await
    .map_err(|e| format!("当前标签页脚本通道不可用：{e}"))?;
  prepare_background_page(&conn, &sid, id).await?;
  let h264 = claim_h264_bundle();
  let _ = conn.call("Page.addScriptToEvaluateOnNewDocument", json!({ "source": h264 }), Some(&sid)).await;
  let _ = conn.evaluate(&h264, Some(&sid)).await;
  let _ = crate::cef::install_push(&conn, Some(&sid)).await;
  // 关闭回调可能在 attach 期间到来，不能再给已经关闭的标签留下占用记录。
  if !registry().lock().ok().is_some_and(|r| r.tabs.contains_key(id)) {
    let _ = conn.call("Target.detachFromTarget", json!({ "sessionId": sid }), None).await;
    return Err("绑定期间标签页已关闭".into());
  }
  remember_bind(id, &target_id, &sid);
  Ok(PageBind { conn, session: Some(sid), target_id, url })
}

async fn page_session(id: &str) -> Result<(CdpConn, Option<String>), String> {
  let page = bind_page(id).await?;
  Ok((page.conn, page.session))
}

pub(crate) fn reset_cdp_state() {
  if let Ok(mut g) = cdp().lock() {
    *g = None;
  }
  if let Ok(mut map) = bind_sessions().lock() {
    map.clear();
  }
  if let Ok(mut log) = network_log().lock() {
    log.owner.clear();
    log.targets.clear();
    log.session_targets.clear();
    log.last_browser.clear();
    log.pump = false;
  }
  crate::cef::forget_all();
}

fn forget_session(session: &str) {
  if session.is_empty() {
    return;
  }
  let page_ids: Vec<String> = bind_sessions()
    .lock()
    .ok()
    .map(|map| {
      map
        .iter()
        .filter(|(_, bind)| bind.session == session)
        .map(|(id, _)| id.clone())
        .collect()
    })
    .unwrap_or_default();
  for id in page_ids {
    forget_bind(&id);
  }
  if let Ok(mut log) = network_log().lock() {
    log.owner.remove(session);
  }
}

fn forget_by_target(target_id: &str) {
  if target_id.is_empty() {
    return;
  }
  if let Ok(mut reg) = registry().lock() {
    for tab in reg.tabs.values_mut().filter(|tab| tab.target_id == target_id) {
      tab.target_id.clear();
    }
  }
  let page_ids: Vec<String> = bind_sessions()
    .lock()
    .ok()
    .map(|map| {
      map
        .iter()
        .filter(|(_, bind)| bind.target_id == target_id)
        .map(|(id, _)| id.clone())
        .collect()
    })
    .unwrap_or_default();
  for id in page_ids {
    forget_target(&id);
  }
  if let Ok(mut log) = network_log().lock() {
    log.targets.remove(target_id);
  }
}

fn emit_frame(id: &str, url: &str) {
  let Ok(guard) = app_handle().lock() else {
    return;
  };
  let Some(app) = guard.as_ref() else {
    return;
  };
  let _ = app.emit(
    "app-browser-frame",
    json!({ "id": id, "url": url }),
  );
}

async fn ensure_cdp() -> Result<CdpConn, String> {
  static CONNECT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
  let _guard = CONNECT.lock().await;
  if let Ok(g) = cdp().lock() {
    if let Some(c) = g.clone() {
      if c.is_alive() {
        return Ok(c);
      }
    }
  }
  reset_cdp_state();
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
  if let Some(text) = v.as_str() {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == "null" || trimmed == "[]" || trimmed == "{}" {
      return 0;
    }
    return (trimmed.len().min(400) as i32) + 2;
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

fn skip_child_eval_url(url: &str) -> bool {
  let raw = url.trim();
  raw.is_empty()
    || raw.eq_ignore_ascii_case("about:blank")
    || raw.starts_with("about:blank")
    || raw.starts_with("chrome-error:")
    || raw.starts_with("devtools:")
    || raw.starts_with("chrome-extension:")
}

async fn eval_frames_inner(id: &str, expression: &str) -> Result<Value, String> {
  let page = bind_page(id).await?;
  let mut rows = vec![(String::new(), page.url.clone(), page.conn.evaluate_ms(expression, page.session.as_deref(), 600).await)];
  let deadline = std::time::Instant::now() + Duration::from_millis(1600);
  if let Ok(Ok(contexts)) = tokio::time::timeout(Duration::from_millis(700), crate::cef::frames::contexts(&page)).await {
    let children: Vec<_> = contexts.iter().filter(|frame| !frame.path.is_empty() && !skip_child_eval_url(&frame.url)).collect();
    for batch in children.chunks(8) {
      if std::time::Instant::now() >= deadline { break; }
      let results = join_all(batch.iter().map(|frame| async {
        let result = tokio::time::timeout(Duration::from_millis(400), crate::cef::frames::evaluate(&page, frame, expression)).await
          .unwrap_or_else(|_| Err("frame 执行超时".into()));
        (frame.id.clone(), frame.url.clone(), result)
      })).await;
      rows.extend(results);
    }
  }
  let mut frames = Vec::new();
  let mut best = Value::Null;
  let mut best_score = -1;
  let mut last_err = String::new();
  // 同 URL 的多个播放器是不同 frame，不能按 URL 去重。
  for (frame_id, url, result) in rows {
    match result {
      Ok(value) => {
        let score = eval_score(&value);
        if score > best_score { best = value.clone(); best_score = score; }
        frames.push(json!({ "frameId": frame_id, "url": url, "result": value, "error": Value::Null }));
      }
      Err(error) => {
        let nice = format_eval_error_near(&error, expression);
        last_err = nice.clone();
        frames.push(json!({ "frameId": frame_id, "url": url, "result": Value::Null, "error": nice }));
      }
    }
  }
  Ok(json!({ "frames": frames, "result": best, "error": if best_score < 0 { last_err } else { String::new() } }))
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

fn virtual_mouse_script(kind: &str, x: f64, y: f64, label: &str) -> String {
  let kind = serde_json::to_string(kind).unwrap_or_else(|_| "\"click\"".into());
  let label = serde_json::to_string(label).unwrap_or_else(|_| "\"\"".into());
  format!(
    "(function(){{\n{VIRTUAL_MOUSE}\n  var x = {x};\n  var y = {y};\n  __zeEnsureMouse().act({kind}, x, y, {label});\n  return true;\n}})()"
  )
}

fn virtual_mouse_enabled() -> bool {
  match std::env::var("ZERROR_VIRTUAL_MOUSE") {
    Ok(value) if value == "0" || value.eq_ignore_ascii_case("false") => false,
    Ok(value) if value == "1" || value.eq_ignore_ascii_case("true") => true,
    _ => cfg!(debug_assertions),
  }
}

async fn show_virtual_mouse(
  conn: &CdpConn,
  session: Option<&str>,
  kind: &str,
  x: f64,
  y: f64,
  label: &str,
) {
  if !virtual_mouse_enabled() {
    return;
  }
  let _ = conn
    .evaluate(&virtual_mouse_script(kind, x, y, label), session)
    .await;
}

/// Playwright 式真实点击：先在顶层画出虚拟鼠标，再按下 / 抬起。
/// x/y 是顶层 page 视口 CSS 像素（与 getBoundingClientRect 换算到 top 后一致）。
/// 指针本身 pointer-events:none，点下去时不要藏，藏了再画经常在 iframe 里超时，之后就再也出不来。
async fn click_point(
  conn: &CdpConn,
  x: f64,
  y: f64,
  session: Option<&str>,
  label: &str,
  button: &str,
  click_count: i64,
) -> Result<(), String> {
  let kind = if button == "right" {
    "right"
  } else if click_count >= 2 {
    "dblclick"
  } else {
    "click"
  };
  show_virtual_mouse(conn, None, kind, x, y, label).await;
  tokio::time::sleep(std::time::Duration::from_millis(240)).await;
  dispatch_click(conn, x, y, session, button, click_count).await
}

/// 只发 CDP 鼠标，不往页里画虚拟指针。
pub(crate) async fn dispatch_click(
  conn: &CdpConn,
  x: f64,
  y: f64,
  session: Option<&str>,
  button: &str,
  click_count: i64,
) -> Result<(), String> {
  let btn = if button == "right" { "right" } else { "left" };
  let down = if btn == "right" { 2 } else { 1 };
  let ev = |ty: &str, button: &str, buttons: u32, count: i64| {
    json!({
      "type": ty,
      "x": x,
      "y": y,
      "button": button,
      "buttons": buttons,
      "clickCount": count,
      "pointerType": "mouse",
    })
  };
  conn.call("Input.dispatchMouseEvent", ev("mouseMoved", "none", 0, 1), session).await?;
  tokio::time::sleep(std::time::Duration::from_millis(16)).await;
  let times = if click_count >= 2 { 2 } else { 1 };
  for count in 1..=times {
    conn.call("Input.dispatchMouseEvent", ev("mousePressed", btn, down, count), session).await?;
    tokio::time::sleep(std::time::Duration::from_millis(24)).await;
    // mouseReleased 的回执要等渲染进程把 click 处理完。目录点节名会同步改 location，
    // 顶层文档开始卸载，回执常常迟到甚至不来；事件本身早已送达，超时不算失败。
    match conn
      .call_ms("Input.dispatchMouseEvent", ev("mouseReleased", btn, 0, count), session, 1500)
      .await
    {
      Ok(_) => {}
      Err(e) if e.contains("超时") => {
        eprintln!("[cef] mouseReleased 回执超时，按已送达处理 ({x:.0},{y:.0})");
      }
      Err(e) => return Err(e),
    }
    if count < times {
      tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
  }
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

pub(crate) fn is_child_target(t: &Value, main_tid: &str, _main_url: &str) -> bool {
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
  // 只认 iframe。type=page 的其它文档是别的标签 / 导航残留，
  // 混进 snapshot 会把学习通目录塞进之江在线登录页，Agent 拿章节按钮当输入框填。
  ty == "iframe"
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
  button: &str,
  click_count: i64,
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
  click_point(conn, x, y, session.as_deref(), &label, button, click_count).await?;
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
  click_found(&page.conn, boxv, session, &label, selector.is_none(), "left", 1).await
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
  click_point(&page.conn, x, y, session.as_deref(), "输入", "left", 1).await?;
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

pub async fn cdp_click_box(
  _app: AppHandle,
  id: String,
  script: String,
  button: Option<String>,
  click_count: Option<i64>,
) -> Result<CdpActResult, String> {
  let script = script.trim();
  if script.is_empty() {
    return Ok(miss("缺少定位脚本".into()));
  }
  let page = bind_page(&id).await?;
  let (boxv, session) = find_box_in_frames(&page, script).await;
  let btn = if button.as_deref() == Some("right") { "right" } else { "left" };
  let count = click_count.unwrap_or(1).clamp(1, 2);
  click_found(&page.conn, boxv, session, "目标", false, btn, count).await
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
  click_point(&page.conn, x, y, session.as_deref(), "输入", "left", 1).await?;
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
  show_virtual_mouse(&page.conn, None, "move", x, y, &label).await;
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
  show_virtual_mouse(&conn, None, "scroll", x, y, "滚动").await;
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

pub async fn cdp_focus_node(
  _app: AppHandle,
  id: String,
  backend: i64,
  session: Option<String>,
) -> Result<CdpActResult, String> {
  if backend <= 0 {
    return Ok(miss("缺少 backendNodeId".into()));
  }
  let page = bind_page(&id).await?;
  let sid = session
    .filter(|s| !s.is_empty())
    .or_else(|| page.session.clone());
  let _ = page.conn.call("DOM.enable", json!({}), sid.as_deref()).await;
  page.conn
    .call("DOM.focus", json!({ "backendNodeId": backend }), sid.as_deref())
    .await
    .map_err(|err| {
      if crate::cdp_client::is_session_dead(&err) {
        crate::cdp_client::HOST_CHANNEL_DOWN.to_string()
      } else {
        format!("聚焦失败: {err}")
      }
    })?;
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

fn quad_bounds(model: &Value, key: &str) -> Option<(f64, f64, f64, f64)> {
  let quad = model.get("model")?.get(key)?.as_array()?;
  let nums: Vec<f64> = quad.iter().filter_map(|v| v.as_f64()).collect();
  if nums.len() < 8 {
    return None;
  }
  let xs = [nums[0], nums[2], nums[4], nums[6]];
  let ys = [nums[1], nums[3], nums[5], nums[7]];
  let min = |arr: [f64; 4]| arr.into_iter().fold(f64::INFINITY, f64::min);
  let max = |arr: [f64; 4]| arr.into_iter().fold(f64::NEG_INFINITY, f64::max);
  Some((min(xs), min(ys), max(xs), max(ys)))
}

/// 落点不在目标盒子里时，返回挡在上面的节点描述。文字在按钮里算打中。
async fn node_backend(conn: &CdpConn, session: Option<&str>, spec: Value) -> i64 {
  conn
    .call("DOM.describeNode", spec, session)
    .await
    .ok()
    .and_then(|described| described.get("node").and_then(|node| node.get("parentId")).and_then(|v| v.as_i64()))
    .unwrap_or(0)
}

async fn parent_backend(conn: &CdpConn, session: Option<&str>, backend: i64) -> i64 {
  let parent_id = node_backend(conn, session, json!({ "backendNodeId": backend })).await;
  if parent_id <= 0 {
    return 0;
  }
  conn
    .call("DOM.describeNode", json!({ "nodeId": parent_id }), session)
    .await
    .ok()
    .and_then(|described| {
      described
        .get("node")
        .and_then(|node| node.get("backendNodeId"))
        .and_then(|v| v.as_i64())
    })
    .unwrap_or(0)
}

fn node_is_clickable(node: &Value) -> bool {
  let tag = node.get("localName").and_then(|v| v.as_str()).unwrap_or("");
  let mut role = String::new();
  let mut onclick = false;
  if let Some(list) = node.get("attributes").and_then(|v| v.as_array()) {
    let mut index = 0;
    while index + 1 < list.len() {
      let key = list[index].as_str().unwrap_or("");
      let value = list[index + 1].as_str().unwrap_or("");
      if key == "role" {
        role = value.to_string();
      }
      if key == "onclick" {
        onclick = true;
      }
      index += 2;
    }
  }
  matches!(tag, "a" | "button" | "label")
    || matches!(role.as_str(), "button" | "link" | "tab" | "menuitem" | "treeitem" | "listitem")
    || onclick
}

async fn shared_clickable(conn: &CdpConn, session: Option<&str>, hit: i64, target: i64) -> bool {
  let mut current = hit;
  for _ in 0..8 {
    if current <= 0 {
      return false;
    }
    let described = conn
      .call("DOM.describeNode", json!({ "backendNodeId": current }), session)
      .await
      .ok();
    let clickable = described
      .as_ref()
      .and_then(|value| value.get("node"))
      .map(node_is_clickable)
      .unwrap_or(false);
    if clickable {
      let mut up = target;
      for _ in 0..8 {
        if up == current {
          return true;
        }
        up = parent_backend(conn, session, up).await;
        if up <= 0 {
          break;
        }
      }
      return false;
    }
    current = parent_backend(conn, session, current).await;
  }
  false
}

/// 点在目标里面（文字、内层 div）或包着目标的节点上，都算点中。外层盒子往往比链接大，不能只比边框。
async fn same_click_target(conn: &CdpConn, session: Option<&str>, hit: i64, target: i64) -> bool {
  if hit <= 0 || target <= 0 {
    return false;
  }
  let mut current = hit;
  for _ in 0..24 {
    if current == target {
      return true;
    }
    current = parent_backend(conn, session, current).await;
    if current <= 0 {
      break;
    }
  }
  current = target;
  for _ in 0..24 {
    if current == hit {
      return true;
    }
    current = parent_backend(conn, session, current).await;
    if current <= 0 {
      return false;
    }
  }
  false
}

// 使用目标节点所在文档的 CSS 坐标命中测试，避免 CEF 缩放时
// DOM.getNodeForLocation 与 getBoxModel 的坐标空间不一致。
pub(crate) async fn click_landed_elsewhere(
  conn: &CdpConn, session: Option<&str>, backend: i64, _x: f64, _y: f64,
) -> Option<String> {
  let result: Result<Option<String>, String> = async {
    let resolved = conn.call("DOM.resolveNode", json!({"backendNodeId":backend}), session).await?;
    let object = resolved.pointer("/object/objectId").and_then(Value::as_str).ok_or("目标节点已失效")?;
    let probe = conn.call("Runtime.callFunctionOn", json!({
      "objectId": object, "returnByValue": true,
      "functionDeclaration": r#"function(){
        var el=this.nodeType===3?this.parentElement:this;
        if(!el || !el.isConnected) return '目标节点已失效';
        var r=el.getBoundingClientRect(), doc=el.ownerDocument;
        if(r.width<2 || r.height<2) return '目标元素不可见';
        var hit=doc.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        if(!hit || !(hit===el || el.contains(hit))) return '真实落点被 '+(hit?hit.tagName.toLowerCase():'视口外区域')+' 遮挡';
        // 同源嵌套 frame 的上层遮罩也必须检查。
        var win=doc.defaultView;
        try {
          while(win && win.frameElement){
            var frame=win.frameElement, box=frame.getBoundingClientRect();
            var sx=box.width/(frame.offsetWidth||box.width), sy=box.height/(frame.offsetHeight||box.height);
            var x=box.left+(r.left+r.width/2+frame.clientLeft)*sx;
            var y=box.top+(r.top+r.height/2+frame.clientTop)*sy;
            var outer=frame.ownerDocument.elementFromPoint(x,y);
            if(outer!==frame && !frame.contains(outer)) return 'iframe 上层存在遮挡';
            r={left:x,top:y,width:0,height:0}; win=frame.ownerDocument.defaultView;
          }
        }catch(e){}
        return null;
      }"#
    }), session).await;
    let _ = conn.call("Runtime.releaseObject", json!({"objectId":object}), session).await;
    let value = probe?;
    if value.get("exceptionDetails").is_some() { return Err("落点验证脚本失败".into()); }
    Ok(value.pointer("/result/value").and_then(Value::as_str).map(str::to_string))
  }.await;
  match result { Ok(blocked) => blocked, Err(error) => Some(format!("无法验证点击目标：{error}")) }
}

pub(crate) async fn visible_control_backend(conn: &CdpConn, session: Option<&str>, backend: i64) -> Result<i64, String> {
  let resolved=conn.call("DOM.resolveNode", json!({"backendNodeId":backend}), session).await?;
  let object=resolved.pointer("/object/objectId").and_then(Value::as_str).ok_or("目标节点已失效")?;
  let result=conn.call("Runtime.callFunctionOn", json!({
    "objectId":object,
    "functionDeclaration":r#"function(){
      var el=this.nodeType===3?this.parentElement:this;
      if(!el) return this;
      var label=el.closest && el.closest('label');
      if(!label && el.labels) label=Array.from(el.labels).find(function(l){var r=l.getBoundingClientRect();return r.width>1&&r.height>1;});
      var role=el.getAttribute && el.getAttribute('role');
      if(!label && (role==='checkbox' || role==='radio') && el.querySelectorAll){
        var controls=el.querySelectorAll('input[type=checkbox],input[type=radio]');
        if(controls.length===1) label=controls[0].closest('label');
      }
      // A link/button/row may contain a checkbox for selection or completion.
      // Only an explicit checkable role may delegate to a descendant label.
      if(label && (label.control && /^(checkbox|radio)$/.test(label.control.type) || label.querySelector('input[type=checkbox],input[type=radio]'))) return label;
      return el;
    }"#
  }),session).await;
  let value=match result { Ok(value)=>value, Err(error)=>{let _=conn.call("Runtime.releaseObject",json!({"objectId":object}),session).await;return Err(error);} };
  let next=value.pointer("/result/objectId").and_then(Value::as_str);
  let described=if let Some(next)=next {conn.call("DOM.describeNode",json!({"objectId":next}),session).await} else {Err("可见点击节点不存在".into())};
  if let Some(next)=next {if next!=object {let _=conn.call("Runtime.releaseObject",json!({"objectId":next}),session).await;}}
  let _=conn.call("Runtime.releaseObject",json!({"objectId":object}),session).await;
  described?.pointer("/node/backendNodeId").and_then(Value::as_i64).ok_or_else(||"点击节点身份不可用".into())
}

async fn check_node_state(page: &PageBind, backend: i64, session: Option<&str>) -> Result<Value, String> {
  let resolved = page.conn.call("DOM.resolveNode", json!({ "backendNodeId": backend }), session).await?;
  let object = resolved.pointer("/object/objectId").and_then(Value::as_str).ok_or("选项节点已失效")?;
  let result = page.conn.call("Runtime.callFunctionOn", json!({
    "objectId": object, "returnByValue": true,
    "functionDeclaration": r#"function(){
      var el=this, input=null;
      if(el.matches && el.matches('input[type=checkbox],input[type=radio]')) input=el;
      else if(el.control && /^(checkbox|radio)$/.test(el.control.type)) input=el.control;
      var role=el.getAttribute && el.getAttribute('role');
      // Only explicit custom controls may delegate state to an inner input.
      // A chapter link or course card containing one checkbox is still a link/card.
      if(!input && (role==='checkbox' || role==='radio') && el.querySelectorAll){
        var controls=el.querySelectorAll('input[type=checkbox],input[type=radio]');
        if(controls.length>1) return {supported:false};
        input=controls[0]||null;
      }
      var kind=input?input.type:role;
      if(kind!=='checkbox' && kind!=='radio') return {supported:false};
      var state=input?!!input.checked:el.getAttribute('aria-checked');
      if(!input && state!=='true' && state!=='false') return {supported:false};
      return {supported:true,kind:kind,connected:!!el.isConnected,
        checked:input?state:state==='true', disabled:input?input.disabled:el.getAttribute('aria-disabled')==='true'};
    }"#
  }), session).await;
  let _ = page.conn.call("Runtime.releaseObject", json!({ "objectId": object }), session).await;
  let value = result?;
  if value.get("exceptionDetails").is_some() { return Err("读取选项状态失败，请重新读取页面".into()); }
  value.pointer("/result/value").cloned().ok_or_else(|| "读取选项状态失败".into())
}

async fn wait_checked(page: &PageBind, backend: i64, session: Option<&str>, checked: bool) -> Result<bool, String> {
  let started = std::time::Instant::now();
  let mut confirmed = 0;
  loop {
    let state = check_node_state(page, backend, session).await?;
    if state["connected"] != true { return Err("选项节点已替换，请重新读取页面后确认".into()); }
    if state["checked"].as_bool() == Some(checked) { confirmed += 1; } else { confirmed = 0; }
    if confirmed >= 2 { return Ok(true); }
    if started.elapsed() >= std::time::Duration::from_millis(1500) { return Ok(false); }
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
  }
}

pub async fn cdp_set_checked(app: AppHandle, id: String, backend: i64, session: Option<String>, checked: bool) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let sid = session.or_else(|| page.session.clone());
  let state = check_node_state(&page, backend, sid.as_deref()).await?;
  if state["supported"] != true || state["connected"] != true { return Ok(json!({"ok":false,"error":"目标不是可读取状态的复选框或单选框"})); }
  if state["checked"].as_bool() == Some(checked) { return Ok(json!({"ok":true,"checked":checked,"already":true})); }
  if state["disabled"] == true { return Ok(json!({"ok":false,"error":"选项已禁用"})); }
  if state["kind"] == "radio" && !checked { return Ok(json!({"ok":false,"error":"单选项不能直接取消，请选择同组另一项"})); }
  let result = cdp_click_node(app, id, backend, sid.clone(), None, None).await?;
  if !result.ok { return Ok(json!({"ok":false,"error":result.error})); }
  let ok = wait_checked(&page, backend, sid.as_deref(), checked).await?;
  Ok(json!({"ok":ok,"checked":if ok {Some(checked)} else {None},"error":if ok {None} else {Some("点击后未达到预期选中状态，请重新读取页面确认，不要盲目重复点击")} }))
}

pub async fn cdp_click_node(
  _app: AppHandle,
  id: String,
  backend: i64,
  session: Option<String>,
  button: Option<String>,
  click_count: Option<i64>,
) -> Result<CdpActResult, String> {
  if backend <= 0 {
    return Ok(miss("缺少 backendNodeId".into()));
  }
  let page = bind_page(&id).await?;
  let sid = session
    .filter(|s| !s.is_empty())
    .or_else(|| page.session.clone());
  let _ = page.conn.call("DOM.enable", json!({}), sid.as_deref()).await;
  // 定位会把每个同名候选都滚进视野量一遍，选中的那颗可能已经被滚出视口。
  let _ = page
    .conn
    .call("DOM.scrollIntoViewIfNeeded", json!({ "backendNodeId": backend }), sid.as_deref())
    .await;
  // 页面滚动/布局未稳定时不投递鼠标事件，避免点到移动中的其它选项。
  let started = std::time::Instant::now();
  let mut previous: Option<Vec<f64>> = None;
  let nums = loop {
    let model = page.conn.call("DOM.getBoxModel", json!({ "backendNodeId": backend }), sid.as_deref()).await?;
    let nums: Vec<f64> = model.pointer("/model/content").and_then(Value::as_array)
      .map(|quad| quad.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
    if nums.len() != 8 { return Ok(miss("元素没有可点的盒子".into())); }
    if previous.as_ref().is_some_and(|before| before.iter().zip(&nums).all(|(a,b)| (a-b).abs() < 0.5)) { break nums; }
    if started.elapsed() >= std::time::Duration::from_millis(1000) { return Ok(miss("元素位置尚未稳定，请重新定位后再点".into())); }
    previous = Some(nums);
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
  };
  let x = (nums[0] + nums[2] + nums[4] + nums[6]) / 4.0;
  let y = (nums[1] + nums[3] + nums[5] + nums[7]) / 4.0;
  let vis = page
    .conn
    .evaluate("document.visibilityState", sid.as_deref())
    .await
    .ok()
    .and_then(|v| v.as_str().map(str::to_string))
    .unwrap_or_default();
  if vis == "hidden" {
    return Ok(miss("浏览器当前不可见，点击不会送达".into()));
  }
  if let Some(cover) = click_landed_elsewhere(&page.conn, sid.as_deref(), backend, x, y).await {
    return Ok(miss(format!("点击没有打进目标，落在了{cover}")));
  }
  let btn = if button.as_deref() == Some("right") { "right" } else { "left" };
  let count = click_count.unwrap_or(1).clamp(1, 2);
  let before = check_node_state(&page, backend, sid.as_deref()).await?;
  dispatch_click(&page.conn, x, y, sid.as_deref(), btn, count).await?;
  if btn == "left" && count == 1 && before["supported"] == true {
    let want = before["kind"] == "radio" || before["checked"] != true;
    if !wait_checked(&page, backend, sid.as_deref(), want).await? {
      return Ok(miss("鼠标事件已发送，但选项状态未改变；请重新读取页面确认".into()));
    }
  }
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
  // 先全选：type 的语义是「填成这个」，不是「接着敲」。不选中就会把用户名敲成两遍、密码越敲越长。
  let _ = page.conn
    .evaluate(
      "(function(){ var el=document.activeElement; if(!el) return false; try { if (typeof el.select === 'function') { el.select(); return true; } } catch (e) {} try { if (el.isContentEditable) { var r=document.createRange(); r.selectNodeContents(el); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); return true; } } catch (e2) {} return false; })()",
      session.as_deref(),
    )
    .await;
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

struct InputField {
  id: String,
  name: String,
  placeholder: String,
  title: String,
  aria: String,
  used: bool,
}

fn input_fields_of(raw: &Value) -> Vec<InputField> {
  let Some(list) = raw.as_array() else {
    return Vec::new();
  };
  list
    .iter()
    .map(|row| InputField {
      id: row.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      name: row.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      placeholder: row.get("placeholder").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      title: row.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      aria: row.get("aria").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
      used: false,
    })
    .filter(|field| !field.id.is_empty() || !field.placeholder.is_empty() || !field.title.is_empty() || !field.aria.is_empty())
    .collect()
}

fn take_input_field<'a>(ax_name: &str, fields: &'a mut [InputField]) -> Option<&'a InputField> {
  let ax = ax_name.trim();
  if ax.is_empty() || ax == "(无文案)" {
    let idx = fields.iter().position(|field| !field.used && !field.placeholder.is_empty())?;
    fields[idx].used = true;
    return Some(&fields[idx]);
  }
  let idx = fields.iter().position(|field| {
    !field.used && (field.title == ax || field.aria == ax || field.placeholder == ax)
  })?;
  fields[idx].used = true;
  Some(&fields[idx])
}

/// 无障碍名经常来自看不见的 title。框里写着的占位符才是页面上的字。
fn visible_input_name(ax_name: &str, field: &InputField) -> String {
  let ph = field.placeholder.trim();
  let ax = ax_name.trim();
  if !ph.is_empty() && ph != ax && (ax.is_empty() || ax == "(无文案)" || field.title == ax || field.aria == ax) {
    return ph.to_string();
  }
  ax.to_string()
}

fn css_attr(value: &str) -> String {
  value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn input_css(field: &InputField) -> Option<String> {
  let id = field.id.trim();
  if !id.is_empty()
    && id.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
    && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')
  {
    return Some(format!("#{id}"));
  }
  if !id.is_empty() {
    let esc = css_attr(id);
    return Some(format!("[id=\"{esc}\"]"));
  }
  let ph = field.placeholder.trim();
  if !ph.is_empty() {
    let esc = css_attr(ph);
    return Some(format!("input[placeholder=\"{esc}\"],textarea[placeholder=\"{esc}\"]"));
  }
  let name = field.name.trim();
  if !name.is_empty() {
    let esc = css_attr(name);
    return Some(format!("input[name=\"{esc}\"],textarea[name=\"{esc}\"]"));
  }
  None
}

fn rewrite_textbox_refs(refs: &mut [Value], raw_fields: &Value) {
  let mut fields = input_fields_of(raw_fields);
  for node in refs.iter_mut() {
    let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("");
    if !matches!(role, "textbox" | "searchbox") {
      continue;
    }
    let ax = node.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let Some(field) = take_input_field(&ax, &mut fields) else {
      continue;
    };
    let show = visible_input_name(&ax, field);
    let Some(css) = input_css(field) else {
      continue;
    };
    let backend = node.pointer("/locator/backend").and_then(Value::as_i64).unwrap_or(0);
    if let Some(obj) = node.as_object_mut() {
      obj.insert("name".into(), json!(show));
      obj.insert("locator".into(), json!({ "by": "css", "value": css, "name": show }));
      if backend > 0 {
        if let Some(locator) = obj.get_mut("locator") { locator["backend"] = json!(backend); }
      }
    }
  }
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

/// 超长标题截断保留。整条丢掉时，章节名超过 96 字就从快照里消失。
fn clip_ax_name(role: &str, raw_in: &str) -> Option<String> {
  let raw = raw_in.trim();
  let max_len = if matches!(role, "treeitem" | "listitem" | "option") {
    120
  } else {
    96
  };
  if raw.is_empty() {
    if role == "video" {
      return Some("视频".into());
    }
    if role == "audio" {
      return Some("音频".into());
    }
    if !matches!(role, "button" | "link" | "textbox" | "tab" | "checkbox") {
      return None;
    }
    return Some("(无文案)".into());
  }
  if raw.chars().count() > max_len {
    let keep = max_len.saturating_sub(1);
    let cut: String = raw.chars().take(keep).collect();
    return Some(format!("{cut}…"));
  }
  Some(raw.to_string())
}

#[cfg(test)]
fn usable_frame_url(url: &str) -> bool {
  let u = url.trim().to_ascii_lowercase();
  !(u.is_empty() || u == "about:blank" || u.starts_with("about:") || u.starts_with("javascript:"))
}

pub struct SnapshotQuery {
  pub frame: Option<String>,
  pub max_frames: usize,
  pub acted: bool,
}

fn child_frame_cap(query: &SnapshotQuery) -> usize {
  if query.acted {
    let has = query
      .frame
      .as_deref()
      .map(|item| !item.trim().is_empty())
      .unwrap_or(false);
    if has { 1 } else { 0 }
  } else {
    query.max_frames.clamp(1, 8)
  }
}

fn frame_url_matches(url: &str, want: &str) -> bool {
  let needle = want.trim().to_ascii_lowercase();
  if needle.is_empty() {
    return false;
  }
  url.to_ascii_lowercase().contains(&needle)
}

fn ax_prop<'a>(node: &'a Value, key: &str) -> Option<&'a str> {
  let props = node.get("properties")?.as_array()?;
  for prop in props {
    if prop.get("name").and_then(|v| v.as_str()) != Some(key) {
      continue;
    }
    return prop
      .get("value")
      .and_then(|v| v.get("value"))
      .and_then(|v| v.as_str())
      .or_else(|| prop.get("value").and_then(|v| v.as_str()));
  }
  None
}

fn format_snap_line(
  indent: &str,
  role: &str,
  name: &str,
  id: &str,
  href: &str,
  media: &str,
  mark: &str,
) -> String {
  let media_bit = if media.is_empty() { String::new() } else { format!(" {media}") };
  let href_bit = if href.is_empty() { String::new() } else { format!(" {href}") };
  let mark_bit = match mark {
    "done" | "current" | "locked" => format!(" [{mark}]"),
    _ => String::new(),
  };
  format!("{indent}- {role} \"{name}\"{media_bit} [ref={id}]{href_bit}{mark_bit}")
}

fn push_named_ref(
  lines: &mut Vec<String>,
  refs: &mut Vec<Value>,
  seen: &mut HashSet<String>,
  role: &str,
  name: &str,
  backend: i64,
  limit: usize,
  url: &str,
  media: &str,
  mark: &str,
  nth: i64,
) {
  if refs.len() >= limit {
    return;
  }
  let Some(name) = clip_ax_name(role, name) else {
    return;
  };
  // 同名按钮各记一颗。按名字去重会把五门课的「进入学习」收成一个。
  let key = if matches!(role, "video" | "audio") {
    format!("{role}:{nth}:{name}")
  } else if backend > 0 {
    format!("{role}:{backend}")
  } else {
    format!("{role}:{name}")
  };
  if !seen.insert(key) {
    return;
  }
  if !matches!(
    role,
    "button"
      | "link"
      | "textbox"
      | "heading"
      | "tab"
      | "checkbox"
      | "menuitem"
      | "listitem"
      | "treeitem"
      | "option"
      | "radio"
      | "switch"
      | "video"
      | "audio"
  ) {
    return;
  }
  let id = format!("e{}", refs.len() + 1);
  let href = if role == "link" && url.starts_with("http") { url } else { "" };
  lines.push(format_snap_line("", role, &name, &id, href, media, mark));
  let locator = if matches!(role, "video" | "audio") {
    json!({ "by": "css", "value": role, "nth": if nth > 0 { nth } else { 1 }, "name": name, "role": role })
  } else if backend > 0 {
    json!({ "by": "role", "value": role, "name": name, "exact": true, "backend": backend })
  } else if matches!(role, "textbox" | "searchbox" | "combobox") {
    json!({ "by": "role", "value": role, "name": name, "exact": true })
  } else if matches!(role, "treeitem" | "menuitem" | "tab" | "button" | "link" | "option" | "listitem") {
    json!({ "by": "role", "value": role, "name": name, "exact": true })
  } else {
    json!({ "by": "text", "value": name, "exact": true })
  };
  refs.push(json!({
    "id": id,
    "role": role,
    "name": name,
    "mark": mark,
    "media": media,
    "locator": locator,
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
    if node["ignored"].as_bool() == Some(true) { continue; }
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
    let backend = node.get("backendDOMNodeId").and_then(|v| v.as_i64()).unwrap_or(0);
    let url = ax_prop(node, "url").unwrap_or("");
    let before = refs.len();
    push_named_ref(lines, refs, seen, role, &name, backend, limit, url, "", "", 0);
    if refs.len() > before {
      if let Some(out) = refs.last_mut().and_then(Value::as_object_mut) {
        if let Some(props) = node["properties"].as_array() {
          for prop in props {
            let key = prop["name"].as_str().unwrap_or("");
            if matches!(key, "checked" | "disabled") {
              let value = &prop["value"]["value"];
              if value.is_boolean() { out.insert(key.into(), value.clone()); }
              else if value == "true" || value == "false" { out.insert(key.into(), json!(value == "true")); }
            }
          }
        }
      }
    }
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
    let media = node.get("media").and_then(|v| v.as_str()).unwrap_or("");
    let mark = node.get("mark").and_then(|v| v.as_str()).unwrap_or("");
    let nth = node.get("nth").and_then(|v| v.as_i64()).unwrap_or(0);
    if refs.iter().any(|r| r["role"] == role && r["name"] == name && r["locator"]["backend"].as_i64().unwrap_or(0) > 0) { continue; }
    if let Some(selector) = node.pointer("/locator/value").and_then(Value::as_str).filter(|s| !s.is_empty()) {
      if refs.len() >= limit || !seen.insert(format!("dom:{selector}")) { continue; }
      let mut row = node.clone();
      row["id"] = json!(format!("e{}", refs.len() + 1));
      refs.push(row);
    } else {
      push_named_ref(lines, refs, seen, role, name, 0, limit, "", media, mark, nth);
    }
  }
}

async fn ax_of(conn: &CdpConn, session: Option<&str>, frame_id: &str) -> Vec<Value> {
  let params = if frame_id.is_empty() {
    json!({})
  } else {
    json!({ "frameId": frame_id })
  };
  let tree = conn
    .call("Accessibility.getFullAXTree", params, session)
    .await
    .unwrap_or(json!({}));
  tree.get("nodes").and_then(|v| v.as_array()).cloned().unwrap_or_default()
}

fn frame_snap_priority(url: &str, ref_count: usize) -> i32 {
  let u = url.trim().to_ascii_lowercase();
  if u.is_empty() || u == "about:blank" || u.starts_with("about:") {
    return 0;
  }
  10 + ref_count as i32
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

async fn collect_frame_snap(
  conn: &CdpConn,
  session: Option<&str>,
  url_hint: &str,
  limit: usize,
  top: bool,
  context: Option<&crate::cef::frames::FrameContext>,
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
  push_ax_nodes(&ax_of(conn, session, context.map(|f| f.id.as_str()).unwrap_or("")).await, &mut lines, &mut refs, &mut seen, limit);
  if let Ok(dom) = conn.evaluate(COLLECT_DOM, session).await {
    push_dom_nodes(&dom, &mut lines, &mut refs, &mut seen, limit);
  }
  if let Ok(fields) = conn.evaluate(INPUT_FIELDS, session).await {
    rewrite_textbox_refs(&mut refs, &fields);
  }
  let priority = frame_snap_priority(&url, refs.len());
  FrameSnap {
    url,
    path: String::new(),
    label: String::new(),
    lines,
    refs,
    priority,
    top,
    cross: false,
    identity: context.cloned(),
  }
}

fn content_rank(node: &Value) -> i32 {
  let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("");
  let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("");
  if matches!(role, "video" | "audio") {
    return -1;
  }
  if matches!(role, "treeitem" | "listitem" | "option" | "row") {
    return 0;
  }
  if matches!(role, "textbox" | "searchbox" | "combobox") {
    return 1;
  }
  if name.contains("ICP") || name.contains("版权") || name.contains("联系我们") || name.contains("备案") {
    return 9;
  }
  if matches!(role, "button" | "tab" | "menuitem") {
    return 2;
  }
  5
}

/// 名额不够时先留目录行，页脚链接往后排。返回省略的 treeitem 数。
fn prefer_content_refs(refs: &[Value], limit: usize) -> (Vec<Value>, usize) {
  let tree_total = refs
    .iter()
    .filter(|node| node.get("role").and_then(|v| v.as_str()) == Some("treeitem"))
    .count();
  let mut indexed: Vec<(i32, usize, Value)> = refs
    .iter()
    .cloned()
    .enumerate()
    .map(|(index, node)| (content_rank(&node), index, node))
    .collect();
  indexed.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
  let taken: Vec<Value> = indexed.into_iter().take(limit).map(|(_, _, node)| node).collect();
  let tree_taken = taken
    .iter()
    .filter(|node| node.get("role").and_then(|v| v.as_str()) == Some("treeitem"))
    .count();
  (taken, tree_total.saturating_sub(tree_taken))
}

/// 顶层最多占一半名额，剩下的按框轮流取，避免目录把视频框挤掉。
fn take_counts(lengths: &[usize], top_index: usize, limit: usize) -> Vec<usize> {
  let mut counts = vec![0usize; lengths.len()];
  let has_child = lengths.iter().enumerate().any(|(index, _)| index != top_index);
  let top_cap = if has_child { limit / 2 } else { limit };
  let top_len = lengths.get(top_index).copied().unwrap_or(0);
  if top_index < counts.len() {
    counts[top_index] = top_len.min(top_cap).min(limit);
  }
  let mut rest = limit.saturating_sub(counts.get(top_index).copied().unwrap_or(0));
  let mut cursors = vec![0usize; lengths.len()];
  while rest > 0 {
    let mut progressed = false;
    for index in 0..lengths.len() {
      if index == top_index || rest == 0 {
        continue;
      }
      if cursors[index] < lengths[index] {
        cursors[index] += 1;
        counts[index] += 1;
        rest -= 1;
        progressed = true;
      }
    }
    if !progressed {
      break;
    }
  }
  counts
}

fn snap_from_dom(path: &str, label: &str, src: &str, nodes: &Value, cross: bool) -> FrameSnap {
  let mut lines = Vec::new();
  let mut refs = Vec::new();
  if !cross {
    let mut seen = HashSet::new();
    push_dom_nodes(nodes, &mut lines, &mut refs, &mut seen, 110);
  }
  let count = if cross { 0 } else { refs.len() };
  FrameSnap {
    url: src.to_string(),
    path: path.to_string(),
    label: label.to_string(),
    lines,
    refs,
    priority: frame_snap_priority(src, count),
    top: false,
    cross,
    identity: None,
  }
}

fn assign_nth(nodes: &mut [Value]) {
  let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
  for (index, node) in nodes.iter().enumerate() {
    let locator = node.get("locator").cloned().unwrap_or(json!({}));
    if locator["backend"].as_i64().unwrap_or(0) > 0 { continue; }
    let by = locator.get("by").and_then(|v| v.as_str()).unwrap_or("");
    let value = locator.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let name = locator.get("name").and_then(|v| v.as_str()).unwrap_or("");
    groups.entry(format!("{by}\n{value}\n{name}")).or_default().push(index);
  }
  for indexes in groups.values() {
    if indexes.len() < 2 {
      continue;
    }
    for (nth, index) in indexes.iter().enumerate() {
      if let Some(obj) = nodes[*index].get_mut("locator").and_then(|v| v.as_object_mut()) {
        obj.insert("nth".into(), json!(nth + 1));
      }
    }
  }
}

#[cfg(test)]
fn frame_tree_rows(node: &Value, path: &str, depth: u8, out: &mut Vec<(String, String, String)>) {
  if depth as usize > crate::cef::frames::MAX_FRAME_DEPTH {
    return;
  }
  let frame = node.get("frame").unwrap_or(node);
  let id = frame.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
  let url = frame.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
  out.push((path.to_string(), id, url));
  let Some(kids) = node.get("childFrames").and_then(|v| v.as_array()) else {
    return;
  };
  for (index, kid) in kids.iter().enumerate() {
    let child = if path.is_empty() { index.to_string() } else { format!("{path}/{index}") };
    frame_tree_rows(kid, &child, depth + 1, out);
  }
}

pub async fn cdp_snapshot(_app: AppHandle, id: String, query: SnapshotQuery) -> Result<Value, String> {
  let page = bind_page(&id).await?;
  let contexts = crate::cef::frames::contexts(&page).await?;
  let metadata = page.conn.evaluate(COLLECT_FRAMES, page.session.as_deref()).await.unwrap_or(json!([]));
  let mut frames = Vec::new();
  let mut frames_capped = false;
  let mut cross_count = 0;
  let mut selected = 0;
  for context in &contexts {
    let top = context.path.is_empty();
    let meta = metadata.as_array().and_then(|rows| rows.iter().find(|row| row["path"].as_str() == Some(context.path.as_str())));
    if meta.and_then(|m| m["hidden"].as_bool()) == Some(true) { continue; }
    let label = meta.and_then(|m| m["label"].as_str()).filter(|s| !s.is_empty()).unwrap_or(&context.name);
    if !top && meta.is_none() && !crate::cef::frames::visible(&page, &contexts, context).await { continue; }
    if !top && selected >= crate::cef::frames::MAX_FRAMES { frames_capped = true; continue; }
    if !top && query.acted {
      let want = query.frame.as_deref().unwrap_or("");
      if want.is_empty() || !(want == context.id || want == context.path || want == label || frame_url_matches(&context.url, want)) { continue; }
      if selected >= 1 { frames_capped = true; continue; }
    }
    let cross = context.session != page.session;
    if !top && cross && cross_count >= child_frame_cap(&query) { frames_capped = true; continue; }
    let mut snap = if top {
      collect_frame_snap(&page.conn, context.session.as_deref(), &context.url, 220, true, Some(context)).await
    } else if let Some(meta) = meta.filter(|m| m["cross"].as_bool() != Some(true)) {
      snap_from_dom(&context.path, label, &context.url, &meta["nodes"], false)
    } else {
      // 同进程跨域和 OOPIF 都在 frame 自己的上下文读取，不从父窗口穿越 document。
      let nodes = crate::cef::frames::evaluate(&page, context, COLLECT_DOM).await.unwrap_or(json!([]));
      let mut snap = snap_from_dom(&context.path, label, &context.url, &nodes, false);
      if snap.refs.is_empty() {
        let mut seen = HashSet::new();
        push_ax_nodes(&ax_of(&page.conn, context.session.as_deref(), &context.id).await,
          &mut snap.lines, &mut snap.refs, &mut seen, 110);
      }
      snap
    };
    snap.identity = Some(context.clone());
    snap.path = context.path.clone();
    snap.label = label.to_string();
    if !top { selected += 1; }
    if cross { cross_count += 1; }
    frames.push(snap);
  }

  // 顶层先出，子框按序号。名额按框分，目录长也不会把视频框挤掉。
  let top_index = frames.iter().position(|frame| frame.top).unwrap_or(0);
  let lengths: Vec<usize> = frames.iter().map(|frame| frame.refs.len()).collect();
  let counts = take_counts(&lengths, top_index, 280);
  let mut order = Vec::new();
  if top_index < frames.len() {
    order.push(top_index);
  }
  for index in 0..frames.len() {
    if index != top_index {
      order.push(index);
    }
  }
  let mut lines = Vec::new();
  let mut refs = Vec::new();
  let mut seen = HashSet::new();
  let mut frame_out = Vec::new();
  for index in order {
    let frame = &frames[index];
    let identity = frame.identity.as_ref().map(|f| format!(" [frameId={} loaderId={}]", f.id, f.loader_id)).unwrap_or_default();
    if frame.cross {
      let label = if frame.label.is_empty() { frame.url.clone() } else { frame.label.clone() };
      lines.push(format!("- iframe \"{label}\" [frame={}]{} cross-origin", frame.path, identity));
      continue;
    }
    if frame.refs.is_empty() {
      continue;
    }
    let (mut taken, omitted_tree) = prefer_content_refs(&frame.refs, counts[index]);
    if omitted_tree > 0 {
      lines.push(format!("省略了 {omitted_tree} 个 treeitem，用 browser_find 查"));
    }
    assign_nth(&mut taken);
    let mut local_lines = Vec::new();
    if !frame.top {
      let label = if frame.label.is_empty() { frame.url.clone() } else { frame.label.clone() };
      let path = if frame.path.is_empty() { index.to_string() } else { frame.path.clone() };
      lines.push(format!("- iframe \"{label}\" [frame={path}]{identity}"));
    }
    for node in &taken {
      if refs.len() >= 280 {
        break;
      }
      let name = node.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
      let role = node.get("role").and_then(|v| v.as_str()).unwrap_or("button");
      if name.is_empty() {
        continue;
      }
      let backend = node.get("locator").and_then(|v| v.get("backend")).and_then(|v| v.as_i64()).unwrap_or(0);
      let nth = node.get("locator").and_then(|v| v.get("nth")).and_then(|v| v.as_i64()).unwrap_or(0);
      let key = format!("{index}:{role}:{name}:{nth}:{backend}");
      if !seen.insert(key) {
        continue;
      }
      // 新快照不能把旧的 e3 重新绑定到另一颗元素。
      static SNAPSHOT_REF_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
      let id = format!("e{}", SNAPSHOT_REF_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
      let indent = if frame.top { "" } else { "  " };
      let media = node.get("media").and_then(|v| v.as_str()).unwrap_or("");
      let mark = node.get("mark").and_then(|v| v.as_str()).unwrap_or("");
      let mut line = format_snap_line(indent, role, name, &id, "", media, mark);
      if node["disabled"].as_bool() == Some(true) { line.push_str(" [disabled]"); }
      if let Some(checked) = node["checked"].as_bool() { line.push_str(if checked { " [checked=true]" } else { " [checked=false]" }); }
      lines.push(line.clone());
      local_lines.push(line);
      let mut locator = node
        .get("locator")
        .cloned()
        .unwrap_or_else(|| json!({ "by": "text", "value": name, "exact": true }));
      if let Some(obj) = locator.as_object_mut() {
        if let Some(identity) = &frame.identity {
          obj.insert("frameId".into(), json!(identity.id));
          obj.insert("loaderId".into(), json!(identity.loader_id));
        }
        if !frame.top {
          if !frame.path.is_empty() {
            obj.insert("framePath".into(), json!(frame.path));
          }
          if !frame.label.is_empty() {
            obj.insert("frame".into(), json!(frame.label));
          } else if !frame.url.is_empty() {
            obj.insert("frame".into(), json!(frame.url));
          }
        }
      }
      refs.push(json!({
        "id": id,
        "role": role,
        "name": name,
        "frame": if frame.top { Value::Null } else { json!(if frame.label.is_empty() { &frame.url } else { &frame.label }) },
        "framePath": frame.path,
        "disabled": node["disabled"].as_bool().unwrap_or(false),
        "checked": node["checked"],
        "locator": locator,
      }));
    }
    frame_out.push(json!({
      "frameId": frame.identity.as_ref().map(|f| &f.id),
      "loaderId": frame.identity.as_ref().map(|f| &f.loader_id),
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
  let preferred = frame_out
    .iter()
    .max_by_key(|item| item.get("priority").and_then(|v| v.as_i64()).unwrap_or(0))
    .cloned()
    .unwrap_or(json!({}));
  Ok(json!({
    "url": top_url,
    "title": title,
    "snapshot": lines.join("\n"),
    "refs": refs,
    "captcha": false,
    "iframes": iframes,
    "frames": frame_out,
    "preferredFrame": preferred,
    "framesCapped": frames_capped,
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
  fn native_surface_fits_from_miniature_to_large_without_reflowing_renderer() {
    for (w,h) in [(134.0,75.375), (224.0,126.0), (777.0,654.0), (1280.0,800.0), (3840.0,2160.0)] {
      let (rw,rh) = renderer_stage_size();
      let scale = fit_scale(w,h);
      assert_eq!((rw,rh), (1920.0,1080.0));
      assert!(rw*scale <= w+0.001 && rh*scale <= h+0.001);
      assert!((rw*scale-w).abs() < 0.001 || (rh*scale-h).abs() < 0.001);
    }
    assert!(fit_scale(224.0,126.0) < 0.25);
  }

  #[test]
  fn native_layer_origin_does_not_add_half_a_window_when_expanded() {
    assert_eq!(
      stage_layer_origin(false, 0.0, 0.0, 960.0, 540.0, 960.0, 540.0, 0.5),
      (0.0, 0.0)
    );
    assert_eq!(
      stage_layer_origin(false, 7.0, 9.0, 1280.0, 720.0, 1280.0, 800.0, 0.5),
      (7.0, 9.0)
    );
    assert_eq!(
      stage_layer_origin(true, 0.0, 0.0, 1920.0, 1080.0, 224.0, 126.0, 224.0 / 1920.0),
      (0.0, 0.0)
    );
    let (_, y) = stage_layer_origin(true, 0.0, 0.0, 1920.0, 1080.0, 224.0, 140.0, 224.0 / 1920.0);
    assert!((y - 7.0).abs() < 0.001);
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
