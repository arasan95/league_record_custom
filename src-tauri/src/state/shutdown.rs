use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Default)]
pub struct Shutdown(AtomicBool);

impl Shutdown {
    pub fn begin(&self) -> bool {
        !self.0.swap(true, Ordering::AcqRel)
    }

    pub fn get(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}
