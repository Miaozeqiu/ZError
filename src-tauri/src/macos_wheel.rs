//! App-local smoothing for coarse wheel events. Precise/gesture/momentum input
//! passes through unchanged. Never installs a system event tap or posts to it.
#[cfg(debug_assertions)]
#[path = "macos_scroll_probe.rs"]
mod probe;

use std::cell::RefCell;
use std::ptr::NonNull;
use std::rc::Rc;
use std::time::Instant;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, MainThreadMarker};
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType, NSView, NSWorkspace};
use objc2_core_graphics::{CGEvent, CGEventField, CGEventType, CGScrollEventUnit};
use objc2_foundation::{NSPoint, NSRunLoop, NSRunLoopCommonModes, NSTimer};

// Applied only after precise/gesture input has already passed through.
const COARSE_WHEEL_SPEED: f64 = 1.3;

/// Integrate remaining distance using elapsed time, not the number of callbacks.
/// Reversing direction drops only the old tail; it never moves against new input.
#[derive(Default)]
struct Axis {
    remaining: f64,
    fraction: f64,
}
impl Axis {
    fn add(&mut self, delta: f64) {
        if !delta.is_finite() || delta == 0.0 { return; }
        if self.remaining.signum() != delta.signum() {
            self.remaining = 0.0;
            self.fraction = 0.0;
        }
        self.remaining += delta;
    }
    fn step(&mut self, seconds: f64) -> i64 {
        let part = if self.remaining.abs() < 0.25 {
            self.remaining
        } else {
            self.remaining * (1.0 - (-seconds.clamp(0.0, 0.032) / 0.035).exp())
        };
        self.remaining -= part;
        self.fraction += part;
        let pixels = if self.remaining == 0.0 { self.fraction.round() } else { self.fraction.trunc() };
        self.fraction -= pixels;
        pixels as i64
    }
    fn active(&self) -> bool { self.remaining != 0.0 }
}

fn coarse_input(precise: bool, phase: usize, momentum: usize, continuous: bool) -> bool {
    !precise && phase == 0 && momentum == 0 && !continuous
}

struct Motion {
    target: Retained<NSView>,
    template: Retained<NSEvent>,
    location: NSPoint,
    x: Axis,
    y: Axis,
    last_tick: Instant,
}
struct State {
    webview: Retained<NSView>,
    motion: Option<Motion>,
    timer: Option<Retained<NSTimer>>,
}
impl State {
    fn stop(&mut self) {
        self.motion = None;
        if let Some(timer) = self.timer.take() { timer.invalidate(); }
    }
}
struct Registration {
    monitor: Retained<AnyObject>,
    state: Rc<RefCell<State>>,
}
impl Drop for Registration {
    fn drop(&mut self) {
        self.state.borrow_mut().stop();
        unsafe { NSEvent::removeMonitor(&self.monitor); }
    }
}
thread_local! {
    static REGISTRATION: RefCell<Option<Registration>> = const { RefCell::new(None) };
}

// Diagnostics for the isolated WKWebView smoke harness; no production IPC.
#[cfg(debug_assertions)]
mod diagnostics {
    use std::sync::atomic::{AtomicU64, Ordering};
    pub static PRECISE: AtomicU64 = AtomicU64::new(0);
    pub static COARSE: AtomicU64 = AtomicU64::new(0);
    pub static DELIVERED: AtomicU64 = AtomicU64::new(0);
    pub fn increment(counter: &AtomicU64) { counter.fetch_add(1, Ordering::Relaxed); }
    pub fn snapshot() -> serde_json::Value {
        serde_json::json!({"precisePassed": PRECISE.load(Ordering::Relaxed),
            "coarseSmoothed": COARSE.load(Ordering::Relaxed), "pixelFrames": DELIVERED.load(Ordering::Relaxed)})
    }
}
#[cfg(debug_assertions)]
#[allow(dead_code)]
pub fn debug_snapshot() -> serde_json::Value { diagnostics::snapshot() }

/// Select only the main WKWebView's native hit target. CEF and native controls
/// are siblings/other windows and must retain their own input handling.
unsafe fn target_at(webview: &NSView, event: &NSEvent) -> Option<Retained<NSView>> {
    let window = event.window(MainThreadMarker::new()?)?;
    if webview.window().as_deref() != Some(&window) { return None; }
    let content = window.contentView()?;
    let point = content.convertPoint_fromView(event.locationInWindow(), None);
    let target = content.hitTest(point)?;
    if target.isDescendantOf(webview) { Some(target) } else { None }
}

fn scroll_event(template: &NSEvent, x: i64, y: i64, unit: CGScrollEventUnit) -> Option<Retained<NSEvent>> {
    let original = template.CGEvent()?;
    // Preserve the original window association, but replace ALL scroll fields
    // from a real scroll-event constructor (including fixed-point deltas).
    let copy = CGEvent::new_copy(Some(&original))?;
    let delta = CGEvent::new_scroll_wheel_event2(None, unit, 2,
        i32::try_from(y).ok()?, i32::try_from(x).ok()?, 0)?;
    CGEvent::set_type(Some(&copy), CGEventType::ScrollWheel);
    for field in [CGEventField::ScrollWheelEventDeltaAxis1, CGEventField::ScrollWheelEventDeltaAxis2,
        CGEventField::ScrollWheelEventDeltaAxis3, CGEventField::ScrollWheelEventPointDeltaAxis1,
        CGEventField::ScrollWheelEventPointDeltaAxis2, CGEventField::ScrollWheelEventPointDeltaAxis3,
        CGEventField::ScrollWheelEventIsContinuous, CGEventField::ScrollWheelEventScrollPhase,
        CGEventField::ScrollWheelEventMomentumPhase] {
        CGEvent::set_integer_value_field(Some(&copy), field, CGEvent::integer_value_field(Some(&delta), field));
    }
    for field in [CGEventField::ScrollWheelEventFixedPtDeltaAxis1,
        CGEventField::ScrollWheelEventFixedPtDeltaAxis2, CGEventField::ScrollWheelEventFixedPtDeltaAxis3] {
        CGEvent::set_double_value_field(Some(&copy), field, CGEvent::double_value_field(Some(&delta), field));
    }
    let event = NSEvent::eventWithCGEvent(&copy)?;
    // CGEvent and NSEvent use different coordinate spaces. Round-trip the
    // location rather than assuming that screen coordinates are window-local.
    let wanted = template.locationInWindow();
    let actual = event.locationInWindow();
    if (wanted.x-actual.x).abs() > 0.01 || (wanted.y-actual.y).abs() > 0.01 {
        let point = CGEvent::location(Some(&copy));
        CGEvent::set_location(Some(&copy), NSPoint::new(point.x+wanted.x-actual.x, point.y+actual.y-wanted.y));
        return NSEvent::eventWithCGEvent(&copy);
    }
    Some(event)
}
fn pixel_event(template: &NSEvent, x: i64, y: i64) -> Option<Retained<NSEvent>> {
    scroll_event(template, x, y, CGScrollEventUnit::Pixel)
}

fn tick(state: &Rc<RefCell<State>>) {
    // Release the RefCell before calling AppKit: scrollWheel may re-enter it.
    let delivery = {
        let mut state = state.borrow_mut();
        let Some(motion) = state.motion.as_mut() else { return; };
        let valid = motion.target.window().is_some_and(|window| {
            // Inactive windows may receive ordinary native scroll events too.
            // Check the original hit location rather than the global pointer.
            window.isVisible() && !motion.target.isHiddenOrHasHiddenAncestor()
                && window.contentView().is_some_and(|content| {
                    let point = content.convertPoint_fromView(motion.location, None);
                    content.hitTest(point).as_deref() == Some(&motion.target)
                })
        });
        if !valid { state.stop(); return; }
        let now = Instant::now();
        let dt = now.duration_since(motion.last_tick).as_secs_f64();
        motion.last_tick = now;
        let x = motion.x.step(dt);
        let y = motion.y.step(dt);
        let event = if x != 0 || y != 0 { pixel_event(&motion.template, x, y) } else { None };
        let delivery = event.map(|event| (motion.target.clone(), event));
        if !motion.x.active() && !motion.y.active() { state.stop(); }
        delivery
    };
    if let Some((target, event)) = delivery {
        #[cfg(debug_assertions)]
        diagnostics::increment(&diagnostics::DELIVERED);
        #[cfg(debug_assertions)]
        probe::event(&state.borrow().webview, "delivery", &event);
        // Direct dispatch stays inside this application's WKWebView. It bypasses
        // the local monitor, so generated events cannot be smoothed twice.
        unsafe { let _: () = msg_send![&*target, scrollWheel: &*event]; }
    }
}

unsafe fn handle(state: &Rc<RefCell<State>>, event: &NSEvent) -> bool {
    if event.r#type() != NSEventType::ScrollWheel {
        // Ordinary pointer movement is not a wheel-gesture cancellation.
        // Consuming the wheel then dropping its tail loses real mouse input.
        if event.r#type() != NSEventType::MouseMoved { state.borrow_mut().stop(); }
        return false;
    }
    #[cfg(debug_assertions)]
    probe::event(&state.borrow().webview, "input", event);
    let cg = event.CGEvent();
    let continuous = cg.as_ref().is_some_and(|cg|
        CGEvent::integer_value_field(Some(cg), CGEventField::ScrollWheelEventIsContinuous) != 0);
    let modifiers = event.modifierFlags();
    let modified = modifiers.intersects(NSEventModifierFlags::Control | NSEventModifierFlags::Command
        | NSEventModifierFlags::Option | NSEventModifierFlags::Shift);
    let reduce_motion: bool = msg_send![&*NSWorkspace::sharedWorkspace(), accessibilityDisplayShouldReduceMotion];
    if !coarse_input(event.hasPreciseScrollingDeltas(), event.phase().0, event.momentumPhase().0, continuous)
        || modified || reduce_motion {
        #[cfg(debug_assertions)]
        diagnostics::increment(&diagnostics::PRECISE);
        state.borrow_mut().stop();
        return false;
    }
    let target = target_at(&state.borrow().webview, event);
    let Some(target) = target else { state.borrow_mut().stop(); return false; };
    // Use the system's point conversion (including its acceleration) when
    // available. Line-based events without it use a conventional 20px line.
    let pixels = |field, delta: f64| {
        let point = cg.as_ref().map_or(0, |cg| CGEvent::integer_value_field(Some(cg), field));
        let distance = if point != 0 { point as f64 } else { delta * 20.0 };
        distance * COARSE_WHEEL_SPEED
    };
    let x = pixels(CGEventField::ScrollWheelEventPointDeltaAxis2, event.scrollingDeltaX());
    let y = pixels(CGEventField::ScrollWheelEventPointDeltaAxis1, event.scrollingDeltaY());
    if !x.is_finite() || !y.is_finite() || (x == 0.0 && y == 0.0) { return false; }
    // If conversion fails, leave the original event untouched.
    if pixel_event(event, x.round() as i64, y.round() as i64).is_none() { return false; }
    enqueue(state, event, target, event.locationInWindow(), x, y);
    true
}

unsafe fn enqueue(state: &Rc<RefCell<State>>, event: &NSEvent, target: Retained<NSView>, location: NSPoint, x: f64, y: f64) {
    #[cfg(debug_assertions)]
    diagnostics::increment(&diagnostics::COARSE);
    let mut inner = state.borrow_mut();
    if inner.motion.as_ref().is_some_and(|m| m.target != target) {
        inner.stop();
    }
    let template = Retained::retain(event as *const NSEvent as *mut NSEvent).unwrap();
    let motion = inner.motion.get_or_insert_with(|| Motion {
        target, template: template.clone(), location, x: Axis::default(), y: Axis::default(), last_tick: Instant::now(),
    });
    motion.template = template;
    motion.location = location;
    motion.x.add(x);
    motion.y.add(y);
    if inner.timer.is_none() {
        let weak = Rc::downgrade(state);
        let block = RcBlock::new(move |_: NonNull<NSTimer>| {
            if let Some(state) = weak.upgrade() { tick(&state); }
        });
        let timer = NSTimer::timerWithTimeInterval_repeats_block(1.0 / 120.0, true, &block);
        NSRunLoop::mainRunLoop().addTimer_forMode(&timer, NSRunLoopCommonModes);
        inner.timer = Some(timer);
    }
}

// Test-only injection into this window, never into the global event stream.
// Exercises hit routing, classification, the shared timer and native WK delivery.
#[cfg(debug_assertions)]
#[allow(dead_code)]
pub fn debug_input(y: i32, precise: bool) -> Result<serde_json::Value, String> {
    REGISTRATION.with(|slot| unsafe {
        let slot = slot.borrow();
        let state = &slot.as_ref().ok_or("monitor missing")?.state;
        let view = state.borrow().webview.clone();
        let window = view.window().ok_or("window missing")?;
        let bounds = view.bounds();
        let point = NSPoint::new(bounds.size.width / 2.0, bounds.size.height / 2.0);
        let location = view.convertPoint_toView(point, None);
        let content = window.contentView().ok_or("content missing")?;
        let target = content.hitTest(content.convertPoint_fromView(location, None)).ok_or("hit missing")?;
        if !target.isDescendantOf(&view) { return Err("hit outside WKWebView".into()); }
        let mouse = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            NSEventType::MouseMoved, location, NSEventModifierFlags::empty(), 0.0,
            window.windowNumber(), None, 0, 0, 0.0).ok_or("template missing")?;
        let event = scroll_event(&mouse, 0, y as i64,
            if precise { CGScrollEventUnit::Pixel } else { CGScrollEventUnit::Line }).ok_or("NSEvent missing")?;
        let routed = target_at(&view, &event).is_some();
        if precise {
            if handle(state, &event) { return Err("precise event was intercepted".into()); }
            let _: () = msg_send![&*target, scrollWheel: &*event];
        } else {
            if !handle(state, &event) { return Err("coarse event was not intercepted".into()); }
            // Regression: pointer movement between the wheel and first timer
            // frame must not discard an already-consumed wheel event.
            handle(state, &mouse);
            if state.borrow().motion.is_none() { return Err("mouse movement discarded wheel input".into()); }
        }
        Ok(serde_json::json!({"hardwareRoutingTested": false, "syntheticWindowResolved": routed, "viewClass": view.class().name().to_string_lossy()}))
    })
}

pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform| unsafe {
        let Some(_) = MainThreadMarker::new() else { return; };
        let Some(webview) = Retained::retain(platform.inner() as *mut NSView) else { return; };
        let state = Rc::new(RefCell::new(State { webview, motion: None, timer: None }));
        let handler_state = state.clone();
        let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            if handle(&handler_state, event.as_ref()) { std::ptr::null_mut() } else { event.as_ptr() }
        });
        let mask = NSEventMask::ScrollWheel | NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown
            | NSEventMask::OtherMouseDown | NSEventMask::KeyDown | NSEventMask::FlagsChanged
            | NSEventMask::LeftMouseDragged | NSEventMask::RightMouseDragged;
        if let Some(monitor) = NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) {
            REGISTRATION.with(|slot| *slot.borrow_mut() = Some(Registration { monitor, state }));
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn precise_gesture_and_pre_smoothed_input_passes_through() {
        assert!(coarse_input(false, 0, 0, false));
        for input in [(true, 0, 0, false), (false, 1, 0, false), (false, 0, 2, false), (false, 0, 0, true)] {
            assert!(!coarse_input(input.0, input.1, input.2, input.3));
        }
    }
    #[test]
    fn converted_event_has_pixel_deltas_and_leaves_the_original_unchanged() {
        use objc2_core_graphics::CGScrollEventUnit;
        let raw = CGEvent::new_scroll_wheel_event2(None, CGScrollEventUnit::Line, 2, -3, 1, 0).unwrap();
        let original = NSEvent::eventWithCGEvent(&raw).unwrap();
        let before = (original.scrollingDeltaX(), original.scrollingDeltaY());
        let pixel = pixel_event(&original, 2, -7).unwrap();
        assert!(pixel.hasPreciseScrollingDeltas());
        assert_eq!((pixel.scrollingDeltaX(), pixel.scrollingDeltaY()), (2.0, -7.0));
        assert_eq!((original.scrollingDeltaX(), original.scrollingDeltaY()), before);
        assert!(!original.hasPreciseScrollingDeltas());
    }
    #[test]
    fn conserves_distance_at_different_refresh_rates() {
        for hz in [30.0, 60.0, 120.0] {
            let mut axis = Axis::default();
            axis.add(120.0);
            let mut total = 0;
            for _ in 0..120 { total += axis.step(1.0 / hz); }
            assert_eq!(total, 120);
            assert!(!axis.active());
        }
    }
    #[test]
    fn reverse_has_no_old_direction_tail_and_new_events_accumulate() {
        let mut axis = Axis::default();
        axis.add(120.0);
        assert!(axis.step(0.008) > 0);
        axis.add(-40.0);
        axis.add(-40.0);
        let mut total = 0;
        for _ in 0..120 {
            let step = axis.step(0.008);
            assert!(step <= 0);
            total += step;
        }
        assert_eq!(total, -80);
    }
}
