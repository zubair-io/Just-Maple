//! WebSocket client for real-time sync

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

/// WebSocket message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsMessage {
    #[serde(rename = "auth")]
    Auth { token: String },
    #[serde(rename = "subscribe")]
    Subscribe { channels: Vec<String> },
    #[serde(rename = "unsubscribe")]
    Unsubscribe { channels: Vec<String> },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "chat")]
    Chat { data: serde_json::Value },
    #[serde(rename = "sync")]
    Sync { data: serde_json::Value },
    #[serde(rename = "error")]
    Error { message: String },
}

/// WebSocket client for real-time communication
pub struct WebSocketClient {
    tx: mpsc::Sender<WsMessage>,
    subscriptions: Arc<RwLock<Vec<String>>>,
    is_connected: Arc<RwLock<bool>>,
}

impl WebSocketClient {
    /// Connect to WebSocket server
    pub async fn connect(url: &str, token: &str) -> Result<Self> {
        let ws_url = format!("{}?token={}", url, token);

        let (ws_stream, _) = connect_async(&ws_url).await?;
        let (mut write, mut read) = ws_stream.split();

        let (tx, mut rx) = mpsc::channel::<WsMessage>(100);
        let is_connected = Arc::new(RwLock::new(true));
        let is_connected_clone = is_connected.clone();

        // Spawn writer task
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                let json = match serde_json::to_string(&msg) {
                    Ok(j) => j,
                    Err(e) => {
                        error!("Failed to serialize WS message: {}", e);
                        continue;
                    }
                };
                if let Err(e) = write.send(Message::Text(json.into())).await {
                    error!("Failed to send WS message: {}", e);
                    break;
                }
            }
        });

        // Spawn reader task
        let tx_clone = tx.clone();
        tokio::spawn(async move {
            while let Some(result) = read.next().await {
                match result {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<WsMessage>(&text) {
                            Ok(WsMessage::Ping) => {
                                // Respond to ping with pong
                                if let Err(e) = tx_clone.send(WsMessage::Pong).await {
                                    error!("Failed to send pong: {}", e);
                                }
                            }
                            Ok(msg) => {
                                debug!("Received WS message: {:?}", msg);
                                // TODO: Handle different message types
                            }
                            Err(e) => {
                                warn!("Failed to parse WS message: {} - {}", e, text);
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        info!("WebSocket closed by server");
                        break;
                    }
                    Ok(_) => {}
                    Err(e) => {
                        error!("WebSocket error: {}", e);
                        break;
                    }
                }
            }

            // Mark as disconnected
            let mut connected = is_connected_clone.write().await;
            *connected = false;
        });

        Ok(Self {
            tx,
            subscriptions: Arc::new(RwLock::new(Vec::new())),
            is_connected,
        })
    }

    /// Check if connected
    pub async fn is_connected(&self) -> bool {
        *self.is_connected.read().await
    }

    /// Subscribe to channels
    pub async fn subscribe(&self, channels: Vec<String>) -> Result<()> {
        self.tx
            .send(WsMessage::Subscribe {
                channels: channels.clone(),
            })
            .await?;

        let mut subs = self.subscriptions.write().await;
        for channel in channels {
            if !subs.contains(&channel) {
                subs.push(channel);
            }
        }

        Ok(())
    }

    /// Unsubscribe from channels
    pub async fn unsubscribe(&self, channels: Vec<String>) -> Result<()> {
        self.tx
            .send(WsMessage::Unsubscribe {
                channels: channels.clone(),
            })
            .await?;

        let mut subs = self.subscriptions.write().await;
        subs.retain(|c| !channels.contains(c));

        Ok(())
    }

    /// Send a message
    pub async fn send(&self, message: WsMessage) -> Result<()> {
        self.tx.send(message).await?;
        Ok(())
    }

    /// Close the connection
    pub async fn close(&self) {
        let mut connected = self.is_connected.write().await;
        *connected = false;
    }
}
