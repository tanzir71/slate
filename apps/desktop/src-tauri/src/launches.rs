use crate::workspace::FileError;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{Emitter, Manager, Url};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Pending,
    Started,
    Applied,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    id: String,
    url: String,
    phase: Phase,
    space_id: Option<String>,
    #[serde(skip)]
    claim: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Snapshot {
    revision: u64,
    current: Option<Request>,
    waiting: usize,
    error: Option<String>,
}
#[derive(Default)]
struct Inbox {
    revision: u64,
    current: Option<Request>,
    waiting: VecDeque<Request>,
    completed: Option<String>,
    error: Option<String>,
}
#[derive(Default)]
pub struct NativeLaunches(Mutex<Inbox>);
fn scheme(identifier: &str) -> &'static str {
    if identifier == "com.slate.workspace.preview" {
        "slate-preview"
    } else {
        "slate"
    }
}
fn cli_url(args: &[String]) -> Option<Url> {
    if args.len() == 2 {
        args[1].parse().ok()
    } else {
        None
    }
}
impl NativeLaunches {
    pub fn initial(identifier: &str, args: Vec<std::ffi::OsString>) -> Self {
        let mut inbox = Inbox::default();
        // Capture the first URI before the single-instance listener can receive another.
        if let Ok(args) = args
            .into_iter()
            .map(std::ffi::OsString::into_string)
            .collect::<Result<Vec<_>, _>>()
        {
            if let Some(url) = cli_url(&args) {
                inbox.push(scheme(identifier), url);
            }
        }
        Self(Mutex::new(inbox))
    }
}
impl Inbox {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            revision: self.revision,
            current: self.current.clone(),
            waiting: self.waiting.len(),
            error: self.error.clone(),
        }
    }
    fn push(&mut self, scheme: &str, url: Url) -> bool {
        if url.scheme() != scheme {
            return false;
        }
        let request = Request {
            id: uuid::Uuid::new_v4().to_string(),
            url: url.to_string(),
            phase: Phase::Pending,
            space_id: None,
            claim: None,
        };
        if self.current.is_none() && self.waiting.is_empty() {
            self.current = Some(request);
        } else {
            self.waiting.push_back(request);
        }
        self.revision += 1;
        true
    }
    fn bind(&mut self, id: &str, space_id: &str) -> Result<(), FileError> {
        let request = self
            .current
            .as_mut()
            .filter(|request| request.id == id)
            .ok_or_else(|| FileError::io("This request is no longer active."))?;
        if request.space_id.as_deref() == Some(space_id) {
            return Ok(());
        }
        if request.phase != Phase::Pending || request.space_id.is_some() {
            return Err(FileError::io(
                "This request belongs to its original Space. Switch Spaces to continue.",
            ));
        }
        request.space_id = Some(space_id.to_owned());
        self.revision += 1;
        Ok(())
    }
    fn transition(&mut self, id: &str, phase: Phase, claim: &str) -> Result<(), FileError> {
        let request = self
            .current
            .as_mut()
            .filter(|request| request.id == id)
            .ok_or_else(|| {
                FileError::io("This request is no longer active. Review the current request.")
            })?;
        match (request.phase, phase) {
            (Phase::Pending, Phase::Started) if !claim.is_empty() && claim.len() <= 128 => {
                request.claim = Some(claim.to_owned());
            }
            (Phase::Started, Phase::Started) | (Phase::Applied, Phase::Applied)
                if request.claim.as_deref() == Some(claim) =>
            {
                return Ok(())
            }
            (Phase::Started, Phase::Applied) if request.claim.as_deref() == Some(claim) => {}
            (Phase::Started, Phase::Pending) => {
                request.claim = None;
            }
            _ => {
                return Err(FileError::io(
                    "This request already started. Review its result before applying it again.",
                ))
            }
        }
        request.phase = phase;
        self.revision += 1;
        Ok(())
    }
    fn complete(&mut self, id: &str) -> Result<(), FileError> {
        if self.completed.as_deref() == Some(id) {
            return Ok(());
        }
        if self.current.as_ref().is_none_or(|request| request.id != id) {
            return Err(FileError::io(
                "This request is no longer active. Your files were kept.",
            ));
        }
        self.current = None;
        self.completed = Some(id.to_owned());
        self.revision += 1;
        Ok(())
    }
    fn next(&mut self) -> Result<(), FileError> {
        if self.current.is_some() {
            return Err(FileError::io("Finish or cancel the current request first."));
        }
        if let Some(request) = self.waiting.pop_front() {
            self.current = Some(request);
            self.revision += 1;
        }
        Ok(())
    }
}
fn change(
    app: &tauri::AppHandle,
    work: impl FnOnce(&mut Inbox) -> Result<(), FileError>,
) -> Result<Snapshot, FileError> {
    let state = app.state::<NativeLaunches>();
    let snapshot = {
        let mut inbox = state.0.lock().map_err(FileError::io)?;
        work(&mut inbox)?;
        inbox.snapshot()
    };
    // Queue authority survives missed events; renderer subscription always reconciles a snapshot.
    let _ = app.emit("slate://launch-changed", &snapshot);
    Ok(snapshot)
}
fn receive(app: &tauri::AppHandle, urls: Vec<Url>) {
    let scheme = scheme(&app.config().identifier);
    let mut admitted = false;
    let _ = change(app, |inbox| {
        for url in urls {
            admitted |= inbox.push(scheme, url);
        }
        Ok(())
    });
    if admitted {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}
pub fn secondary(app: &tauri::AppHandle, args: Vec<String>) {
    if let Some(url) = cli_url(&args) {
        receive(app, vec![url]);
    } else if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
pub fn start(app: &tauri::AppHandle) -> Result<(), FileError> {
    // macOS supplies OS open events. Windows/Linux CLI delivery is captured directly
    // instead of reading the plugin's last-URL slot, which can overwrite an earlier launch.
    #[cfg(target_os = "macos")]
    {
        let urls = app
            .deep_link()
            .get_current()
            .map_err(FileError::io)?
            .unwrap_or_default();
        receive(app, urls);
    }
    let handle = app.clone();
    app.deep_link()
        .on_open_url(move |event| receive(&handle, event.urls()));
    #[cfg(any(windows, target_os = "linux"))]
    if !cfg!(debug_assertions) && app.deep_link().register_all().is_err() {
        let _ = change(app, |inbox| {
            inbox.error = Some("Desktop links could not be registered. You can still open Slate directly and use your files.".into());
            inbox.revision += 1;
            Ok(())
        });
    }
    Ok(())
}
#[tauri::command]
pub fn pending_native_launches(
    state: tauri::State<'_, NativeLaunches>,
) -> Result<Snapshot, FileError> {
    Ok(state.0.lock().map_err(FileError::io)?.snapshot())
}
#[tauri::command]
pub fn bind_native_launch(
    app: tauri::AppHandle,
    id: String,
    space_id: String,
) -> Result<Snapshot, FileError> {
    crate::spaces::resolve(&app, Some(&space_id))?;
    change(&app, |inbox| inbox.bind(&id, &space_id))
}
#[tauri::command]
pub fn begin_native_launch(
    app: tauri::AppHandle,
    id: String,
    claim: String,
) -> Result<Snapshot, FileError> {
    change(&app, |inbox| inbox.transition(&id, Phase::Started, &claim))
}
#[tauri::command]
pub fn apply_native_launch(
    app: tauri::AppHandle,
    id: String,
    claim: String,
) -> Result<Snapshot, FileError> {
    change(&app, |inbox| inbox.transition(&id, Phase::Applied, &claim))
}
#[tauri::command]
pub fn review_native_launch(app: tauri::AppHandle, id: String) -> Result<Snapshot, FileError> {
    change(&app, |inbox| inbox.transition(&id, Phase::Pending, ""))
}
#[tauri::command]
pub fn complete_native_launch(app: tauri::AppHandle, id: String) -> Result<Snapshot, FileError> {
    change(&app, |inbox| inbox.complete(&id))
}
#[tauri::command]
pub fn next_native_launch(app: tauri::AppHandle) -> Result<Snapshot, FileError> {
    change(&app, Inbox::next)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initial_cli_capture_precedes_warm_delivery_and_ignores_unrelated_arguments() {
        let state = NativeLaunches::initial(
            "com.slate.workspace",
            vec!["slate".into(), "slate://new?text=first".into()],
        );
        let mut inbox = state.0.lock().unwrap();
        assert!(inbox.push("slate", "slate://new?text=second".parse().unwrap()));
        assert!(inbox.current.as_ref().unwrap().url.ends_with("first"));
        assert!(inbox.waiting.front().unwrap().url.ends_with("second"));
        for args in [
            vec!["slate".into()],
            vec!["slate".into(), "notes.md".into()],
            vec!["slate".into(), "--flag".into(), "slate://new".into()],
        ] {
            assert!(NativeLaunches::initial("com.slate.workspace", args)
                .0
                .lock()
                .unwrap()
                .current
                .is_none());
        }
        assert!(NativeLaunches::initial(
            "com.slate.workspace.preview",
            vec!["slate".into(), "slate://new".into()]
        )
        .0
        .lock()
        .unwrap()
        .current
        .is_none());
    }
    #[test]
    fn unscoped_requests_capture_one_space_and_cannot_be_redirected_on_reload() {
        let mut inbox = Inbox::default();
        let id = push(&mut inbox, "slate://new?title=Kept");
        inbox.bind(&id, "first").unwrap();
        let revision = inbox.revision;
        inbox.bind(&id, "first").unwrap();
        assert_eq!(inbox.revision, revision);
        assert!(inbox.bind(&id, "second").is_err());
        inbox.transition(&id, Phase::Started, "claim").unwrap();
        inbox.transition(&id, Phase::Pending, "").unwrap();
        assert!(inbox.bind(&id, "second").is_err());
        assert_eq!(
            inbox.snapshot().current.unwrap().space_id.as_deref(),
            Some("first")
        );
    }
    fn push(inbox: &mut Inbox, uri: &str) -> String {
        assert!(inbox.push("slate", uri.parse().unwrap()));
        inbox.current.as_ref().unwrap().id.clone()
    }
    #[test]
    fn cold_and_warm_requests_keep_fifo_order_and_require_review_for_waiting_work() {
        let mut inbox = Inbox::default();
        let first = push(&mut inbox, "slate://new?text=first");
        push(&mut inbox, "slate://append?path=note.md&text=second");
        assert_eq!(inbox.snapshot().current.unwrap().id, first);
        assert_eq!(inbox.waiting.len(), 1);
        assert!(inbox.next().is_err());
        inbox.complete(&first).unwrap();
        assert!(inbox.current.is_none());
        assert_eq!(inbox.waiting.len(), 1);
        assert!(inbox.push("slate", "slate://search?query=third".parse().unwrap()));
        assert!(inbox.current.is_none());
        inbox.next().unwrap();
        assert!(inbox.current.as_ref().unwrap().url.contains("second"));
        let second = inbox.current.as_ref().unwrap().id.clone();
        inbox.complete(&second).unwrap();
        inbox.next().unwrap();
        assert!(inbox.current.as_ref().unwrap().url.contains("third"));
    }
    #[test]
    fn same_uri_after_completion_is_a_new_request_and_preview_cannot_admit_stable_scheme() {
        let mut inbox = Inbox::default();
        let uri = "slate://new?title=Same";
        let first = push(&mut inbox, uri);
        inbox.complete(&first).unwrap();
        let second = push(&mut inbox, uri);
        assert_ne!(first, second);
        assert!(!inbox.push("slate-preview", uri.parse().unwrap()));
        assert!(inbox.push(
            "slate-preview",
            "slate-preview://new?title=Preview".parse().unwrap()
        ));
    }
    #[test]
    fn interrupted_actions_need_review_and_applied_actions_cannot_start_again() {
        let mut inbox = Inbox::default();
        let id = push(&mut inbox, "slate://append?path=n.md&text=words");
        inbox.transition(&id, Phase::Started, "claim").unwrap();
        assert_eq!(inbox.snapshot().current.unwrap().phase, Phase::Started);
        inbox.transition(&id, Phase::Started, "claim").unwrap();
        assert!(inbox.transition(&id, Phase::Started, "other").is_err());
        assert!(inbox.transition(&id, Phase::Applied, "other").is_err());
        inbox.transition(&id, Phase::Pending, "").unwrap();
        inbox.transition(&id, Phase::Started, "next").unwrap();
        inbox.transition(&id, Phase::Applied, "next").unwrap();
        inbox.transition(&id, Phase::Applied, "next").unwrap();
        assert!(inbox.transition(&id, Phase::Pending, "").is_err());
        assert!(inbox.transition(&id, Phase::Started, "next").is_err());
        inbox.complete(&id).unwrap();
        assert!(inbox.current.is_none());
    }
    #[test]
    fn acknowledgements_are_idempotent_and_cannot_discard_another_active_request() {
        let mut inbox = Inbox::default();
        let id = push(&mut inbox, "slate://new");
        assert!(inbox.complete("unknown").is_err());
        assert!(inbox
            .transition("unknown", Phase::Started, "claim")
            .is_err());
        inbox.complete(&id).unwrap();
        let revision = inbox.revision;
        inbox.complete(&id).unwrap();
        assert_eq!(inbox.revision, revision);
        let next = push(&mut inbox, "slate://open?path=other.md");
        inbox.complete(&id).unwrap();
        assert_eq!(inbox.current.unwrap().id, next);
    }
    #[test]
    fn snapshots_retain_exact_unicode_query_and_advance_only_when_state_changes() {
        let mut inbox = Inbox::default();
        let uri = "slate://new?text=%EF%BB%BF%E0%A6%AC%E0%A6%BE%0D%0A&space=opaque";
        let id = push(&mut inbox, uri);
        let first = inbox.snapshot();
        assert_eq!(first.current.unwrap().url, uri);
        assert_eq!(first.revision, 1);
        inbox.transition(&id, Phase::Started, "claim").unwrap();
        inbox.transition(&id, Phase::Applied, "claim").unwrap();
        assert_eq!(inbox.snapshot().revision, 3);
        assert!(serde_json::to_value(inbox.snapshot()).unwrap()["current"]
            .get("claim")
            .is_none());
    }
}
