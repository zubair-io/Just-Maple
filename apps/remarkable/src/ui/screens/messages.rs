//! Messages screen

use crate::ui::Screen;
use crate::AppState;
use egui::{Color32, RichText, ScrollArea, Ui};
use maple_shared::{CreateMessageInput, Message, PageContent};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Messages screen
pub struct MessagesScreen {
    notebook_id: String,
    messages: Vec<Message>,
    input_text: String,
    loading: bool,
    show_keyboard: bool,
    scroll_to_bottom: bool,
}

impl MessagesScreen {
    pub fn new() -> Self {
        Self {
            notebook_id: String::new(),
            messages: Vec::new(),
            input_text: String::new(),
            loading: false,
            show_keyboard: false,
            scroll_to_bottom: false,
        }
    }

    pub fn set_notebook_id(&mut self, notebook_id: String) {
        if self.notebook_id != notebook_id {
            self.notebook_id = notebook_id;
            self.messages.clear();
            self.loading = true;
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        let mut navigation = None;

        // Load messages if needed
        if self.loading && self.messages.is_empty() {
            self.load_messages(state);
        }

        // Header
        ui.horizontal(|ui| {
            if ui.button("← Back").clicked() {
                navigation = Some(Screen::NotebookList);
            }
            ui.add_space(16.0);
            ui.heading("Messages");
        });

        ui.separator();

        // Messages area
        let keyboard_height = if self.show_keyboard { 300.0 } else { 0.0 };
        let input_height = 60.0;
        let messages_height = ui.available_height() - keyboard_height - input_height;

        ScrollArea::vertical()
            .id_salt("messages_scroll")
            .max_height(messages_height)
            .stick_to_bottom(true)
            .show(ui, |ui| {
                if self.loading {
                    ui.centered_and_justified(|ui| {
                        ui.spinner();
                    });
                } else if self.messages.is_empty() {
                    ui.centered_and_justified(|ui| {
                        ui.label("No messages yet");
                    });
                } else {
                    for message in &self.messages {
                        self.render_message(ui, message, state);
                    }
                }
            });

        // Input area
        ui.separator();
        ui.horizontal(|ui| {
            let text_edit = egui::TextEdit::singleline(&mut self.input_text)
                .hint_text("Type a message...")
                .desired_width(ui.available_width() - 120.0);

            let response = ui.add(text_edit);

            if response.gained_focus() {
                self.show_keyboard = true;
            }

            if ui.button("⌨").clicked() {
                self.show_keyboard = !self.show_keyboard;
            }

            if ui.button("Send").clicked() && !self.input_text.is_empty() {
                self.send_message(state);
            }
        });

        // On-screen keyboard
        if self.show_keyboard {
            ui.separator();
            self.render_keyboard(ui);
        }

        navigation
    }

    fn load_messages(&mut self, state: &Arc<RwLock<AppState>>) {
        let notebook_id = self.notebook_id.clone();
        let state_clone = state.clone();

        tokio::spawn(async move {
            let state_guard = state_clone.read().await;
            if let Some(api) = state_guard.sync.api().await {
                match api.get_messages(&notebook_id).await {
                    Ok(messages) => {
                        tracing::info!("Loaded {} messages", messages.len());
                        for msg in &messages {
                            let key = format!("tag:{}:{}", notebook_id, msg.id);
                            let _ = state_guard.storage.store_message(&key, msg);
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to load messages: {}", e);
                    }
                }
            }
        });

        // Load from local storage
        let state_clone = state.clone();
        let notebook_id_clone = self.notebook_id.clone();
        self.messages = tokio::task::block_in_place(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                let state_guard = state_clone.read().await;
                state_guard
                    .storage
                    .get_messages_for_tag::<Message>(&notebook_id_clone)
                    .unwrap_or_default()
            })
        });

        self.loading = false;
    }

    fn render_message(&self, ui: &mut Ui, message: &Message, state: &Arc<RwLock<AppState>>) {
        let is_own_message = tokio::task::block_in_place(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                let state_guard = state.read().await;
                state_guard
                    .auth
                    .get_user()
                    .await
                    .map(|u| u.id == message.user_id)
                    .unwrap_or(false)
            })
        });

        let layout = if is_own_message {
            egui::Layout::right_to_left(egui::Align::TOP)
        } else {
            egui::Layout::left_to_right(egui::Align::TOP)
        };

        ui.with_layout(layout, |ui| {
            let bg_color = if is_own_message {
                Color32::from_gray(230)
            } else {
                Color32::WHITE
            };

            egui::Frame::none()
                .fill(bg_color)
                .inner_margin(12.0)
                .outer_margin(4.0)
                .stroke(egui::Stroke::new(1.0, Color32::from_gray(200)))
                .rounding(8.0)
                .show(ui, |ui| {
                    ui.set_max_width(ui.available_width() * 0.7);

                    // Sender name
                    if let Some(name) = &message.sender_display_name {
                        ui.label(RichText::new(name).small().color(Color32::DARK_GRAY));
                    } else if let Some(email) = &message.sender_email {
                        ui.label(RichText::new(email).small().color(Color32::DARK_GRAY));
                    }

                    // Message content
                    let content_text = Self::extract_text(&message.content);
                    ui.label(&content_text);

                    // Timestamp
                    ui.label(
                        RichText::new(&message.created_at[..16])
                            .small()
                            .color(Color32::GRAY),
                    );
                });
        });
    }

    fn extract_text(content: &PageContent) -> String {
        fn extract_from_value(value: &serde_json::Value) -> String {
            let mut text = String::new();

            if let Some(obj) = value.as_object() {
                if let Some(text_val) = obj.get("text") {
                    if let Some(t) = text_val.as_str() {
                        text.push_str(t);
                    }
                }

                if let Some(content) = obj.get("content") {
                    if let Some(arr) = content.as_array() {
                        for item in arr {
                            text.push_str(&extract_from_value(item));
                        }
                    }
                }
            }

            text
        }

        if let Some(content_arr) = &content.content {
            content_arr
                .iter()
                .map(extract_from_value)
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            String::new()
        }
    }

    fn send_message(&mut self, state: &Arc<RwLock<AppState>>) {
        let text = self.input_text.clone();
        if text.is_empty() {
            return;
        }

        let notebook_id = self.notebook_id.clone();
        let state_clone = state.clone();

        let content = PageContent {
            content_type: "doc".to_string(),
            content: Some(vec![serde_json::json!({
                "type": "paragraph",
                "content": [{"type": "text", "text": text}]
            })]),
            attrs: None,
            text: None,
        };

        let input = CreateMessageInput { content };

        tokio::spawn(async move {
            let state_guard = state_clone.read().await;
            if let Some(api) = state_guard.sync.api().await {
                match api.create_message(&notebook_id, &input).await {
                    Ok(message) => {
                        let key = format!("tag:{}:{}", notebook_id, message.id);
                        let _ = state_guard.storage.store_message(&key, &message);
                        tracing::info!("Message sent");
                    }
                    Err(e) => {
                        tracing::error!("Failed to send message: {}", e);
                        // Queue for offline
                        state_guard.sync.queue_offline(
                            crate::sync::offline::OfflineOperation::CreateMessage {
                                tag_id: notebook_id,
                                input,
                            },
                        );
                    }
                }
            } else {
                // Queue for offline
                state_guard.sync.queue_offline(
                    crate::sync::offline::OfflineOperation::CreateMessage {
                        tag_id: notebook_id,
                        input,
                    },
                );
            }
        });

        self.input_text.clear();
        self.scroll_to_bottom = true;
    }

    fn render_keyboard(&mut self, ui: &mut Ui) {
        let keys = [
            vec!["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
            vec!["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
            vec!["a", "s", "d", "f", "g", "h", "j", "k", "l", "'"],
            vec!["⇧", "z", "x", "c", "v", "b", "n", "m", ".", "⌫"],
            vec!["space"],
        ];

        egui::Frame::none()
            .fill(Color32::from_gray(245))
            .inner_margin(8.0)
            .show(ui, |ui| {
                for row in &keys {
                    ui.horizontal(|ui| {
                        ui.add_space(4.0);
                        for key in row {
                            let key_width = if *key == "space" { 300.0 } else { 48.0 };

                            let button =
                                egui::Button::new(*key).min_size(egui::vec2(key_width, 45.0));

                            if ui.add(button).clicked() {
                                match *key {
                                    "⌫" => {
                                        self.input_text.pop();
                                    }
                                    "⇧" => {
                                        // TODO: Implement shift
                                    }
                                    "space" => {
                                        self.input_text.push(' ');
                                    }
                                    k => {
                                        self.input_text.push_str(k);
                                    }
                                }
                            }
                        }
                    });
                }
            });
    }
}

impl Default for MessagesScreen {
    fn default() -> Self {
        Self::new()
    }
}
