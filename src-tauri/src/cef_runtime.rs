//! macOS CEF 运行时：加载框架、helper 进程、外部消息泵、调试端口。
#![cfg(target_os = "macos")]

use cef::{self, *};
use objc2::encode::Encode;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::sel;
use std::ffi::CString;
use std::path::{Path, PathBuf};
use std::os::raw::{c_long, c_void};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicPtr, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

pub const CHROME_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_DEBUG_PORT: i32 = 9333;

static FRAMEWORK_LOADED: OnceLock<()> = OnceLock::new();
static READY: AtomicBool = AtomicBool::new(false);
static DEBUG_PORT: AtomicI32 = AtomicI32::new(0);
static PUMP_STARTED: AtomicBool = AtomicBool::new(false);
static PUMP_QUEUED: AtomicBool = AtomicBool::new(false);
static HANDLING_SEND_EVENT: AtomicBool = AtomicBool::new(false);
static ORIG_SEND_EVENT: AtomicPtr<()> = AtomicPtr::new(std::ptr::null_mut());
static SEND_EVENT_WRAPPED: AtomicBool = AtomicBool::new(false);

/// Chromium 在处理右键菜单等事件时会调 `[NSApp isHandlingSendEvent]`。
/// Tao 的 `TaoApp` 没实现 CefAppProtocol，未识别的 selector 会直接把整个进程杀掉。
pub fn install_app_protocol() {
  add_handling_send_event(c"NSApplication");
  add_handling_send_event(c"TaoApp");
  wrap_tao_send_event();
}

fn add_handling_send_event(name: &std::ffi::CStr) {
  let Some(cls) = AnyClass::get(name) else {
    return;
  };
  let cls_ptr = cls as *const AnyClass as *mut AnyClass;
  let get_types = CString::new(format!("{}@:", Bool::ENCODING)).expect("encoding");
  let set_types = CString::new(format!("v@:{}", Bool::ENCODING)).expect("encoding");
  unsafe {
    let _ = objc2::ffi::class_addMethod(
      cls_ptr,
      sel!(isHandlingSendEvent),
      std::mem::transmute::<unsafe extern "C-unwind" fn(*mut AnyObject, Sel) -> Bool, Imp>(
        is_handling_send_event,
      ),
      get_types.as_ptr(),
    );
    let _ = objc2::ffi::class_addMethod(
      cls_ptr,
      sel!(setHandlingSendEvent:),
      std::mem::transmute::<unsafe extern "C-unwind" fn(*mut AnyObject, Sel, Bool), Imp>(
        set_handling_send_event,
      ),
      set_types.as_ptr(),
    );
  }
}

fn wrap_tao_send_event() {
  if SEND_EVENT_WRAPPED.load(Ordering::SeqCst) {
    return;
  }
  let Some(cls) = AnyClass::get(c"TaoApp") else {
    return;
  };
  let Some(method) = cls.instance_method(sel!(sendEvent:)) else {
    return;
  };
  let wrapped = unsafe {
    std::mem::transmute::<
      unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject),
      Imp,
    >(wrapped_send_event)
  };
  let prev = unsafe { method.set_implementation(wrapped) };
  ORIG_SEND_EVENT.store(unsafe { std::mem::transmute::<Imp, *mut ()>(prev) }, Ordering::SeqCst);
  SEND_EVENT_WRAPPED.store(true, Ordering::SeqCst);
  eprintln!("[cef] 已给 TaoApp 补上 Chromium CefAppProtocol（右键不再闪退）");
}

unsafe extern "C-unwind" fn is_handling_send_event(
  _this: *mut AnyObject,
  _cmd: Sel,
) -> Bool {
  Bool::new(HANDLING_SEND_EVENT.load(Ordering::SeqCst))
}

unsafe extern "C-unwind" fn set_handling_send_event(
  _this: *mut AnyObject,
  _cmd: Sel,
  handling: Bool,
) {
  HANDLING_SEND_EVENT.store(handling.as_bool(), Ordering::SeqCst);
}

struct RestoreHandling(bool);

impl Drop for RestoreHandling {
  fn drop(&mut self) {
    HANDLING_SEND_EVENT.store(self.0, Ordering::SeqCst);
  }
}

unsafe extern "C-unwind" fn wrapped_send_event(
  this: *mut AnyObject,
  cmd: Sel,
  event: *mut AnyObject,
) {
  let _guard = RestoreHandling(HANDLING_SEND_EVENT.swap(true, Ordering::SeqCst));
  let orig = ORIG_SEND_EVENT.load(Ordering::SeqCst);
  if orig.is_null() {
    return;
  }
  let orig: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) =
    std::mem::transmute(orig);
  orig(this, cmd, event);
}

wrap_browser_process_handler! {
  pub struct ZeBrowserProcess;

  impl BrowserProcessHandler {
    fn on_schedule_message_pump_work(&self, delay_ms: i64) {
      schedule_pump(delay_ms);
    }
  }
}

wrap_app! {
  pub struct ZeCefApp {
    process: BrowserProcessHandler,
  }

  impl App {
    fn on_before_command_line_processing(
      &self,
      _process_type: Option<&CefString>,
      command_line: Option<&mut CommandLine>,
    ) {
      let Some(cmd) = command_line else { return };
      for flag in [
        "disable-gpu-shader-disk-cache",
        "no-first-run",
        "no-default-browser-check",
        // 不走系统钥匙串：弹窗会卡住主线程，整个 Tauri 进程被 Chromium 杀掉
        "use-mock-keychain",
        // 作业名单 / 课表在跨源 iframe 里。不是 CORS，是 SOP：关掉后页内才能读 contentDocument。
        "disable-web-security",
        "disable-site-isolation-trials",
        // 开源 CEF 无 H.264 时，学习通视频走本机 1430。自编译带编码的框架不再需要。允许 https 页加载 localhost 媒体。
        "allow-running-insecure-content",
      ] {
        let sw = CefString::from(flag);
        cmd.append_switch(Some(&sw));
      }
      let feat = CefString::from("disable-features");
      let val = CefString::from("IsolateOrigins,site-per-process");
      cmd.append_switch_with_value(Some(&feat), Some(&val));
    }

    fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
      Some(self.process.clone())
    }
  }
}

#[repr(C)]
struct CfRunLoopTimerContext {
  version: c_long,
  info: *mut c_void,
  retain: Option<extern "C" fn(*const c_void) -> *const c_void>,
  release: Option<extern "C" fn(*const c_void)>,
  copy_description: Option<extern "C" fn(*const c_void) -> *const c_void>,
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
  fn CFAbsoluteTimeGetCurrent() -> f64;
  fn CFRunLoopGetMain() -> *mut c_void;
  fn CFRunLoopAddTimer(rl: *mut c_void, timer: *mut c_void, mode: *const c_void);
  fn CFRunLoopTimerCreate(
    allocator: *const c_void,
    fire_date: f64,
    interval: f64,
    flags: usize,
    order: c_long,
    callout: extern "C" fn(*mut c_void, *mut c_void),
    context: *mut CfRunLoopTimerContext,
  ) -> *mut c_void;
  fn CFRunLoopTimerSetTolerance(timer: *mut c_void, tolerance: f64);
  static kCFRunLoopCommonModes: *const c_void;
}

extern "C" fn on_runloop_pump(_timer: *mut c_void, _info: *mut c_void) {
  if READY.load(Ordering::SeqCst) {
    do_message_loop_work();
  }
}

/// 主线程上最多挂一笔 CEF 泵。给 create_browser 等一次性唤醒用。
fn queue_pump(app: &tauri::AppHandle) {
  if PUMP_QUEUED.swap(true, Ordering::SeqCst) {
    return;
  }
  let app = app.clone();
  if app
    .run_on_main_thread(move || {
      if READY.load(Ordering::SeqCst) {
        do_message_loop_work();
      }
      PUMP_QUEUED.store(false, Ordering::SeqCst);
    })
    .is_err()
  {
    PUMP_QUEUED.store(false, Ordering::SeqCst);
  }
}

fn schedule_pump(delay_ms: i64) {
  // 视频会在 DoMessageLoopWork 里以 delay=0 立刻再调度。
  // 再往 GCD 主队列塞泵会饿死 WK 的 NSRunLoop，侧栏假死、CEF 视频仍正常。
  let _ = delay_ms;
}

pub fn pump_now() {
  if READY.load(Ordering::SeqCst) {
    do_message_loop_work();
  }
}

fn dir_with_framework(root: &Path, depth: u8) -> Option<PathBuf> {
  if root.join("Chromium Embedded Framework.framework").is_dir() {
    return Some(root.to_path_buf());
  }
  if depth == 0 {
    return None;
  }
  let Ok(entries) = std::fs::read_dir(root) else {
    return None;
  };
  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    if let Some(found) = dir_with_framework(&path, depth - 1) {
      return Some(found);
    }
  }
  None
}

/// 下载缓存里的框架目录（含 Chromium Embedded Framework.framework）。
fn downloaded_framework_dir() -> Option<PathBuf> {
  if let Ok(raw) = std::env::var("CEF_PATH") {
    if let Some(found) = dir_with_framework(Path::new(&raw), 4) {
      return Some(found);
    }
  }
  if let Some(home) = dirs_next_or_home() {
    if let Some(found) = dir_with_framework(&home.join(".local/share/cef"), 4) {
      return Some(found);
    }
  }
  None
}

fn enclosing_app(path: &Path) -> Option<PathBuf> {
  let mut cur = path.to_path_buf();
  for _ in 0..8 {
    if cur.extension().and_then(|e| e.to_str()) == Some("app") {
      return Some(cur);
    }
    cur = cur.parent()?.to_path_buf();
  }
  None
}

fn main_app_plist() -> &'static str {
  r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>zerror</string>
  <key>CFBundleIdentifier</key>
  <string>com.zerror.app</string>
  <key>CFBundleName</key>
  <string>ZError</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
"#
}

fn ensure_dev_app_bundle(app: &Path, exe: &Path) -> Result<(), String> {
  let macos = app.join("Contents/MacOS");
  std::fs::create_dir_all(&macos).map_err(|e| e.to_string())?;
  std::fs::write(app.join("Contents/Info.plist"), main_app_plist()).map_err(|e| e.to_string())?;
  let dest = macos.join("zerror");
  if !dest.is_file() {
    let _ = std::fs::remove_file(&dest);
    if std::fs::hard_link(exe, &dest).is_err() {
      std::os::unix::fs::symlink(exe, &dest).map_err(|e| format!("链接主程序进 .app 失败: {e}"))?;
    }
  }
  Ok(())
}

/// 主程序 .app：打包后是真 bundle；cargo 开发时造一份 target/debug/ZError.app。
fn runtime_app_bundle() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  if let Some(app) = enclosing_app(&exe) {
    let name = app.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.contains("Helper") {
      if let Some(main) = app.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
        if main.extension().and_then(|e| e.to_str()) == Some("app") {
          return Ok(main.to_path_buf());
        }
      }
    } else {
      return Ok(app);
    }
  }
  let app = exe
    .parent()
    .map(|p| p.join("ZError.app"))
    .ok_or_else(|| "无法解析开发用 .app".to_string())?;
  ensure_dev_app_bundle(&app, &exe)?;
  Ok(app)
}

/// 运行时 Frameworks：必须在 Main.app/Contents/Frameworks，Mach 端口才能对上。
fn runtime_frameworks_dir() -> Result<PathBuf, String> {
  let dir = runtime_app_bundle()?.join("Contents/Frameworks");
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建 Frameworks 失败: {e}"))?;
  Ok(dir)
}

fn helper_bundle_id(name: &str) -> &'static str {
  match name {
    "ZError Helper (GPU)" => "com.zerror.app.helper.gpu",
    "ZError Helper (Plugin)" => "com.zerror.app.helper.plugin",
    "ZError Helper (Renderer)" => "com.zerror.app.helper.renderer",
    _ => "com.zerror.app.helper",
  }
}

fn dirs_next_or_home() -> Option<PathBuf> {
  std::env::var_os("HOME").map(PathBuf::from)
}

fn bind_api_version() {
  let _ = api_hash(cef::sys::CEF_API_VERSION, 0);
}

fn helper_exe(frameworks: &Path) -> PathBuf {
  frameworks
    .join("ZError Helper.app")
    .join("Contents/MacOS/ZError Helper")
}

fn write_helper_plist(dest: &Path, name: &str) -> Result<(), String> {
  let id = helper_bundle_id(name);
  let plist = format!(
    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>{name}</string>
  <key>CFBundleIdentifier</key>
  <string>{id}</string>
  <key>CFBundleName</key>
  <string>{name}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
"#
  );
  std::fs::create_dir_all(dest.join("Contents/MacOS")).map_err(|e| e.to_string())?;
  std::fs::write(dest.join("Contents/Info.plist"), plist).map_err(|e| e.to_string())
}

fn ensure_runtime_layout(frameworks: &Path) -> Result<(), String> {
  let dest_fw = frameworks.join("Chromium Embedded Framework.framework");
  if !dest_fw.is_dir() {
    let mut srcs = Vec::new();
    if let Some(d) = downloaded_framework_dir() {
      srcs.push(d.join("Chromium Embedded Framework.framework"));
    }
    if let Ok(exe) = std::env::current_exe() {
      if let Some(dir) = exe.parent().and_then(|p| p.parent()) {
        srcs.push(dir.join("Frameworks/Chromium Embedded Framework.framework"));
      }
    }
    let src = srcs
      .into_iter()
      .find(|p| p.is_dir())
      .ok_or_else(|| {
        "没有找到 Chromium Embedded Framework。先运行 scripts/setup-cef-macos.sh".to_string()
      })?;
    std::os::unix::fs::symlink(&src, &dest_fw).map_err(|e| {
      format!("链接 CEF 框架失败（{} → {}）: {e}", src.display(), dest_fw.display())
    })?;
  }
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  for name in [
    "ZError Helper",
    "ZError Helper (GPU)",
    "ZError Helper (Plugin)",
    "ZError Helper (Renderer)",
  ] {
    let app = frameworks.join(format!("{name}.app"));
    write_helper_plist(&app, name)?;
    let bin = app.join("Contents/MacOS").join(name);
    let replace = !bin.is_file()
      || bin
        .symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    if replace {
      let _ = std::fs::remove_file(&bin);
      if std::fs::hard_link(&exe, &bin).is_err() {
        std::os::unix::fs::symlink(&exe, &bin)
          .map_err(|e| format!("链接 helper {name} 失败: {e}"))?;
      }
    }
  }
  Ok(())
}

fn framework_binary(frameworks: &Path) -> PathBuf {
  frameworks
    .join("Chromium Embedded Framework.framework")
    .join("Chromium Embedded Framework")
}

fn frameworks_beside_helper(path: &Path) -> Option<PathBuf> {
  if !path.to_string_lossy().contains("Helper.app") {
    return None;
  }
  path
    .parent()
    .and_then(|p| p.parent())
    .and_then(|p| p.parent())
    .and_then(|p| p.parent())
    .map(Path::to_path_buf)
}

fn candidate_framework_dirs() -> Vec<PathBuf> {
  let mut dirs = Vec::new();
  if let Some(arg0) = std::env::args_os().next() {
    if let Some(dir) = frameworks_beside_helper(&PathBuf::from(arg0)) {
      dirs.push(dir);
    }
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = frameworks_beside_helper(&exe) {
      dirs.push(dir);
    }
    if let Some(dir) = exe.parent() {
      dirs.push(dir.join("ZError.app/Contents/Frameworks"));
    }
    if let Some(dir) = exe.parent().and_then(|p| p.parent()) {
      dirs.push(dir.join("Frameworks"));
    }
  }
  if let Some(dir) = downloaded_framework_dir() {
    dirs.push(dir);
  }
  dirs
}

fn resolve_framework_binary() -> Result<PathBuf, String> {
  for dir in candidate_framework_dirs() {
    let bin = framework_binary(&dir);
    if bin.is_file() {
      return Ok(bin);
    }
  }
  Err(
    "没有找到 Chromium Embedded Framework。先运行 scripts/setup-cef-macos.sh".into(),
  )
}

fn load_library_file(bin: &Path) -> Result<(), String> {
  use std::ffi::CString;
  use std::os::unix::ffi::OsStrExt;
  let name =
    CString::new(bin.as_os_str().as_bytes()).map_err(|_| "CEF 框架路径无效".to_string())?;
  let ok = unsafe { load_library(Some(&*name.as_ptr().cast())) };
  if ok == 1 {
    Ok(())
  } else {
    Err(format!("cef_load_library 失败：{}", bin.display()))
  }
}

fn load_framework() -> Result<(), String> {
  if FRAMEWORK_LOADED.get().is_some() {
    return Ok(());
  }
  let bin = resolve_framework_binary()?;
  load_library_file(&bin)?;
  let _ = FRAMEWORK_LOADED.set(());
  Ok(())
}

/// CEF helper 子进程入口。返回 true 表示当前进程应立刻退出。
pub fn maybe_run_helper() -> bool {
  let args: Vec<String> = std::env::args().collect();
  let is_helper = args.iter().any(|a| a.starts_with("--type="));
  if !is_helper {
    return false;
  }
  install_app_protocol();
  if let Err(err) = load_framework() {
    eprintln!("[cef] helper 无法加载 Chromium Embedded Framework: {err}");
    std::process::exit(1);
  }
  bind_api_version();
  let cef_args = args::Args::new();
  let mut app = ZeCefApp::new(ZeBrowserProcess::new());
  let code = execute_process(
    Some(cef_args.as_main_args()),
    Some(&mut app),
    std::ptr::null_mut(),
  );
  std::process::exit(if code >= 0 { code } else { 0 });
}

pub fn is_ready() -> bool {
  READY.load(Ordering::SeqCst)
}

/// 设 `ZERROR_USE_WK=1` 时不启 CEF，浏览区走回 WKWebView（避免 Chromium 把整个进程杀掉）。
pub fn cef_enabled() -> bool {
  !matches!(
    std::env::var("ZERROR_USE_WK").as_deref(),
    Ok("1") | Ok("true") | Ok("TRUE")
  )
}

pub fn debug_port() -> i32 {
  DEBUG_PORT.load(Ordering::SeqCst)
}

pub fn profile_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|err| err.to_string())?
    .join("app-browsers")
    .join("chromium-profile-mock");
  std::fs::create_dir_all(&dir).map_err(|err| format!("创建 Chromium 配置目录失败: {err}"))?;
  Ok(dir)
}

/// 主进程初始化。必须在主线程、Tauri 窗口起来之前或 setup 里调用。
pub fn initialize_browser_process(app: &tauri::AppHandle) -> Result<(), String> {
  if READY.load(Ordering::SeqCst) {
    return Ok(());
  }
  install_app_protocol();
  load_framework()?;
  bind_api_version();

  let app_bundle = runtime_app_bundle()?;
  let runtime = runtime_frameworks_dir()?;
  ensure_runtime_layout(&runtime)?;
  let helper = helper_exe(&runtime);
  if !helper.is_file() {
    return Err(format!(
      "缺少 helper：{}。请运行 scripts/setup-cef-macos.sh",
      helper.display()
    ));
  }
  let framework_path = runtime.join("Chromium Embedded Framework.framework");
  let profile = profile_dir(app)?;
  let port = DEFAULT_DEBUG_PORT;

  let cef_args = args::Args::new();
  let mut application = ZeCefApp::new(ZeBrowserProcess::new());
  let settings = Settings {
    no_sandbox: 1,
    external_message_pump: 1,
    remote_debugging_port: port,
    persist_session_cookies: 1,
    browser_subprocess_path: CefString::from(helper.to_string_lossy().as_ref()),
    framework_dir_path: CefString::from(framework_path.to_string_lossy().as_ref()),
    main_bundle_path: CefString::from(app_bundle.to_string_lossy().as_ref()),
    root_cache_path: CefString::from(profile.to_string_lossy().as_ref()),
    cache_path: CefString::from(profile.join("cache").to_string_lossy().as_ref()),
    user_agent: CefString::from(CHROME_UA),
    locale: CefString::from("zh-CN"),
    ..Default::default()
  };

  let ok = initialize(
    Some(cef_args.as_main_args()),
    Some(&settings),
    Some(&mut application),
    std::ptr::null_mut(),
  );
  if ok != 1 {
    return Err("CefInitialize 失败".into());
  }
  std::mem::forget(application);
  DEBUG_PORT.store(port, Ordering::SeqCst);
  READY.store(true, Ordering::SeqCst);
  start_pump(app);
  do_message_loop_work();
  eprintln!("[cef] 已初始化（主线程），CDP 端口 {port}，profile {}", profile.display());
  Ok(())
}

fn start_pump(_app: &tauri::AppHandle) {
  if PUMP_STARTED.swap(true, Ordering::SeqCst) {
    return;
  }
  unsafe {
    let mut ctx = CfRunLoopTimerContext {
      version: 0,
      info: std::ptr::null_mut(),
      retain: None,
      release: None,
      copy_description: None,
    };
    let timer = CFRunLoopTimerCreate(
      std::ptr::null(),
      CFAbsoluteTimeGetCurrent() + 0.024,
      0.024,
      0,
      0,
      on_runloop_pump,
      &mut ctx,
    );
    if timer.is_null() {
      eprintln!("[cef] 无法在主 RunLoop 上建泵");
      return;
    }
    CFRunLoopTimerSetTolerance(timer, 0.008);
    CFRunLoopAddTimer(CFRunLoopGetMain(), timer, kCFRunLoopCommonModes);
  }
}

/// 必须在 Tauri 主线程调用。CEF 会把调用线程当成 UI 线程。
pub fn ensure(app: &tauri::AppHandle) -> Result<(), String> {
  static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
  let _g = LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|e| e.to_string())?;
  initialize_browser_process(app)
}
