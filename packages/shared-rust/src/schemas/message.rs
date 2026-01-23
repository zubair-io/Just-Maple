//! Message schemas
//! Port of packages/shared/src/schemas/message.ts

use super::page::PageContent;
use serde::{Deserialize, Serialize};

/// Sender type - distinguishes between user and bot messages
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SenderType {
    User,
    Bot,
    System,
}

impl Default for SenderType {
    fn default() -> Self {
        Self::User
    }
}

/// Parsed mention in content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mention {
    #[serde(rename = "type")]
    pub mention_type: String, // "user" | "bot"
    pub id: String,
    pub handle: String,
    #[serde(rename = "startIndex")]
    pub start_index: i64,
    #[serde(rename = "endIndex")]
    pub end_index: i64,
}

/// Message document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "tagId")]
    pub tag_id: String,
    #[serde(rename = "threadId", skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "senderType", skip_serializing_if = "Option::is_none")]
    pub sender_type: Option<SenderType>,
    #[serde(rename = "userBotId", skip_serializing_if = "Option::is_none")]
    pub user_bot_id: Option<String>,
    #[serde(rename = "senderEmail", skip_serializing_if = "Option::is_none")]
    pub sender_email: Option<String>,
    #[serde(rename = "senderDisplayName", skip_serializing_if = "Option::is_none")]
    pub sender_display_name: Option<String>,
    #[serde(rename = "senderProfilePictureUrl", skip_serializing_if = "Option::is_none")]
    pub sender_profile_picture_url: Option<String>,
    pub content: PageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<Mention>>,
    #[serde(rename = "hasThread", skip_serializing_if = "Option::is_none")]
    pub has_thread: Option<bool>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(rename = "editedAt", skip_serializing_if = "Option::is_none")]
    pub edited_at: Option<String>,
    #[serde(rename = "deletedAt", skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}

/// Create message input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMessageInput {
    pub content: PageContent,
}

/// Update message input
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateMessageInput {
    pub content: PageContent,
}

/// Unread tracking per user per tag
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnreadTracking {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "tagId")]
    pub tag_id: String,
    #[serde(rename = "lastReadAt")]
    pub last_read_at: String,
}

/// Unread count response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnreadCount {
    #[serde(rename = "tagId")]
    pub tag_id: String,
    pub count: i64,
}

/// Real-time chat event actions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatAction {
    Message,
    Typing,
    Edited,
    Deleted,
    MessageUpdated,
    ThreadCreated,
    ThreadMessage,
    BotInvocationStarted,
    BotInvocationCompleted,
    BotInvocationFailed,
    CollectableCreated,
    CollectableUpdated,
    CollectableDeleted,
}

/// Real-time chat event payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatEvent {
    pub action: ChatAction,
    pub data: serde_json::Value,
    #[serde(rename = "tagId")]
    pub tag_id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub timestamp: String,
}

/// Typing indicator event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypingEvent {
    #[serde(rename = "tagId")]
    pub tag_id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "isTyping")]
    pub is_typing: bool,
}
