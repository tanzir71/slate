mod store;

use crate::{spaces::NativeSpaces, workspace::FileError};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub struct NativeCapture {
    store: Mutex<store::Store>,
    opening: AtomicBool,
    showing_main: Mutex<()>,
}
impl NativeCapture {
    pub fn new(data: PathBuf) -> Self {
        Self {
            store: Mutex::new(store::Store::new(data)),
            opening: AtomicBool::new(false),
            showing_main: Mutex::new(()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    shortcut_error: Option<String>,
    last_error: Option<String>,
}

fn capture_config(app: &tauri::AppHandle) -> Result<tauri::utils::config::WindowConfig, FileError> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| FileError::io("The main window configuration is unavailable."))?;
    config.label = "capture".into();
    config.title = "Quick Capture — Slate".into();
    config.url = tauri::WebviewUrl::App("capture.html".into());
    config.width = 560.0;
    config.height = 360.0;
    config.min_width = Some(440.0);
    config.min_height = Some(280.0);
    config.center = true;
    config.visible = true;
    config.focus = true;
    config.resizable = true;
    Ok(config)
}

fn focus(window: &tauri::WebviewWindow) -> Result<(), FileError> {
    window.show().map_err(FileError::io)?;
    window.unminimize().map_err(FileError::io)?;
    window.set_focus().map_err(FileError::io)
}

fn open_window(app: &tauri::AppHandle, selected: Option<&str>) -> Result<(), FileError> {
    let service = app.state::<NativeCapture>();
    if service.opening.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let result = (|| {
        if let Some(window) = app.get_webview_window("capture") {
            return focus(&window);
        }
        service
            .store
            .lock()
            .map_err(FileError::io)?
            .prepare(&app.state::<NativeSpaces>(), selected)?;
        let window = tauri::WebviewWindowBuilder::from_config(app, &capture_config(app)?)
            .map_err(FileError::io)?
            .build()
            .map_err(FileError::io)?;
        focus(&window)
    })();
    service.opening.store(false, Ordering::Release);
    result
}

fn show_main(app: &tauri::AppHandle) -> Result<(), FileError> {
    let service = app.state::<NativeCapture>();
    let _guard = service.showing_main.lock().map_err(FileError::io)?;
    if let Some(window) = app.get_webview_window("main") {
        return focus(&window);
    }
    let config = app
        .config()
        .app
        .windows
        .first()
        .ok_or_else(|| FileError::io("The main window configuration is unavailable."))?;
    let window = tauri::WebviewWindowBuilder::from_config(app, config)
        .map_err(FileError::io)?
        .build()
        .map_err(FileError::io)?;
    focus(&window)
}

fn report(app: &tauri::AppHandle, error: &FileError) {
    if let Ok(mut state) = app.state::<NativeCapture>().store.lock() {
        state.last_error = Some(error.to_string());
    }
    let _ = app.emit_to("main", "slate://capture-error", error.to_string());
}

/// Failure to reserve an OS chord must not prevent normal writing or manual capture.
pub fn start(app: &tauri::AppHandle) {
    let result = app
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .map_err(FileError::io)
        .and_then(|()| {
            app.global_shortcut()
                .on_shortcut(
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space),
                    |app, _, event| {
                        if event.state != ShortcutState::Pressed {
                            return;
                        }
                        let app = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            if let Err(error) = open_window(&app, None) {
                                report(&app, &error);
                                let _ = show_main(&app);
                            }
                        });
                    },
                )
                .map_err(FileError::io)
        });
    if let Err(error) = result {
        if let Ok(mut state) = app.state::<NativeCapture>().store.lock() {
            state.shortcut_error = Some(format!("Ctrl+Alt+Space is unavailable: {error}. Open Quick Capture from Slate's menu instead."));
        }
    }
}

#[tauri::command]
pub async fn set_capture_space(
    app: tauri::AppHandle,
    space_id: String,
) -> Result<Status, FileError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeSpaces>().resolve(Some(&space_id))?;
        app.state::<NativeCapture>()
            .store
            .lock()
            .map_err(FileError::io)?
            .active_space = space_id;
        capture_status(app)
    })
    .await
    .map_err(FileError::io)?
}

#[tauri::command]
pub fn capture_status(app: tauri::AppHandle) -> Result<Status, FileError> {
    let service = app.state::<NativeCapture>();
    let store = service.store.lock().map_err(FileError::io)?;
    Ok(Status {
        shortcut_error: store.shortcut_error.clone(),
        last_error: store.last_error.clone(),
    })
}

#[tauri::command]
pub async fn open_native_capture(app: tauri::AppHandle, space_id: String) -> Result<(), FileError> {
    tauri::async_runtime::spawn_blocking(move || open_window(&app, Some(&space_id)))
        .await
        .map_err(FileError::io)?
}

#[tauri::command]
pub async fn capture_snapshot(app: tauri::AppHandle) -> Result<store::Snapshot, FileError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeCapture>()
            .store
            .lock()
            .map_err(FileError::io)?
            .snapshot()
    })
    .await
    .map_err(FileError::io)?
}

#[tauri::command]
pub async fn stash_capture(
    app: tauri::AppHandle,
    id: String,
    text: String,
    pending: bool,
    revision: u64,
) -> Result<(), FileError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeCapture>()
            .store
            .lock()
            .map_err(FileError::io)?
            .stash(&id, &text, pending, revision)
    })
    .await
    .map_err(FileError::io)?
}

#[tauri::command]
pub async fn save_capture(
    app: tauri::AppHandle,
    id: String,
    text: String,
    revision: u64,
) -> Result<store::Completed, FileError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<NativeCapture>()
            .store
            .lock()
            .map_err(FileError::io)?
            .save(&app.state::<NativeSpaces>(), &id, &text, revision)
    })
    .await
    .map_err(FileError::io)?
}

#[tauri::command]
pub async fn capture_show_main(app: tauri::AppHandle) -> Result<(), FileError> {
    tauri::async_runtime::spawn_blocking(move || show_main(&app))
        .await
        .map_err(FileError::io)?
}
