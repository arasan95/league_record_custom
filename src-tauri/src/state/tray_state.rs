use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Default)]
pub struct TrayState {
    update_available: AtomicBool,
}

impl TrayState {
    pub fn set_update_available(&self, update_available: bool) {
        self.update_available.store(update_available, Ordering::Release);
    }

    pub fn update_available(&self) -> bool {
        self.update_available.load(Ordering::Acquire)
    }
}
