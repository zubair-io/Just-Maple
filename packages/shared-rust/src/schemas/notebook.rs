//! Notebook schemas
//! Port of packages/shared/src/schemas/notebook.ts

use serde::{Deserialize, Serialize};

/// Access level for shared users
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessLevel {
    Read,
    Write,
    Owner,
}

/// Shared user entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedWithEntry {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "accessLevel")]
    pub access_level: AccessLevel,
}

/// Shared bot entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedBotEntry {
    #[serde(rename = "userBotId")]
    pub user_bot_id: String,
}

/// Sharing configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookSharing {
    #[serde(rename = "sharedWith")]
    pub shared_with: Vec<SharedWithEntry>,
    #[serde(rename = "isPublic", skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
    #[serde(rename = "sharedBots", skip_serializing_if = "Option::is_none")]
    pub shared_bots: Option<Vec<SharedBotEntry>>,
}

/// Notebook value - metadata for folder content type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotebookValue {
    Mixed,
    Recordings,
    Notes,
}

impl Default for NotebookValue {
    fn default() -> Self {
        Self::Mixed
    }
}

/// Notebook document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notebook {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "type")]
    pub notebook_type: String, // Always "folder"
    pub value: NotebookValue,
    pub label: String,
    pub sharing: NotebookSharing,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Create notebook input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNotebookInput {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<NotebookValue>,
}

/// Update notebook input
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateNotebookInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<NotebookValue>,
}

/// Share notebook input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareNotebookInput {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "accessLevel")]
    pub access_level: AccessLevel,
}

/// Notebook member with full user data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotebookMember {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(rename = "displayName", skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(rename = "profilePictureUrl", skip_serializing_if = "Option::is_none")]
    pub profile_picture_url: Option<String>,
    #[serde(rename = "accessLevel")]
    pub access_level: AccessLevel,
}
