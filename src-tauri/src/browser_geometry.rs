//! 原生浏览区跟随窗口的锚点规则；不改变网页的固定 CSS 视口。
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewportLayout {
  pub viewport_width: f64,
  pub viewport_height: f64,
  pub padding_ratio: f64,
  pub padding_min: f64,
  pub padding_max: f64,
  pub compact_breakpoint: f64,
  pub compact_padding: f64,
  pub preview: Option<PreviewViewportLayout>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewViewportLayout {
  pub wide_width: f64,
  pub medium_width: f64,
  pub compact_width: f64,
  pub wide_padding: f64,
  pub medium_padding: f64,
  pub compact_padding: f64,
  pub medium_breakpoint: f64,
  pub compact_breakpoint: f64,
}

impl PreviewViewportLayout {
  fn pane(self, viewport_width: f64) -> (f64, f64) {
    if viewport_width <= self.compact_breakpoint { (self.compact_width, self.compact_padding) }
    else if viewport_width <= self.medium_breakpoint { (self.medium_width, self.medium_padding) }
    else { (self.wide_width, self.wide_padding) }
  }
  fn valid(self) -> bool {
    [self.wide_width, self.medium_width, self.compact_width, self.wide_padding, self.medium_padding,
      self.compact_padding, self.medium_breakpoint, self.compact_breakpoint].iter().all(|v| v.is_finite() && *v >= 0.0)
      && self.compact_breakpoint <= self.medium_breakpoint
  }
}

impl BrowserViewportLayout {
  fn padding(self, width: f64) -> f64 {
    if width <= self.compact_breakpoint { self.compact_padding }
    else { (width * self.padding_ratio).clamp(self.padding_min, self.padding_max) }
  }
}

#[derive(Clone, Copy)]
pub struct AnchoredBrowserGeometry {
  rule: BrowserViewportLayout,
  left_extra: f64,
  right_extra: f64,
  top: f64,
  bottom: f64,
  preview_size: Option<(f64, f64, f64, f64)>,
}

impl AnchoredBrowserGeometry {
  pub fn new(rule: BrowserViewportLayout, x: f64, y: f64, width: f64, height: f64) -> Option<Self> {
    if ![rule.viewport_width, rule.viewport_height, rule.padding_ratio, rule.padding_min,
      rule.padding_max, rule.compact_breakpoint, rule.compact_padding, x, y, width, height]
      .iter().all(|value| value.is_finite())
      || rule.viewport_width <= 0.0 || rule.viewport_height <= 0.0
      || rule.padding_min < 0.0 || rule.padding_max < rule.padding_min
      || !(0.0..=0.5).contains(&rule.padding_ratio) || rule.compact_padding < 0.0
      || width <= 0.0 || height <= 0.0 || rule.preview.is_some_and(|preview| !preview.valid()) {
      return None;
    }
    let padding = rule.padding(rule.viewport_width);
    Some(Self { rule, left_extra: x - padding,
      right_extra: rule.viewport_width - x - width - padding,
      top: y, bottom: rule.viewport_height - y - height,
      preview_size: rule.preview.map(|preview| {
        let (pane, padding) = preview.pane(rule.viewport_width);
        (width, height, pane, padding)
      }) })
  }

  pub fn bounds(self, viewport_width: f64, viewport_height: f64) -> (f64, f64, f64, f64) {
    if let (Some(preview), Some((width, height, old_pane, old_padding))) = (self.rule.preview, self.preview_size) {
      let (pane, padding) = preview.pane(viewport_width);
      let new_width = (width + pane - old_pane - 2.0 * (padding - old_padding)).max(1.0);
      let right = self.rule.viewport_width - self.left_extra - self.rule.padding(self.rule.viewport_width) - width
        + padding - old_padding;
      return (viewport_width - right - new_width, self.top, new_width, height * new_width / width);
    }
    let padding = self.rule.padding(viewport_width);
    let x = padding + self.left_extra;
    let right = padding + self.right_extra;
    (x, self.top, (viewport_width - x - right).max(1.0), (viewport_height - self.top - self.bottom).max(1.0))
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  fn rule() -> BrowserViewportLayout {
    BrowserViewportLayout { viewport_width: 1200.0, viewport_height: 800.0, padding_ratio: 0.07,
      padding_min: 16.0, padding_max: 144.0, compact_breakpoint: 760.0, compact_padding: 12.0, preview: None }
  }
  #[test]
  fn native_resize_tracks_css_insets_without_waiting_for_javascript() {
    let layout = AnchoredBrowserGeometry::new(rule(), 86.0, 46.0, 1028.0, 680.0).unwrap();
    for (width, height, inset) in [(1400.0, 900.0, 100.0), (2300.0, 1000.0, 146.0), (700.0, 600.0, 14.0)] {
      let (x, y, w, h) = layout.bounds(width, height);
      assert!((x - inset).abs() < 0.001);
      assert_eq!(y, 46.0);
      assert!((w - (width - 2.0 * inset)).abs() < 0.001);
      assert_eq!(h, height - 120.0);
    }
  }
  #[test]
  fn delayed_bounds_are_resolved_against_current_native_window() {
    let layout = AnchoredBrowserGeometry::new(rule(), 86.0, 120.0, 1028.0, 606.0).unwrap();
    assert_eq!(layout.bounds(1600.0, 1000.0), (114.0, 120.0, 1372.0, 806.0));
  }
  #[test]
  fn invalid_rules_cannot_create_nan_frames_or_panic_on_clamp() {
    let mut invalid = rule(); invalid.padding_max = -1.0;
    assert!(AnchoredBrowserGeometry::new(invalid, 0.0, 0.0, 10.0, 10.0).is_none());
    assert!(AnchoredBrowserGeometry::new(rule(), f64::NAN, 0.0, 10.0, 10.0).is_none());
  }
  #[test]
  fn preview_tracks_right_edge_and_sidebar_breakpoints_during_native_resize() {
    let mut r = rule();
    r.preview = Some(PreviewViewportLayout { wide_width: 252.0, medium_width: 210.0, compact_width: 150.0,
      wide_padding: 14.0, medium_padding: 10.0, compact_padding: 8.0,
      medium_breakpoint: 1150.0, compact_breakpoint: 760.0 });
    let layout = AnchoredBrowserGeometry::new(r, 963.0, 90.0, 223.0, 125.4375).unwrap();
    for (viewport, expected_x, expected_width, expected_right) in [
      (1600.0, 1363.0, 223.0, 14.0), (1000.0, 801.0, 189.0, 10.0), (700.0, 559.0, 133.0, 8.0),
    ] {
      let (x, y, width, height) = layout.bounds(viewport, 1100.0);
      assert!((x - expected_x).abs() < 0.001);
      assert!((width - expected_width).abs() < 0.001);
      assert!((viewport - x - width - expected_right).abs() < 0.001);
      assert_eq!(y, 90.0);
      assert!((height / width - 125.4375 / 223.0).abs() < 0.001);
    }
  }
  #[test]
  fn preview_rejects_invalid_breakpoint_rules() {
    let mut r = rule();
    r.preview = Some(PreviewViewportLayout { wide_width: 252.0, medium_width: 210.0, compact_width: 150.0,
      wide_padding: 14.0, medium_padding: 10.0, compact_padding: 8.0,
      medium_breakpoint: 700.0, compact_breakpoint: 760.0 });
    assert!(AnchoredBrowserGeometry::new(r, 900.0, 50.0, 223.0, 125.0).is_none());
  }
}
