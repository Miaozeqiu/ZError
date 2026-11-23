// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use std::{
  ffi::{CStr, OsStr},
  os::unix::ffi::OsStrExt,
  path::PathBuf,
};

use objc2::{
  runtime::{Bool, ProtocolObject},
  ClassType, DeclaredClass,
};
use objc2_app_kit::{NSDragOperation, NSDraggingInfo, NSPasteboard};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSString, NSURL};

use crate::DragDropEvent;

use super::WryWebView;

fn collect_paths(drag_info: &ProtocolObject<dyn NSDraggingInfo>) -> Vec<PathBuf> {
  let pasteboard = drag_info.draggingPasteboard();
  let classes = NSArray::from_slice(&[NSURL::class()]);
  let paths: Vec<_> = (unsafe { pasteboard.readObjectsForClasses_options(&classes, None) })
    .into_iter()
    .flat_map(|urls| urls.into_iter())
    .filter_map(|object| {
      let url = object.downcast::<NSURL>().ok()?;
      if !url.isFileURL() {
        return None;
      }
      let path = unsafe { CStr::from_ptr(url.fileSystemRepresentation().as_ptr()) };
      Some(PathBuf::from(OsStr::from_bytes(path.to_bytes())))
    })
    .collect();

  if paths.is_empty() {
    legacy_file_paths(&pasteboard)
  } else {
    paths
  }
}

// Some drag sources still provide only a legacy filename list.
#[allow(deprecated)]
fn legacy_file_paths(pasteboard: &NSPasteboard) -> Vec<PathBuf> {
  // SAFETY: AppKit provides this immutable pasteboard type string.
  let filename_type = unsafe { objc2_app_kit::NSFilenamesPboardType };
  let Some(paths) = pasteboard
    .propertyListForType(filename_type)
    .and_then(|paths| paths.downcast::<NSArray>().ok())
  else {
    return Vec::new();
  };

  paths
    .into_iter()
    .filter_map(|path| path.downcast::<NSString>().ok())
    .map(|path| PathBuf::from(path.to_string()))
    .collect()
}

pub(crate) fn dragging_entered(
  this: &WryWebView,
  drag_info: &ProtocolObject<dyn NSDraggingInfo>,
) -> NSDragOperation {
  let paths = collect_paths(drag_info);
  let dl: NSPoint = drag_info.draggingLocation();
  let frame: NSRect = this.frame();
  let position = (dl.x as i32, (frame.size.height - dl.y) as i32);

  let listener = &this.ivars().drag_drop_handler;
  if !listener(DragDropEvent::Enter { paths, position }) {
    // Reject the Wry file drop (invoke the OS default behaviour)
    unsafe { objc2::msg_send![super(this), draggingEntered: drag_info] }
  } else {
    NSDragOperation::Copy
  }
}

pub(crate) fn dragging_updated(
  this: &WryWebView,
  drag_info: &ProtocolObject<dyn NSDraggingInfo>,
) -> NSDragOperation {
  let dl: NSPoint = drag_info.draggingLocation();
  let frame: NSRect = this.frame();
  let position = (dl.x as i32, (frame.size.height - dl.y) as i32);

  let listener = &this.ivars().drag_drop_handler;
  if !listener(DragDropEvent::Over { position }) {
    unsafe {
      let os_operation = objc2::msg_send![super(this), draggingUpdated: drag_info];
      if os_operation == NSDragOperation::None {
        // 0 will be returned for a drop on any arbitrary location on the webview.
        // We'll override that with NSDragOperationCopy.
        NSDragOperation::Copy
      } else {
        // A different NSDragOperation is returned when a file is hovered over something like
        // a <input type="file">, so we'll make sure to preserve that behaviour.
        os_operation
      }
    }
  } else {
    NSDragOperation::Copy
  }
}

pub(crate) fn perform_drag_operation(
  this: &WryWebView,
  drag_info: &ProtocolObject<dyn NSDraggingInfo>,
) -> Bool {
  let paths = collect_paths(drag_info);
  let dl: NSPoint = drag_info.draggingLocation();
  let frame: NSRect = this.frame();
  let position = (dl.x as i32, (frame.size.height - dl.y) as i32);

  let listener = &this.ivars().drag_drop_handler;
  if !listener(DragDropEvent::Drop { paths, position }) {
    // Reject the Wry drop (invoke the OS default behaviour)
    unsafe { objc2::msg_send![super(this), performDragOperation: drag_info] }
  } else {
    Bool::YES
  }
}

pub(crate) fn dragging_exited(this: &WryWebView, drag_info: &ProtocolObject<dyn NSDraggingInfo>) {
  let listener = &this.ivars().drag_drop_handler;
  if !listener(DragDropEvent::Leave) {
    // Reject the Wry drop (invoke the OS default behaviour)
    unsafe { objc2::msg_send![super(this), draggingExited: drag_info] }
  }
}
