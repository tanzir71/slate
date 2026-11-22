use super::{scheme, FileError, Inbox, NativeLaunches, Phase, Request};
use crate::spaces::{AssociatedFile, NativeSpaces, SpaceRecord};
use serde::Serialize;
use std::{ffi::OsString, path::PathBuf};
use tauri::{Emitter, Manager, Url};

#[derive(Clone)]
pub(super) struct FileInput {
    path: PathBuf,
    bound: Option<AssociatedFile>,
}
#[derive(Serialize)]
pub struct FileTarget {
    space: SpaceRecord,
    url: String,
    path: String,
}

pub(super) fn cli_files(args: &[OsString]) -> Vec<PathBuf> {
    let paths = args
        .iter()
        .skip(1)
        .map(|arg| {
            let path = if let Some(text) = arg.to_str().filter(|text| text.starts_with("file:")) {
                let url = Url::parse(text).ok()?;
                if url.query().is_some() || url.fragment().is_some() {
                    return None;
                }
                url.to_file_path().ok()?
            } else {
                PathBuf::from(arg)
            };
            (path.is_absolute() && crate::spaces::markdown(&path)).then_some(path)
        })
        .collect::<Option<Vec<_>>>();
    paths.unwrap_or_default()
}

impl Inbox {
    pub(super) fn push_file(&mut self, path: PathBuf) -> bool {
        if !path.is_absolute() || !crate::spaces::markdown(&path) {
            return false;
        }
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        self.enqueue(Request {
            id: uuid::Uuid::new_v4().to_string(),
            url: String::new(),
            phase: Phase::Pending,
            space_id: None,
            claim: None,
            file_name,
            file: Some(FileInput { path, bound: None }),
        })
    }
    fn file_input(&self, id: &str) -> Result<FileInput, FileError> {
        self.current
            .as_ref()
            .filter(|request| request.id == id)
            .and_then(|request| request.file.clone())
            .ok_or_else(|| FileError::io("This native file request is no longer active."))
    }
    fn bind_file(
        &mut self,
        id: &str,
        file: AssociatedFile,
        scheme: &str,
    ) -> Result<FileTarget, FileError> {
        let request = self
            .current
            .as_mut()
            .filter(|request| request.id == id && request.file.is_some())
            .ok_or_else(|| FileError::io("This native file request is no longer active."))?;
        let input = request
            .file
            .as_mut()
            .ok_or_else(|| FileError::io("This is not a native file request."))?;
        if let Some(bound) = &input.bound {
            if bound.space.id != file.space.id || bound.root != file.root || bound.path != file.path
            {
                return Err(FileError::io(
                    "This file request already belongs to its original Space.",
                ));
            }
        }
        let mut url = Url::parse(&format!("{scheme}://open")).map_err(FileError::io)?;
        url.query_pairs_mut()
            .append_pair("space", &file.space.id)
            .append_pair("path", &file.path);
        let url = url.to_string();
        if request.url != url {
            request.url = url.clone();
            request.space_id = Some(file.space.id.clone());
            self.revision += 1;
        }
        input.bound = Some(file.clone());
        Ok(FileTarget {
            space: file.space,
            url,
            path: file.path,
        })
    }
}

fn target(spaces: &NativeSpaces, input: FileInput) -> Result<AssociatedFile, FileError> {
    if let Some(file) = input.bound {
        let actual =
            std::fs::canonicalize(spaces.resolve(Some(&file.space.id))?).map_err(FileError::io)?;
        if actual != file.root {
            return Err(FileError::io("The opened file's Space moved. Reconnect its original folder; no files were changed."));
        }
        slate_core::workspace_file_info(&actual, &file.path)?.ok_or_else(|| {
            FileError::io("The opened file is no longer available. Your folders were kept.")
        })?;
        Ok(file)
    } else {
        spaces.associate_file(&input.path)
    }
}

pub(super) fn resolve(app: &tauri::AppHandle, id: &str) -> Result<FileTarget, FileError> {
    let service = app.state::<NativeLaunches>();
    let input = service.0.lock().map_err(FileError::io)?.file_input(id)?;
    let file = target(&app.state::<NativeSpaces>(), input)?;
    let (target, snapshot) = {
        let mut inbox = service.0.lock().map_err(FileError::io)?;
        let target = inbox.bind_file(id, file, scheme(&app.config().identifier))?;
        (target, inbox.snapshot())
    };
    let _ = app.emit("slate://launch-changed", &snapshot);
    Ok(target)
}

#[cfg(test)]
mod tests;
