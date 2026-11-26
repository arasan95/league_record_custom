#[macro_export]
macro_rules! cancellable {
    ($function:expr, $cancel_token:expr, Option) => {
        tokio::select! {
            option = $function => option,
            _ = $cancel_token.cancelled() => None
        }
    };
    ($function:expr, $cancel_token:expr, Result) => {
        tokio::select! {
            result = $function => result.map_err(|e| anyhow::anyhow!("{e}")),
            _ = $cancel_token.cancelled() => Err(anyhow::anyhow!("cancelled"))
        }
    };
    ($function:expr, $cancel_token:expr, ()) => {
        tokio::select! {
            _ = $function => false,
            _ = $cancel_token.cancelled() => true
        }
    };
}

pub fn write_json_atomically(path: &std::path::Path, data: &impl serde::Serialize) -> anyhow::Result<()> {
    use std::{
        fs,
        io::Write,
        sync::atomic::{AtomicU64, Ordering},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let json = serde_json::to_vec_pretty(data)?;
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(
        ".{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let temporary = std::path::PathBuf::from(name);
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    let written = file.write_all(&json).and_then(|_| file.sync_all());
    drop(file);
    let result = written.and_then(|_| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    Ok(result?)
}
