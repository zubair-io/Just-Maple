//! Collectable schemas
//! Port of packages/shared/src/schemas/collectable.ts

use serde::{Deserialize, Serialize};

/// Collectable status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CollectableStatus {
    Have,
    Want,
    Sold,
    None,
}

impl Default for CollectableStatus {
    fn default() -> Self {
        Self::None
    }
}

/// Collectable data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectableData {
    #[serde(rename = "itemId")]
    pub item_id: String,
    pub provider: String,
    #[serde(rename = "registryData", skip_serializing_if = "Option::is_none")]
    pub registry_data: Option<String>,
    pub status: CollectableStatus,
    pub quantity: i64,
    pub created: String,
}

/// Collectable document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collectable {
    #[serde(rename = "_id")]
    pub id: String,
    pub tags: Vec<String>,
    #[serde(rename = "type")]
    pub collectable_type: String, // Always "collectible"
    pub data: CollectableData,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// Create collectable input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCollectableInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    pub data: CreateCollectableData,
}

/// Data for creating a collectable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCollectableData {
    #[serde(rename = "itemId")]
    pub item_id: String,
    pub provider: String,
    #[serde(rename = "registryData", skip_serializing_if = "Option::is_none")]
    pub registry_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<CollectableStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<i64>,
}

/// Update collectable input
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateCollectableInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<UpdateCollectableData>,
}

/// Data for updating a collectable
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateCollectableData {
    #[serde(rename = "itemId", skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(rename = "registryData", skip_serializing_if = "Option::is_none")]
    pub registry_data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<CollectableStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<i64>,
}
