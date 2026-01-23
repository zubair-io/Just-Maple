//! Local storage module
//!
//! Uses sled for persistent local storage with offline support.

use anyhow::Result;
use serde::{de::DeserializeOwned, Serialize};
use sled::{Db, Tree};
use std::path::Path;
use std::sync::Arc;
use tracing::{debug, warn};

/// Local storage backed by sled
#[derive(Clone)]
pub struct LocalStorage {
    db: Arc<Db>,
    /// Key-value store for settings and auth
    settings: Tree,
    /// Pages cache
    pages: Tree,
    /// Notebooks cache
    notebooks: Tree,
    /// Messages cache
    messages: Tree,
    /// Collectables cache
    collectables: Tree,
    /// Offline queue for pending operations
    offline_queue: Tree,
    /// Automerge documents
    documents: Tree,
}

impl LocalStorage {
    /// Create new local storage at the specified path
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        // Ensure directory exists
        std::fs::create_dir_all(path.as_ref())?;

        let db_path = path.as_ref().join("maple.db");
        let db = sled::open(&db_path)?;

        let settings = db.open_tree("settings")?;
        let pages = db.open_tree("pages")?;
        let notebooks = db.open_tree("notebooks")?;
        let messages = db.open_tree("messages")?;
        let collectables = db.open_tree("collectables")?;
        let offline_queue = db.open_tree("offline_queue")?;
        let documents = db.open_tree("documents")?;

        debug!("Local storage initialized at {:?}", db_path);

        Ok(Self {
            db: Arc::new(db),
            settings,
            pages,
            notebooks,
            messages,
            collectables,
            offline_queue,
            documents,
        })
    }

    // ===== Generic Settings =====

    /// Get a value from settings
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        match self.settings.get(key)? {
            Some(bytes) => {
                let value = serde_json::from_slice(&bytes)?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    /// Set a value in settings
    pub fn set<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let bytes = serde_json::to_vec(value)?;
        self.settings.insert(key, bytes)?;
        Ok(())
    }

    /// Delete a value from settings
    pub fn delete(&self, key: &str) -> Result<()> {
        self.settings.remove(key)?;
        Ok(())
    }

    // ===== Pages =====

    /// Store a page
    pub fn store_page<T: Serialize>(&self, id: &str, page: &T) -> Result<()> {
        let bytes = serde_json::to_vec(page)?;
        self.pages.insert(id, bytes)?;
        Ok(())
    }

    /// Get a page by ID
    pub fn get_page<T: DeserializeOwned>(&self, id: &str) -> Result<Option<T>> {
        match self.pages.get(id)? {
            Some(bytes) => {
                let page = serde_json::from_slice(&bytes)?;
                Ok(Some(page))
            }
            None => Ok(None),
        }
    }

    /// Get all pages for a notebook
    pub fn get_pages_for_notebook<T: DeserializeOwned>(&self, notebook_id: &str) -> Result<Vec<T>> {
        let prefix = format!("notebook:{}", notebook_id);
        let mut pages = Vec::new();

        for result in self.pages.scan_prefix(prefix.as_bytes()) {
            let (_, bytes) = result?;
            let page: T = serde_json::from_slice(&bytes)?;
            pages.push(page);
        }

        Ok(pages)
    }

    /// Delete a page
    pub fn delete_page(&self, id: &str) -> Result<()> {
        self.pages.remove(id)?;
        Ok(())
    }

    // ===== Notebooks =====

    /// Store a notebook
    pub fn store_notebook<T: Serialize>(&self, id: &str, notebook: &T) -> Result<()> {
        let bytes = serde_json::to_vec(notebook)?;
        self.notebooks.insert(id, bytes)?;
        Ok(())
    }

    /// Get a notebook by ID
    pub fn get_notebook<T: DeserializeOwned>(&self, id: &str) -> Result<Option<T>> {
        match self.notebooks.get(id)? {
            Some(bytes) => {
                let notebook = serde_json::from_slice(&bytes)?;
                Ok(Some(notebook))
            }
            None => Ok(None),
        }
    }

    /// Get all notebooks
    pub fn get_all_notebooks<T: DeserializeOwned>(&self) -> Result<Vec<T>> {
        let mut notebooks = Vec::new();

        for result in self.notebooks.iter() {
            let (_, bytes) = result?;
            let notebook: T = serde_json::from_slice(&bytes)?;
            notebooks.push(notebook);
        }

        Ok(notebooks)
    }

    /// Delete a notebook
    pub fn delete_notebook(&self, id: &str) -> Result<()> {
        self.notebooks.remove(id)?;
        Ok(())
    }

    // ===== Messages =====

    /// Store a message
    pub fn store_message<T: Serialize>(&self, id: &str, message: &T) -> Result<()> {
        let bytes = serde_json::to_vec(message)?;
        self.messages.insert(id, bytes)?;
        Ok(())
    }

    /// Get messages for a tag
    pub fn get_messages_for_tag<T: DeserializeOwned>(&self, tag_id: &str) -> Result<Vec<T>> {
        let prefix = format!("tag:{}", tag_id);
        let mut messages = Vec::new();

        for result in self.messages.scan_prefix(prefix.as_bytes()) {
            let (_, bytes) = result?;
            let message: T = serde_json::from_slice(&bytes)?;
            messages.push(message);
        }

        Ok(messages)
    }

    /// Delete a message
    pub fn delete_message(&self, id: &str) -> Result<()> {
        self.messages.remove(id)?;
        Ok(())
    }

    // ===== Collectables =====

    /// Store a collectable
    pub fn store_collectable<T: Serialize>(&self, id: &str, collectable: &T) -> Result<()> {
        let bytes = serde_json::to_vec(collectable)?;
        self.collectables.insert(id, bytes)?;
        Ok(())
    }

    /// Get all collectables
    pub fn get_all_collectables<T: DeserializeOwned>(&self) -> Result<Vec<T>> {
        let mut collectables = Vec::new();

        for result in self.collectables.iter() {
            let (_, bytes) = result?;
            let collectable: T = serde_json::from_slice(&bytes)?;
            collectables.push(collectable);
        }

        Ok(collectables)
    }

    /// Delete a collectable
    pub fn delete_collectable(&self, id: &str) -> Result<()> {
        self.collectables.remove(id)?;
        Ok(())
    }

    // ===== Offline Queue =====

    /// Queue operation for later sync
    pub fn queue_operation<T: Serialize>(&self, operation: &T) -> Result<()> {
        let id = uuid::Uuid::new_v4().to_string();
        let bytes = serde_json::to_vec(operation)?;
        self.offline_queue.insert(id.as_bytes(), bytes)?;
        debug!("Queued offline operation: {}", id);
        Ok(())
    }

    /// Get all pending operations
    pub fn get_pending_operations<T: DeserializeOwned>(&self) -> Result<Vec<(String, T)>> {
        let mut operations = Vec::new();

        for result in self.offline_queue.iter() {
            let (key, bytes) = result?;
            let id = String::from_utf8_lossy(&key).to_string();
            match serde_json::from_slice(&bytes) {
                Ok(op) => operations.push((id, op)),
                Err(e) => warn!("Failed to deserialize queued operation: {}", e),
            }
        }

        Ok(operations)
    }

    /// Remove completed operation from queue
    pub fn remove_operation(&self, id: &str) -> Result<()> {
        self.offline_queue.remove(id)?;
        debug!("Removed offline operation: {}", id);
        Ok(())
    }

    // ===== Documents (Automerge) =====

    /// Store an Automerge document
    pub fn store_document(&self, id: &str, data: &[u8]) -> Result<()> {
        self.documents.insert(id, data)?;
        Ok(())
    }

    /// Get an Automerge document
    pub fn get_document(&self, id: &str) -> Result<Option<Vec<u8>>> {
        match self.documents.get(id)? {
            Some(bytes) => Ok(Some(bytes.to_vec())),
            None => Ok(None),
        }
    }

    /// Delete a document
    pub fn delete_document(&self, id: &str) -> Result<()> {
        self.documents.remove(id)?;
        Ok(())
    }

    // ===== Utilities =====

    /// Flush all pending writes to disk
    pub fn flush(&self) -> Result<()> {
        self.db.flush()?;
        Ok(())
    }

    /// Get database size in bytes
    pub fn size_on_disk(&self) -> Result<u64> {
        Ok(self.db.size_on_disk()?)
    }

    /// Clear all data (for logout)
    pub fn clear_all(&self) -> Result<()> {
        self.settings.clear()?;
        self.pages.clear()?;
        self.notebooks.clear()?;
        self.messages.clear()?;
        self.collectables.clear()?;
        self.offline_queue.clear()?;
        self.documents.clear()?;
        Ok(())
    }
}
