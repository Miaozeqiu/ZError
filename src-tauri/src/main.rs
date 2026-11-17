// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    {
        if zerror_lib::cef_runtime::maybe_run_helper() {
            return;
        }
    }
    zerror_lib::run()
}
