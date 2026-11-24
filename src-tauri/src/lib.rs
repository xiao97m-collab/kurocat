#![recursion_limit = "256"]

mod cats;
mod config;
mod input_hook;
mod mcp;
mod tray;
mod updater;

use cats::{cats_path, desktop_cats, CatSkinConfig, DUOROU_ID};
use config::{
    config_path, load_settings, normalize_cat_breed, normalize_keyboard_layout,
    normalize_keyboard_orientation, save_settings, set_windows_autostart, AppSettings,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, State};

pub const BASE_WIDTH: f64 = 420.0;
pub const BASE_HEIGHT: f64 = 440.0;
pub const BASE_WIDTH_108: f64 = 540.0;
pub const BASE_HEIGHT_108: f64 = 456.0;
pub const MIN_WINDOW_WIDTH: f64 = 260.0;
pub const MIN_WINDOW_HEIGHT: f64 = 410.0;

fn pet_keyboard_layout(settings: &AppSettings) -> &str {
    if settings.cat_breed == DUOROU_ID {
        "65"
    } else {
        &settings.keyboard_layout
    }
}

pub fn base_dimensions(layout: &str) -> (f64, f64) {
    if layout == "108" {
        (BASE_WIDTH_108, BASE_HEIGHT_108)
    } else {
        (BASE_WIDTH, BASE_HEIGHT)
    }
}

pub fn window_dimensions(layout: &str, scale: f64) -> (f64, f64) {
    let (bw, bh) = base_dimensions(layout);
    let s = scale.clamp(0.20, 1.50);
    (
        (bw * s).round().max(MIN_WINDOW_WIDTH),
        (bh * s).round().max(MIN_WINDOW_HEIGHT),
    )
}

fn resize_window_anchored_bottom_right(
    win: &tauri::WebviewWindow,
    layout: &str,
    scale: f64,
) -> Option<(i32, i32)> {
    let (new_w, new_h) = window_dimensions(layout, scale);
    let old_pos = win.outer_position().ok();
    let old_size = win.outer_size().ok();
    let sf = win.scale_factor().unwrap_or(1.0);

    let _ = win.set_size(Size::Logical(LogicalSize::new(new_w, new_h)));

    if let (Some(pos), Some(sz)) = (old_pos, old_size) {
        let new_pw = (new_w * sf).round() as i32;
        let new_ph = (new_h * sf).round() as i32;
        let new_x = (pos.x + sz.width as i32 - new_pw).max(0);
        let new_y = (pos.y + sz.height as i32 - new_ph).max(0);
        if new_x != pos.x || new_y != pos.y {
            let _ = win.set_position(PhysicalPosition::new(new_x, new_y));
        }
        return Some((new_x, new_y));
    }
    None
}

pub fn run_mcp_stdio() {
    mcp::run_stdio_mcp();
}

pub struct AppState {
    pub settings: Arc<Mutex<AppSettings>>,
    pub menu_open: Arc<AtomicBool>,
    pub dragging: Arc<AtomicBool>,
    pub mcp_enabled: Arc<AtomicBool>,
    pub update_banner_open: Arc<AtomicBool>,
    pub paused_guard: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowCursorInfo {
    rel_x: f64,
    rel_y: f64,
    inside_window: bool,
    over_cat: bool,
    alt_override: bool,
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn get_cats() -> Vec<CatSkinConfig> {
    desktop_cats()
}

#[tauri::command]
fn get_mcp_config(state: State<'_, AppState>) -> String {
    let port = state.settings.lock().unwrap().mcp_port;
    let exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "KuroCat.exe".to_string());
    serde_json::to_string_pretty(&serde_json::json!({
        "mcpServers": {
            "kurocat": {
                "command": exe,
                "args": ["--mcp"],
                "url": format!("http://127.0.0.1:{}/mcp", port)
            }
        }
    }))
    .unwrap_or_default()
}

#[tauri::command]
fn update_settings(app: AppHandle, state: State<'_, AppState>, mut patch: AppSettings) -> AppSettings {
    patch.scale = patch.scale.clamp(0.20, 1.50);
    patch.cat_breed = normalize_cat_breed(&patch.cat_breed);
    if patch.mcp_port == 0 {
        patch.mcp_port = 27420;
    }
    patch.keyboard_layout = normalize_keyboard_layout(&patch.keyboard_layout);
    patch.keyboard_orientation = normalize_keyboard_orientation(&patch.keyboard_orientation);

    let (prev_autostart, prev_scale, prev_layout) = {
        let s = state.settings.lock().unwrap();
        (s.autostart, s.scale, pet_keyboard_layout(&s).to_string())
    };
    if patch.autostart != prev_autostart {
        let _ = set_windows_autostart(patch.autostart);
    }

    state.mcp_enabled.store(patch.mcp_enabled, Ordering::Relaxed);

    let layout = pet_keyboard_layout(&patch);
    let size_changed = (patch.scale - prev_scale).abs() > 0.005 || layout != prev_layout;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(patch.always_on_top);
        #[cfg(target_os = "macos")]
        configure_macos_fullscreen_overlay(&win, patch.always_on_top);
        if size_changed {
            if let Some((nx, ny)) = resize_window_anchored_bottom_right(&win, layout, patch.scale) {
                patch.x = Some(nx);
                patch.y = Some(ny);
            }
        }
    }

    {
        let mut s = state.settings.lock().unwrap();
        *s = patch.clone();
        save_settings(&s);
    }
    let _ = app.emit("kuro-settings", patch.clone());
    patch
}

#[tauri::command]
fn set_menu_open(state: State<'_, AppState>, open: bool) {
    state.menu_open.store(open, Ordering::Relaxed);
}

#[tauri::command]
fn set_dragging(state: State<'_, AppState>, dragging: bool) {
    state.dragging.store(dragging, Ordering::Relaxed);
}

#[tauri::command]
fn set_update_banner_open(state: State<'_, AppState>, open: bool) {
    state.update_banner_open.store(open, Ordering::Relaxed);
}

#[tauri::command]
fn get_app_version() -> String {
    updater::CURRENT_VERSION.to_string()
}

#[tauri::command]
async fn check_for_update() -> Result<updater::UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(updater::check_latest_update)
        .await
        .map_err(|e| format!("检查更新任务异常: {}", e))?
}

#[tauri::command]
async fn install_update(app: AppHandle, info: updater::UpdateInfo) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || updater::perform_update_install(&app, info))
        .await
        .map_err(|e| format!("安装更新任务异常: {}", e))?
}

#[tauri::command]
fn open_release_page(url: String) {
    updater::open_url_in_browser(&url);
}

#[tauri::command]
fn save_window_pos(app: AppHandle, state: State<'_, AppState>) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(pos) = win.outer_position() {
            let mut s = state.settings.lock().unwrap();
            s.x = Some(pos.x);
            s.y = Some(pos.y);
            save_settings(&s);
        }
    }
}

#[tauri::command]
fn reset_position(app: AppHandle) {
    reset_window_position(&app);
}

#[tauri::command]
fn create_desktop_shortcut() -> Result<String, String> {
    config::create_desktop_shortcut()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub fn apply_breed_and_save(app: &AppHandle, breed: &str) {
    let state = app.state::<AppState>();
    let mut patch = state.settings.lock().unwrap().clone();
    patch.cat_breed = breed.to_string();
    update_settings(app.clone(), state, patch);
}

pub fn reload_and_emit_all(app: &AppHandle) {
    let disk_settings = load_settings();
    let cats = desktop_cats();
    let state = app.state::<AppState>();

    let (size_changed, top_changed) = {
        let mut s = state.settings.lock().unwrap();
        let sc = (s.scale - disk_settings.scale).abs() > 0.01
            || pet_keyboard_layout(&s) != pet_keyboard_layout(&disk_settings);
        let tc = s.always_on_top != disk_settings.always_on_top;
        *s = disk_settings.clone();
        (sc, tc)
    };
    state
        .mcp_enabled
        .store(disk_settings.mcp_enabled, Ordering::Relaxed);

    if let Some(win) = app.get_webview_window("main") {
        if top_changed {
            let _ = win.set_always_on_top(disk_settings.always_on_top);
        }
        if size_changed {
            let _ = resize_window_anchored_bottom_right(
                &win,
                pet_keyboard_layout(&disk_settings),
                disk_settings.scale,
            );
        }
    }

    let _ = app.emit("kuro-cats", cats);
    let _ = app.emit("kuro-settings", disk_settings);
}

fn file_mtime(path: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

fn start_storage_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let c_path = cats_path();
        let s_path = config_path();
        let mut last_cats_m = file_mtime(&c_path);
        let mut last_settings_m = file_mtime(&s_path);

        loop {
            std::thread::sleep(Duration::from_millis(400));
            let cur_c = file_mtime(&c_path);
            let cur_s = file_mtime(&s_path);
            if cur_c != last_cats_m || cur_s != last_settings_m {
                last_cats_m = cur_c;
                last_settings_m = cur_s;
                reload_and_emit_all(&app);
            }
        }
    });
}

pub fn apply_scale_and_save(app: &AppHandle, scale: f64) {
    let clamped = scale.clamp(0.20, 1.50);
    let state = app.state::<AppState>();
    let layout = { pet_keyboard_layout(&state.settings.lock().unwrap()).to_string() };
    let new_pos = app
        .get_webview_window("main")
        .and_then(|win| resize_window_anchored_bottom_right(&win, &layout, clamped));
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.scale = clamped;
        if let Some((nx, ny)) = new_pos {
            s.x = Some(nx);
            s.y = Some(ny);
        }
        save_settings(&s);
        s.clone()
    };
    let _ = app.emit("kuro-settings", updated);
}

pub fn apply_keyboard_layout_and_save(app: &AppHandle, layout: &str) {
    let normalized = normalize_keyboard_layout(layout);
    let state = app.state::<AppState>();
    let (cur_scale, is_duorou) = {
        let settings = state.settings.lock().unwrap();
        (settings.scale, settings.cat_breed == DUOROU_ID)
    };
    let effective_layout = if is_duorou { "65" } else { &normalized };
    let new_pos = app.get_webview_window("main").and_then(|win| {
        resize_window_anchored_bottom_right(&win, effective_layout, cur_scale)
    });
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.keyboard_layout = normalized;
        if let Some((nx, ny)) = new_pos {
            s.x = Some(nx);
            s.y = Some(ny);
        }
        save_settings(&s);
        s.clone()
    };
    let _ = app.emit("kuro-settings", updated);
}

pub fn apply_keyboard_orientation_and_save(app: &AppHandle, orientation: &str) {
    let normalized = normalize_keyboard_orientation(orientation);
    let state = app.state::<AppState>();
    let updated = {
        let mut s = state.settings.lock().unwrap();
        s.keyboard_orientation = normalized;
        save_settings(&s);
        s.clone()
    };
    let _ = app.emit("kuro-settings", updated);
}

pub fn reset_window_position(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let size = win.outer_size().unwrap_or(tauri::PhysicalSize::new(420, 440));
        let sf = win.scale_factor().unwrap_or(1.0);
        let (target_x, target_y) = default_bottom_right_position(size.width as i32, size.height as i32, sf);
        let _ = win.set_position(PhysicalPosition::new(target_x, target_y));
        let state = app.state::<AppState>();
        let mut s = state.settings.lock().unwrap();
        s.x = Some(target_x);
        s.y = Some(target_y);
        save_settings(&s);
    }
}

#[cfg(windows)]
fn default_bottom_right_position(win_w: i32, win_h: i32, _scale_factor: f64) -> (i32, i32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);
        ((sw - win_w - 28).max(20), (sh - win_h - 68).max(20))
    }
}

#[cfg(target_os = "macos")]
fn default_bottom_right_position(win_w: i32, win_h: i32, scale_factor: f64) -> (i32, i32) {
    let (sw_pt, sh_pt) = input_hook::macos_hook::main_display_size();
    let sw = (sw_pt * scale_factor).round() as i32;
    let sh = (sh_pt * scale_factor).round() as i32;
    let pad_x = (28.0 * scale_factor).round() as i32;
    let pad_y = (84.0 * scale_factor).round() as i32;
    ((sw - win_w - pad_x).max(20), (sh - win_h - pad_y).max(20))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn default_bottom_right_position(_win_w: i32, _win_h: i32, _scale_factor: f64) -> (i32, i32) {
    (900, 500)
}

#[cfg(windows)]
fn get_cursor_pos(_scale_factor: f64) -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) != 0 {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }
}

#[cfg(target_os = "macos")]
fn get_cursor_pos(scale_factor: f64) -> Option<(i32, i32)> {
    input_hook::macos_hook::cursor_pos_points().map(|(x, y)| {
        (
            (x * scale_factor).round() as i32,
            (y * scale_factor).round() as i32,
        )
    })
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn get_cursor_pos(_scale_factor: f64) -> Option<(i32, i32)> {
    None
}

#[cfg(windows)]
fn win_is_click_through(win: &tauri::WebviewWindow) -> Option<bool> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
    };
    let hwnd = win.hwnd().ok()?.0 as windows_sys::Win32::Foundation::HWND;
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    Some((ex & (WS_EX_TRANSPARENT as isize)) != 0)
}

#[cfg(windows)]
fn win_force_click_through(win: &tauri::WebviewWindow, ignore: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    let Ok(raw_hwnd) = win.hwnd() else {
        return;
    };
    let hwnd = raw_hwnd.0 as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_ex = if ignore {
            ex | (WS_EX_TRANSPARENT as isize) | (WS_EX_LAYERED as isize)
        } else {
            ex & !(WS_EX_TRANSPARENT as isize)
        };
        if new_ex != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex);
            let _ = SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

#[cfg(windows)]
fn win_foreground_hwnd() -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow() as isize }
}

#[cfg(windows)]
fn win_gentle_reassert_topmost(win: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    };
    let Ok(raw_hwnd) = win.hwnd() else {
        return;
    };
    let hwnd = raw_hwnd.0 as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }
}

#[cfg(target_os = "macos")]
pub fn configure_macos_fullscreen_overlay(win: &tauri::WebviewWindow, always_on_top: bool) {
    use std::ffi::{c_char, c_void};
    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
    }
    if let Ok(raw_ns_win) = win.ns_window() {
        if raw_ns_win.is_null() {
            return;
        }
        unsafe {
            let sel_get_behavior =
                sel_registerName(b"collectionBehavior\0".as_ptr() as *const c_char);
            let sel_set_behavior =
                sel_registerName(b"setCollectionBehavior:\0".as_ptr() as *const c_char);
            let sel_set_level = sel_registerName(b"setLevel:\0".as_ptr() as *const c_char);

            let get_fn: extern "C" fn(*mut c_void, *mut c_void) -> usize =
                std::mem::transmute(objc_msgSend as *const ());
            let set_usize_fn: extern "C" fn(*mut c_void, *mut c_void, usize) =
                std::mem::transmute(objc_msgSend as *const ());
            let set_isize_fn: extern "C" fn(*mut c_void, *mut c_void, isize) =
                std::mem::transmute(objc_msgSend as *const ());

            let cur = get_fn(raw_ns_win, sel_get_behavior);
            // CanJoinAllSpaces (1 << 0) | Stationary (1 << 4) | FullScreenAuxiliary (1 << 8)
            let next = cur | (1 << 0) | (1 << 4) | (1 << 8);
            set_usize_fn(raw_ns_win, sel_set_behavior, next);
            // NSStatusWindowLevel = 25 (floats above native fullscreen apps/games), Normal = 0
            set_isize_fn(raw_ns_win, sel_set_level, if always_on_top { 25 } else { 0 });
        }
    }
}

fn is_over_interactive_silhouette(rx: f64, ry: f64, is_108: bool) -> (bool, bool) {
    // Cat body/head oval centered around (0.48, 0.49) for 65% or (0.51, 0.48) for 108-key
    let (cat_cx, cat_rx) = if is_108 { (0.51, 0.21) } else { (0.48, 0.25) };
    let dx_cat = (rx - cat_cx) / cat_rx;
    let dy_cat = (ry - 0.49) / 0.27;
    let over_cat = (dx_cat * dx_cat + dy_cat * dy_cat) <= 1.0;

    // Keyboard & mouse lower area
    let over_desk = if is_108 {
        rx >= 0.04 && rx <= 0.94 && ry >= 0.65 && ry <= 0.94
    } else {
        rx >= 0.06 && rx <= 0.92 && ry >= 0.65 && ry <= 0.91
    };

    (over_cat || over_desk, over_cat)
}

fn is_over_duorou(rx: f64, ry: f64) -> (bool, bool) {
    let in_oval = |cx: f64, cy: f64, w: f64, h: f64| {
        ((rx - cx) / w).powi(2) + ((ry - cy) / h).powi(2) <= 1.0
    };
    let body = in_oval(0.53, 0.39, 0.16, 0.24) || in_oval(0.50, 0.64, 0.21, 0.13);
    let keyboard = (0.30..=0.73).contains(&rx) && (0.69..=0.84).contains(&ry);
    let mouse = in_oval(0.266, 0.746, 0.045, 0.05);
    (body || keyboard || mouse, body)
}

fn start_hit_test_loop(
    app: AppHandle,
    settings: Arc<Mutex<AppSettings>>,
    menu_open: Arc<AtomicBool>,
    dragging: Arc<AtomicBool>,
    update_banner_open: Arc<AtomicBool>,
    paused_guard: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut last_ignore: Option<bool> = None;
        let mut last_cursor: (i32, i32) = (i32::MIN, i32::MIN);
        let mut last_alt_override = false;
        let mut last_effective_locked = false;
        #[cfg(windows)]
        let mut drift_ticks: u8 = 0;
        #[cfg(windows)]
        let mut last_fg_hwnd: isize = 0;
        #[cfg(windows)]
        let mut pending_topmost_ticks: u8 = 0;
        #[cfg(windows)]
        let mut last_topmost_reassert = Instant::now() - Duration::from_secs(2);

        loop {
            std::thread::sleep(Duration::from_millis(25));

            if paused_guard.load(Ordering::Relaxed) {
                continue;
            }
            let Some(win) = app.get_webview_window("main") else {
                continue;
            };
            if !win.is_visible().unwrap_or(false) {
                continue;
            }
            let sf = win.scale_factor().unwrap_or(1.0);
            let Some((cx, cy)) = get_cursor_pos(sf) else {
                continue;
            };
            let Ok(pos) = win.outer_position() else {
                continue;
            };
            let Ok(size) = win.outer_size() else {
                continue;
            };
            let w = size.width.max(1) as f64;
            let h = size.height.max(1) as f64;
            let rx = (cx - pos.x) as f64 / w;
            let ry = (cy - pos.y) as f64 / h;
            let inside = rx >= 0.0 && rx <= 1.0 && ry >= 0.0 && ry <= 1.0;
            let (locked, always_on_top, is_duorou, cur_scale, layout_str) = {
                let s = settings.lock().unwrap();
                (
                    s.click_through_locked,
                    s.always_on_top,
                    s.cat_breed == DUOROU_ID,
                    s.scale.clamp(0.20, 1.50),
                    pet_keyboard_layout(&s).to_string(),
                )
            };

            // Gentle once-per-foreground-switch topmost guard for borderless fullscreen games:
            // never spams SetWindowPos in a loop and never steals focus (SWP_NOACTIVATE).
            #[cfg(windows)]
            if always_on_top {
                let fg = win_foreground_hwnd();
                let our_hwnd = win.hwnd().map(|h| h.0 as isize).unwrap_or(0);
                if fg != 0 && fg != our_hwnd && fg != last_fg_hwnd {
                    last_fg_hwnd = fg;
                    pending_topmost_ticks = 5; // ~125ms after target borderless window takes focus
                }
                if pending_topmost_ticks > 0 {
                    pending_topmost_ticks -= 1;
                    if pending_topmost_ticks == 0
                        && last_topmost_reassert.elapsed() >= Duration::from_millis(350)
                    {
                        win_gentle_reassert_topmost(&win);
                        last_topmost_reassert = Instant::now();
                    }
                }
            } else {
                pending_topmost_ticks = 0;
            }
            let alt_override = input_hook::is_alt_pressed();
            let effective_locked = locked && !alt_override;

            // Map window-relative (rx, ry) into exact pet-local (pet_rx, pet_ry),
            // since at small scales (20%..90%) the pet is anchored bottom-right inside a min-safe menu window!
            let (bw, bh) = base_dimensions(&layout_str);
            let win_log_w = (w / sf).max(1.0);
            let win_log_h = (h / sf).max(1.0);
            let pet_w_frac = ((bw * cur_scale) / win_log_w).clamp(0.05, 1.0);
            let pet_h_frac = ((bh * cur_scale) / win_log_h).clamp(0.05, 1.0);
            let pet_x0 = 1.0 - pet_w_frac;
            let pet_y0 = 1.0 - pet_h_frac;
            let pet_rx = (rx - pet_x0) / pet_w_frac;
            let pet_ry = (ry - pet_y0) / pet_h_frac;
            let inside_pet = pet_rx >= 0.0 && pet_rx <= 1.0 && pet_ry >= 0.0 && pet_ry <= 1.0;

            let (over_interactive, raw_over_cat) = if inside_pet && is_duorou {
                is_over_duorou(pet_rx, pet_ry)
            } else if inside_pet {
                is_over_interactive_silhouette(pet_rx, pet_ry, layout_str == "108")
            } else {
                (false, false)
            };
            // While click-through is locked (and Alt is not held), suppress petting hover so users
            // aren't misled by squinting eyes when the cat is intentionally click-through.
            let over_cat = if effective_locked { false } else { raw_over_cat };

            let is_menu = menu_open.load(Ordering::Relaxed);
            let is_drag = dragging.load(Ordering::Relaxed);
            let is_banner = update_banner_open.load(Ordering::Relaxed);
            let over_banner = is_banner && inside && ry <= 0.19;

            let should_ignore = if is_menu || is_drag || over_banner {
                false
            } else if effective_locked {
                true
            } else {
                !over_interactive
            };

            if last_ignore != Some(should_ignore) {
                let _ = win.set_ignore_cursor_events(should_ignore);
                last_ignore = Some(should_ignore);
                #[cfg(windows)]
                {
                    drift_ticks = 0;
                }
            } else {
                // Self-heal Windows WS_EX_TRANSPARENT if DWM / Wallpaper Engine / Show-Desktop drifted it
                #[cfg(windows)]
                if let Some(actual_transparent) = win_is_click_through(&win) {
                    if actual_transparent != should_ignore {
                        drift_ticks = drift_ticks.saturating_add(1);
                        if drift_ticks >= 4 {
                            win_force_click_through(&win, should_ignore);
                            let _ = win.set_ignore_cursor_events(should_ignore);
                            drift_ticks = 0;
                        }
                    } else {
                        drift_ticks = 0;
                    }
                }
            }

            if (cx, cy) != last_cursor
                || alt_override != last_alt_override
                || effective_locked != last_effective_locked
            {
                last_cursor = (cx, cy);
                last_alt_override = alt_override;
                last_effective_locked = effective_locked;
                let _ = app.emit(
                    "kuro-cursor",
                    WindowCursorInfo {
                        rel_x: pet_rx,
                        rel_y: pet_ry,
                        inside_window: inside_pet,
                        over_cat,
                        alt_override,
                    },
                );
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut initial_settings = load_settings();
    // Always start unlocked so users who accidentally toggled click-through lock can never be permanently trapped across restarts/upgrades
    if initial_settings.click_through_locked {
        initial_settings.click_through_locked = false;
        save_settings(&initial_settings);
    }
    let settings_arc = Arc::new(Mutex::new(initial_settings.clone()));
    let menu_open = Arc::new(AtomicBool::new(false));
    let dragging = Arc::new(AtomicBool::new(false));
    let mcp_enabled = Arc::new(AtomicBool::new(initial_settings.mcp_enabled));
    let update_banner_open = Arc::new(AtomicBool::new(false));
    let paused_guard = Arc::new(AtomicBool::new(false));

    let settings_for_setup = settings_arc.clone();
    let menu_for_setup = menu_open.clone();
    let drag_for_setup = dragging.clone();
    let mcp_for_setup = mcp_enabled.clone();
    let banner_for_setup = update_banner_open.clone();
    let paused_for_setup = paused_guard.clone();

    tauri::Builder::default()
        .manage(AppState {
            settings: settings_arc,
            menu_open,
            dragging,
            mcp_enabled,
            update_banner_open,
            paused_guard,
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let s = settings_for_setup.lock().unwrap().clone();

            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_always_on_top(s.always_on_top);
                #[cfg(target_os = "macos")]
                {
                    let _ = win.set_visible_on_all_workspaces(true);
                    configure_macos_fullscreen_overlay(&win, s.always_on_top);
                }
                let (win_w, win_h) = window_dimensions(pet_keyboard_layout(&s), s.scale);
                let _ = win.set_size(Size::Logical(LogicalSize::new(win_w, win_h)));
                if let (Some(x), Some(y)) = (s.x, s.y) {
                    let _ = win.set_position(PhysicalPosition::new(x, y));
                } else {
                    let sz = win.outer_size().unwrap_or(tauri::PhysicalSize::new(420, 440));
                    let sf = win.scale_factor().unwrap_or(1.0);
                    let (dx, dy) = default_bottom_right_position(sz.width as i32, sz.height as i32, sf);
                    let _ = win.set_position(PhysicalPosition::new(dx, dy));
                }
            }

            tray::setup_tray(&handle, &s)?;
            input_hook::start_global_hooks(handle.clone());
            start_hit_test_loop(
                handle.clone(),
                settings_for_setup,
                menu_for_setup,
                drag_for_setup,
                banner_for_setup,
                paused_for_setup,
            );
            start_storage_watcher(handle.clone());
            updater::start_background_update_checker(handle.clone());

            let http_handle = handle.clone();
            let mcp_port = if s.mcp_port == 0 { 27420 } else { s.mcp_port };
            mcp::start_http_mcp_server(mcp_port, mcp_for_setup, move || {
                reload_and_emit_all(&http_handle);
            });

            if std::env::args().any(|a| a == "--demo") {
                let demo_handle = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1200));
                    let keys: &[u32] = &[0x46, 0x53, 0x41, 0x45, 0x20, 0xA0, 0x4B];
                    for &vk in keys {
                        let _ = demo_handle.emit(
                            "kuro-input",
                            serde_json::json!({ "kind": "keyDown", "vk": vk, "scan": 0, "repeat": false }),
                        );
                        std::thread::sleep(Duration::from_millis(100));
                        let _ = demo_handle.emit(
                            "kuro-input",
                            serde_json::json!({ "kind": "keyUp", "vk": vk, "scan": 0 }),
                        );
                    }
                    let _ = demo_handle.emit(
                        "kuro-input",
                        serde_json::json!({ "kind": "mouseMove", "x": 400, "y": 400, "nx": 0.25, "ny": 0.4 }),
                    );
                    let _ = demo_handle.emit(
                        "kuro-input",
                        serde_json::json!({ "kind": "mouseDown", "button": "left" }),
                    );
                    let _ = demo_handle.emit(
                        "kuro-input",
                        serde_json::json!({ "kind": "keyDown", "vk": 0x4B, "scan": 0, "repeat": false }),
                    );
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            get_cats,
            get_mcp_config,
            get_app_version,
            update_settings,
            set_menu_open,
            set_dragging,
            set_update_banner_open,
            save_window_pos,
            reset_position,
            create_desktop_shortcut,
            check_for_update,
            install_update,
            open_release_page,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KuroCat");
}
