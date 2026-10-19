//! Authentication module
//!
//! Handles login, token storage, and session management.

use anyhow::{anyhow, Result};
use maple_shared::{AuthResponse, AuthUser};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::storage::LocalStorage;

/// Stored credentials
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCredentials {
    pub access_token: String,
    pub user: AuthUser,
    pub stored_at: i64,
}

/// Authentication manager
#[derive(Clone)]
pub struct AuthManager {
    storage: LocalStorage,
    credentials: Arc<RwLock<Option<StoredCredentials>>>,
    http_client: Client,
    api_url: Arc<RwLock<String>>,
}

impl AuthManager {
    pub fn new(storage: LocalStorage) -> Self {
        let credentials = storage
            .get::<StoredCredentials>("auth_credentials")
            .ok()
            .flatten();

        Self {
            storage,
            credentials: Arc::new(RwLock::new(credentials)),
            http_client: Client::new(),
            api_url: Arc::new(RwLock::new("https://api.justmaple.app".to_string())),
        }
    }

    /// Set the API URL
    pub async fn set_api_url(&self, url: &str) {
        let mut api_url = self.api_url.write().await;
        *api_url = url.to_string();
    }

    /// Check if user is authenticated (has stored token)
    pub async fn is_authenticated(&self) -> bool {
        self.credentials.read().await.is_some()
    }

    /// Get current access token
    pub async fn get_access_token(&self) -> Option<String> {
        self.credentials
            .read()
            .await
            .as_ref()
            .map(|c| c.access_token.clone())
    }

    /// Get current user
    pub async fn get_user(&self) -> Option<AuthUser> {
        self.credentials
            .read()
            .await
            .as_ref()
            .map(|c| c.user.clone())
    }

    /// Store credentials locally
    async fn store_credentials(&self, auth: &AuthResponse) -> Result<()> {
        let credentials = StoredCredentials {
            access_token: auth.access_token.clone(),
            user: auth.user.clone(),
            stored_at: chrono::Utc::now().timestamp(),
        };

        self.storage.set("auth_credentials", &credentials)?;

        let mut creds = self.credentials.write().await;
        *creds = Some(credentials);

        debug!("Credentials stored");
        Ok(())
    }

    /// Refresh the current session
    pub async fn refresh_session(&self) -> Result<()> {
        let token = self
            .get_access_token()
            .await
            .ok_or_else(|| anyhow!("No stored token"))?;

        let api_url = self.api_url.read().await.clone();
        let url = format!("{}/api/auth/me", api_url);

        let response = self
            .http_client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if !response.status().is_success() {
            self.logout().await;
            return Err(anyhow!("Session invalid"));
        }

        debug!("Session refreshed");
        Ok(())
    }

    /// Logout and clear credentials
    pub async fn logout(&self) {
        self.storage.delete("auth_credentials").ok();
        let mut creds = self.credentials.write().await;
        *creds = None;
        info!("Logged out");
    }

    /// Create HTTP client with auth header
    pub async fn create_authenticated_client(&self) -> Result<Client> {
        let token = self
            .get_access_token()
            .await
            .ok_or_else(|| anyhow!("Not authenticated"))?;

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", token).parse()?,
        );

        Ok(Client::builder().default_headers(headers).build()?)
    }
}
