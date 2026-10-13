use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl};
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
  // 一次 set_bounds，避免 set_position + set_size 各打一帧 setFrame，拖窗口时 WK 更容易白屏。
  webview
    .set_bounds(Rect {
      position: LogicalPosition::new(x.max(0.0), y.max(0.0)).into(),
      size: LogicalSize::new(width, height).into(),
    })
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

pub(crate) fn emit_opened(app: &AppHandle, id: &str, url: String) {
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

fn is_studentstudy(raw: &str) -> bool {
  let lower = raw.to_ascii_lowercase();
  lower.contains("/mycourse/studentstudy") || lower.contains("studentstudy?")
}

/// 空间课表地址。禁止顶层打开，禁止当「我学的课」去点。
pub(crate) fn is_space_list_url(raw: &str) -> bool {
  let lower = raw.to_ascii_lowercase();
  let list = lower.contains("visit/courses")
    || lower.contains("visit/interaction")
    || lower.contains("courselist");
  let course = lower.contains("stucoursemiddle")
    || lower.contains("mycourse/stu")
    || lower.contains("courseid=");
  list && !course
}

/// 学习通嵌在 iframe 里的文档地址。整窗由我们控制，也绝不把这些当顶层打开。
/// 注意：stucoursemiddle / mycourse/stu 是「进课」中间页或课程壳，不是嵌套 iframe，必须能顶层打开。
pub(crate) fn is_iframe_document_url(raw: &str) -> bool {
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

/// 作业作答 / 打开一份作业的地址。工具识别用；点击弹窗不再靠这份名单放行。
pub(crate) fn is_homework_do_url(raw: &str) -> bool {
  let lower = raw.to_ascii_lowercase();
  if lower.contains("/work/list") {
    return false;
  }
  lower.contains("dohomework")
    || lower.contains("/work/do")
    || lower.contains("dowork")
    || lower.contains("do-work")
    || lower.contains("/work/preview")
    || lower.contains("/work/task")
    || lower.contains("/work/view")
    || (lower.contains("/work/") && lower.contains("workid="))
}

/// 页面自己点开的地址应留在当前窗口。只有空地址、播放器嵌套页、课表外路丢掉。
/// 工具 `navigate` / `open` 另拦，不走这里。
pub(crate) fn popup_should_drop(opener: &str, raw: &str) -> bool {
  let lower = raw.trim().to_ascii_lowercase();
  if lower.is_empty() || lower.starts_with("about:") || lower.starts_with("javascript:") {
    return true;
  }
  if is_iframe_document_url(raw) || is_space_list_url(raw) {
    return true;
  }
  is_studentstudy(opener) && is_studentstudy(raw)
}

/// 从空间课表点进一门课：中间页或课程壳。应在当前窗口打开，不能吞掉，也不宜另开标签。
pub(crate) fn is_course_entry_url(raw: &str) -> bool {
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
  if popup_should_drop(opener_url, raw) {
    return;
  }
  // 进课：在当前窗口打开，Agent 仍挂着这个 browserId
  if is_course_entry_url(raw) {
    if let Ok(target) = parse_url(raw) {
      if let Ok(webview) = find_browser(app, opener_id) {
        remember_url(opener_id, raw);
        let _ = webview.navigate(target);
      }
    }
    return;
  }
  // 作业等真实顶层页：开新标签并让前端自动切过去
  emit_opened(app, &new_browser_id(), raw.to_string());
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
      document.documentElement.style.background = '#fff';
      if (document.body) {
        document.body.replaceChildren();
        document.body.style.cssText = 'margin:0;background:#fff;min-height:100vh';
      }
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

/// 旧跨域快照桥。CDP `browser_cdp_snapshot` 已替代，不再注入每个站点。
#[allow(dead_code)]
const CHAOXING_FRAME_BRIDGE: &str = r#"(function(){
  if (window.__ZE_FRAME_BRIDGE__) return;
  window.__ZE_FRAME_BRIDGE__ = true;
  var isTop = false;
  try { isTop = window === window.top; } catch (e) { isTop = false; }

  function kindOf(href, text){
    var h = String(href || '');
    var t = String(text || '');
    if (/studentcourse|已完成任务点|#coursetree|posCatalog_/i.test(h + t)) return 'catalog';
    if (/doHomeWork|dowork|\/work\/|作业列表|待做|未交|未提交/i.test(h + t)) return 'work';
    if (/暂无任务|默认班级/.test(t) && !/已完成任务点/.test(t)) return 'task';
    if (/ananas|insertvideo|knowledge\/cards/i.test(h)) return 'player';
    return 'other';
  }

  function snapRefs(){
    var out = [];
    var seen = {};
    var nodes = [];
    try {
      nodes = document.querySelectorAll('a, button, [role="tab"], [role="button"], [role="link"], input, textarea, h2, h3, h4, li.course, .course-name, .color1, [data-url], [title], [data-id], [onclick*="pageHeader"]');
    } catch (e0) { return out; }
    function chromeName(el){
      var hook = '';
      try { hook = String(el.getAttribute('data-url') || el.getAttribute('onclick') || el.getAttribute('href') || ''); } catch (eH) {}
      if (/pageHeader=8|\/mooc2\/work|\/work\/list|studentwork|workEnc/i.test(hook)) return '作业';
      if (/pageHeader=1|studentcourse/i.test(hook)) return '章节';
      if (/pageHeader=0|stuActiveList/i.test(hook)) return '任务';
      var id = '';
      try { id = String(el.getAttribute('data-id') || el.getAttribute('data-header') || ''); } catch (eI) {}
      if (id === '8') return '作业';
      var attr = '';
      try { attr = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim(); } catch (eA) {}
      if (/^(章节|作业|任务|统计|资料|考试|讨论|通知)$/.test(attr)) return attr;
      return '';
    }
    for (var i = 0; i < nodes.length && out.length < 80; i++) {
      var el = nodes[i];
      var tag = String(el.tagName || '').toLowerCase();
      var type = '';
      try { type = String(el.type || '').toLowerCase(); } catch (e1) {}
      if (type === 'hidden' || type === 'checkbox' || type === 'radio') continue;
      var role = tag === 'a' ? 'link' : (tag === 'button' ? 'button' : ((tag === 'input' || tag === 'textarea') ? 'textbox' : (/^h[1-4]$/.test(tag) ? 'heading' : 'button')));
      var name = chromeName(el);
      if (!name) {
        try {
          name = String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        } catch (e2) {}
      }
      if (!name || name.length < 2 || name.length > 40) continue;
      if (seen[name]) continue;
      seen[name] = 1;
      var value = '';
      if (role === 'textbox' && type !== 'password') {
        try { value = String(el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80); } catch (e3) {}
      }
      out.push({ role: role, name: name, value: value });
    }
    return out;
  }

  function worksFromRefs(refs){
    var out = [];
    var seen = {};
    for (var i = 0; i < refs.length; i++) {
      var name = String((refs[i] && refs[i].name) || '').replace(/\s+/g, ' ').trim();
      var m = name.match(/^(.*?)(?:\s*[;；|]\s*|\s+)(待做|未做|未完成|未交|未提交|待交|待批阅|已完成|已批阅|已交)\s*$/);
      if (!m) continue;
      var title = String(m[1] || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 2 || title.length > 80) continue;
      if (/^作业$|^测验$|^考试$|^默认班级$|^章节$|^任务$/.test(title)) continue;
      if (seen[title]) continue;
      seen[title] = 1;
      var raw = m[2];
      var status = /待批阅/.test(raw) ? '待批阅' : ((/已完成|已批阅|已交/.test(raw) && !/未交|未提交|待交/.test(raw)) ? '已完成' : '待做');
      out.push({ title: title, status: status });
    }
    return out;
  }

  function snapSelf(){
    var text = '';
    try { text = String((document.body && document.body.innerText) || '').trim(); } catch (e) {}
    var href = '';
    try { href = String(location.href || ''); } catch (e2) {}
    var title = '';
    try { title = String(document.title || ''); } catch (e3) {}
    var refs = snapRefs();
    return {
      href: href.slice(0, 400),
      title: title.slice(0, 120),
      text: text.slice(0, 4000),
      refs: refs,
      works: worksFromRefs(refs),
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

  function compact(s){ return String(s || '').replace(/\s+/g, ''); }
  function bareOf(s){
    return compact(s).replace(/[;；].*$/, '').replace(/(待做|未做|未完成|未交|未提交|待交|待批阅|已完成|已批阅|已交)$/, '');
  }
  function clickable(el){
    var cur = el;
    for (var u = 0; u < 5 && cur; u++) {
      var tag = String(cur.tagName || '').toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'label') return cur;
      try {
        var role = String(cur.getAttribute('role') || '');
        if (role === 'tab' || role === 'button' || role === 'link') return cur;
        if (cur.getAttribute('coursetype') || /\btab-item\b/.test(String(cur.className || ''))) return cur;
        if (cur.getAttribute('onclick') || cur.getAttribute('data-url') || cur.getAttribute('href')) return cur;
      } catch (eU) {}
      if (tag === 'li' || tag === 'td') {
        var innerA = null;
        try { innerA = cur.querySelector('a, button, [onclick], [data-url], .titTxt a, .workName a'); } catch (eA) {}
        if (innerA) return innerA;
      }
      var parent = cur.parentElement;
      if (!parent || (parent.childElementCount || 0) > 8) return cur;
      cur = parent;
    }
    return el;
  }
  function clickByText(want){
    var target = compact(want);
    if (!target) return null;
    var bare = bareOf(want);
    var known = {
      '我学的课': ['.tab-item[coursetype="1"]', '[coursetype="1"]', '.tab-item'],
      '我教的课': ['.tab-item[coursetype="0"]', '[coursetype="0"]', '.tab-item'],
      '作业': ['[title="作业"]', '[aria-label="作业"]', '[onclick*="pageHeader=8"]', '[data-url*="work"]', '[data-id="8"]'],
      '章节': ['[title="章节"]', '[aria-label="章节"]', '[data-url*="studentcourse"]'],
    };
    function labelOf(el){
      var t = '';
      try { t = el.getAttribute('aria-label') || el.getAttribute('title') || ''; } catch (eL) {}
      t = compact(t);
      if (t) return t;
      try { return compact(el.innerText || el.textContent || ''); } catch (eL2) { return ''; }
    }
    function labelOk(want, label){
      var a = compact(want);
      var b = compact(label);
      if (!a || !b) return false;
      if (b.indexOf('删除') >= 0 && a.indexOf('删除') < 0) return false;
      if ((a === '我学的课' || a === '已学的课') && (b === '我学的课' || b === '已学的课')) return true;
      return b === a || b.indexOf(a) === 0;
    }
    var sels = known[target] || known[bare] || [];
    for (var s = 0; s < sels.length; s++) {
      try {
        var nodes = document.querySelectorAll(sels[s]);
        for (var k = 0; k < nodes.length; k++) {
          var found = nodes[k];
          var foundHref = '';
          try { foundHref = String(found.href || found.getAttribute('href') || found.getAttribute('data-url') || ''); } catch (eH) {}
          if (/visit\/(?:courses|interaction)|courselist/i.test(foundHref)) continue;
          if (String(found.tagName || '').toLowerCase() === 'a' && (target === '我学的课' || target === '我教的课' || target === '已学的课')) continue;
          if (!labelOk(target, labelOf(found)) && !labelOk(bare, labelOf(found))) continue;
          found.scrollIntoView({ block: 'center', inline: 'nearest' });
          var view0 = (found.ownerDocument && found.ownerDocument.defaultView) || window;
          found.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view0 }));
          if (typeof found.click === 'function') found.click();
          return { text: labelOf(found) || target, href: String(found.href || found.getAttribute('href') || found.getAttribute('data-url') || '') };
        }
      } catch (eK) {}
    }
    var walker = null;
    try { walker = document.body && document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null); } catch (eW) {}
    var exact = null;
    var fuzzy = null;
    var exactScore = 1e9;
    var fuzzyScore = 1e9;
    var n = null;
    var seen = 0;
    while (walker && (n = walker.nextNode())) {
      if (++seen > 4000) break;
      var tx = compact(n.nodeValue);
      if (!tx || tx.length > 64) continue;
      if (tx.indexOf('删除') >= 0 && target.indexOf('删除') < 0 && bare.indexOf('删除') < 0) continue;
      var hitExact = tx === target || tx === bare || bareOf(tx) === target || bareOf(tx) === bare;
      var hitNear = !hitExact && bare && tx.length <= bare.length + 8 && tx.indexOf(bare) >= 0;
      if (!hitExact && !hitNear) continue;
      var el = n.parentElement;
      if (!el) continue;
      var kids = 0;
      try { kids = el.childElementCount || 0; } catch (eC) { kids = 0; }
      if (kids > 12) continue;
      var score = tx.length + kids;
      if (hitExact && score < exactScore) { exact = el; exactScore = score; }
      else if (hitNear && score < fuzzyScore) { fuzzy = el; fuzzyScore = score; }
      if (hitExact && kids <= 1 && tx === target) break;
    }
    var hit = exact || fuzzy;
    if (!hit) return null;
    hit = clickable(hit);
    try {
      hit.scrollIntoView({ block: 'center', inline: 'nearest' });
      var view = (hit.ownerDocument && hit.ownerDocument.defaultView) || window;
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
      if (typeof hit.click === 'function') hit.click();
    } catch (e2) {}
    var text = '';
    var href = '';
    try { text = String(hit.getAttribute('title') || hit.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80); } catch (e3) {}
    try {
      var a = hit.tagName === 'A' ? hit : (hit.closest ? hit.closest('a') : null);
      href = a ? String(a.href || a.getAttribute('href') || '') : '';
    } catch (e4) {}
    return { text: text || want, href: href };
  }

  function fillByText(sel, text){
    var el = null;
    try { if (sel) el = document.querySelector(sel); } catch (e) {}
    if (!el) {
      var boxes = [];
      try { boxes = document.querySelectorAll('input, textarea, [contenteditable="true"]'); } catch (e2) { return null; }
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var label = '';
        try { label = String(box.getAttribute('placeholder') || box.getAttribute('aria-label') || box.getAttribute('title') || ''); } catch (e3) {}
        if (sel && label && label.indexOf(sel) >= 0) { el = box; break; }
        if (!sel && !el) el = box;
      }
    }
    if (!el) return null;
    try {
      try { el.click(); } catch (eC) {}
      el.focus();
      try { if (typeof el.select === 'function') el.select(); } catch (eS) {}
      var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      var apply = function(value){
        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;
      };
      apply('');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      apply(text);
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: text, inputType: 'insertFromPaste' }));
      } catch (eIn) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e4) { return null; }
    return { text: text };
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
        if (hit) postTop({ __ze: 1, type: 'clicked', req: d.req, text: hit.text, href: hit.href || '' });
      } else if (d.op === 'fill') {
        var filled = fillByText(String((d.extra && d.extra.selector) || ''), String((d.extra && d.extra.text) || ''));
        if (filled) postTop({ __ze: 1, type: 'filled', req: d.req, text: filled.text });
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
      window.__ZE_CLICKED_HREF__ = String(d.href || '');
    }
    if (d.type === 'filled') {
      window.__ZE_FILLED__ = String(d.text || '');
    }
  });

  if (isTop) {
    window.__ZE_FRAME_SNAPS__ = window.__ZE_FRAME_SNAPS__ || [];
    window.__ZE_ASK_FRAMES__ = function(op, extra){
      var req = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      window.__ZE_FRAME_SNAPS__ = [];
      window.__ZE_CLICKED__ = '';
      window.__ZE_CLICKED_HREF__ = '';
      window.__ZE_FILLED__ = '';
      var msg = { __ze: 1, type: 'ask', op: op || 'snap', req: req, extra: extra || {} };
      // 顶层自己也记一份（同源子树仍由 __sameFrames 扫；这里补跨域）
      try { window.__ZE_FRAME_SNAPS__.push(snapSelf()); } catch (e) {}
      if (op === 'click') {
        try {
          var selfHit = clickByText(String((extra && extra.text) || ''));
          if (selfHit) {
            window.__ZE_CLICKED__ = String(selfHit.text || '');
            window.__ZE_CLICKED_HREF__ = String(selfHit.href || '');
          }
        } catch (eC) {}
      }
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
) -> Result<(), String> {
  if is_space_list_url(&url) {
    return Err("禁止顶层打开课表地址。只点 iframe 里的「我学的课」页签。".into());
  }
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::open(app, id, url, x, y, width, height).await;
  }
  {
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
    .initialization_script_for_all_frames(BROWSER_HOME_LAUNCH)
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
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::set_bounds(app, id, x, y, width, height, notify.unwrap_or(false));
  }
  {
  let webview = find_browser(&app, &id)?;
  apply_bounds(&webview, x, y, width, height)?;
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
  sleep_stale_browsers(&app, Some(&label));
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
  sleep_stale_browsers(&app, None);
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
  sleep_stale_browsers(&app, None);
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::close(app, id);
  }
  {
  if let Ok(webview) = find_browser(&app, &id) {
    webview.close().map_err(|err| err.to_string())?;
  }
  forget_view(&id);
  Ok(())
  }
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::navigate(app, id, url);
  }
  {
  let webview = find_browser(&app, &id)?;
  let current = remembered_url(&id);
  let target = parse_url(&url)?;
  let target_raw = target.to_string();
  if is_space_list_url(&target_raw) {
    return Err("禁止顶层打开课表地址。只点 iframe 里的「我学的课」页签。".into());
  }
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
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::reload(app, id);
  }
  {
  find_browser(&app, &id)?
    .reload()
    .map_err(|err| err.to_string())
  }
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::go_back(app, id);
  }
  {
  find_browser(&app, &id)?
    .eval("history.back()")
    .map_err(|err| err.to_string())
  }
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::go_forward(app, id);
  }
  {
  find_browser(&app, &id)?
    .eval("history.forward()")
    .map_err(|err| err.to_string())
  }
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
pub async fn browser_video_overlay_tick(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let state = crate::macos_video_overlay::tick(app, id).await?;
    return serde_json::to_value(state).map_err(|e| e.to_string());
  }
  let _ = (app, id);
  Ok(serde_json::json!({ "found": false, "active": false }))
}

#[tauri::command]
pub async fn browser_video_overlay_state(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let state = crate::macos_video_overlay::state(app, id)?;
    return serde_json::to_value(state).map_err(|e| e.to_string());
  }
  let _ = (app, id);
  Ok(serde_json::json!({ "found": false, "active": false }))
}

#[tauri::command]
pub async fn browser_video_overlay_play(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    let state = crate::macos_video_overlay::play(app, id)?;
    return serde_json::to_value(state).map_err(|e| e.to_string());
  }
  let _ = (app, id);
  Ok(serde_json::json!({ "found": false, "active": false }))
}

#[tauri::command]
pub async fn browser_video_overlay_hide(app: AppHandle, id: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    crate::macos_video_overlay::hide_tab(&app, &id);
    return Ok(());
  }
  let _ = (app, id);
  Ok(())
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
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::cdp_screenshot(app, id).await;
  }
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
  url: Option<String>,
) -> Result<serde_json::Value, String> {
  let target = cookie_target(&id, url);
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::set_cookies(&id, cookies, &target).await;
  }
  let _ = (app, cookies);
  Err("当前平台浏览区不是 Chromium".into())
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
  domain: Option<String>,
) -> Result<serde_json::Value, String> {
  let target = cookie_target(&id, url);
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::clear_cookies(&id, &target, name, domain).await;
  }
  let _ = (app, name, domain);
  Err("当前平台浏览区不是 Chromium".into())
}

/// Agent 用：在每个 CDP frame 执行同一脚本，返回多帧结果（内部工具仍用 browser_eval 取 best）。
#[tauri::command]
pub async fn browser_eval_frames(
  app: AppHandle,
  id: String,
  script: String,
) -> Result<serde_json::Value, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::eval_script_frames(app, id, script).await;
  }
  {
    let value = browser_eval(app, id, script).await?;
    let parsed: serde_json::Value =
      serde_json::from_str(&value).unwrap_or_else(|_| serde_json::Value::String(value));
    Ok(serde_json::json!({
      "frames": [{ "url": "", "result": parsed, "error": null }],
      "result": parsed,
      "hint": "当前内核未走多帧 CDP；不要写 iframe.contentDocument。"
    }))
  }
}

/// 只把深度 0 上的 return / const / let / 分号当成语句。嵌在函数里的 return 仍是表达式。
fn top_level_statement(script: &str) -> bool {
  let chars: Vec<char> = script.chars().collect();
  let mut i = 0;
  let mut depth = 0i32;
  let mut quote = '\0';
  while i < chars.len() {
    let ch = chars[i];
    if quote != '\0' {
      if ch == '\\' {
        i += 2;
        continue;
      }
      if ch == quote {
        quote = '\0';
      }
      i += 1;
      continue;
    }
    if ch == '"' || ch == '\'' || ch == '`' {
      quote = ch;
      i += 1;
      continue;
    }
    if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
      while i < chars.len() && chars[i] != '\n' {
        i += 1;
      }
      continue;
    }
    if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
      i += 2;
      while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
        i += 1;
      }
      i = (i + 2).min(chars.len());
      continue;
    }
    if ch == '(' || ch == '{' || ch == '[' {
      depth += 1;
      i += 1;
      continue;
    }
    if ch == ')' || ch == '}' || ch == ']' {
      depth = (depth - 1).max(0);
      i += 1;
      continue;
    }
    if depth == 0 {
      if ch == ';' {
        return true;
      }
      if ch == '_' || ch == '$' || ch.is_ascii_alphabetic() {
        let start = i;
        i += 1;
        while i < chars.len()
          && (chars[i] == '_' || chars[i] == '$' || chars[i].is_ascii_alphanumeric())
        {
          i += 1;
        }
        let word: String = chars[start..i].iter().collect();
        if matches!(
          word.as_str(),
          "return"
            | "const"
            | "let"
            | "var"
            | "function"
            | "class"
            | "if"
            | "for"
            | "while"
            | "do"
            | "switch"
            | "try"
            | "throw"
        ) {
          return true;
        }
        continue;
      }
    }
    i += 1;
  }
  false
}

pub(crate) fn prepare_eval_script(script: &str) -> String {
  let trimmed = script.trim();
  if trimmed.is_empty() {
    return trimmed.to_string();
  }
  // 只有整段已是 IIFE 表达式时才原样代入。
  // 不能单靠 ends_with(")()")：`function foo(){} (function(){})()` 也会命中。
  let already = trimmed.starts_with("(function")
    || trimmed.starts_with("(()=>")
    || trimmed.starts_with("(() =>")
    || trimmed.starts_with("(async");
  if already {
    return trimmed.to_string();
  }
  // 顶层 return / const / let 才包成函数体。嵌套 return 仍按表达式 return。
  if top_level_statement(trimmed) {
    return format!("(function(){{\n{trimmed}\n}})()");
  }
  format!("(function(){{ return ({trimmed}); }})()")
}

fn syntax_place(raw: &str, script: &str) -> String {
  let col = serde_json::from_str::<serde_json::Value>(raw)
    .ok()
    .and_then(|v| {
      v.get("columnNumber")
        .and_then(|n| n.as_u64())
        .or_else(|| v.pointer("/exceptionDetails/columnNumber").and_then(|n| n.as_u64()))
    });
  let Some(col) = col else {
    return "脚本里".into();
  };
  let chars: Vec<char> = script.chars().collect();
  if chars.is_empty() {
    return format!("第 {col} 列");
  }
  let idx = (col as usize).min(chars.len().saturating_sub(1));
  let start = idx.saturating_sub(10);
  let end = (idx + 10).min(chars.len());
  let near: String = chars[start..end].iter().collect();
  if near.is_empty() {
    format!("第 {col} 列")
  } else {
    format!("第 {col} 列附近「{near}」")
  }
}

/// 把 CDP exceptionDetails JSON 收成短中文，方便 Agent 看。
pub(crate) fn format_eval_error(raw: &str) -> String {
  format_eval_error_near(raw, "")
}

pub(crate) fn format_eval_error_near(raw: &str, script: &str) -> String {
  let lower = raw.to_ascii_lowercase();
  let syntax = lower.contains("syntaxerror")
    || lower.contains("unexpected token")
    || lower.contains("illegal return");
  let place = syntax_place(raw, script);
  if lower.contains("illegal return statement") {
    return format!(
      "脚本语法错：顶层不能写 return。错在{place}。多数信息在 get_page 的 video 行、[done] 标记里。"
    );
  }
  if syntax {
    let desc = serde_json::from_str::<serde_json::Value>(raw)
      .ok()
      .and_then(|v| {
        v.pointer("/exception/description")
          .or_else(|| v.pointer("/exception/value"))
          .and_then(|x| x.as_str())
          .map(|text| text.chars().take(120).collect::<String>())
      })
      .filter(|text| !text.is_empty())
      .unwrap_or_else(|| "脚本语法错".into());
    return format!("{desc}。错在{place}。多数信息在 get_page 的 video 行、[done] 标记里。");
  }
  if raw.contains("contentDocument")
    || raw.contains("Blocked a frame")
    || lower.contains("cross-origin")
    || raw.contains("iframe not accessible")
  {
    return "不要读 iframe.contentDocument。CDP 会在每个 frame 内执行脚本，直接用 document / querySelector。".into();
  }
  if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
    let desc = v
      .pointer("/exception/description")
      .or_else(|| v.pointer("/exception/value"))
      .or_else(|| v.get("text"))
      .and_then(|x| x.as_str())
      .unwrap_or("");
    if !desc.is_empty() {
      return desc.chars().take(240).collect();
    }
  }
  raw.chars().take(240).collect()
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
pub async fn browser_eval_main(app: AppHandle, id: String, script: String) -> Result<String, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::eval_script_main(app, id, script).await;
  }
  browser_eval(app, id, script).await
}

#[tauri::command]
pub async fn browser_eval(app: AppHandle, id: String, script: String) -> Result<String, String> {
  #[cfg(target_os = "macos")]
  if crate::cef_runtime::cef_enabled() {
    return crate::cef::eval_script(app, id, script).await;
  }
  {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  if script.len() > 400_000 {
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
}

fn protocol_arg_str(args: &serde_json::Value, key: &str) -> Option<String> {
  args.get(key).and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

fn protocol_arg_f64(args: &serde_json::Value, key: &str) -> f64 {
  args
    .get(key)
    .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64)))
    .unwrap_or(0.0)
}

fn protocol_json<T: serde::Serialize>(value: T) -> Result<serde_json::Value, String> {
  serde_json::to_value(value).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_protocol(
  app: AppHandle,
  id: String,
  op: String,
  args: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
  let args = args.unwrap_or(serde_json::Value::Null);
  let first = dispatch_browser_protocol(app.clone(), id.clone(), op.clone(), args.clone()).await;
  #[cfg(target_os = "macos")]
  if let Err(err) = &first {
    if crate::cef_runtime::cef_enabled() && crate::cdp_client::is_session_dead(err) {
      crate::cef::drop_page_bind(&id);
      return match dispatch_browser_protocol(app, id, op, args).await {
        Err(again) if crate::cdp_client::is_session_dead(&again) => {
          Err(crate::cdp_client::HOST_CHANNEL_DOWN.into())
        }
        other => other,
      };
    }
  }
  first
}

async fn dispatch_browser_protocol(
  app: AppHandle,
  id: String,
  op: String,
  args: serde_json::Value,
) -> Result<serde_json::Value, String> {
  match op.as_str() {
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
    "click_node" => protocol_json(
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
    ),
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
          browser_set_cookies(app, id, cookies, url).await
        }
        "clear" => {
          browser_clear_cookies(
            app,
            id,
            url,
            protocol_arg_str(&args, "name"),
            protocol_arg_str(&args, "domain"),
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
  use super::{is_course_entry_url, is_homework_do_url, is_space_list_url, popup_should_drop};

  #[test]
  fn space_list_url_is_banned() {
    assert!(is_space_list_url("https://mooc1-1.chaoxing.com/visit/courses?s=1"));
    assert!(is_space_list_url("https://mooc1-1.chaoxing.com/visit/interaction"));
    assert!(is_space_list_url("https://mooc1-1.chaoxing.com/visit/courselist"));
    assert!(!is_space_list_url("https://i.chaoxing.com/base"));
    assert!(!is_space_list_url("https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1"));
  }

  #[test]
  fn homework_do_url_is_kept() {
    assert!(is_homework_do_url("https://mooc1.chaoxing.com/mooc-ans/work/dowork?courseId=1"));
    assert!(is_homework_do_url("https://mooc1.chaoxing.com/mooc2/work/doHomeWork?id=1"));
    assert!(is_homework_do_url("https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?workId=1"));
    assert!(!is_homework_do_url("https://mooc1.chaoxing.com/mooc2/work/list?courseId=1"));
  }

  #[test]
  fn click_popup_stays_except_nested_or_space_list() {
    let list = "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?pageHeader=8";
    assert!(!popup_should_drop(
      list,
      "https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?courseId=1&workId=2"
    ));
    assert!(!popup_should_drop(list, "https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?id=1"));
    assert!(is_course_entry_url("https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1"));
    assert!(!popup_should_drop(
      "https://i.chaoxing.com/base",
      "https://mooc2-ans.chaoxing.com/visit/stucoursemiddle?courseid=1"
    ));
    assert!(popup_should_drop(list, "https://mooc1-1.chaoxing.com/visit/courses?s=1"));
    assert!(popup_should_drop(list, "https://mooc1.chaoxing.com/knowledge/cards?clazzid=1"));
    assert!(popup_should_drop(list, "about:blank"));
    assert!(popup_should_drop(
      "https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1",
      "https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=2"
    ));
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
