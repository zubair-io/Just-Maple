//! Sync module
//!
//! Handles HTTP API calls and WebSocket real-time sync.

mod api;
pub mod offline;
mod websocket;

pub use api::ApiClient;
pub use offline::OfflineQueue;
pub use websocket::{RealtimeEvent, WebSocketClient};

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::auth::AuthManager;
use crate::Config;

/// Connection state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

/// Sync manager coordinates API and WebSocket communication
#[derive(Clone)]
pub struct SyncManager {
    config: Config,
    auth: AuthManager,
    api: Arc<RwLock<Option<ApiClient>>>,
    ws: Arc<RwLock<Option<WebSocketClient>>>,
    offline_queue: OfflineQueue,
    active_page: Arc<RwLock<Option<String>>>,
    connection_state: Arc<RwLock<ConnectionState>>,
}

impl SyncManager {
    pub fn new(config: Config, auth: AuthManager) -> Self {
        let offline_queue = OfflineQueue::new();

        Self {
            config,
            auth,
            api: Arc::new(RwLock::new(None)),
            ws: Arc::new(RwLock::new(None)),
            offline_queue,
            active_page: Arc::new(RwLock::new(None)),
            connection_state: Arc::new(RwLock::new(ConnectionState::Disconnected)),
        }
    }

    /// Get current connection state
    pub async fn connection_state(&self) -> ConnectionState {
        *self.connection_state.read().await
    }

    /// Initialize API client (requires authentication)
    pub async fn init_api(&self) -> Result<()> {
        let client = self.auth.create_authenticated_client().await?;
        let api = ApiClient::new(client, &self.config.api_url);

        let mut api_lock = self.api.write().await;
        *api_lock = Some(api);

        info!("API client initialized");
        Ok(())
    }

    /// Get API client
    pub async fn api(&self) -> Option<ApiClient> {
        self.api.read().await.clone()
    }

    /// Connect to WebSocket for real-time updates
    pub async fn connect_websocket(&self) -> Result<()> {
        {
            let mut state = self.connection_state.write().await;
            *state = ConnectionState::Connecting;
        }

        let token = self
            .auth
            .get_access_token()
            .await
            .ok_or_else(|| anyhow::anyhow!("Not authenticated"))?;

        let ws = match WebSocketClient::connect(&self.config.ws_url, &token).await {
            Ok(ws) => ws,
            Err(error) => {
                *self.connection_state.write().await = ConnectionState::Disconnected;
                return Err(error);
            }
        };

        {
            let mut ws_lock = self.ws.write().await;
            *ws_lock = Some(ws);
        }

        {
            let mut state = self.connection_state.write().await;
            *state = ConnectionState::Connected;
        }

        if let Some(page) = self.active_page.read().await.as_ref() {
            self.subscribe_page(page).await?;
        }
        info!("WebSocket connected");

        // Process any pending offline operations
        self.process_offline_queue().await;

        Ok(())
    }

    pub fn drain_events(&self) -> Vec<RealtimeEvent> {
        self.ws
            .try_read()
            .ok()
            .and_then(|ws| ws.as_ref().map(WebSocketClient::drain))
            .unwrap_or_default()
    }

    pub async fn set_active_page(&self, previous: Option<String>, next: Option<String>) {
        *self.active_page.write().await = next.clone();
        if let Some(ws) = self.ws.read().await.as_ref() {
            if let Some(page) = previous {
                let _ = ws.unsubscribe(vec![page]).await;
            }
            if let Some(page) = next {
                let _ = ws.subscribe(vec![page]).await;
            }
        }
    }

    pub async fn subscribe_page(&self, page_id: &str) -> Result<()> {
        if let Some(ws) = self.ws.read().await.as_ref() {
            ws.subscribe(vec![page_id.to_owned()]).await?;
        }
        Ok(())
    }

    /// Disconnect WebSocket
    pub async fn disconnect_websocket(&self) {
        let mut ws_lock = self.ws.write().await;
        if let Some(ws) = ws_lock.take() {
            ws.close().await;
        }

        let mut state = self.connection_state.write().await;
        *state = ConnectionState::Disconnected;

        info!("WebSocket disconnected");
    }

    /// Check if we're online and connected
    pub async fn is_online(&self) -> bool {
        if let Some(ws) = self.ws.read().await.as_ref() {
            ws.is_connected().await
        } else {
            false
        }
    }

    /// Queue operation for offline processing
    pub fn queue_offline(&self, operation: offline::OfflineOperation) {
        self.offline_queue.push(operation);
        debug!("Operation queued for offline processing");
    }

    /// Process pending offline operations
    async fn process_offline_queue(&self) {
        let api = match self.api().await {
            Some(api) => api,
            None => {
                warn!("Cannot process offline queue: API not initialized");
                return;
            }
        };

        let operations = self.offline_queue.drain();
        if operations.is_empty() {
            return;
        }

        info!("Processing {} offline operations", operations.len());

        for op in operations {
            match self.execute_operation(&api, op.clone()).await {
                Ok(_) => debug!("Offline operation completed"),
                Err(e) => {
                    warn!("Failed to process offline operation: {}", e);
                    // Re-queue failed operation
                    self.offline_queue.push(op);
                }
            }
        }
    }

    /// Execute a single offline operation
    async fn execute_operation(
        &self,
        api: &ApiClient,
        operation: offline::OfflineOperation,
    ) -> Result<()> {
        match operation {
            offline::OfflineOperation::CreatePage(input) => {
                api.create_page(&input).await?;
            }
            offline::OfflineOperation::UpdatePage { id, input } => {
                api.update_page(&id, &input).await?;
            }
            offline::OfflineOperation::DeletePage { id } => {
                api.delete_page(&id).await?;
            }
            offline::OfflineOperation::CreateMessage { tag_id, input } => {
                api.create_message(&tag_id, &input).await?;
            }
            offline::OfflineOperation::UpdateMessage { id, input } => {
                api.update_message(&id, &input).await?;
            }
            offline::OfflineOperation::DeleteMessage { id } => {
                api.delete_message(&id).await?;
            }
            offline::OfflineOperation::UpdateCollectable { id, input } => {
                api.update_collectable(&id, &input).await?;
            }
        }
        Ok(())
    }
}
