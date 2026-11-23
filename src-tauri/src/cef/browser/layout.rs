//! layout implementation; the parent module preserves the public facade.
use super::*;

/// 取能把 1920x1080 整页放进洞口的缩放。小于 1 是缩小，大于 1 是放大。
pub(super) fn fit_scale(hole_w: f64, hole_h: f64) -> f64 {
  if !hole_w.is_finite() || !hole_h.is_finite() || hole_w < 1.0 || hole_h < 1.0 {
    return 1.0;
  }
  (hole_w / PAGE_W).min(hole_h / PAGE_H)
}

pub(super) fn stage_points(hole_w: f64, hole_h: f64) -> (f64, f64) {
  let s = fit_scale(hole_w, hole_h);
  (
    (PAGE_W * s).floor().min(hole_w.floor()).max(1.0),
    (PAGE_H * s).floor().min(hole_h.floor()).max(1.0),
  )
}

pub(super) fn page_fit(w: f64, h: f64) -> f64 {
  (w / PAGE_W).min(h / PAGE_H)
}

pub(super) fn renderer_size(hole: NSSize, preview: bool, live_resize: bool, expanded: Option<(f64, f64)>, current: (f64, f64)) -> (f64, f64) {
  if live_resize {
    current
  } else if preview {
    expanded.map(|(width, height)| stage_points(width, height)).unwrap_or(current)
  } else {
    stage_points(hole.width, hole.height)
  }
}

pub(super) fn remove_wrapper(wrapper: ViewPtr) {
  unsafe {
    (*wrapper_view(wrapper)).removeFromSuperview();
    drop(Retained::from_raw(wrapper.0 as *mut NSView));
  }
}

pub(super) fn parent_nsview(window: &tauri::Window) -> Result<*mut c_void, String> {
  match window.window_handle().map_err(|e| e.to_string())?.as_raw() {
    RawWindowHandle::AppKit(handle) => Ok(handle.ns_view.as_ptr()),
    _ => Err("主窗口不是 AppKit".into()),
  }
}

pub(super) fn hole_size_tick(view: &ZeCefHoleView) {
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
  view.ivars().ticking.set(false);
  if changed && !view.ivars().stage.get().0.is_null() {
    update_hole_presentation(view);
  }
}

pub(super) fn update_hole_presentation(view: &ZeCefHoleView) {
  if !view.ivars().live_resize.get() {
    schedule_hole_layout(view);
  } else if !view.isHidden() {
    // AppKit 已经更新了洞口。拖动时只改图层，不修改 CEF 子视图或页面 zoom。
    present_hole_stage(view.ivars(), view.bounds().size, true);
  }
}

pub(super) fn present_hole_stage(iv: &ZeCefHoleIvars, hole: NSSize, scaled: bool) {
  let (w, h) = (iv.stage_w.get(), iv.stage_h.get());
  let layer_fit = if scaled { (hole.width / w).min(hole.height / h) } else { 1.0 };
  iv.fit.set(page_fit(w, h) * layer_fit);
  present_stage_layer(iv.stage.get(), scaled, hole.width, hole.height, layer_fit);
}

pub(super) fn schedule_hole_layout(view: &ZeCefHoleView) {
  if view.ivars().pending.replace(true) {
    return;
  }
  // 下一圈再改 CEF 子视图，避免和 AppKit 布局重入。
  // 拖窗口时 RunLoop 在事件跟踪模式，默认模式的 afterDelay 要等松手才跑。
  // CommonModes 同时覆盖默认模式和拖动模式，所以缩放能跟着边沿走。
  unsafe {
    let modes = NSArray::arrayWithObject(NSRunLoopCommonModes);
    let _: () = msg_send![
      view,
      performSelector: sel!(zeFlushLayout),
      withObject: std::ptr::null::<objc2::runtime::AnyObject>(),
      afterDelay: 0.0f64,
      inModes: &*modes,
    ];
  }
}

pub(super) fn bind_hole_browser(ptr: ViewPtr, bid: i32) {
  if ptr.0.is_null() || bid <= 0 {
    return;
  }
  unsafe {
    (*(ptr.0 as *const ZeCefHoleView)).ivars().browser_id.set(bid);
  }
}

pub(super) fn is_view_descendant(owner: &objc2::runtime::AnyObject, view: &NSView) -> bool {
  let is_view: bool = unsafe { msg_send![owner, isKindOfClass: objc2::class!(NSView)] };
  is_view && unsafe { (&*(owner as *const _ as *const NSView)).isDescendantOf(view) }
}

pub(super) fn native_tracking_event_targets_view(event: &objc2_app_kit::NSEvent, view: &NSView) -> bool {
  use objc2_app_kit::NSEventType;
  matches!(event.r#type(), NSEventType::MouseEntered | NSEventType::MouseExited | NSEventType::CursorUpdate)
    && event.trackingArea().and_then(|area| area.owner()).is_some_and(|owner| is_view_descendant(&owner, view))
}

// AppKit 本地事件在发送给 CEF 子视图之前到达；CDP 的 Input.* 不经过这里。
pub(crate) fn native_event_targets_view(event: &objc2_app_kit::NSEvent, view: &NSView) -> bool {
  use objc2_app_kit::NSEventType;
  let Some(mtm) = MainThreadMarker::new() else { return false };
  let Some(window) = event.window(mtm) else { return false };
  if view.window().map(|window| window.windowNumber()) != Some(window.windowNumber()) { return false; }
  if matches!(event.r#type(), NSEventType::KeyDown | NSEventType::KeyUp | NSEventType::FlagsChanged) {
    return window.firstResponder().is_some_and(|responder| is_view_descendant(&responder, view));
  }
  let point = view.convertPoint_fromView(event.locationInWindow(), None);
  let bounds = view.bounds();
  if point.x >= bounds.origin.x && point.y >= bounds.origin.y
    && point.x < bounds.origin.x + bounds.size.width && point.y < bounds.origin.y + bounds.size.height { return true; }
  native_tracking_event_targets_view(event, view)
}

pub(crate) fn install_user_input_monitor() {
  use objc2_app_kit::{NSEvent, NSEventMask};
  use std::ptr::NonNull;
  static INSTALLED: AtomicBool = AtomicBool::new(false);
  if INSTALLED.swap(true, Ordering::SeqCst) { return; }
  let mask = NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown
    | NSEventMask::LeftMouseUp | NSEventMask::RightMouseUp | NSEventMask::OtherMouseUp
    | NSEventMask::LeftMouseDragged | NSEventMask::RightMouseDragged | NSEventMask::OtherMouseDragged
    | NSEventMask::MouseMoved | NSEventMask::MouseEntered | NSEventMask::MouseExited | NSEventMask::CursorUpdate
    | NSEventMask::ScrollWheel | NSEventMask::KeyDown | NSEventMask::KeyUp | NSEventMask::FlagsChanged
    | NSEventMask::Gesture | NSEventMask::Magnify | NSEventMask::Swipe | NSEventMask::Rotate
    | NSEventMask::BeginGesture | NSEventMask::EndGesture | NSEventMask::SmartMagnify
    | NSEventMask::Pressure | NSEventMask::TabletPoint | NSEventMask::TabletProximity | NSEventMask::DirectTouch;
  let block = block2::RcBlock::new(move |raw: NonNull<NSEvent>| -> *mut NSEvent {
    let event = unsafe { raw.as_ref() };
    let target = (|| {
      let reg = registry().lock().ok()?;
      for tab in reg.tabs.values() {
        if tab.hidden || tab.wrapper.0.is_null() { continue; }
        let view = unsafe { &*wrapper_view(tab.wrapper) };
        if unsafe { (*(tab.wrapper.0 as *const ZeCefHoleView)).ivars().preview.get() } {
          // CEF tracking areas can receive exit events even when the preview's
          // hit test lets the click through to the WKWebView underneath.
          if native_tracking_event_targets_view(event, view) { return Some((tab.id.clone(), true)); }
          continue;
        }
        if native_event_targets_view(event, view) { return Some((tab.id.clone(), false)); }
      }
      None
    })().or_else(|| crate::app_browser::fallback_user_input_target(event).map(|id| (id, false)));
    if let Some((id, preview_tracking)) = target {
      if preview_tracking || !crate::browser_control::user_input_allowed(&id) { return std::ptr::null_mut(); }
    }
    raw.as_ptr()
  });
  let token = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block) };
  if let Some(token) = token { let _ = Retained::into_raw(token); } else { INSTALLED.store(false, Ordering::SeqCst); }
}

pub(super) fn create_wrapper(parent_ptr: *mut c_void, id: &str, x: f64, y: f64, w: f64, h: f64, hidden: bool) -> Result<WrapperViews, String> {
  install_user_input_monitor();
  unsafe {
    let parent = &*(parent_ptr as *const NSView);
    let frame = frame_in_parent(parent, x, y, w, h);
    let mtm = MainThreadMarker::new().ok_or_else(|| "必须在主线程创建浏览区".to_string())?;
    let view = ZeCefHoleView::create(mtm, frame, id.to_string());
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

pub(super) fn wrapper_view(ptr: ViewPtr) -> *const NSView {
  ptr.0 as *const NSView
}

pub(super) fn stretch_mask() -> NSAutoresizingMaskOptions {
  NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable
}

pub(super) fn apply_stretch_mask(view: &NSView) {
  view.setAutoresizingMask(stretch_mask());
}

pub(super) fn stretch_wrapper_children(hole: ViewPtr, stage: ViewPtr) {
  unsafe {
    let view = &*wrapper_view(hole);
    apply_stretch_mask(view);
    view.setClipsToBounds(true);
    fit_hole_scroll(hole);
    fit_stage_children(stage);
  }
}

/// 只把滚动视图拉满洞口。播放器浮层也挂在洞口上，不能一起被拉大。
pub(super) fn fit_hole_scroll(ptr: ViewPtr) {
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

pub(super) fn fit_stage_children(stage: ViewPtr) {
  if stage.0.is_null() {
    return;
  }
  unsafe {
    fit_cef_children(&*wrapper_view(stage));
  }
}

pub(super) fn fit_cef_children(view: &NSView) {
  let inner = view.bounds();
  for sub in view.subviews() {
    apply_stretch_mask(&sub);
    if !frames_close(sub.frame(), inner) {
      sub.setFrame(inner);
    }
  }
}

pub(super) fn resize_stage(stage: ViewPtr, w: f64, h: f64) {
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
pub(super) fn present_stage_layer(stage: ViewPtr, scaled: bool, width: f64, height: f64, fit: f64) {
  if stage.0.is_null() {
    return;
  }
  unsafe {
    let view = &*wrapper_view(stage);
    if !view.wantsLayer() { view.setWantsLayer(true); }
    if let Some(layer) = view.layer() {
      CATransaction::begin();
      CATransaction::setDisableActions(true);
      // NSView-backed layers default to a top-left (0,0) anchor, not CALayer's
      // usual (0.5,0.5). Keep the anchor explicit in both presentation modes.
      layer.setAnchorPoint(NSPoint::new(0.0, 0.0));
      let scale = NSNumber::numberWithDouble(if scaled { fit } else { 1.0 });
      let _: () = msg_send![&*layer,setValue:&*scale,forKeyPath:ns_string!("transform.scale")];
      let f = view.frame();
      let clip_origin = view.superview().map(|clip| clip.bounds().origin).unwrap_or(f.origin);
      let (x, y) = stage_layer_origin(
        scaled,
        f.origin,
        clip_origin,
        f.size.width,
        f.size.height,
        width,
        height,
        fit,
      );
      layer.setPosition(NSPoint::new(x, y));
      CATransaction::commit();
    }
  }
}

pub(super) fn stage_layer_origin(
  scaled: bool,
  frame_origin: NSPoint,
  clip_origin: NSPoint,
  w: f64,
  h: f64,
  hole_w: f64,
  hole_h: f64,
  fit: f64,
) -> (f64, f64) {
  if scaled {
    (clip_origin.x + (hole_w - w * fit) / 2.0, clip_origin.y + (hole_h - h * fit) / 2.0)
  } else {
    (frame_origin.x, frame_origin.y)
  }
}

pub(super) fn recenter_stage(stage: &NSView) {
  let Some(clip) = (unsafe { stage.superview() }) else { return };
  let origin = clip.bounds().origin;
  let _: () = unsafe { msg_send![&*clip, scrollToPoint: origin] };
}

pub(super) fn frames_close(a: NSRect, b: NSRect) -> bool {
  (a.origin.x - b.origin.x).abs() < 0.5
    && (a.origin.y - b.origin.y).abs() < 0.5
    && (a.size.width - b.size.width).abs() < 0.5
    && (a.size.height - b.size.height).abs() < 0.5
}

pub(super) fn wrapper_in_live_resize(ptr: ViewPtr) -> bool {
  unsafe {
    let view = &*wrapper_view(ptr);
    view.window().is_some_and(|w| w.inLiveResize())
  }
}

/// `raise=true` 时才重排 z-order；拖窗口改尺寸时不要 addSubview，否则会卡。
pub(super) fn apply_wrapper_bounds_ex(ptr: ViewPtr, x: f64, y: f64, w: f64, h: f64, raise: bool) {
  unsafe {
    let view = &*wrapper_view(ptr);
    view.setClipsToBounds(true);
    apply_stretch_mask(view);
    if let Some(parent) = view.superview() {
      // 拖窗口：autoresizing 已经在跟手改真实尺寸。JS 坐标慢一拍，套上去会来回拽。
      let layout = (*(ptr.0 as *const ZeCefHoleView)).ivars().layout.get();
      if !raise && layout.is_none() && wrapper_in_live_resize(ptr) {
        return;
      }
      // JS 的测量可能比原生窗口旧一帧；有锚点规则时按当前窗口尺寸重新计算。
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

pub(super) fn set_wrapper_hidden(ptr: ViewPtr, hidden: bool) {
  unsafe {
    let view = &*wrapper_view(ptr);
    view.setHidden(hidden);
    if !hidden {
      let hole = &*(ptr.0 as *const ZeCefHoleView);
      schedule_hole_layout(hole);
    }
    // 切走浏览页只藏起来，z-order 还在最上面。回来时不要 addSubview，否则整窗会卡一下。
  }
}
