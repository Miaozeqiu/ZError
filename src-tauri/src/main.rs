// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("cli") {
        std::process::exit(zerror_lib::cli::client::main(std::env::args().skip(2).collect()));
    }
    #[cfg(target_os = "macos")]
    {
        if zerror_lib::cef_runtime::maybe_run_helper() {
            return;
        }
    }
    zerror_lib::run()
}
