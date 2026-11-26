use std::{
    io::{self, BufRead, BufReader, BufWriter, StdinLock, StdoutLock, Write},
    path::{Component, Path},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use intprocess_recorder::settings::{Adapter, Encoder, RecorderSettings};

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub enum IpcCommand {
    Init {
        libobs_data_path: Option<String>,
        plugin_bin_path: Option<String>,
        plugin_data_path: Option<String>,
    },
    Configure(RecorderSettings),
    Encoders,
    Adapter,
    StartRecording,
    CaptureVideoRegion {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    StopRecording,
    IsRecording,
    Shutdown,
    Exit,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct VideoRegionFrame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum IpcResponse {
    Ok,
    Encoders { available: Vec<Encoder>, selected: Encoder },
    Adapter(Adapter),
    Recording(bool),
    VideoRegion(Option<VideoRegionFrame>),
    Err(String),
}

#[derive(Debug)]
pub struct IpcLinkMaster {
    requests: mpsc::Sender<(IpcCommand, mpsc::SyncSender<IpcResponse>)>,
    child_process: Child,
}

impl IpcLinkMaster {
    pub fn new(executable: impl AsRef<Path>) -> io::Result<Self> {
        let executable = executable.as_ref().canonicalize()?;
        let mut command = Command::new(executable.as_os_str());
        command.current_dir(executable.parent().unwrap_or_else(|| Path::new(&Component::RootDir)));
        Self::spawn(&mut command)
    }

    fn spawn(command: &mut Command) -> io::Result<Self> {
        let mut child_process = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        let mut tx = BufWriter::new(child_process.stdin.take().unwrap());
        let mut rx = BufReader::new(child_process.stdout.take().unwrap());
        let (requests, incoming) = mpsc::channel::<(IpcCommand, mpsc::SyncSender<IpcResponse>)>();
        let worker = std::thread::Builder::new().name("recorder-ipc".into()).spawn(move || {
            for (command, reply) in incoming {
                let response = (|| -> io::Result<IpcResponse> {
                    serde_json::to_writer(&mut tx, &command)?;
                    tx.write_all(b"\n")?;
                    tx.flush()?;
                    let mut line = String::new();
                    loop {
                        if rx.read_line(&mut line)? == 0 {
                            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "recorder pipe closed"));
                        }
                        if let Ok(response) = serde_json::from_str(&line) { return Ok(response); }
                        log::info!("[rec]: {}", line.trim_end());
                        line.clear();
                    }
                })();
                let _ = reply.send(response.unwrap_or_else(|error| IpcResponse::Err(error.to_string())));
            }
        });
        if let Err(error) = worker {
            let _ = child_process.kill();
            let _ = child_process.wait();
            return Err(error);
        }
        Ok(Self { requests, child_process })
    }

    pub fn send(&mut self, cmd: IpcCommand) -> IpcResponse {
        let timeout = match cmd {
            IpcCommand::StopRecording | IpcCommand::Shutdown | IpcCommand::Exit => Duration::from_secs(5),
            _ => Duration::from_secs(15),
        };
        self.send_with_timeout(cmd, timeout)
    }

    fn send_with_timeout(&mut self, cmd: IpcCommand, timeout: Duration) -> IpcResponse {
        let (reply, response) = mpsc::sync_channel(1);
        if self.requests.send((cmd, reply)).is_err() {
            return IpcResponse::Err("recorder IPC worker disconnected".into());
        }
        match response.recv_timeout(timeout) {
            Ok(response) => response,
            Err(error) => {
                self.terminate();
                IpcResponse::Err(format!("recorder IPC response failed: {error}"))
            }
        }
    }

    pub fn drain_logs(&mut self) -> io::Result<()> {
        use wait_timeout::ChildExt;
        match self.child_process.wait_timeout(Duration::from_secs(3))? {
            Some(status) if status.success() => Ok(()),
            Some(status) => Err(io::Error::other(format!("recorder exited with {status}"))),
            None => {
                self.terminate();
                Err(io::Error::new(io::ErrorKind::TimedOut, "recorder did not exit"))
            }
        }
    }

    fn terminate(&mut self) {
        if !matches!(self.child_process.try_wait(), Ok(Some(_))) {
            let _ = self.child_process.kill();
            let _ = self.child_process.wait();
        }
    }
}

impl Drop for IpcLinkMaster {
    fn drop(&mut self) { self.terminate(); }
}

pub struct IpcLinkSlave<'a> {
    tx: BufWriter<StdoutLock<'a>>,
    rx: BufReader<StdinLock<'a>>,
    buffer: String,
}

impl IpcLinkSlave<'_> {
    #[must_use]
    pub fn new() -> Self {
        Self {
            tx: BufWriter::new(io::stdout().lock()),
            rx: BufReader::new(io::stdin().lock()),
            buffer: String::with_capacity(512),
        }
    }

    pub fn respond(&mut self, mut handler: impl FnMut(IpcCommand) -> Option<IpcResponse>) {
        loop {
            let line = self.read_line();
            if line.is_empty() {
                break;
            }
            let cmd = match serde_json::from_str(line) {
                Ok(c) => c,
                Err(_) => break,
            };

            let Some(response) = handler(cmd) else { break };
            if serde_json::to_writer::<_, IpcResponse>(&mut self.tx, &response).is_err() {
                break;
            }
            if self.tx.write(b"\n").is_err() {
                break;
            }
            if self.tx.flush().is_err() {
                break;
            }
        }

        // Send one last IpcResponse::Ok because the other side is waiting for a response to IpcCommand::Exit
        _ = serde_json::to_writer::<_, IpcResponse>(&mut self.tx, &IpcResponse::Ok);
        _ = self.tx.write(b"\n");
        _ = self.tx.flush();
    }

    fn read_line(&mut self) -> &str {
        self.buffer.clear();
        self.rx.read_line(&mut self.buffer).unwrap();
        &self.buffer
    }
}

impl Default for IpcLinkSlave<'_> {
    fn default() -> Self {
        Self::new()
    }
}


#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn unresponsive_helper_is_reaped_before_returning_timeout() {
        let script = "$null = [Console]::ReadLine(); Start-Sleep -Seconds 30";
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        let mut link = IpcLinkMaster::spawn(&mut command).unwrap();
        let result = link.send_with_timeout(IpcCommand::StopRecording, Duration::from_millis(250));
        assert!(matches!(result, IpcResponse::Err(message) if message.contains("timed out") || message.contains("timeout")));
        assert!(link.child_process.try_wait().unwrap().is_some());
    }
}
