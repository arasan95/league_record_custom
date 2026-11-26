use serde::{Deserialize, Serialize};

#[allow(clippy::enum_variant_names)]
#[cfg_attr(test, derive(specta::Type, tauri_specta::Event))]
#[derive(Debug, Clone, strum_macros::IntoStaticStr, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AppEvent {
    RecordingPhaseChanged { payload: RecordingStatus },
    RecordingsChanged { payload: () },
    MetadataChanged { payload: Vec<String> },
    MarkerflagsChanged { payload: () },
    RecordingStarted,
    ManualRecordingStarted,
    ManualRecordingStopped,
    GameDetected,
    GameStarted,
    RecordingFailed { payload: String },
    RecordingMetadataSaveFailed { payload: String },
    RecordingFinished { payload: (String, bool) },
}

#[cfg_attr(test, derive(specta::Type))]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordingStatus {
    Idle,
    Preparing,
    Recording,
    Stopping,
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
            RecordingPhaseChanged { payload } => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), payload)?
            }
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
            ManualRecordingStarted => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), ())?
            }
            ManualRecordingStopped => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), ())?
            }
            GameDetected => self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), ())?,
            GameStarted => self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), ())?,
            RecordingFailed { payload } | RecordingMetadataSaveFailed { payload } => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), payload)?
            }
            RecordingFinished { payload } => {
                self.emit_to(EventTarget::webview_window(AppWindow::Main), (&event).into(), payload)?
            }
        };

        Ok(())
    }
}
