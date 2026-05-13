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
    task: Mutex<Option<JoinHandle<()>>>,
    manual_stop_tx: tokio::sync::broadcast::Sender<()>,
    manual_start_tx: tokio::sync::broadcast::Sender<()>,
}

impl LeagueRecorder {
    const PLATFORM_ID: &'static str = "/lol-platform-config/v1/namespaces/LoginDataPacket/platformId";
    const REGION_LOCALE: &'static str = "/riotclient/region-locale";

    async fn platform_id(lcu_rest_client: &LcuRestClient) -> String {
        if let Ok(platform_id) = lcu_rest_client.get::<String>(Self::PLATFORM_ID).await {
            return platform_id;
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RegionLocale {
            region: Option<String>,
            web_region: Option<String>,
        }

        let inferred = lcu_rest_client
            .get::<RegionLocale>(Self::REGION_LOCALE)
            .await
            .ok()
            .and_then(|region_locale| {
                region_locale
                    .web_region
                    .or(region_locale.region)
                    .and_then(|region| platform_id_from_region(&region))
            });

        if let Some(platform_id) = inferred {
            log::warn!(
                "LCU platformId endpoint is unavailable; inferred platform_id='{}' from region-locale",
                platform_id
            );
            platform_id
        } else {
            log::warn!("LCU platformId endpoint is unavailable; continuing with platform_id='UNKNOWN'");
            "UNKNOWN".to_string()
        }
    }

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
                        let platform_id = Self::platform_id(&lcu_rest_client).await;

                        let ctx = ApiCtx {
                            app_handle: app_handle.clone(),
                            credentials,
                            platform_id,
                            cancel_token: cancel_token.clone(),
                        };

                        if let Err(e) = GameListener::new(ctx, manual_stop_tx.subscribe(), manual_start_tx.subscribe())
                            .run()
                            .await
                        {
                            log::error!("stopped listening for games: {e}");
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
            task: Mutex::new(Some(task)),
            manual_stop_tx,
            manual_start_tx,
        }
    }

    pub async fn stop(&self) {
        self.cancel_token.cancel();

        let Ok(mut task_slot) = self.task.try_lock() else { return };
        let Some(mut task) = task_slot.take() else { return };

        if timeout(Duration::from_secs(2), &mut task).await.is_err() {
            log::warn!("RecordingTask stop() ran into timeout - aborting task");
            task.abort();
            let _ = task.await;
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

fn platform_id_from_region(region: &str) -> Option<String> {
    let normalized = region.trim().replace(['-', '_'], "").to_ascii_uppercase();
    let platform_id = match normalized.as_str() {
        "BR" | "BR1" => "BR1",
        "EUN" | "EUNE" | "EUN1" => "EUN1",
        "EUW" | "EUW1" => "EUW1",
        "JP" | "JP1" => "JP1",
        "KR" => "KR",
        "LA1" | "LAN" => "LA1",
        "LA2" | "LAS" => "LA2",
        "ME" | "ME1" => "ME1",
        "NA" | "NA1" => "NA1",
        "OC" | "OCE" | "OC1" => "OC1",
        "RU" => "RU",
        "SG" | "SG2" => "SG2",
        "TH" | "TH2" => "TH2",
        "TR" | "TR1" => "TR1",
        "TW" | "TW2" => "TW2",
        "VN" | "VN2" => "VN2",
        _ => return None,
    };
    Some(platform_id.to_string())
}
