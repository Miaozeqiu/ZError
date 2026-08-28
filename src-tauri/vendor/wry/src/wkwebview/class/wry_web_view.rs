// Copyright 2020-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{collections::HashMap, sync::Mutex};

#[cfg(target_os = "macos")]
use objc2::runtime::ProtocolObject;
use objc2::{define_class, rc::Retained, runtime::Bool, AllocAnyThread, DeclaredClass};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
  NSDraggingDestination, NSEvent, NSTrackingArea, NSTrackingAreaOptions, NSView,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect};
use objc2_foundation::{NSObjectProtocol, NSUUID};

#[cfg(target_os = "ios")]
use crate::wkwebview::ios::WKWebView::WKWebView;
#[cfg(target_os = "macos")]
use crate::{
  wkwebview::{drag_drop, synthetic_mouse_events},
  DragDropEvent,
};
#[cfg(target_os = "ios")]
use objc2_ui_kit::UIEvent as NSEvent;
#[cfg(target_os = "macos")]
use objc2_web_kit::WKWebView;

pub struct WryWebViewIvars {
  pub(crate) is_child: bool,
  #[cfg(target_os = "macos")]
  pub(crate) drag_drop_handler: Box<dyn Fn(DragDropEvent) -> bool>,
  #[cfg(target_os = "macos")]
  pub(crate) accept_first_mouse: objc2::runtime::Bool,
  #[cfg(target_os = "ios")]
  pub(crate) input_accessory_view_builder: Option<Box<crate::InputAccessoryViewBuilder>>,
  pub(crate) custom_protocol_task_ids: Mutex<HashMap<usize, Retained<NSUUID>>>,
}

define_class!(
  #[unsafe(super(WKWebView))]
  #[name = "WryWebView"]
  #[ivars = WryWebViewIvars]
  pub struct WryWebView;

  /// Overridden NSView methods.
  impl WryWebView {
    #[unsafe(method(performKeyEquivalent:))]
    fn perform_key_equivalent(&self, event: &NSEvent) -> Bool {
      // This is a temporary workaround for https://github.com/tauri-apps/tauri/issues/9426
      // FIXME: When the webview is a child webview, performKeyEquivalent always return YES
      // and stop propagating the event to the window, hence the menu shortcut won't be
      // triggered. However, overriding this method also means the cmd+key event won't be
      // handled in webview, which means the key cannot be listened by JavaScript.
      if self.ivars().is_child {
        Bool::NO
      } else {
        unsafe { objc2::msg_send![super(self), performKeyEquivalent: event] }
      }
    }

    #[cfg(target_os = "macos")]
    #[unsafe(method(acceptsFirstMouse:))]
    fn accept_first_mouse(&self, _event: &NSEvent) -> Bool {
      self.ivars().accept_first_mouse
    }

    #[cfg(target_os = "macos")]
    #[unsafe(method(viewDidEndLiveResize))]
    fn view_did_end_live_resize(&self) {
      unsafe { objc2::msg_send![super(self), viewDidEndLiveResize] }
      self.setNeedsDisplay(true);
      if let Some(layer) = self.layer() {
        layer.setNeedsDisplay();
      }
    }

    #[cfg(target_os = "ios")]
    #[unsafe(method_id(inputAccessoryView))]
    fn input_accessory_view(&self) -> Option<Retained<objc2_ui_kit::UIView>> {
      if let Some(builder) = &self.ivars().input_accessory_view_builder {
        builder(self)
      } else {
        unsafe { objc2::msg_send![super(self), inputAccessoryView] }
      }
    }
  }
  unsafe impl NSObjectProtocol for WryWebView {}

  // Drag & Drop
  #[cfg(target_os = "macos")]
  unsafe impl NSDraggingDestination for WryWebView {
    #[unsafe(method(draggingEntered:))]
    fn dragging_entered(
      &self,
      drag_info: &ProtocolObject<dyn objc2_app_kit::NSDraggingInfo>,
    ) -> objc2_app_kit::NSDragOperation {
      drag_drop::dragging_entered(self, drag_info)
    }

    #[unsafe(method(draggingUpdated:))]
    fn dragging_updated(
      &self,
      drag_info: &ProtocolObject<dyn objc2_app_kit::NSDraggingInfo>,
    ) -> objc2_app_kit::NSDragOperation {
      drag_drop::dragging_updated(self, drag_info)
    }

    #[unsafe(method(performDragOperation:))]
    fn perform_drag_operation(
      &self,
      drag_info: &ProtocolObject<dyn objc2_app_kit::NSDraggingInfo>,
    ) -> Bool {
      drag_drop::perform_drag_operation(self, drag_info)
    }

    #[unsafe(method(draggingExited:))]
    fn dragging_exited(&self, drag_info: &ProtocolObject<dyn objc2_app_kit::NSDraggingInfo>) {
      drag_drop::dragging_exited(self, drag_info)
    }
  }

  // Synthetic mouse events
  #[cfg(target_os = "macos")]
  impl WryWebView {
    #[unsafe(method(otherMouseDown:))]
    fn other_mouse_down(&self, event: &NSEvent) {
      synthetic_mouse_events::other_mouse_down(self, event)
    }

    #[unsafe(method(otherMouseUp:))]
    fn other_mouse_up(&self, event: &NSEvent) {
      synthetic_mouse_events::other_mouse_up(self, event)
    }
  }

  // Cursor updates in regions covered by a child webview.
  //
  // A child webview is a sibling view layered on top of the webview underneath it, so both
  // tracking areas cover the same pixels and both webviews receive `mouseMoved:`. Each one then
  // sets the cursor from its own hit test, and the cursor flickers between the two, e.g. between
  // `pointer` over a link in the child and `default` over the host's container.
  //
  // Only the topmost webview under the pointer should drive the cursor, so skip these events when
  // the pointer is over a child webview stacked above us.
  // See https://github.com/tauri-apps/wry/issues/1763
  #[cfg(target_os = "macos")]
  impl WryWebView {
    #[unsafe(method(mouseMoved:))]
    fn mouse_moved(&self, event: &NSEvent) {
      if self.is_covered_by_child_webview(event) {
        return;
      }
      unsafe { objc2::msg_send![super(self), mouseMoved: event] }
    }

    #[unsafe(method(cursorUpdate:))]
    fn cursor_update(&self, event: &NSEvent) {
      if self.is_covered_by_child_webview(event) {
        return;
      }
      unsafe { objc2::msg_send![super(self), cursorUpdate: event] }
    }

    #[unsafe(method(updateTrackingAreas))]
    fn update_tracking_areas(&self) {
      // Let WebKit install its own tracking areas first, then punch holes in them.
      let _: () = unsafe { objc2::msg_send![super(self), updateTrackingAreas] };
      self.exclude_child_webviews_from_mouse_tracking();
    }
  }
);

#[cfg(target_os = "macos")]
impl WryWebView {
  /// Keeps WebKit from tracking the mouse where a child webview covers this webview.
  ///
  /// WebKit drives the cursor from a tracking area owned by an internal observer, and AppKit
  /// delivers to every tracking area containing the pointer regardless of what is stacked on top.
  /// Two overlapping webviews therefore both set the cursor on each mouse move and it flickers
  /// between them. Replacing WebKit's area with the same area minus the covered rects leaves the
  /// topmost webview as the only one tracking the pointer there.
  /// See https://github.com/tauri-apps/wry/issues/1763
  fn exclude_child_webviews_from_mouse_tracking(&self) {
    let driving = NSTrackingAreaOptions::MouseMoved | NSTrackingAreaOptions::CursorUpdate;
    let mut template = None;
    let areas = self.trackingAreas();
    for area in areas.iter() {
      let options = area.options();
      if !options.contains(driving) {
        continue;
      }
      let Some(owner) = area.owner() else {
        continue;
      };
      // Ours from an earlier pass are indistinguishable from WebKit's except for the flag we
      // strip, so put it back to rebuild from a single full-size area every time.
      template = Some((owner, options | NSTrackingAreaOptions::InVisibleRect));
      self.removeTrackingArea(&area);
    }
    let Some((owner, options)) = template else {
      return;
    };

    let visible = self.visibleRect();
    let holes = self.covering_child_webview_rects();
    if holes.is_empty() {
      self.add_tracking_area(visible, options, &owner);
      return;
    }
    for piece in subtract_rects(visible, &holes) {
      self.add_tracking_area(piece, options & !NSTrackingAreaOptions::InVisibleRect, &owner);
    }
  }

  fn add_tracking_area(
    &self,
    rect: NSRect,
    options: NSTrackingAreaOptions,
    owner: &objc2::runtime::AnyObject,
  ) {
    let area = unsafe {
      NSTrackingArea::initWithRect_options_owner_userInfo(
        NSTrackingArea::alloc(),
        rect,
        options,
        Some(owner),
        None,
      )
    };
    self.addTrackingArea(&area);
  }

  /// Rects of the child webviews stacked in front of this one, in its own coordinates.
  fn covering_child_webview_rects(&self) -> Vec<NSRect> {
    let mut rects = Vec::new();
    let superview = unsafe { self.superview() };
    let Some(superview) = superview else {
      return rects;
    };
    let host_ptr: *const NSView = self as *const WryWebView as *const NSView;
    let subviews = superview.subviews();
    let mut in_front = false;
    for subview in subviews.iter() {
      let subview: &NSView = &subview;
      if std::ptr::eq(subview as *const NSView, host_ptr) {
        in_front = true;
        continue;
      }
      if !in_front || subview.isHidden() {
        continue;
      }
      if !subview.isKindOfClass(<WryWebView as objc2::ClassType>::class()) {
        continue;
      }
      // Checked above, and `WryWebView` is a plain `WKWebView` subclass.
      let webview: &WryWebView = unsafe { &*(subview as *const NSView as *const WryWebView) };
      if !webview.ivars().is_child {
        continue;
      }
      rects.push(self.convertRect_fromView(subview.bounds(), Some(subview)));
    }
    rects
  }

  /// The tracking areas of the webviews behind this one depend on where this one sits.
  pub(crate) fn refresh_covered_siblings(&self) {
    let superview = unsafe { self.superview() };
    let Some(superview) = superview else {
      return;
    };
    let host_ptr: *const NSView = self as *const WryWebView as *const NSView;
    let subviews = superview.subviews();
    for subview in subviews.iter() {
      let subview: &NSView = &subview;
      if std::ptr::eq(subview as *const NSView, host_ptr) {
        break;
      }
      if subview.isKindOfClass(<WryWebView as objc2::ClassType>::class()) {
        subview.updateTrackingAreas();
      }
    }
  }
}

/// `base` minus every rect in `holes`, as a set of non-overlapping rects.
#[cfg(target_os = "macos")]
fn subtract_rects(base: NSRect, holes: &[NSRect]) -> Vec<NSRect> {
  let mut pieces = vec![base];
  for hole in holes {
    let mut rest = Vec::with_capacity(pieces.len());
    for piece in pieces.drain(..) {
      subtract_rect(piece, *hole, &mut rest);
    }
    pieces = rest;
  }
  pieces
}

#[cfg(target_os = "macos")]
fn subtract_rect(base: NSRect, hole: NSRect, out: &mut Vec<NSRect>) {
  let (bx0, by0) = (base.origin.x, base.origin.y);
  let (bx1, by1) = (bx0 + base.size.width, by0 + base.size.height);
  let hx0 = hole.origin.x.max(bx0);
  let hy0 = hole.origin.y.max(by0);
  let hx1 = (hole.origin.x + hole.size.width).min(bx1);
  let hy1 = (hole.origin.y + hole.size.height).min(by1);
  if hx1 <= hx0 || hy1 <= hy0 {
    out.push(base);
    return;
  }
  let rect = |x: f64, y: f64, w: f64, h: f64| NSRect {
    origin: objc2_foundation::NSPoint { x, y },
    size: objc2_foundation::NSSize { width: w, height: h },
  };
  if hy0 > by0 {
    out.push(rect(bx0, by0, base.size.width, hy0 - by0));
  }
  if hy1 < by1 {
    out.push(rect(bx0, hy1, base.size.width, by1 - hy1));
  }
  if hx0 > bx0 {
    out.push(rect(bx0, hy0, hx0 - bx0, hy1 - hy0));
  }
  if hx1 < bx1 {
    out.push(rect(hx1, hy0, bx1 - hx1, hy1 - hy0));
  }
}

#[cfg(target_os = "macos")]
impl WryWebView {
  /// Whether the event happened over a child webview layered above this one.
  fn is_covered_by_child_webview(&self, event: &NSEvent) -> bool {
    covering_child_webview(self, event.locationInWindow())
  }
}

/// Whether a child webview stacked in front of `host` contains `point_in_window`.
///
/// A child webview is added as a sibling of the webview it covers, and `subviews` runs back to
/// front, so only the entries after `host` can be on top of it.
#[cfg(target_os = "macos")]
fn covering_child_webview(host: &WryWebView, point_in_window: NSPoint) -> bool {
  let superview = unsafe { host.superview() };
  let Some(superview) = superview else {
    return false;
  };
  let host_ptr: *const NSView = host as *const WryWebView as *const NSView;
  let subviews = superview.subviews();
  let mut in_front = false;
  for subview in subviews.iter() {
    let subview: &NSView = &subview;
    if std::ptr::eq(subview as *const NSView, host_ptr) {
      in_front = true;
      continue;
    }
    if !in_front || subview.isHidden() {
      continue;
    }
    if !subview.isKindOfClass(<WryWebView as objc2::ClassType>::class()) {
      continue;
    }
    // Checked above, and `WryWebView` is a plain `WKWebView` subclass.
    let webview: &WryWebView = unsafe { &*(subview as *const NSView as *const WryWebView) };
    if !webview.ivars().is_child {
      continue;
    }
    let frame = subview.convertRect_toView(subview.bounds(), None);
    let inside_x =
      point_in_window.x >= frame.origin.x && point_in_window.x < frame.origin.x + frame.size.width;
    let inside_y = point_in_window.y >= frame.origin.y
      && point_in_window.y < frame.origin.y + frame.size.height;
    if inside_x && inside_y {
      return true;
    }
  }
  false
}

// Custom Protocol Task Checker
impl WryWebView {
  pub(crate) fn add_custom_task_key(&self, task_id: usize) -> Retained<NSUUID> {
    let task_uuid = NSUUID::new();
    self
      .ivars()
      .custom_protocol_task_ids
      .lock()
      .unwrap()
      .insert(task_id, task_uuid.clone());
    task_uuid
  }
  pub(crate) fn remove_custom_task_key(&self, task_id: usize) {
    self
      .ivars()
      .custom_protocol_task_ids
      .lock()
      .unwrap()
      .remove(&task_id);
  }
  pub(crate) fn get_custom_task_uuid(&self, task_id: usize) -> Option<Retained<NSUUID>> {
    self
      .ivars()
      .custom_protocol_task_ids
      .lock()
      .unwrap()
      .get(&task_id)
      .cloned()
  }
}
