use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, Default)]
pub enum RecordingPhase {
    #[default]
    Idle,
    Preparing(Option<PathBuf>),
    Recording(PathBuf),
    Stopping(PathBuf),
}

#[derive(Debug, Default)]
pub struct CurrentlyRecording(Mutex<RecordingPhase>);

impl CurrentlyRecording {
    pub fn set(&self, phase: RecordingPhase) {
        *self.0.lock().unwrap() = phase;
    }

    pub fn phase(&self) -> RecordingPhase {
        self.0.lock().unwrap().clone()
    }

    pub fn get(&self) -> Option<PathBuf> {
        match self.phase() {
            RecordingPhase::Preparing(path) => path,
            RecordingPhase::Recording(path) | RecordingPhase::Stopping(path) => Some(path),
            _ => None,
        }
    }
}
