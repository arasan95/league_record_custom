use std::path::PathBuf;
use std::{ffi::OsStr, path::Path};

use notify::event::ModifyKind;
use notify::{EventKind, Watcher};
use tauri::{AppHandle, Manager};

use crate::app::{AppEvent, EventManager};
use crate::state::CurrentlyRecording;
use crate::state::{FileWatcher, SettingsWrapper};

pub fn replace(app_handle: &AppHandle, roots: [&Path; 2]) {
    let mut directories = Vec::from(roots.map(Path::to_owned));
    if let Some(settings) = app_handle.try_state::<SettingsWrapper>() {
        directories.extend(
            settings
                .alternate_default_library(roots[0])
                .into_iter()
                .filter(|path| path.is_dir()),
        );
    }
    let mut watched = std::collections::BTreeSet::new();
    directories.retain(|path| watched.insert(path.clone()));
    let watcher = notify::recommended_watcher({
        let app_handle = app_handle.clone();
        let watched_roots = directories.clone();
        move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else {
                let _ = app_handle.send_event(AppEvent::RecordingsChanged { payload: () });
                return;
            };

            let currently_recording: Option<PathBuf> = app_handle.state::<CurrentlyRecording>().get();

            let mut contains_mp4_path: bool = false;
            let mut json_paths: Vec<String> = Vec::new();

            let mut root_changed = false;
            for path in event.paths {
                root_changed |= watched_roots.contains(&path);
                if Some(&path) == currently_recording.as_ref() {
                    continue;
                }

                let ext = path.extension().and_then(OsStr::to_str);

                contains_mp4_path |= ext == Some("mp4");

                if ext == Some("json") {
                    if let Some(video_id) = path.to_str().map(str::to_owned) {
                        json_paths.push(video_id);
                    }
                }
            }

            let entries_changed = matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
            );
            let metadata_changed = entries_changed || matches!(event.kind, EventKind::Modify(ModifyKind::Data(_)));
            if (entries_changed && (contains_mp4_path || root_changed)) || (metadata_changed && !json_paths.is_empty())
            {
                if let Err(error) = app_handle.send_event(AppEvent::RecordingsChanged { payload: () }) {
                    log::warn!("filewatcher failed to send recordings change: {error}");
                }
            }
            if metadata_changed && !json_paths.is_empty() {
                if let Err(error) = app_handle.send_event(AppEvent::MetadataChanged { payload: json_paths }) {
                    log::warn!("filewatcher failed to send metadata change: {error}");
                }
            }
        }
    });

    match watcher {
        Ok(mut watcher) => {
            for root in directories {
                if let Err(error) = watcher.watch(&root, notify::RecursiveMode::NonRecursive) {
                    log::warn!("Could not watch {}: {error}", root.display());
                }
            }

            // store Watcher so it doesn't drop and stop watching
            // also drop old watcher
            if let Some(fw_state) = app_handle.try_state::<FileWatcher>() {
                fw_state.set(watcher);
            } else {
                app_handle.manage::<FileWatcher>(FileWatcher::new(watcher));
            }
        }
        Err(e) => log::error!("failed to start filewatcher: {e}"),
    }
}
