use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWindow, NSWorkspace};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::ffi::{c_char, c_void, CStr};
use std::sync::{atomic::Ordering, mpsc, Mutex};
use tauri::{AppHandle, Manager};

use crate::AppState;

type CfType = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateApplication(pid: i32) -> CfType;
    fn AXUIElementCreateSystemWide() -> CfType;
    fn AXUIElementGetTypeID() -> usize;
    fn AXUIElementSetMessagingTimeout(element: CfType, timeout: f32) -> i32;
    fn AXUIElementGetPid(element: CfType, pid: *mut i32) -> i32;
    fn AXUIElementCopyAttributeValue(element: CfType, name: CfType, result: *mut CfType) -> i32;
    fn AXUIElementIsAttributeSettable(element: CfType, name: CfType, result: *mut u8) -> i32;
    fn AXUIElementCopyParameterizedAttributeValue(
        element: CfType,
        name: CfType,
        parameter: CfType,
        result: *mut CfType,
    ) -> i32;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetValue(value: CfType, kind: u32, result: *mut c_void) -> bool;
    fn CGWindowListCopyWindowInfo(options: u32, relative_to_window: u32) -> CfType;
    fn CGRectMakeWithDictionaryRepresentation(bounds: CfType, result: *mut NSRect) -> bool;
    static kCGWindowOwnerPID: CfType;
    static kCGWindowLayer: CfType;
    static kCGWindowBounds: CfType;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFGetTypeID(value: CfType) -> usize;
    fn CFEqual(lhs: CfType, rhs: CfType) -> u8;
    fn CFRelease(value: CfType);
    fn CFStringCreateWithCString(allocator: CfType, value: *const c_char, encoding: u32) -> CfType;
    fn CFArrayGetCount(array: CfType) -> isize;
    fn CFArrayGetValueAtIndex(array: CfType, index: isize) -> CfType;
    fn CFDictionaryGetValue(dictionary: CfType, key: CfType) -> CfType;
    fn CFNumberGetValue(number: CfType, kind: isize, result: *mut i32) -> u8;
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

    fn belongs_to(&self, pid: i32) -> bool {
        let mut owner = 0;
        unsafe {
            CFGetTypeID(self.0) == AXUIElementGetTypeID()
                && AXUIElementGetPid(self.0, &mut owner) == 0
                && owner == pid
        }
    }

    fn is_settable(&self, attribute: &CStr) -> bool {
        let Some(name) = Self::string(attribute) else {
            return false;
        };
        let mut settable = 0;
        unsafe {
            AXUIElementIsAttributeSettable(self.0, name.0, &mut settable) == 0 && settable != 0
        }
    }

    fn caret_rect(&self) -> Option<NSRect> {
        let selection = self.attribute(c"AXSelectedTextRange")?;
        let name = Self::string(c"AXBoundsForRange")?;
        let mut result = std::ptr::null();
        if unsafe { AXUIElementCopyParameterizedAttributeValue(self.0, name.0, selection.0, &mut result) } != 0 {
            return None;
        }
        let value = Self::new(result)?;
        let mut rect = NSRect::ZERO;
        if unsafe {
            CFGetTypeID(value.0) != AXValueGetTypeID()
                || !AXValueGetValue(value.0, 3, (&mut rect as *mut NSRect).cast())
        } {
            return None;
        }
        // An insertion caret can have zero width and still identify its screen.
        if !rect.size.width.is_finite() || rect.size.width < 0.0 {
            return None;
        }
        rect.size.width = rect.size.width.max(1.0);
        valid_rect(rect)
    }
}

impl Drop for RetainedCf {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) };
    }
}

const NO_EDITOR: &str = "前台应用未提供可用的焦点编辑框";
const NO_BOUNDS: &str = "识别到编辑框，但无法读取位置";
const SECURE_INPUT: &str = "安全输入框";
static LAST_PROBE: Mutex<&'static str> = Mutex::new("尚未收到跟随检查");

pub(crate) fn last_probe() -> &'static str {
    *LAST_PROBE.lock().unwrap()
}

fn report(status: &'static str, result: bool) -> bool {
    *LAST_PROBE.lock().unwrap() = status;
    result
}

fn valid_rect(rect: NSRect) -> Option<NSRect> {
    let NSRect { origin, size } = rect;
    (origin.x.is_finite()
        && origin.y.is_finite()
        && size.width.is_finite()
        && size.height.is_finite()
        && size.width > 0.0
        && size.height > 0.0)
        .then_some(rect)
}

fn input_frame(input: &RetainedCf) -> Option<NSRect> {
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
    valid.then(|| NSRect::new(point, dimensions)).and_then(valid_rect)
}

fn supports_text_editing(
    is_settable: impl Fn(&CStr) -> bool,
    has_selected_range: impl FnOnce() -> bool,
) -> bool {
    (is_settable(c"AXValue") || is_settable(c"AXSelectedTextRange")) && has_selected_range()
}

fn editor_at(mut input: RetainedCf, pid: i32) -> Result<NSRect, &'static str> {
    for _ in 0..3 {
        if !input.belongs_to(pid) {
            break;
        }
        let role = input.attribute(c"AXRole").ok_or(NO_EDITOR)?;
        if role.is(c"AXSecureTextField")
            || input.attribute(c"AXSubrole").is_some_and(|subrole| subrole.is(c"AXSecureTextField"))
        {
            return Err(SECURE_INPUT);
        }
        let text_role = role.is(c"AXTextField") || role.is(c"AXTextArea");
        if text_role
            || supports_text_editing(
                |attribute| input.is_settable(attribute),
                || input.attribute(c"AXSelectedTextRange").is_some(),
            )
        {
            return input_frame(&input).or_else(|| input.caret_rect()).ok_or(NO_BOUNDS);
        }
        // A rich editor can expose its focused text node separately from the editable container.
        let other_element = |attribute| {
            input
                .attribute(attribute)
                .filter(|element| unsafe { CFEqual(input.0, element.0) == 0 })
        };
        let Some(editor) = other_element(c"AXFocusedUIElement")
            .or_else(|| other_element(c"AXEditableAncestor"))
        else {
            break;
        };
        input = editor;
    }
    Err(NO_EDITOR)
}

struct FocusedArea {
    editor: Option<NSRect>,
    window: Option<NSRect>,
}

fn onscreen_window_frame(pid: i32) -> Option<NSRect> {
    const ON_SCREEN_ONLY: u32 = 1;
    const EXCLUDE_DESKTOP: u32 = 16;
    const SINT32: isize = 3;
    let list = RetainedCf::new(unsafe {
        CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0)
    })?;
    // WindowServer lists windows front to back. Use the foreground app's first normal window.
    unsafe {
        (0..CFArrayGetCount(list.0)).find_map(|index| {
            let window = CFArrayGetValueAtIndex(list.0, index);
            let number = |key| {
                let value = CFDictionaryGetValue(window, key);
                let mut result = 0;
                (!value.is_null() && CFNumberGetValue(value, SINT32, &mut result) != 0)
                    .then_some(result)
            };
            if number(kCGWindowOwnerPID) != Some(pid) || number(kCGWindowLayer) != Some(0) {
                return None;
            }
            let bounds = CFDictionaryGetValue(window, kCGWindowBounds);
            let mut frame = NSRect::ZERO;
            (!bounds.is_null() && CGRectMakeWithDictionaryRepresentation(bounds, &mut frame))
                .then(|| valid_rect(frame))
                .flatten()
        })
    }
}

fn focused_area() -> Result<FocusedArea, &'static str> {
    const NO_WINDOW: &str = "未找到前台应用的窗口";
    let pid = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier())
        .ok_or(NO_WINDOW)?;
    if pid <= 0 || pid == std::process::id() as i32 {
        return Err(NO_WINDOW);
    }

    let mut editor = None;
    let mut window = None;
    if let Some(app) = unsafe { AXIsProcessTrusted() }
        .then(|| RetainedCf::new(unsafe { AXUIElementCreateApplication(pid) }))
        .flatten()
    {
        unsafe { AXUIElementSetMessagingTimeout(app.0, 0.12) };
        let focused = |root: &RetainedCf| {
            root.attribute(c"AXFocusedUIElement")
                .ok_or(NO_EDITOR)
                .and_then(|input| editor_at(input, pid))
        };
        let result = match focused(&app) {
            Err(reason) if reason != SECURE_INPUT => {
                RetainedCf::new(unsafe { AXUIElementCreateSystemWide() })
                    .map_or(Err(reason), |system| focused(&system))
            }
            result => result,
        };
        if result == Err(SECURE_INPUT) {
            return Err(SECURE_INPUT);
        }
        editor = result.ok();
        window = app
            .attribute(c"AXFocusedWindow")
            .and_then(|window| input_frame(&window));
    }
    let window = window.or_else(|| onscreen_window_frame(pid));
    if editor.is_none() && window.is_none() {
        return Err(NO_WINDOW);
    }
    Ok(FocusedArea { editor, window })
}

fn intersection_area(a: NSRect, b: NSRect) -> f64 {
    (a.max().x.min(b.max().x) - a.min().x.max(b.min().x)).max(0.0)
        * (a.max().y.min(b.max().y) - a.min().y.max(b.min().y)).max(0.0)
}

fn display_for_rect(rect: NSRect, screens: &[NSRect]) -> Option<usize> {
    screens.iter()
        .enumerate()
        .map(|(index, screen)| (index, intersection_area(rect, *screen)))
        .filter(|(_, area)| *area > 0.0)
        .max_by(|(_, left), (_, right)| left.total_cmp(right))
        .map(|(index, _)| index)
}

impl FocusedArea {
    fn across_displays(
        &self,
        screens: &[NSRect],
        current: Option<usize>,
    ) -> Result<usize, &'static str> {
        const NO_DISPLAY: &str = "无法定位输入所在屏幕";
        let desktop_top = screens.first().ok_or(NO_DISPLAY)?.max().y;
        let to_appkit = |mut rect: NSRect| {
            rect.origin.y = desktop_top - rect.max().y;
            rect
        };
        let window = self.window.map(to_appkit);
        let editor = self.editor.map(to_appkit)
            .filter(|editor| window.is_none_or(|window| intersection_area(*editor, window) > 0.0));
        let target = editor
            .and_then(|rect| display_for_rect(rect, screens))
            .or_else(|| window.and_then(|rect| display_for_rect(rect, screens)))
            .ok_or(NO_DISPLAY)?;
        if Some(target) == current {
            return Err("输入位置与桌宠同屏");
        }
        Ok(target)
    }
}

// AppKit points have an upward Y axis. The visible screen frame excludes the Dock and menu bar.
fn bottom_right_origin(screen: NSRect, window_size: NSSize) -> NSPoint {
    const INSET: f64 = 8.0;
    NSPoint::new(
        (screen.max().x - window_size.width - INSET).max(screen.min().x + INSET),
        screen.min().y + INSET,
    )
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
        return report("跟随关闭或桌宠正在交互", false);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let area = match objc2::rc::autoreleasepool(|_| focused_area()) {
            Ok(area) => area,
            Err(reason) => return report(reason, false),
        };
        let (tx, rx) = mpsc::sync_channel(1);
        let handle = app.clone();
        if app.run_on_main_thread(move || {
            let _ = tx.send(place_window(&handle, area, move_window));
        }).is_err() {
            return report("无法更新桌宠窗口", false);
        }
        rx.recv().unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

fn place_window(app: &AppHandle, area: FocusedArea, move_window: bool) -> bool {
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
    let frame = native.frame();
    let frames: Vec<_> = (0..screens.count())
        .map(|index| screens.objectAtIndex(index).frame())
        .collect();
    let current = display_for_rect(frame, &frames);
    let display = match area.across_displays(&frames, current) {
        Ok(target) => target,
        Err(reason) => return report(reason, false),
    };
    if move_window {
        let screen = screens.objectAtIndex(display).visibleFrame();
        native.setFrameOrigin(bottom_right_origin(screen, frame.size));
        return report("已跨屏移动", true);
    }
    report("输入位置在另一块屏幕，等待移位", true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
    }

    #[test]
    fn typing_follow_recognizes_editors_with_a_writable_selection_but_no_writable_value() {
        assert!(supports_text_editing(
            |name| name == c"AXSelectedTextRange",
            || true,
        ));
        assert!(supports_text_editing(|name| name == c"AXValue", || true));
        assert!(!supports_text_editing(|_| false, || true));
        assert!(!supports_text_editing(|_| true, || false));
    }

    #[test]
    fn typing_follow_rejects_nonfinite_or_degenerate_bounds() {
        let external_display_caret = rect(-800.0, 120.0, 1.0, 19.0);
        assert_eq!(valid_rect(external_display_caret), Some(external_display_caret));
        assert!(valid_rect(rect(f64::NAN, 120.0, 1.0, 19.0)).is_none());
        assert!(valid_rect(rect(0.0, 0.0, 100.0, 0.0)).is_none());
    }

    #[test]
    fn typing_follow_moves_in_both_directions_only_when_the_input_is_on_another_display() {
        let screens = [rect(0.0, 0.0, 1470.0, 956.0), rect(1470.0, 0.0, 1920.0, 1080.0)];
        let at = |x, y| FocusedArea {
            editor: Some(rect(x, y, 60.0, 40.0)),
            window: None,
        };
        for (x, y) in [(32.0, 900.0), (1370.0, 5.0)] {
            assert_eq!(at(x, y).across_displays(&screens, Some(0)), Err("输入位置与桌宠同屏"));
        }
        assert_eq!(at(1471.0, -100.0).across_displays(&screens, Some(0)), Ok(1));
        assert_eq!(at(1370.0, 5.0).across_displays(&screens, Some(1)), Ok(0));
    }

    #[test]
    fn typing_follow_uses_the_window_screen_when_editor_geometry_is_unavailable() {
        let screens = [rect(0.0, 0.0, 1200.0, 900.0), rect(-1000.0, 0.0, 1000.0, 700.0)];
        let area = FocusedArea { editor: None, window: Some(rect(-900.0, 220.0, 800.0, 650.0)) };
        assert_eq!(area.across_displays(&screens, Some(0)), Ok(1));
        assert_eq!(area.across_displays(&screens, Some(1)), Err("输入位置与桌宠同屏"));
        let area = FocusedArea { editor: Some(rect(2000.0, 1000.0, 100.0, 50.0)), ..area };
        assert_eq!(area.across_displays(&screens, Some(0)), Ok(1));
        let stale = FocusedArea { editor: Some(rect(20.0, 220.0, 40.0, 30.0)), ..area };
        assert_eq!(stale.across_displays(&screens, Some(0)), Ok(1));
        let spanning = FocusedArea {
            editor: Some(rect(-80.0, 220.0, 40.0, 30.0)),
            window: Some(rect(-300.0, 220.0, 1000.0, 650.0)),
        };
        assert_eq!(spanning.across_displays(&screens, Some(0)), Ok(1));
    }

    #[test]
    fn typing_follow_lands_in_the_usable_bottom_right_corner_of_either_screen() {
        let window = NSSize::new(353.0, 410.0);
        assert_eq!(
            bottom_right_origin(rect(0.0, 82.0, 1470.0, 836.0), window),
            NSPoint::new(1109.0, 90.0),
        );
        assert_eq!(
            bottom_right_origin(rect(1470.0, 0.0, 1920.0, 1080.0), window),
            NSPoint::new(3029.0, 8.0),
        );
    }
}
