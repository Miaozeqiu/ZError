use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{
  webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
  AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use url::Url;

const LABEL_PREFIX: &str = "app-browser-";
const SAFARI_UA: &str =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

#[derive(Clone, Serialize)]
pub struct BrowserPageState {
  id: String,
  url: String,
  title: String,
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

fn is_home(raw: &str) -> bool {
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

fn parse_url(raw: &str) -> Result<Url, String> {
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

fn find_browser(app: &AppHandle, id: &str) -> Result<tauri::Webview, String> {
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

fn apply_bounds(webview: &tauri::Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
  let width = width.max(1.0);
  let height = height.max(1.0);
  webview
    .set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)))
    .map_err(|err| err.to_string())?;
  webview
    .set_size(LogicalSize::new(width, height))
    .map_err(|err| err.to_string())?;
  Ok(())
}

const SLEEP_AFTER: Duration = Duration::from_secs(10 * 60);

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

fn forget_view(id: &str) {
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

fn sleep_stale_browsers(app: &AppHandle, keep_label: Option<&str>) {
  let now = Instant::now();
  let stale: Vec<String> = browser_labels(app)
    .into_iter()
    .filter(|label| keep_label.map_or(true, |keep| label != keep))
    .filter(|label| {
      id_from_label(label).is_some_and(|id| {
        hidden_since()
          .lock()
          .ok()
          .and_then(|map| map.get(id).copied())
          .is_some_and(|at| now.saturating_duration_since(at) >= SLEEP_AFTER)
      })
    })
    .collect();
  for label in stale {
    if let Some(webview) = app.get_webview(&label) {
      let _ = webview.close();
    }
    if let Some(id) = id_from_label(&label) {
      forget_view(id);
    }
  }
}

fn new_browser_id() -> String {
  format!(
    "{:x}{:x}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|value| value.as_nanos())
      .unwrap_or(0),
    std::process::id()
  )
}

fn emit_state(app: &AppHandle, id: &str, url: String, title: String) {
  let _ = app.emit(
    "app-browser-state",
    BrowserPageState {
      id: id.to_string(),
      url,
      title,
    },
  );
}

fn emit_opened(app: &AppHandle, id: &str, url: String) {
  let _ = app.emit(
    "app-browser-opened",
    BrowserPageState {
      id: id.to_string(),
      url,
      title: String::new(),
    },
  );
}

fn last_urls() -> &'static Mutex<HashMap<String, String>> {
  static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_url(id: &str, url: &str) {
  if url.is_empty() {
    return;
  }
  if let Ok(mut map) = last_urls().lock() {
    map.insert(id.to_string(), url.to_string());
  }
}

fn remembered_url(id: &str) -> String {
  last_urls()
    .lock()
    .ok()
    .and_then(|map| map.get(id).cloned())
    .unwrap_or_default()
}

fn is_studentstudy(raw: &str) -> bool {
  let lower = raw.to_ascii_lowercase();
  lower.contains("/mycourse/studentstudy") || lower.contains("studentstudy?")
}

/// 学习通嵌在 iframe 里的文档地址。整窗由我们控制，也绝不把这些当顶层打开。
/// 注意：stucoursemiddle / mycourse/stu 是「进课」中间页或课程壳，不是嵌套 iframe，必须能顶层打开。
fn is_iframe_document_url(raw: &str) -> bool {
  let lower = raw.to_ascii_lowercase();
  lower.contains("/mycourse/studentcourse")
    || lower.contains("studentcourse?")
    || lower.contains("/knowledge/cards")
    || lower.contains("ananas/modules")
    || lower.contains("insertvideo")
    || lower.contains("insertdoc")
    || lower.contains("insertaudio")
    || lower.contains("insertbbs")
    || lower.contains("insertbook")
    || lower.contains("insertflash")
    || lower.contains("/mooc-ans/bbscircle/")
}

/// 从空间课表点进一门课：中间页或课程壳。应在当前窗口打开，不能吞掉，也不宜另开标签。
fn is_course_entry_url(raw: &str) -> bool {
  let lower = raw.to_ascii_lowercase();
  lower.contains("stucoursemiddle")
    || lower.contains("/mycourse/stu")
    || lower.contains("mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu")
}

fn defer_off_webview(app: AppHandle, job: impl FnOnce(&AppHandle) + Send + 'static) {
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_millis(40));
    let _ = app.clone().run_on_main_thread(move || job(&app));
  });
}

fn handle_deferred_popup(app: &AppHandle, opener_id: &str, opener_url: &str, raw: &str) {
  // 播放页自己会原地切节。这里再 navigate 会把当前页盖掉，还可能带错 chapterId。
  if is_studentstudy(opener_url) && is_studentstudy(raw) {
    return;
  }
  // 进课：在当前浏览器窗口打开，Agent 仍挂着这个 browserId
  if is_course_entry_url(raw) {
    if let Ok(target) = parse_url(raw) {
      if let Ok(webview) = find_browser(app, opener_id) {
        remember_url(opener_id, raw);
        let _ = webview.navigate(target);
      }
    }
    return;
  }
  // iframe 文档绝不当新标签顶层打开
  if is_iframe_document_url(raw) {
    return;
  }
  emit_opened(app, &new_browser_id(), raw.to_string());
}

/// 注入到每一个 frame（含跨域）。用 postMessage 把子 frame 文本/点击回传到顶层，
/// 顶层提供 `__ZE_ASK_FRAMES__` / `__ZE_FRAME_SNAPS__`，供 get_page / click_text 使用。
const CHAOXING_FRAME_BRIDGE: &str = r#"(function(){
  if (window.__ZE_FRAME_BRIDGE__) return;
  window.__ZE_FRAME_BRIDGE__ = true;
  var isTop = false;
  try { isTop = window === window.top; } catch (e) { isTop = false; }

  function kindOf(href, text){
    var h = String(href || '');
    var t = String(text || '');
    if (/studentcourse|已完成任务点|#coursetree|posCatalog_/i.test(h + t)) return 'catalog';
    if (/doHomeWork|dowork|\/work\/|作业列表|待做/i.test(h + t)) return 'work';
    if (/暂无任务|默认班级/.test(t) && !/已完成任务点/.test(t)) return 'task';
    if (/ananas|insertvideo|knowledge\/cards/i.test(h)) return 'player';
    return 'other';
  }

  function snapSelf(){
    var text = '';
    try { text = String((document.body && document.body.innerText) || '').trim(); } catch (e) {}
    var href = '';
    try { href = String(location.href || ''); } catch (e2) {}
    var title = '';
    try { title = String(document.title || ''); } catch (e3) {}
    return {
      href: href.slice(0, 400),
      title: title.slice(0, 120),
      text: text.slice(0, 12000),
      kind: kindOf(href, text)
    };
  }

  function postTop(msg){
    try { window.top.postMessage(msg, '*'); return; } catch (e) {}
    try { window.parent.postMessage(msg, '*'); } catch (e2) {}
  }

  function forwardAsk(msg){
    try {
      var list = document.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        try { list[i].contentWindow.postMessage(msg, '*'); } catch (e) {}
      }
    } catch (e2) {}
  }

  function clickByText(want){
    var target = String(want || '').replace(/\s+/g, '');
    if (!target) return null;
    var bare = target.replace(/[（(]\s*\d+\s*[）)]\s*$/g, '');
    var nodes = document.querySelectorAll('a, button, [role="tab"], [role="button"], span, div, li, h3, h4, label');
    var exact = null;
    var fuzzy = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var label = '';
      try { label = String(el.getAttribute('title') || el.innerText || el.textContent || '').replace(/\s+/g, ''); } catch (e) {}
      if (!label) continue;
      if (label === bare || label === target) { exact = el; break; }
      if (!fuzzy && label.length <= 64 && label.indexOf(bare) >= 0) fuzzy = el;
    }
    var hit = exact || fuzzy;
    if (!hit) return null;
    try {
      hit.scrollIntoView({ block: 'center', inline: 'nearest' });
      var view = (hit.ownerDocument && hit.ownerDocument.defaultView) || window;
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
      if (typeof hit.click === 'function') hit.click();
    } catch (e2) {}
    var text = '';
    try { text = String(hit.getAttribute('title') || hit.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80); } catch (e3) {}
    return { text: text || want };
  }

  window.addEventListener('message', function(ev){
    var d = ev && ev.data;
    if (!d || d.__ze !== 1) return;
    if (d.type === 'ask') {
      if (d.op === 'snap' || !d.op) {
        postTop({ __ze: 1, type: 'snap', req: d.req, snap: snapSelf() });
      } else if (d.op === 'click') {
        var want = String((d.extra && d.extra.text) || '');
        var hit = clickByText(want);
        if (hit) postTop({ __ze: 1, type: 'clicked', req: d.req, text: hit.text, href: '' });
      }
      forwardAsk(d);
      return;
    }
    if (!isTop) return;
    if (d.type === 'snap' && d.snap) {
      if (!window.__ZE_FRAME_SNAPS__) window.__ZE_FRAME_SNAPS__ = [];
      window.__ZE_FRAME_SNAPS__.push(d.snap);
      return;
    }
    if (d.type === 'clicked') {
      window.__ZE_CLICKED__ = String(d.text || '');
      window.__ZE_CLICKED_HREF__ = '';
    }
  });

  if (isTop) {
    window.__ZE_FRAME_SNAPS__ = window.__ZE_FRAME_SNAPS__ || [];
    window.__ZE_ASK_FRAMES__ = function(op, extra){
      var req = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      window.__ZE_FRAME_SNAPS__ = [];
      window.__ZE_CLICKED__ = '';
      window.__ZE_CLICKED_HREF__ = '';
      var msg = { __ze: 1, type: 'ask', op: op || 'snap', req: req, extra: extra || {} };
      // 顶层自己也记一份（同源子树仍由 __sameFrames 扫；这里补跨域）
      try { window.__ZE_FRAME_SNAPS__.push(snapSelf()); } catch (e) {}
      forwardAsk(msg);
      return true;
    };
  } else {
    // 子 frame 就绪后主动报一次，方便顶层缓存
    try {
      postTop({ __ze: 1, type: 'snap', req: 'boot', snap: snapSelf() });
    } catch (e) {}
  }
})();"#;

/// 学习通讨论模块是套了两层 iframe 的卡片。拦掉子 frame 之后，
/// 在 knowledge/cards 里用附件数据画成同样的卡片，点击仍 window.open。
const CHAOXING_BBS_CARDS: &str = r#"(function(){
  try {
    if (!/\/knowledge\/cards/i.test(location.href)) return;
  } catch (e) { return; }
  if (window.__ZE_BBS_CARDS__) return;
  window.__ZE_BBS_CARDS__ = true;
  function esc(s){
    return String(s || '').replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function parseData(el){
    try { return JSON.parse(el.getAttribute('data') || '{}') || {}; } catch (e) { return {}; }
  }
  function attachments(){
    return (window.AttachmentSetting && AttachmentSetting.attachments) || [];
  }
  function defaults(){
    return (window.AttachmentSetting && AttachmentSetting.defaults) || {};
  }
  function isBbs(item){
    var t = String((item && (item.type || item.attachmentType || (item.property && (item.property.module || item.property.type)))) || '');
    return /bbs|topic|discuss/i.test(t);
  }
  function findAttach(iframe, data){
    var mid = String(data.mid || '');
    var list = attachments();
    var i;
    if (mid) {
      for (i = 0; i < list.length; i++) {
        var p = list[i] && list[i].property;
        if (p && String(p.mid) === mid) return list[i];
      }
    }
    var frames = document.querySelectorAll('iframe[src*="insertbbs"], iframe[class*="insertbbs"]');
    var idx = -1;
    for (i = 0; i < frames.length; i++) if (frames[i] === iframe) idx = i;
    var bbs = [];
    for (i = 0; i < list.length; i++) if (isBbs(list[i])) bbs.push(list[i]);
    return idx >= 0 && bbs[idx] ? bbs[idx] : null;
  }
  function titleOf(data, attach){
    var p = (attach && attach.property) || {};
    return p.talkTitle || p.title || p.name || p.content || data.talkTitle || data.title || '讨论';
  }
  function subOf(data, attach){
    var p = (attach && attach.property) || {};
    return p.discussTitle || p.subtitle || p.desc || '';
  }
  function hrefOf(data, attach){
    var p = (attach && attach.property) || {};
    if (p.topicUrl) return String(p.topicUrl);
    if (p.url && /groupweb|topic|bbs|replysList/i.test(String(p.url))) return String(p.url);
    var def = defaults();
    var courseid = data.courseid || def.courseid || '';
    var clazzId = def.clazzId || '';
    if (p.bbsid && (p.uuid || p.topicId || p.tid)) {
      return 'https://groupweb.chaoxing.com/course/topic/v3/bbs/' + p.bbsid + '/' + (p.uuid || p.topicId || p.tid) + '/replysList?courseId=' + courseid + '&classId=' + clazzId;
    }
    var mid = data.mid || p.mid || '';
    if (!mid) return '';
    return 'https://mooc1.chaoxing.com/mooc-ans/bbscircle/chapter?mtopicid=' + encodeURIComponent(mid)
      + '&jobid=' + encodeURIComponent(data.jobid || data._jobid || '')
      + '&isPortal=false&knowledgeid=' + encodeURIComponent(def.knowledgeid || '')
      + '&ut=s&clazzId=' + encodeURIComponent(clazzId)
      + '&courseid=' + encodeURIComponent(courseid)
      + '&isJob=false';
  }
  function paint(iframe){
    if (iframe.getAttribute('data-ze-bbs') === '1') return;
    var src = String(iframe.getAttribute('src') || iframe.src || '');
    var cls = String(iframe.className || '');
    if (!/insertbbs/i.test(src) && !/insertbbs/i.test(cls)) return;
    iframe.setAttribute('data-ze-bbs', '1');
    var data = parseData(iframe);
    var attach = findAttach(iframe, data);
    var href = hrefOf(data, attach);
    var title = titleOf(data, attach);
    var sub = subOf(data, attach);
    var card = document.createElement('div');
    card.className = 'ze-bbs-card';
    card.setAttribute('role', 'link');
    card.innerHTML = '<img class="ze-bbs-icon" src="//mooc1.chaoxing.com/mooc-ans/css/images/tl-new.png" alt="">'
      + '<div class="ze-bbs-text"><p>' + esc(title) + '</p>'
      + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>';
    if (href) card.onclick = function(){ window.open(href); };
    iframe.style.cssText = 'display:none!important;height:0!important;border:0;';
    iframe.insertAdjacentElement('afterend', card);
    var box = iframe.closest ? (iframe.closest('.ans-attach-ct, .ans-cc, .moduleDiv') || iframe.parentElement) : iframe.parentElement;
    if (box) { box.style.height = 'auto'; box.style.minHeight = '0'; }
  }
  function scan(){
    var list = document.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) paint(list[i]);
  }
  var style = document.createElement('style');
  style.textContent = '.ze-bbs-card{padding:16px;background:#F7F8FA;display:flex;align-items:center;border-radius:4px;cursor:pointer;margin:8px 0;box-sizing:border-box;}'
    + '.ze-bbs-icon{width:42px;height:42px;margin-right:14px;flex:none;}'
    + '.ze-bbs-text{flex:1;min-width:0;}'
    + '.ze-bbs-text p{margin:0;line-height:1.5;font-size:14px;color:#131B26;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}'
    + '.ze-bbs-text span{display:block;color:#8A8B99;font-size:12px;line-height:18px;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}';
  function boot(){
    (document.head || document.documentElement).appendChild(style);
    var n = 0;
    function tick(){
      scan();
      n += 1;
      if (n < 12) setTimeout(tick, 250);
    }
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
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
) -> Result<(), String> {
  let label = label_for(&id)?;
  let parsed = open_webview_url(&url)?;
  sleep_stale_browsers(&app, Some(&label));
  hide_other_browsers(&app, &label);
  if let Some(existing) = app.get_webview(&label) {
    apply_bounds(&existing, x, y, width, height)?;
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

  let mut builder = WebviewBuilder::new(&label, parsed)
    .data_directory(data_dir)
    .focused(true)
    .accept_first_mouse(true)
    .user_agent(SAFARI_UA)
    .initialization_script_for_all_frames(CHAOXING_FRAME_BRIDGE)
    .initialization_script_for_all_frames(CHAOXING_BBS_CARDS)
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
      if payload.event() == PageLoadEvent::Finished {
        let next = payload.url().to_string();
        remember_url(&state_id, &next);
        emit_state(webview.app_handle(), &state_id, next, String::new());
      }
    })
    .on_document_title_changed(move |webview, title| {
      let url = webview
        .url()
        .map(|value| value.to_string())
        .unwrap_or_default();
      remember_url(&title_id, &url);
      handle_title_change(webview.app_handle(), &title_id, url, title);
    });

  #[cfg(debug_assertions)]
  {
    builder = builder.devtools(true);
  }

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
          apply_bounds(&existing, x, y, width, height)?;
          existing.show().map_err(|e| e.to_string())?;
          mark_shown(&id);
          return Ok(());
        }
      }
      return Err(msg);
    }
  };
  webview.show().map_err(|err| err.to_string())?;
  mark_shown(&id);
  Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
  app: AppHandle,
  id: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  apply_bounds(&find_browser(&app, &id)?, x, y, width, height)
}

#[tauri::command]
pub async fn browser_show(app: AppHandle, id: String) -> Result<(), String> {
  let label = label_for(&id)?;
  sleep_stale_browsers(&app, Some(&label));
  hide_other_browsers(&app, &label);
  find_browser(&app, &id)?
    .show()
    .map_err(|err| err.to_string())?;
  mark_shown(&id);
  Ok(())
}

#[tauri::command]
pub async fn browser_hide(app: AppHandle, id: String) -> Result<(), String> {
  if let Ok(webview) = find_browser(&app, &id) {
    hide_webview(&webview, &id);
  }
  sleep_stale_browsers(&app, None);
  Ok(())
}

#[tauri::command]
pub async fn browser_hide_all(app: AppHandle) -> Result<(), String> {
  hide_all_browsers(&app);
  sleep_stale_browsers(&app, None);
  Ok(())
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
  if let Ok(webview) = find_browser(&app, &id) {
    webview.close().map_err(|err| err.to_string())?;
  }
  forget_view(&id);
  Ok(())
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
  let webview = find_browser(&app, &id)?;
  let current = remembered_url(&id);
  let target = parse_url(&url)?;
  let target_raw = target.to_string();
  if is_iframe_document_url(&target_raw) {
    return Err(
      "这是学习通 iframe 里的页面，不能当顶层打开。留在当前课页，在页面里点章节/作业。"
        .into(),
    );
  }
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

#[tauri::command]
pub async fn browser_reload(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .reload()
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .eval("history.back()")
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .eval("history.forward()")
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_set_zoom(app: AppHandle, id: String, zoom: f64) -> Result<(), String> {
  let zoom = if zoom.is_finite() {
    zoom.clamp(0.25, 5.0)
  } else {
    1.0
  };
  find_browser(&app, &id)?
    .set_zoom(zoom)
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_get_state(app: AppHandle, id: String) -> Result<BrowserPageState, String> {
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

#[tauri::command]
pub async fn browser_set_app_above_page(
  _app: AppHandle,
  _above: bool,
  _id: Option<String>,
) -> Result<(), String> {
  Ok(())
}

fn prepare_eval_script(script: &str) -> String {
  let trimmed = script.trim();
  // 只有整段已是 IIFE 表达式时才原样代入 `var value = …`。
  // 不能单靠 ends_with(")()")：`function foo(){} (function(){})()` 也会命中，
  // 导致 function 声明落在赋值外、IIFE 里找不到 __sameFrames。
  let already = trimmed.starts_with("(function")
    || trimmed.starts_with("(()=>")
    || trimmed.starts_with("(() =>")
    || trimmed.starts_with("(async");
  if already {
    return trimmed.to_string();
  }
  if trimmed.contains("return ") || trimmed.starts_with("return") {
    return format!("(function(){{\n{trimmed}\n}})()");
  }
  trimmed.to_string()
}

fn new_eval_token() -> String {
  format!(
    "{:x}{:x}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|value| value.as_nanos())
      .unwrap_or(0),
    std::process::id()
  )
}

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

#[tauri::command]
pub async fn browser_eval(app: AppHandle, id: String, script: String) -> Result<String, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  if script.len() > 40_000 {
    return Err("脚本过长".into());
  }
  let webview = find_browser(&app, &id)?;
  let token = new_eval_token();
  let prepared = prepare_eval_script(script);
  let mut wrapped = String::from("(function(){\n  var prev = document.title;\n  try {\n    var value = ");
  wrapped.push_str(&prepared);
  wrapped.push_str(";\n    window.__ZE_EVAL_MAP__ = window.__ZE_EVAL_MAP__ || {};\n    window.__ZE_EVAL_MAP__[\"");
  wrapped.push_str(&token);
  wrapped.push_str("\"] = { buf: JSON.stringify(value === undefined ? null : value), off: 0 };\n    document.title = \"ZRRESULT:");
  wrapped.push_str(&token);
  wrapped.push_str(":__READY__\";\n  } catch (e) {\n    window.__ZE_EVAL_MAP__ = window.__ZE_EVAL_MAP__ || {};\n    window.__ZE_EVAL_MAP__[\"");
  wrapped.push_str(&token);
  wrapped.push_str("\"] = { buf: JSON.stringify({__error: String(e && e.message || e)}), off: 0 };\n    document.title = \"ZRRESULT:");
  wrapped.push_str(&token);
  wrapped.push_str(":__READY__\";\n  }\n  setTimeout(function(){ document.title = prev; }, 30);\n})();");
  let first = eval_wait_title(&webview, token.clone(), wrapped).await?;
  if first != "__READY__" {
    return Ok(first);
  }
  let mut out = String::new();
  for _ in 0..200 {
    let chunk_token = new_eval_token();
    let chunk_js = format!(
      r#"(function(){{
  var prev = document.title;
  var slot = (window.__ZE_EVAL_MAP__ || {{}})["{src}"];
  var s = slot ? String(slot.buf || '') : '';
  var off = slot ? (slot.off | 0) : 0;
  var chunk = s.slice(off, off + 360);
  if (slot) slot.off = off + chunk.length;
  document.title = "ZRRESULT:{chunk_token}:" + JSON.stringify({{c: chunk, d: !slot || slot.off >= s.length}});
  setTimeout(function(){{ document.title = prev; }}, 20);
}})();"#,
      src = token,
      chunk_token = chunk_token
    );
    let raw = eval_wait_title(&webview, chunk_token, chunk_js).await?;
    let parsed: serde_json::Value =
      serde_json::from_str(&raw).map_err(|_| "读取执行结果失败".to_string())?;
    if let Some(chunk) = parsed.get("c").and_then(|v| v.as_str()) {
      out.push_str(chunk);
    }
    if parsed.get("d").and_then(|v| v.as_bool()).unwrap_or(false) {
      let _ = webview.eval(&format!(
        r#"(function(){{ try {{ if (window.__ZE_EVAL_MAP__) delete window.__ZE_EVAL_MAP__["{token}"]; }} catch (e) {{}} }})();"#
      ));
      return Ok(out);
    }
  }
  Err("执行结果过长".into())
}
