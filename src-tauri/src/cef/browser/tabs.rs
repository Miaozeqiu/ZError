//! tabs implementation; the parent module preserves the public facade.
use super::*;

pub(super) fn parent_window(app: &AppHandle) -> Result<tauri::Window, String> {
  app
    .get_webview("main")
    .map(|w| w.window())
    .ok_or_else(|| "主窗口不存在".into())
}

pub(super) fn on_main<T: Send + 'static>(app: &AppHandle, job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
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

pub(super) fn hide_other(keep: &str) {
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
    crate::browser_theme::apply_cef();
    let window = parent_window(&app2)?;
    let parent = parent_nsview(&window)?;
    if !hidden {
      hide_other(&id2);
    }
    let views = create_wrapper(parent, &id, x, y, width, height, hidden)?;
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
          locator_boxes: Default::default(),
          close_waiters: Vec::new(),
          target_id: String::new(),
          url: target.clone(),
          title: String::new(),
          hidden,
          zoom: 1.0,
          audio_muted: true,
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
      if let Ok(mut reg) = registry().lock() {
        reg.tabs.remove(&id2);
      }
      remove_wrapper(views.hole);
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

pub(super) fn show_at(app: &AppHandle, id: &str, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
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
    // 尺寸变化由 setFrameSize 排到下一圈刷新舞台；CEF 子视图接收 AppKit 原生尺寸变化。
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
  on_main(&app, move || {
    let Some(wrapper) = (|| {
      let reg = registry().lock().ok()?;
      let tab = reg.tabs.get(&id)?;
      Some(tab.wrapper)
    })() else {
      return Ok(());
    };
    let hole = unsafe { &*(wrapper.0 as *const ZeCefHoleView) };
    let previous_preview = hole.ivars().preview.get();
    if previous_preview != preview { hole.ivars().presentation_dirty.set(true); }
    hole.ivars().preview.set(preview);
    hole.ivars().preview_renderer_size.set(layout.and_then(|rule| rule.preview?.renderer_size()));
    hole.ivars().layout.set(
      layout.and_then(|rule| AnchoredBrowserGeometry::new(rule, x, y, width, height)),
    );
    // A hidden caret must not keep accepting keyboard input after collapse.
    if preview && !previous_preview { clear_focus_in_hole(hole); }
    // 在 registry 锁之外调整视图。
    // 下一圈统一更新舞台/图层，禁止在 setFrameSize 回调里同步刷新 Chromium。
    apply_wrapper_bounds_ex(wrapper, x, y, width, height, false);
    if !hole.ivars().live_resize.get() || preview != previous_preview {
      update_hole_presentation(hole);
    }
    // 位置同步不能唤醒已收起的网页，显示由 browser_show 单独控制。
    Ok(())
  })?
}

pub fn show(app: AppHandle, id: String) -> Result<(), String> {
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

pub async fn close(app: AppHandle, id: String) -> Result<(), String> {
  let closed = on_main(&app, move || -> Result<_, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let (browser_id, first_close) = {
      let mut reg = registry().lock().map_err(|_| "浏览器注册表不可用".to_string())?;
      let Some(tab) = reg.tabs.get_mut(&id) else { return Ok(None) };
      let first_close = tab.close_waiters.is_empty();
      tab.close_waiters.push(sender);
      set_wrapper_hidden(tab.wrapper, true);
      tab.hidden = true;
      (tab.browser_id, first_close)
    };
    // 尚未完成创建的实例由 on_after_created 负责关闭。
    if first_close && browser_id != 0 {
      if let Some(host) = browser_by_id(browser_id).and_then(|browser| browser.host()) {
        host.close_browser(1);
      }
    }
    Ok(Some(receiver))
  })??;
  if let Some(closed) = closed {
    tokio::time::timeout(Duration::from_secs(8), closed).await
      .map_err(|_| "关闭 CEF 浏览器超时".to_string())?
      .map_err(|_| "浏览器关闭回调未完成".to_string())?;
  }
  Ok(())
}

pub(super) fn navigate_tab(id: &str, url: &str) {
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

pub(super) fn browser_by_id(id: i32) -> Option<Browser> {
  browser_host_get_browser_by_identifier(id)
}

pub async fn navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
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

pub(super) fn scale_to_zoom_level(scale: f64) -> f64 {
  // 下限留给「窗口缩小后的整页适配」。用户缩放本身仍在 set_zoom 里限制在 0.25–5 倍。
  let scale = if scale.is_finite() { scale.clamp(0.05, 16.0) } else { 1.0 };
  if (scale - 1.0).abs() < 0.001 {
    0.0
  } else {
    scale.ln() / 1.2_f64.ln()
  }
}

pub(super) fn apply_browser_zoom(browser_id: i32, scale: f64) {
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
    let mut reg = registry().lock().map_err(|_| "浏览器状态不可用".to_string())?;
    let tab = reg.tabs.get_mut(&id).ok_or_else(|| "浏览器标签页不存在".to_string())?;
    let bid = tab.browser_id;
    if bid == 0 {
      tab.audio_muted = muted;
      return Ok(());
    }
    let browser = browser_by_id(bid).ok_or_else(|| "浏览器尚未就绪".to_string())?;
    let host = browser.host().ok_or_else(|| "浏览器音频控制不可用".to_string())?;
    tab.audio_muted = muted;
    drop(reg);
    host.set_audio_muted(i32::from(muted));
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
