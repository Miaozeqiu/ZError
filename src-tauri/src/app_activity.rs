//! 抑制 macOS App Nap，避免后台时 WebView/定时器被挂起导致答题超时 408。

#[cfg(target_os = "macos")]
mod macos {
    use objc2::runtime::ProtocolObject;
    use objc2_foundation::{NSActivityOptions, NSObjectProtocol, NSProcessInfo, NSString};
    use std::sync::Mutex;

    struct ActivityToken {
        token: objc2::rc::Retained<ProtocolObject<dyn NSObjectProtocol>>,
    }

    // SAFETY: Foundation activity token 可跨线程 end；仅进程内一把锁串行访问
    unsafe impl Send for ActivityToken {}

    static ACTIVITY: Mutex<Option<ActivityToken>> = Mutex::new(None);

    pub fn start(reason: &str) {
        let mut guard = ACTIVITY.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return;
        }

        let info = NSProcessInfo::processInfo();
        let ns_reason = NSString::from_str(reason);
        let options = NSActivityOptions::UserInitiatedAllowingIdleSystemSleep
            | NSActivityOptions::SuddenTerminationDisabled
            | NSActivityOptions::AutomaticTerminationDisabled;

        let token = info.beginActivityWithOptions_reason(options, &ns_reason);
        *guard = Some(ActivityToken { token });
        println!("🛡️ macOS activity started (anti App Nap): {}", reason);
    }

    pub fn stop() {
        let mut guard = ACTIVITY.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(activity) = guard.take() {
            let info = NSProcessInfo::processInfo();
            // SAFETY: token 来自 beginActivity，成对 endActivity
            unsafe {
                info.endActivity(&activity.token);
            }
            println!("🛡️ macOS activity ended");
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    pub fn start(_reason: &str) {}
    pub fn stop() {}
}

pub fn begin_server_activity() {
    macos::start("ZError HTTP server answering requests");
}

pub fn end_server_activity() {
    macos::stop();
}
