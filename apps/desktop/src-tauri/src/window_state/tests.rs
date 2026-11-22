use super::*;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{test::MockRuntime, Manager, WebviewWindowBuilder};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("slate-window-state-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn app(&self) -> tauri::App<MockRuntime> {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        // Mock contexts bypass bundle validation. An absolute identifier isolates
        // PathResolver's config-directory join without changing process-wide env.
        context.config_mut().identifier = self.0.to_str().unwrap().into();
        let app = tauri::test::mock_builder()
            .plugin(plugin())
            .build(context)
            .unwrap();
        assert_eq!(app.path().app_config_dir().unwrap(), self.0);
        app
    }
    fn saved(&self) -> Value {
        serde_json::from_slice(&std::fs::read(self.0.join(".window-state.json")).unwrap()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("slate-window-state-"));
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn capture_and_other_windows_do_not_enter_the_main_geometry_cache() {
    let fixture = Fixture::new();
    let app = fixture.app();
    for label in ["main", "capture", "other"] {
        WebviewWindowBuilder::new(&app, label, Default::default())
            .build()
            .unwrap();
    }
    app.handle().save_window_state(geometry()).unwrap();
    assert_eq!(
        fixture
            .saved()
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        ["main"]
    );
    assert!(!geometry().intersects(StateFlags::VISIBLE | StateFlags::DECORATIONS));
    assert!(geometry().contains(
        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
    ));
}

#[test]
fn closing_main_persists_its_cache_while_capture_stays_open_and_keeps_note_bytes() {
    let fixture = Fixture::new();
    let note = fixture.0.join("untouched.md");
    std::fs::write(&note, b"\xef\xbb\xbforiginal\r\n").unwrap();
    let app = fixture.app();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let capture = WebviewWindowBuilder::new(&app, "capture", Default::default())
        .build()
        .unwrap();
    on_window_event(&capture.as_ref().window(), &WindowEvent::Destroyed);
    assert!(!fixture.0.join(".window-state.json").exists());
    on_window_event(&main.as_ref().window(), &WindowEvent::Destroyed);
    assert!(app.get_webview_window("capture").is_some());
    assert!(fixture.saved().get("main").is_some());
    assert!(fixture.saved().get("capture").is_none());
    assert_eq!(std::fs::read(&note).unwrap(), b"\xef\xbb\xbforiginal\r\n");
}

#[test]
fn malformed_optional_geometry_never_blocks_startup() {
    let fixture = Fixture::new();
    let cache = fixture.0.join(".window-state.json");
    std::fs::write(&cache, b"{broken\xff").unwrap();
    let app = fixture.app();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    assert_eq!(std::fs::read(&cache).unwrap(), b"{broken\xff");
    on_window_event(&main.as_ref().window(), &WindowEvent::Destroyed);
    assert!(fixture.saved().get("main").is_some());
}
