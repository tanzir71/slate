use tauri::{plugin::TauriPlugin, Manager, Runtime, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

fn geometry() -> StateFlags {
    // OS chrome comes from configuration; opening Slate must not restore a hidden window.
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_window_state::Builder::new()
        .with_state_flags(geometry())
        .with_filter(|label| label == "main")
        .build()
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    // Main can close while Quick Capture keeps the process alive. Its cached
    // geometry must reach disk without waiting for that other window to exit.
    if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
        if let Err(error) = window.app_handle().save_window_state(geometry()) {
            eprintln!("Could not remember the Slate window position: {error}");
        }
    }
}

#[cfg(test)]
mod tests;
