use std::cell::RefCell;

use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
            WindowsAndMessaging::{
                DestroyIcon, GetSystemMetrics, LoadImageW, SendMessageW, HICON, ICON_BIG,
                ICON_SMALL, IMAGE_ICON, LR_DEFAULTCOLOR, SM_CXICON, SM_CXSMICON, SM_CYICON,
                SM_CYSMICON, SYSTEM_METRICS_INDEX, WM_SETICON,
            },
        },
    },
};

// tauri-build embeds the ICO from bundle.icon as RT_GROUP_ICON 32512.
const APP_ICON_RESOURCE_ID: usize = 32512;

struct OwnedIcon(HICON);

impl Drop for OwnedIcon {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.0);
        }
    }
}

#[derive(Default)]
struct WindowIcons {
    small: Option<OwnedIcon>,
    big: Option<OwnedIcon>,
}

impl WindowIcons {
    fn update(&mut self, hwnd: HWND, module: HINSTANCE, dpi: u32) {
        let metric = |index: SYSTEM_METRICS_INDEX| unsafe {
            let size = GetSystemMetricsForDpi(index, dpi);
            if size > 0 {
                size
            } else {
                GetSystemMetrics(index)
            }
        };
        for (slot, current, width, height) in [
            (ICON_SMALL, &mut self.small, SM_CXSMICON, SM_CYSMICON),
            (ICON_BIG, &mut self.big, SM_CXICON, SM_CYICON),
        ] {
            // LR_SHARED can return the first cached size for both icon slots.
            let image = unsafe {
                LoadImageW(
                    module,
                    PCWSTR(APP_ICON_RESOURCE_ID as *const u16),
                    IMAGE_ICON,
                    metric(width),
                    metric(height),
                    LR_DEFAULTCOLOR,
                )
            };
            match image {
                Ok(image) => {
                    unsafe {
                        SendMessageW(hwnd, WM_SETICON, WPARAM(slot as usize), LPARAM(image.0));
                    }
                    // Release only the icon we own, after Windows has switched to the new one.
                    *current = Some(OwnedIcon(HICON(image.0)));
                }
                Err(error) => eprintln!("[zerror] Failed to load Windows window icon: {error}"),
            }
        }
    }
}

pub(crate) fn install<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let Ok(module) = (unsafe { GetModuleHandleW(None) }) else {
        return;
    };

    // Tauri and this crate use different versions of the windows bindings.
    let hwnd = HWND(hwnd.0 as isize);
    let module = HINSTANCE(module.0);
    let mut icons = WindowIcons::default();
    icons.update(hwnd, module, unsafe { GetDpiForWindow(hwnd) });

    // The window owns this listener and keeps the icon handles alive until destruction.
    let icons = RefCell::new(icons);
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::ScaleFactorChanged { scale_factor, .. } = event {
            let dpi = (scale_factor * 96.0).round() as u32;
            icons.borrow_mut().update(hwnd, module, dpi);
        }
    });
}
