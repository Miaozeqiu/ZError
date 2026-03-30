use tauri::{AppHandle, Manager};

#[derive(Clone, Copy)]
pub struct WindowSizePreset {
    pub preferred_width: f64,
    pub preferred_height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub width_ratio: f64,
    pub height_ratio: f64,
    pub max_width: f64,
    pub max_height: f64,
}

impl WindowSizePreset {
    pub const fn new(
        preferred_width: f64,
        preferred_height: f64,
        min_width: f64,
        min_height: f64,
        width_ratio: f64,
        height_ratio: f64,
        max_width: f64,
        max_height: f64,
    ) -> Self {
        Self {
            preferred_width,
            preferred_height,
            min_width,
            min_height,
            width_ratio,
            height_ratio,
            max_width,
            max_height,
        }
    }
}

#[derive(Clone, Copy)]
pub struct ResolvedWindowSize {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}

pub const MAIN_WINDOW_PRESET: WindowSizePreset =
    WindowSizePreset::new(1200.0, 800.0, 800.0, 600.0, 0.78, 0.82, 1600.0, 1080.0);

pub const URL_CONTENT_WINDOW_PRESET: WindowSizePreset =
    WindowSizePreset::new(1200.0, 800.0, 1000.0, 600.0, 0.84, 0.86, 1720.0, 1180.0);

pub const FILE_INFO_WINDOW_PRESET: WindowSizePreset =
    WindowSizePreset::new(1280.0, 900.0, 960.0, 600.0, 0.84, 0.88, 1720.0, 1200.0);

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

pub fn resolve_window_size(app: &AppHandle, preset: WindowSizePreset) -> ResolvedWindowSize {
    let mut width = preset.preferred_width;
    let mut height = preset.preferred_height;
    let mut min_width = preset.min_width.min(width);
    let mut min_height = preset.min_height.min(height);

    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let scale_factor = monitor.scale_factor().max(1.0);
        let screen_width = monitor.size().width as f64 / scale_factor;
        let screen_height = monitor.size().height as f64 / scale_factor;

        let available_width = (screen_width - 48.0).max(640.0);
        let available_height = (screen_height - 72.0).max(480.0);

        let max_width = preset.max_width.min(available_width);
        let max_height = preset.max_height.min(available_height);

        width = clamp(
            (screen_width * preset.width_ratio).floor(),
            640.0,
            max_width,
        );
        height = clamp(
            (screen_height * preset.height_ratio).floor(),
            480.0,
            max_height,
        );

        min_width = preset.min_width.min(width);
        min_height = preset.min_height.min(height);
    }

    ResolvedWindowSize {
        width,
        height,
        min_width,
        min_height,
    }
}
