//! Just Maple reMarkable Application
//!
//! Native app for reMarkable tablets supporting Notes, Whiteboard, Messages, and Lego features.

mod auth;
mod eink;
mod input;
mod storage;
mod sync;
mod ui;

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use crate::auth::AuthManager;
use crate::storage::LocalStorage;
use crate::sync::SyncManager;
use crate::ui::App;

/// Application configuration
#[derive(Debug, Clone)]
pub struct Config {
    /// API base URL
    pub api_url: String,
    /// WebSocket URL for real-time sync
    pub ws_url: String,
    /// Local storage path
    pub storage_path: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_url: "https://api.justmaple.app".to_string(),
            ws_url: "wss://api.justmaple.app/ws".to_string(),
            storage_path: "/home/root/.local/share/justmaple".to_string(),
        }
    }
}

impl Config {
    /// Load config from environment variables or use defaults
    pub fn from_env() -> Self {
        Self {
            api_url: std::env::var("MAPLE_API_URL")
                .unwrap_or_else(|_| "https://api.justmaple.app".to_string()),
            ws_url: std::env::var("MAPLE_WS_URL")
                .unwrap_or_else(|_| "wss://api.justmaple.app/ws".to_string()),
            storage_path: std::env::var("MAPLE_STORAGE_PATH")
                .unwrap_or_else(|_| "/home/root/.local/share/justmaple".to_string()),
        }
    }
}

/// Shared application state
pub struct AppState {
    pub config: Config,
    pub storage: LocalStorage,
    pub auth: AuthManager,
    pub sync: SyncManager,
}

impl AppState {
    pub async fn new(config: Config) -> Result<Self> {
        let storage = LocalStorage::new(&config.storage_path)?;
        let auth = AuthManager::new(storage.clone());

        // Set the API URL from config
        auth.set_api_url(&config.api_url).await;

        let sync = SyncManager::new(config.clone(), auth.clone());

        Ok(Self {
            config,
            storage,
            auth,
            sync,
        })
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::DEBUG)
        .with_target(false)
        .compact()
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    info!("Starting Just Maple for reMarkable");

    // Load configuration
    let config = Config::from_env();
    info!("API URL: {}", config.api_url);

    // Initialize application state
    let state = Arc::new(RwLock::new(AppState::new(config).await?));

    // Check if we have stored credentials
    {
        let state_guard = state.read().await;
        if state_guard.auth.is_authenticated().await {
            info!("Found stored credentials, attempting to restore session");
            if let Err(e) = state_guard.auth.refresh_session().await {
                info!("Session refresh failed: {}, will require re-login", e);
            } else {
                info!("Session restored successfully");
            }
        }
    }

    // Run the UI
    App::run(state).await
}
