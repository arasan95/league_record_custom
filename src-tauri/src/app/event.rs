use serde::{Deserialize, Serialize};

#[allow(clippy::enum_variant_names)]
#[cfg_attr(test, derive(specta::Type, tauri_specta::Event))]
#[derive(Debug, Clone, strum_macros::IntoStaticStr, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AppEvent {
    RecordingsChanged { payload: () },
    MetadataChanged { payload: Vec<String> },
    MarkerflagsChanged { payload: () },
    RecordingStarted,
    GameDetected,
    RecordingFinished { payload: (String, bool) },
}

pub trait EventManager {
    fn send_event(&self, event: AppEvent) -> anyhow::Result<()>;
}

impl EventManager for tauri::AppHandle {
    fn send_event(&self, event: AppEvent) -> anyhow::Result<()> {
        use crate::app::AppWindow;
        use tauri::{Emitter, EventTarget};
        use AppEvent::*;

        match &event {
            RecordingsChanged { payload } => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), payload)?
            }
            MetadataChanged { payload } => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), payload)?
            }
            MarkerflagsChanged { payload } => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), payload)?
            }
            RecordingStarted => self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), ())?,
            GameDetected => self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), ())?,
            RecordingFinished { payload } => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), payload)?
            }
        };

        Ok(())
    }
}
