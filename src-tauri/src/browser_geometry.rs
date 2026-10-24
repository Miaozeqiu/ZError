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
}

impl AnchoredBrowserGeometry {
  pub fn new(rule: BrowserViewportLayout, x: f64, y: f64, width: f64, height: f64) -> Option<Self> {
    if ![rule.viewport_width, rule.viewport_height, rule.padding_ratio, rule.padding_min,
      rule.padding_max, rule.compact_breakpoint, rule.compact_padding, x, y, width, height]
      .iter().all(|value| value.is_finite())
      || rule.viewport_width <= 0.0 || rule.viewport_height <= 0.0
      || rule.padding_min < 0.0 || rule.padding_max < rule.padding_min
      || !(0.0..=0.5).contains(&rule.padding_ratio) || rule.compact_padding < 0.0 {
      return None;
    }
    let padding = rule.padding(rule.viewport_width);
    Some(Self { rule, left_extra: x - padding,
      right_extra: rule.viewport_width - x - width - padding,
      top: y, bottom: rule.viewport_height - y - height })
  }

  pub fn bounds(self, viewport_width: f64, viewport_height: f64) -> (f64, f64, f64, f64) {
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
      padding_min: 16.0, padding_max: 144.0, compact_breakpoint: 760.0, compact_padding: 12.0 }
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
}
