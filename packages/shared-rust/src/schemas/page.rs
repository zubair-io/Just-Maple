//! Page schemas
//! Port of packages/shared/src/schemas/page.ts

use serde::{Deserialize, Serialize};

/// Page content (ProseMirror JSON format)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PageContent {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attrs: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Sync status for offline support
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    Pending,
    Syncing,
    Synced,
    Failed,
    Conflict,
}

/// Page type - determines the editor/view used
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageType {
    Memo, // Default (was Write)
    Collectable,
    Whiteboard,
    Kanban,
    Message,
    Recording,
}

impl Default for PageType {
    fn default() -> Self {
        Self::Memo
    }
}

/// Page document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    #[serde(rename = "_id")]
    pub mongo_id: String,
    /// UUID v4 for routing (was document_id)
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "type")]
    pub page_type: PageType,
    pub title: String,
    /// ProseMirror JSON format (for search indexing)
    pub content: PageContent,
    /// Binary CRDT (source of truth) - base64 encoded
    #[serde(rename = "automergeDoc", skip_serializing_if = "Option::is_none")]
    pub automerge_doc: Option<serde_json::Value>,
    /// Hash of Automerge heads (for cache validation)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    /// Automerge heads (for sync optimization)
    #[serde(rename = "lastSyncedHeads", skip_serializing_if = "Option::is_none")]
    pub last_synced_heads: Option<Vec<String>>,
    /// Associated notebook/folder
    #[serde(rename = "tagId", skip_serializing_if = "Option::is_none")]
    pub tag_id: Option<String>,
    #[serde(rename = "isFavorite", skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
    #[serde(rename = "isArchived", skip_serializing_if = "Option::is_none")]
    pub is_archived: Option<bool>,
    #[serde(rename = "isTrashed", skip_serializing_if = "Option::is_none")]
    pub is_trashed: Option<bool>,
    #[serde(rename = "trashedAt", skip_serializing_if = "Option::is_none")]
    pub trashed_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Create page input
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreatePageInput {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub page_type: Option<PageType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<PageContent>,
    #[serde(rename = "tagId", skip_serializing_if = "Option::is_none")]
    pub tag_id: Option<String>,
    /// UUID v4 for routing (was document_id)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "automergeDoc", skip_serializing_if = "Option::is_none")]
    pub automerge_doc: Option<serde_json::Value>,
}

/// Update page input
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdatePageInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<PageContent>,
    #[serde(rename = "automergeDoc", skip_serializing_if = "Option::is_none")]
    pub automerge_doc: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(rename = "lastSyncedHeads", skip_serializing_if = "Option::is_none")]
    pub last_synced_heads: Option<Vec<String>>,
    #[serde(rename = "tagId", skip_serializing_if = "Option::is_none")]
    pub tag_id: Option<String>,
    #[serde(rename = "isFavorite", skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
    #[serde(rename = "isArchived", skip_serializing_if = "Option::is_none")]
    pub is_archived: Option<bool>,
    #[serde(rename = "isTrashed", skip_serializing_if = "Option::is_none")]
    pub is_trashed: Option<bool>,
}

/// Default empty page content - starts with H1 heading as title
pub fn default_page_content() -> PageContent {
    PageContent {
        content_type: "doc".to_string(),
        content: Some(vec![
            serde_json::json!({
                "type": "heading",
                "attrs": { "level": 1 },
                "content": []
            }),
            serde_json::json!({
                "type": "paragraph",
                "content": []
            }),
        ]),
        attrs: None,
        text: None,
    }
}
