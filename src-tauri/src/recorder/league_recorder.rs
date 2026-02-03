use std::time::Duration;

use shaco::rest::LcuRestClient;
use tauri::async_runtime::{self, JoinHandle, Mutex};
use tauri::AppHandle;
use tokio::time::{sleep, timeout};
use tokio_util::sync::CancellationToken;

use super::game_listener::{ApiCtx, GameListener};
use crate::cancellable;

pub struct LeagueRecorder {
    cancel_token: CancellationToken,
    task: Mutex<JoinHandle<()>>,
    manual_stop_tx: tokio::sync::broadcast::Sender<()>,
    manual_start_tx: tokio::sync::broadcast::Sender<()>,
}

impl LeagueRecorder {
    const PLATFORM_ID: &'static str = "/lol-platform-config/v1/namespaces/LoginDataPacket/platformId";

    pub fn new(app_handle: AppHandle) -> Self {
        let cancel_token = CancellationToken::new();
        let (manual_stop_tx, _) = tokio::sync::broadcast::channel(1);
        let (manual_start_tx, _) = tokio::sync::broadcast::channel(1);

        let task = async_runtime::spawn({
            let cancel_token = cancel_token.child_token();
            let manual_stop_tx = manual_stop_tx.clone();
            let manual_start_tx = manual_start_tx.clone();

            async move {
                log::info!("waiting for LCU API");

                loop {
                    if let Ok(credentials) = riot_local_auth::lcu::try_get_credentials() {
                        let lcu_rest_client = LcuRestClient::from(&credentials);

                        if let Ok(platform_id) = lcu_rest_client.get::<String>(Self::PLATFORM_ID).await {
                            let ctx = ApiCtx {
                                app_handle: app_handle.clone(),
                                credentials,
                                platform_id,
                                cancel_token: cancel_token.clone(),
                            };

                            if let Err(e) = GameListener::new(ctx, manual_stop_tx.subscribe(), manual_start_tx.subscribe()).run().await {
                                log::error!("stopped listening for games: {e}");
                            }
                        }
                    }

                    let cancelled = cancellable!(sleep(Duration::from_secs(1)), cancel_token, ());
                    if cancelled {
                        log::info!("task cancelled (wait_for_api)");
                        return;
                    }
                }
            }
        });

        Self {
            cancel_token,
            task: Mutex::new(task),
            manual_stop_tx,
            manual_start_tx,
        }
    }

    pub async fn stop(&self) {
        self.cancel_token.cancel();

        let Ok(mut task) = self.task.try_lock() else { return };
        if timeout(Duration::from_secs(2), &mut *task).await.is_err() {
            log::warn!("RecordingTask stop() ran into timeout - aborting task");
            task.abort();
        }
    }

    pub fn manual_stop(&self) {
        // We don't need to spawn a task if send is sync (broadcast send is sync)
        if let Err(e) = self.manual_stop_tx.send(()) {
            log::debug!("failed to send manual stop signal (no receivers?): {e}");
        }
    }

    pub fn manual_start(&self) {
        if let Err(e) = self.manual_start_tx.send(()) {
            log::debug!("failed to send manual start signal (no receivers?): {e}");
        }
    }
}
