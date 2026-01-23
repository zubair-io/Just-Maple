//! Offline queue for pending operations

use maple_shared::{
    CreateMessageInput, CreatePageInput, UpdateCollectableInput, UpdateMessageInput,
    UpdatePageInput,
};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// Operations that can be queued for offline processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OfflineOperation {
    CreatePage(CreatePageInput),
    UpdatePage {
        id: String,
        input: UpdatePageInput,
    },
    DeletePage {
        id: String,
    },
    CreateMessage {
        tag_id: String,
        input: CreateMessageInput,
    },
    UpdateMessage {
        id: String,
        input: UpdateMessageInput,
    },
    DeleteMessage {
        id: String,
    },
    UpdateCollectable {
        id: String,
        input: UpdateCollectableInput,
    },
}

/// Thread-safe queue for offline operations
#[derive(Clone)]
pub struct OfflineQueue {
    queue: Arc<Mutex<VecDeque<OfflineOperation>>>,
}

impl OfflineQueue {
    pub fn new() -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    /// Add operation to queue
    pub fn push(&self, operation: OfflineOperation) {
        let mut queue = self.queue.lock().unwrap();
        queue.push_back(operation);
    }

    /// Get and remove the next operation
    pub fn pop(&self) -> Option<OfflineOperation> {
        let mut queue = self.queue.lock().unwrap();
        queue.pop_front()
    }

    /// Drain all operations from the queue
    pub fn drain(&self) -> Vec<OfflineOperation> {
        let mut queue = self.queue.lock().unwrap();
        queue.drain(..).collect()
    }

    /// Check if queue is empty
    pub fn is_empty(&self) -> bool {
        let queue = self.queue.lock().unwrap();
        queue.is_empty()
    }

    /// Get queue length
    pub fn len(&self) -> usize {
        let queue = self.queue.lock().unwrap();
        queue.len()
    }
}

impl Default for OfflineQueue {
    fn default() -> Self {
        Self::new()
    }
}
