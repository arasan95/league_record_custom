use anyhow::Result;
use futures_util::StreamExt;
use riot_datatypes::lcu::{SessionEventData, SubscriptionResponse};
use riot_local_auth::Credentials;
use shaco::model::ws::{EventType, LcuSubscriptionType};
use shaco::{rest::LcuRestClient, ws::LcuWebsocketClient};

pub(super) struct GameListener(LcuWebsocketClient);

impl GameListener {
    pub(super) const GAMEFLOW_SESSION: &'static str = "/lol-gameflow/v1/session";
    const EOG_STATS_BLOCK: &'static str = "/lol-end-of-game/v1/eog-stats-block";

    pub(super) async fn connect(credentials: &Credentials) -> Result<Self> {
        let mut client = LcuWebsocketClient::connect_with(credentials).await?;
        for endpoint in [Self::GAMEFLOW_SESSION, Self::EOG_STATS_BLOCK] {
            client
                .subscribe(LcuSubscriptionType::JsonApiEvent(endpoint.into()))
                .await?;
        }
        log::info!("Connected to League Client gameflow events");
        Ok(Self(client))
    }

    pub(super) async fn initial_session(&self, credentials: &Credentials) -> Option<SessionEventData> {
        match LcuRestClient::from(credentials).get(Self::GAMEFLOW_SESSION).await {
            Ok(session) => Some(session),
            Err(error) => {
                log::info!("no initial event-data: {error}");
                None
            }
        }
    }

    pub(super) async fn next_event(&mut self) -> Option<SubscriptionResponse> {
        while let Some(event) = self.0.next().await {
            if event.payload.event_type != EventType::Update {
                continue;
            }
            match serde_json::from_value(event.payload.data) {
                Ok(event) => return Some(event),
                Err(error) => log::error!("failed to deserialize event: {error}"),
            }
        }
        None
    }
}
