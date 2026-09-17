//! 开源 CEF 解不了 H.264。学习通页面仍在 CEF，画面交给系统 AVPlayer。
#![cfg(target_os = "macos")]

use crate::cef_browser;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, MainThreadMarker};
use objc2_app_kit::NSView;
use objc2_av_foundation::AVPlayer;
use objc2_av_kit::{AVPlayerView, AVPlayerViewControlsStyle};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL};
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

const LOCATE: &str = r#"(function(){
  function unwrap(u){
    u = String(u || '');
    if (!u) return '';
    try {
      var loc = new URL(u, location.href);
      if (loc.hostname === '127.0.0.1' && /1430/.test(loc.port || '')) {
        return decodeURIComponent(loc.searchParams.get('u') || '') || u;
      }
    } catch (e) {}
    return u;
  }
  function looksVideo(u){
    return /^https?:/i.test(u) && /mp4|m3u8|mpegurl|cldisk|ananas|aliyun|chaoxing|noteynb|myqcloud/i.test(u);
  }
  function pickUrl(doc){
    var v = doc.querySelector('video');
    if (v) {
      var s = unwrap(v.currentSrc || v.src || '');
      if (looksVideo(s)) return s;
    }
    var att = null;
    try { att = doc.defaultView && doc.defaultView.AttachmentSetting; } catch (e) {}
    if (att && att.attachments) {
      for (var i = 0; i < att.attachments.length; i++) {
        var a = att.attachments[i] || {};
        var p = a.property || {};
        var cands = [p.httphd, p.http, p.https, p.hd, p.sd, a.objectId];
        for (var j = 0; j < cands.length; j++) {
          var c = unwrap(String(cands[j] || ''));
          if (looksVideo(c)) return c;
        }
      }
    }
    return '';
  }
  function frameDocs(doc, ox, oy, depth){
    var out = [{ doc: doc, ox: ox || 0, oy: oy || 0 }];
    if ((depth || 0) > 6 || !doc) return out;
    var list = doc.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      var child = null;
      try { child = list[i].contentDocument; } catch (e) {}
      var r = list[i].getBoundingClientRect();
      if (child) out = out.concat(frameDocs(child, ox + r.left, oy + r.top, (depth || 0) + 1));
    }
    return out;
  }
  function mask(doc){
    var v = doc.querySelector('video');
    if (v) {
      try { v.muted = true; } catch (e) {}
      v.style.opacity = '0';
    }
    var nodes = doc.querySelectorAll('.vjs-error-display, .vjs-modal-dialog');
    for (var i = 0; i < nodes.length; i++) nodes[i].style.display = 'none';
  }
  if (window.top !== window) return { found: false, frameLocal: true };
  var frames = frameDocs(document, 0, 0, 0);
  var best = null;
  var bestScore = -1;
  var viewH = window.innerHeight || 0;
  for (var f = 0; f < frames.length; f++) {
    var v = frames[f].doc.querySelector('video');
    if (!v) continue;
    var src = pickUrl(frames[f].doc);
    if (!src) continue;
    mask(frames[f].doc);
    var el = frames[f].doc.querySelector('.video-js') || v;
    var r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 60) continue;
    var top = frames[f].oy + r.top;
    var vis = Math.max(0, Math.min(top + r.height, viewH) - Math.max(top, 0));
    var score = vis * 1000 + r.width * r.height;
    if (score > bestScore) {
      bestScore = score;
      best = {
        found: true,
        x: frames[f].ox + r.left,
        y: top,
        width: r.width,
        height: r.height,
        src: src,
        duration: Number(v.duration) || 0,
        current: Number(v.currentTime) || 0
      };
    }
  }
  return best || { found: false };
})()"#;

#[derive(Clone, Copy)]
struct ViewPtr(*mut c_void);
unsafe impl Send for ViewPtr {}
unsafe impl Sync for ViewPtr {}

struct Overlay {
  view: ViewPtr,
  player: ViewPtr,
  url: String,
}

struct Registry {
  tabs: HashMap<String, Overlay>,
}

fn registry() -> &'static Mutex<Registry> {
  static REG: OnceLock<Mutex<Registry>> = OnceLock::new();
  REG.get_or_init(|| Mutex::new(Registry { tabs: HashMap::new() }))
}

#[derive(Serialize)]
pub struct OverlayState {
  pub found: bool,
  pub active: bool,
  pub url: String,
  pub current: f64,
  pub duration: f64,
  pub playing: bool,
  pub ended: bool,
}

fn empty_state() -> OverlayState {
  OverlayState {
    found: false,
    active: false,
    url: String::new(),
    current: 0.0,
    duration: 0.0,
    playing: false,
    ended: false,
  }
}

fn on_main<T: Send + 'static>(app: &AppHandle, job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
  let (tx, rx) = std::sync::mpsc::channel();
  app
    .run_on_main_thread(move || {
      let _ = tx.send(job());
    })
    .map_err(|e| e.to_string())?;
  rx.recv().map_err(|e| e.to_string())
}

fn player_ref(ptr: ViewPtr) -> *const AVPlayer {
  ptr.0 as *const AVPlayer
}

fn player_seconds(player: &AVPlayer, duration: bool) -> f64 {
  unsafe {
    if duration {
      let item: *mut AnyObject = msg_send![player, currentItem];
      if item.is_null() {
        return 0.0;
      }
      return cm_seconds(msg_send![item, duration]);
    }
    cm_seconds(player.currentTime())
  }
}

fn cm_seconds(t: objc2_core_media::CMTime) -> f64 {
  if t.timescale == 0 {
    return 0.0;
  }
  t.value as f64 / f64::from(t.timescale)
}

fn make_player(url: &str, _cookie: &str, mtm: MainThreadMarker) -> Result<Retained<AVPlayer>, String> {
  let nsurl = NSURL::URLWithString(&NSString::from_str(url)).ok_or_else(|| "视频地址无效".to_string())?;
  Ok(unsafe { AVPlayer::playerWithURL(&nsurl, mtm) })
}

fn apply_frame(view: &NSView, x: f64, y: f64, w: f64, h: f64) {
  unsafe {
    if let Some(parent) = view.superview() {
      let frame = css_to_ns(&parent, x, y, w, h);
      view.setFrame(frame);
      parent.addSubview_positioned_relativeTo(view, objc2_app_kit::NSWindowOrderingMode::Above, None);
    }
  }
}

fn css_to_ns(parent: &NSView, x: f64, y: f64, width: f64, height: f64) -> NSRect {
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

fn live_state(over: &Overlay) -> OverlayState {
  let player = unsafe { &*player_ref(over.player) };
  let duration = player_seconds(player, true);
  let current = player_seconds(player, false);
  let playing = unsafe { player.rate() } > 0.01;
  OverlayState {
    found: true,
    active: true,
    url: over.url.clone(),
    current,
    duration,
    playing,
    ended: duration > 1.0 && current >= duration - 0.4,
  }
}

fn destroy_unlocked(reg: &mut Registry, id: &str) {
  if let Some(over) = reg.tabs.remove(id) {
    unsafe {
      let view = &*(over.view.0 as *const NSView);
      view.removeFromSuperview();
      let _ = Retained::from_raw(over.view.0 as *mut NSView);
      let _ = Retained::from_raw(over.player.0 as *mut AVPlayer);
    }
  }
}

pub fn raise_tab(app: &AppHandle, id: &str) {
  let id = id.to_string();
  let _ = on_main(app, move || {
    if let Ok(reg) = registry().lock() {
      if let Some(over) = reg.tabs.get(&id) {
        unsafe {
          let view = &*(over.view.0 as *const NSView);
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
  });
}

pub fn hide_tab(app: &AppHandle, id: &str) {
  let id = id.to_string();
  let _ = on_main(app, move || {
    if let Ok(mut reg) = registry().lock() {
      destroy_unlocked(&mut reg, &id);
    }
  });
}

pub fn hide_all(app: &AppHandle) {
  let _ = on_main(app, || {
    if let Ok(mut reg) = registry().lock() {
      let ids: Vec<String> = reg.tabs.keys().cloned().collect();
      for id in ids {
        destroy_unlocked(&mut reg, &id);
      }
    }
  });
}

pub fn hide_others(app: &AppHandle, keep: &str) {
  let keep = keep.to_string();
  let _ = on_main(app, move || {
    if let Ok(mut reg) = registry().lock() {
      let ids: Vec<String> = reg.tabs.keys().filter(|id| *id != &keep).cloned().collect();
      for id in ids {
        destroy_unlocked(&mut reg, &id);
      }
    }
  });
}

fn sync_page_time_script(current: f64, ended: bool) -> String {
  format!(
    r#"(function(){{
  var t = {current};
  var ended = {ended};
  function apply(doc){{
    var v = doc.querySelector('video');
    if (!v) return false;
    try {{
      if (Math.abs((Number(v.currentTime) || 0) - t) > 0.4) v.currentTime = t;
      if (ended) {{
        try {{ v.dispatchEvent(new Event('ended')); }} catch (e) {{}}
      }} else {{
        v.dispatchEvent(new Event('timeupdate'));
        v.dispatchEvent(new Event('playing'));
      }}
    }} catch (e) {{}}
    return true;
  }}
  function walk(doc, depth){{
    if (!doc || depth > 6) return false;
    if (apply(doc)) return true;
    var list = doc.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {{
      try {{ if (walk(list[i].contentDocument, depth + 1)) return true; }} catch (e) {{}}
    }}
    return false;
  }}
  if (window.top !== window) return {{ ok: apply(document) }};
  return {{ ok: walk(document, 0) }};
}})()"#,
    current = current,
    ended = if ended { "true" } else { "false" }
  )
}

fn show_on_main(
  app: &AppHandle,
  id: &str,
  url: &str,
  cookie: &str,
  x: f64,
  y: f64,
  w: f64,
  h: f64,
) -> Result<OverlayState, String> {
  let id = id.to_string();
  let url = url.to_string();
  let cookie = cookie.to_string();
  let app2 = app.clone();
  on_main(app, move || -> Result<OverlayState, String> {
    let Some((host_x, host_y, _, _)) = cef_browser::tab_css_frame(&id) else {
      if let Ok(mut reg) = registry().lock() {
        destroy_unlocked(&mut reg, &id);
      }
      return Ok(empty_state());
    };
    let ox = host_x + x;
    let oy = host_y + y;
    if let Ok(mut reg) = registry().lock() {
      if let Some(over) = reg.tabs.get_mut(&id) {
        if over.url == url {
          let view = unsafe { &*(over.view.0 as *const NSView) };
          apply_frame(view, ox, oy, w, h);
          return Ok(live_state(over));
        }
        destroy_unlocked(&mut reg, &id);
      }
    }
    let window = cef_browser::parent_window_nsview(&app2)?;
    let mtm = MainThreadMarker::new().ok_or_else(|| "必须在主线程创建播放器".to_string())?;
    let player = make_player(&url, &cookie, mtm)?;
    unsafe {
      let parent = &*(window as *const NSView);
      let frame = css_to_ns(parent, ox, oy, w, h);
      let view = AVPlayerView::initWithFrame(mtm.alloc::<AVPlayerView>(), frame);
      view.setPlayer(Some(&player));
      view.setControlsStyle(AVPlayerViewControlsStyle::Inline);
      parent.addSubview_positioned_relativeTo(&view, objc2_app_kit::NSWindowOrderingMode::Above, None);
      player.play();
      let view_ptr = ViewPtr(Retained::into_raw(Retained::into_super(view)) as *mut c_void);
      let player_ptr = ViewPtr(Retained::into_raw(player) as *mut c_void);
      if let Ok(mut reg) = registry().lock() {
        reg.tabs.insert(
          id,
          Overlay {
            view: view_ptr,
            player: player_ptr,
            url: url.clone(),
          },
        );
      }
      Ok(OverlayState {
        found: true,
        active: true,
        url,
        current: 0.0,
        duration: 0.0,
        playing: true,
        ended: false,
      })
    }
  })?
}

pub async fn tick(app: AppHandle, _id: String) -> Result<OverlayState, String> {
  hide_all(&app);
  Ok(empty_state())
}

pub fn play(app: AppHandle, id: String) -> Result<OverlayState, String> {
  on_main(&app, move || {
    if let Ok(reg) = registry().lock() {
      if let Some(over) = reg.tabs.get(&id) {
        unsafe {
          (*player_ref(over.player)).play();
        }
        return Ok(live_state(over));
      }
    }
    Ok(empty_state())
  })?
}

pub fn state(app: AppHandle, id: String) -> Result<OverlayState, String> {
  on_main(&app, move || {
    if let Ok(reg) = registry().lock() {
      if let Some(over) = reg.tabs.get(&id) {
        return Ok(live_state(over));
      }
    }
    Ok(empty_state())
  })?
}

