//! HTTP API client for Just Maple backend

use anyhow::Result;
use maple_shared::{
    Collectable, CreateCollectableInput, CreateMessageInput, CreateNotebookInput,
    CreatePageInput, Message, Notebook, Page, UpdateCollectableInput, UpdateMessageInput,
    UpdateNotebookInput, UpdatePageInput,
};
use reqwest::Client;
use serde::de::DeserializeOwned;
use tracing::{debug, info};

/// API client for HTTP requests
#[derive(Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
}

impl ApiClient {
    pub fn new(client: Client, base_url: &str) -> Self {
        Self {
            client,
            base_url: base_url.to_string(),
        }
    }

    /// Make GET request
    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        info!("API GET {}", url);

        let response = self.client.get(&url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("GET {} failed with {}: {}", url, status, body));
        }
        let body = response.text().await?;
        debug!("API response: {}", body);
        Ok(serde_json::from_str(&body)?)
    }

    /// Make POST request
    async fn post<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        info!("API POST {}", url);

        let response = self
            .client
            .post(&url)
            .json(body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("POST {} failed with {}: {}", url, status, body));
        }
        let body = response.text().await?;
        debug!("API response: {}", body);
        Ok(serde_json::from_str(&body)?)
    }

    /// Make PATCH request
    async fn patch<T: DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        info!("API PATCH {}", url);

        let response = self
            .client
            .patch(&url)
            .json(body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("PATCH {} failed with {}: {}", url, status, body));
        }
        let body = response.text().await?;
        debug!("API response: {}", body);
        Ok(serde_json::from_str(&body)?)
    }

    /// Make DELETE request
    async fn delete(&self, path: &str) -> Result<()> {
        let url = format!("{}{}", self.base_url, path);
        info!("API DELETE {}", url);

        let response = self.client
            .delete(&url)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("DELETE {} failed with {}: {}", url, status, body));
        }
        Ok(())
    }

    // ===== Notebooks =====

    /// Get all notebooks for the current user
    pub async fn get_notebooks(&self) -> Result<Vec<Notebook>> {
        #[derive(serde::Deserialize)]
        struct Response {
            notebooks: Vec<Notebook>,
        }
        let response: Response = self.get("/api/notebooks").await?;
        Ok(response.notebooks)
    }

    /// Get a single notebook
    pub async fn get_notebook(&self, id: &str) -> Result<Notebook> {
        #[derive(serde::Deserialize)]
        struct Response {
            notebook: Notebook,
        }
        let response: Response = self.get(&format!("/api/notebooks/{}", id)).await?;
        Ok(response.notebook)
    }

    /// Create a new notebook
    pub async fn create_notebook(&self, input: &CreateNotebookInput) -> Result<Notebook> {
        #[derive(serde::Deserialize)]
        struct Response {
            notebook: Notebook,
        }
        let response: Response = self.post("/api/notebooks", input).await?;
        Ok(response.notebook)
    }

    /// Update a notebook
    pub async fn update_notebook(&self, id: &str, input: &UpdateNotebookInput) -> Result<Notebook> {
        #[derive(serde::Deserialize)]
        struct Response {
            notebook: Notebook,
        }
        let response: Response = self.patch(&format!("/api/notebooks/{}", id), input).await?;
        Ok(response.notebook)
    }

    /// Delete a notebook
    pub async fn delete_notebook(&self, id: &str) -> Result<()> {
        self.delete(&format!("/api/notebooks/{}", id)).await
    }

    // ===== Pages =====

    /// Get all pages for a notebook (tag)
    pub async fn get_pages(&self, notebook_id: &str) -> Result<Vec<Page>> {
        #[derive(serde::Deserialize)]
        struct Response {
            pages: Vec<Page>,
        }
        let response: Response = self
            .get(&format!("/api/pages?tagId={}", notebook_id))
            .await?;
        Ok(response.pages)
    }

    /// Get a single page
    pub async fn get_page(&self, id: &str) -> Result<Page> {
        #[derive(serde::Deserialize)]
        struct Response {
            page: Page,
        }
        let response: Response = self.get(&format!("/api/pages/{}", id)).await?;
        Ok(response.page)
    }

    /// Create a new page
    pub async fn create_page(&self, input: &CreatePageInput) -> Result<Page> {
        #[derive(serde::Deserialize)]
        struct Response {
            page: Page,
        }
        let response: Response = self.post("/api/pages", input).await?;
        Ok(response.page)
    }

    /// Update a page
    pub async fn update_page(&self, id: &str, input: &UpdatePageInput) -> Result<Page> {
        #[derive(serde::Deserialize)]
        struct Response {
            page: Page,
        }
        let response: Response = self.patch(&format!("/api/pages/{}", id), input).await?;
        Ok(response.page)
    }

    /// Delete a page
    pub async fn delete_page(&self, id: &str) -> Result<()> {
        self.delete(&format!("/api/pages/{}", id)).await
    }

    // ===== Messages =====

    /// Get messages for a notebook
    pub async fn get_messages(&self, notebook_id: &str) -> Result<Vec<Message>> {
        #[derive(serde::Deserialize)]
        struct Response {
            messages: Vec<Message>,
        }
        let response: Response = self.get(&format!("/api/notebooks/{}/messages", notebook_id)).await?;
        Ok(response.messages)
    }

    /// Create a message
    pub async fn create_message(&self, notebook_id: &str, input: &CreateMessageInput) -> Result<Message> {
        #[derive(serde::Deserialize)]
        struct Response {
            message: Message,
        }
        let response: Response = self
            .post(&format!("/api/notebooks/{}/messages", notebook_id), input)
            .await?;
        Ok(response.message)
    }

    /// Update a message
    pub async fn update_message(&self, id: &str, input: &UpdateMessageInput) -> Result<Message> {
        #[derive(serde::Deserialize)]
        struct Response {
            message: Message,
        }
        let response: Response = self.patch(&format!("/api/messages/{}", id), input).await?;
        Ok(response.message)
    }

    /// Delete a message
    pub async fn delete_message(&self, id: &str) -> Result<()> {
        self.delete(&format!("/api/messages/{}", id)).await
    }

    // ===== Collectables =====

    /// Get all collectables
    pub async fn get_collectables(&self) -> Result<Vec<Collectable>> {
        #[derive(serde::Deserialize)]
        struct Response {
            collectables: Vec<Collectable>,
        }
        let response: Response = self.get("/api/collectables").await?;
        Ok(response.collectables)
    }

    /// Get a single collectable
    pub async fn get_collectable(&self, id: &str) -> Result<Collectable> {
        #[derive(serde::Deserialize)]
        struct Response {
            collectable: Collectable,
        }
        let response: Response = self.get(&format!("/api/collectables/{}", id)).await?;
        Ok(response.collectable)
    }

    /// Create a collectable
    pub async fn create_collectable(&self, input: &CreateCollectableInput) -> Result<Collectable> {
        #[derive(serde::Deserialize)]
        struct Response {
            collectable: Collectable,
        }
        let response: Response = self.post("/api/collectables", input).await?;
        Ok(response.collectable)
    }

    /// Update a collectable
    pub async fn update_collectable(
        &self,
        id: &str,
        input: &UpdateCollectableInput,
    ) -> Result<Collectable> {
        #[derive(serde::Deserialize)]
        struct Response {
            collectable: Collectable,
        }
        let response: Response = self
            .patch(&format!("/api/collectables/{}", id), input)
            .await?;
        Ok(response.collectable)
    }

    /// Delete a collectable
    pub async fn delete_collectable(&self, id: &str) -> Result<()> {
        self.delete(&format!("/api/collectables/{}", id)).await
    }
}
