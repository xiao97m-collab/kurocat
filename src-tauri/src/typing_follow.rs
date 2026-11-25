use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWindow};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::ffi::{c_char, c_void, CStr};
use std::sync::{mpsc, atomic::Ordering};
use tauri::{AppHandle, Manager};

use crate::{base_dimensions, pet_keyboard_layout, AppState, DUOROU_ID};

type CfType = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateSystemWide() -> CfType;
    fn AXUIElementGetTypeID() -> usize;
    fn AXUIElementSetMessagingTimeout(element: CfType, timeout: f32) -> i32;
    fn AXUIElementGetPid(element: CfType, pid: *mut i32) -> i32;
    fn AXUIElementCopyAttributeValue(element: CfType, name: CfType, result: *mut CfType) -> i32;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetValue(value: CfType, kind: u32, result: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFGetTypeID(value: CfType) -> usize;
    fn CFEqual(lhs: CfType, rhs: CfType) -> u8;
    fn CFRelease(value: CfType);
    fn CFStringCreateWithCString(allocator: CfType, value: *const c_char, encoding: u32) -> CfType;
}

struct RetainedCf(CfType);

impl RetainedCf {
    fn new(ptr: CfType) -> Option<Self> {
        (!ptr.is_null()).then(|| Self(ptr))
    }

    fn attribute(&self, name: &CStr) -> Option<Self> {
        let name = Self::string(name)?;
        let mut result = std::ptr::null();
        if unsafe { AXUIElementCopyAttributeValue(self.0, name.0, &mut result) } == 0 {
            Self::new(result)
        } else {
            None
        }
    }

    fn string(value: &CStr) -> Option<Self> {
        const UTF8: u32 = 0x0800_0100;
        Self::new(unsafe { CFStringCreateWithCString(std::ptr::null(), value.as_ptr(), UTF8) })
    }

    fn is(&self, value: &CStr) -> bool {
        Self::string(value).is_some_and(|value| unsafe { CFEqual(self.0, value.0) != 0 })
    }
}

impl Drop for RetainedCf {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

fn focused_input() -> Option<NSRect> {
    if !unsafe { AXIsProcessTrusted() } {
        return None;
    }
    let system = RetainedCf::new(unsafe { AXUIElementCreateSystemWide() })?;
    unsafe { AXUIElementSetMessagingTimeout(system.0, 0.12) };
    let input = system.attribute(c"AXFocusedUIElement")?;
    let mut pid = 0;
    if unsafe {
        CFGetTypeID(input.0) != AXUIElementGetTypeID()
            || AXUIElementGetPid(input.0, &mut pid) != 0
    } || pid == std::process::id() as i32
    {
        return None;
    }
    let role = input.attribute(c"AXRole")?;
    if !role.is(c"AXTextField") && !role.is(c"AXTextArea") {
        return None;
    }
    if input.attribute(c"AXSubrole").is_some_and(|subrole| subrole.is(c"AXSecureTextField")) {
        return None;
    }

    // Query the control's geometry only. CGPoint and CGSize are AXValue kinds 1 and 2.
    let position = input.attribute(c"AXPosition")?;
    let size = input.attribute(c"AXSize")?;
    let mut point = NSPoint::ZERO;
    let mut dimensions = NSSize::ZERO;
    let valid = unsafe {
        CFGetTypeID(position.0) == AXValueGetTypeID()
            && CFGetTypeID(size.0) == AXValueGetTypeID()
            && AXValueGetValue(position.0, 1, (&mut point as *mut NSPoint).cast())
            && AXValueGetValue(size.0, 2, (&mut dimensions as *mut NSSize).cast())
    };
    (valid
        && point.x.is_finite()
        && point.y.is_finite()
        && dimensions.width.is_finite()
        && dimensions.height.is_finite()
        && dimensions.width > 0.0
        && dimensions.height > 0.0)
        .then(|| NSRect::new(point, dimensions))
}

fn intersection_area(a: NSRect, b: NSRect) -> f64 {
    (a.max().x.min(b.max().x) - a.min().x.max(b.min().x)).max(0.0)
        * (a.max().y.min(b.max().y) - a.min().y.max(b.min().y)).max(0.0)
}

#[derive(Clone, Copy)]
pub(crate) struct Anchor {
    center: NSPoint,
    display: NSRect,
}

impl Anchor {
    fn is_near(self, next: Self, work_area: NSRect) -> bool {
        self.display == next.display
            && (self.center.x - next.center.x).hypot(self.center.y - next.center.y)
                <= work_area.size.width.hypot(work_area.size.height) / 3.0
    }
}

// All coordinates here are AppKit points, with the Y axis pointing up.
fn placement(field: NSRect, screen: NSRect, visible_pet: NSRect) -> Option<NSPoint> {
    let w = visible_pet.size.width;
    let h = visible_pet.size.height;
    let (left, right) = (screen.min().x + 8.0, screen.max().x - 8.0 - w);
    let (bottom, top) = (screen.min().y + 8.0, screen.max().y - 8.0 - h);
    if right < left || top < bottom {
        return None;
    }
    let x = (field.mid().x - w / 2.0).clamp(left, right);
    let y = (field.mid().y - h / 2.0).clamp(bottom, top);
    for gap in [50.0, 12.0] {
        let candidates = [
            (x, field.max().y + gap),
            (x, field.min().y - gap - h),
            (field.max().x + gap, y),
            (field.min().x - gap - w, y),
        ];
        for (x, y) in candidates {
            if (left..=right).contains(&x) && (bottom..=top).contains(&y) {
                return Some(NSPoint::new(x - visible_pet.min().x, y - visible_pet.min().y));
            }
        }
    }
    None
}

fn can_follow(state: &AppState) -> bool {
    !state.paused_guard.load(Ordering::Relaxed)
        && !state.dragging.load(Ordering::Relaxed)
        && !state.menu_open.load(Ordering::Relaxed)
        && !state.update_banner_open.load(Ordering::Relaxed)
        && state.settings.lock().unwrap().follow_typing
}

pub async fn target(app: AppHandle, move_window: bool) -> bool {
    if !can_follow(&app.state::<AppState>()) {
        return false;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(field) = focused_input() else { return false };
        let (tx, rx) = mpsc::sync_channel(1);
        let handle = app.clone();
        if app.run_on_main_thread(move || {
            let _ = tx.send(place_window(&handle, field, move_window));
        }).is_err() {
            return false;
        }
        rx.recv().unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

fn place_window(app: &AppHandle, mut field: NSRect, move_window: bool) -> bool {
    let state = app.state::<AppState>();
    if !can_follow(&state) {
        return false;
    }
    let Some(mtm) = MainThreadMarker::new() else { return false };
    let Some(window) = app.get_webview_window("main") else { return false };
    let Ok(raw) = window.ns_window() else { return false };
    // Tauri owns the NSWindow. Use it only inside the main-thread callback.
    let Some(native) = (unsafe { raw.cast::<NSWindow>().as_ref() }) else { return false };
    if !native.isVisible() {
        return false;
    }

    let screens = NSScreen::screens(mtm);
    if screens.count() == 0 {
        return false;
    }
    field.origin.y = screens.objectAtIndex(0).frame().max().y - field.max().y;
    let display = (0..screens.count())
        .map(|i| screens.objectAtIndex(i))
        .max_by(|a, b| intersection_area(field, a.frame()).total_cmp(&intersection_area(field, b.frame())));
    let Some(display) = display.filter(|screen| intersection_area(field, screen.frame()) > 0.0) else {
        return false;
    };
    let screen = display.visibleFrame();
    let next = Anchor { center: field.mid(), display: display.frame() };
    let mut anchor = state.typing_anchor.lock().unwrap();
    if anchor.is_some_and(|previous| previous.is_near(next, screen)) {
        return false;
    }

    let frame = native.frame();
    let settings = state.settings.lock().unwrap();
    let (bw, bh) = base_dimensions(pet_keyboard_layout(&settings));
    let scale = settings.scale.min(frame.size.width / bw).min(frame.size.height / bh);
    let (w, h) = (bw * scale, bh * scale);
    // The canvas draws the pet at the bottom-right. Ignore its transparent margins.
    let (left, top, right, bottom) = if settings.cat_breed == DUOROU_ID {
        (0.20, 0.13, 0.88, 0.88)
    } else {
        (0.03, 0.14, 0.97, 0.94)
    };
    let pet = NSRect::new(
        NSPoint::new(frame.size.width - w + left * w, (1.0 - bottom) * h),
        NSSize::new((right - left) * w, (bottom - top) * h),
    );
    let Some(target) = placement(field, screen, pet) else { return false };
    if (target.x - frame.origin.x).hypot(target.y - frame.origin.y) < 8.0 {
        *anchor = Some(next);
        return false;
    }
    if move_window {
        native.setFrameOrigin(target);
        *anchor = Some(next);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
    }

    #[test]
    fn typing_follow_ignores_nearby_fields_without_suppressing_other_displays() {
        let display = rect(0.0, 0.0, 1200.0, 900.0);
        let anchor = Anchor { center: NSPoint::new(100.0, 300.0), display };
        let at = |x| Anchor { center: NSPoint::new(x, 300.0), display };
        assert!(anchor.is_near(at(600.0), display));
        assert!(!anchor.is_near(at(601.0), display));
        let other = rect(-1200.0, 0.0, 1200.0, 900.0);
        assert!(!anchor.is_near(Anchor { display: other, ..at(102.0) }, other));
    }

    #[test]
    fn typing_follow_centers_above_the_field_with_a_gap_from_the_visible_pet() {
        let field = rect(-660.0, 80.0, 400.0, 60.0);
        let screen = rect(-900.0, 0.0, 900.0, 700.0);
        let pet = rect(40.0, 50.0, 280.0, 300.0);
        assert_eq!(placement(field, screen, pet), Some(NSPoint::new(-640.0, 140.0)));
    }

    #[test]
    fn typing_follow_falls_below_at_the_top_and_skips_when_the_field_fills_the_screen() {
        let screen = rect(0.0, 0.0, 800.0, 650.0);
        let pet = rect(20.0, 20.0, 300.0, 320.0);
        assert_eq!(placement(rect(610.0, 570.0, 180.0, 30.0), screen, pet),
            Some(NSPoint::new(472.0, 180.0)));
        assert_eq!(placement(screen, screen, pet), None);
    }
}
