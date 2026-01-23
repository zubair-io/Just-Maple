//! Note editor screen

use crate::ui::Screen;
use crate::AppState;
use egui::{Color32, RichText, ScrollArea, Ui};
use maple_shared::Page;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

/// Shared page data that can be updated from async tasks
#[derive(Default)]
struct PageData {
    page: Option<Page>,
    title: String,
    content: String,
}

/// Note editor screen
pub struct NoteEditorScreen {
    page_id: String,
    page_data: Arc<Mutex<PageData>>,
    local_content: String,
    local_title: String,
    is_dirty: bool,
    loading: Arc<Mutex<bool>>,
    show_keyboard: bool,
    data_loaded: bool,
}

impl NoteEditorScreen {
    pub fn new() -> Self {
        Self {
            page_id: String::new(),
            page_data: Arc::new(Mutex::new(PageData::default())),
            local_content: String::new(),
            local_title: String::new(),
            is_dirty: false,
            loading: Arc::new(Mutex::new(false)),
            show_keyboard: false,
            data_loaded: false,
        }
    }

    pub fn set_page_id(&mut self, page_id: String) {
        if self.page_id != page_id {
            self.page_id = page_id;
            *self.page_data.lock().unwrap() = PageData::default();
            self.local_content.clear();
            self.local_title.clear();
            self.is_dirty = false;
            *self.loading.lock().unwrap() = true;
            self.data_loaded = false;
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        let mut navigation = None;

        let is_loading = *self.loading.lock().unwrap();

        // Load page if needed
        if is_loading && !self.data_loaded {
            self.load_page(state);
        }

        // Sync from shared state if data was loaded by async task
        if !self.data_loaded {
            let page_data = self.page_data.lock().unwrap();
            if page_data.page.is_some() {
                self.local_title = page_data.title.clone();
                self.local_content = page_data.content.clone();
                self.data_loaded = true;
                *self.loading.lock().unwrap() = false;
            }
        }

        // Header
        ui.horizontal(|ui| {
            if ui.button("← Back").clicked() {
                if self.is_dirty {
                    self.save_page(state);
                }
                navigation = Some(Screen::NotebookList);
            }

            ui.add_space(16.0);

            // Title editor
            let title_edit = egui::TextEdit::singleline(&mut self.local_title)
                .font(egui::TextStyle::Heading)
                .desired_width(ui.available_width() - 200.0);

            if ui.add(title_edit).changed() {
                self.is_dirty = true;
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if self.is_dirty {
                    if ui.button("Save").clicked() {
                        self.save_page(state);
                    }
                    ui.label(RichText::new("•").color(Color32::DARK_RED));
                }

                if ui.button("⌨").clicked() {
                    self.show_keyboard = !self.show_keyboard;
                }
            });
        });

        ui.separator();

        // Content area
        let keyboard_height = if self.show_keyboard { 300.0 } else { 0.0 };
        let content_height = ui.available_height() - keyboard_height;

        ScrollArea::vertical()
            .id_salt("note_content_scroll")
            .max_height(content_height)
            .show(ui, |ui| {
                if is_loading && !self.data_loaded {
                    ui.centered_and_justified(|ui| {
                        ui.spinner();
                    });
                } else {
                    let content_edit = egui::TextEdit::multiline(&mut self.local_content)
                        .font(egui::TextStyle::Body)
                        .desired_width(ui.available_width())
                        .desired_rows(30)
                        .frame(false);

                    if ui.add(content_edit).changed() {
                        self.is_dirty = true;
                    }
                }
            });

        // On-screen keyboard
        if self.show_keyboard {
            ui.separator();
            self.render_keyboard(ui);
        }

        navigation
    }

    fn load_page(&mut self, state: &Arc<RwLock<AppState>>) {
        let page_id = self.page_id.clone();
        let state_clone = state.clone();
        let page_data = self.page_data.clone();
        let loading = self.loading.clone();

        tracing::info!("Loading page: {}", page_id);

        tokio::spawn(async move {
            let state_guard = state_clone.read().await;

            // Get id from local storage if available (list endpoint stores basic info)
            let page_route_id = if let Ok(Some(page)) = state_guard.storage.get_page::<Page>(&page_id) {
                tracing::debug!("Found page in local storage, id: {}", page.id);
                page.id.clone()
            } else {
                // Assume page_id is the id if not in storage
                page_id.clone()
            };

            // Always fetch from API to get full content
            if let Some(api) = state_guard.sync.api().await {
                match api.get_page(&page_route_id).await {
                    Ok(page) => {
                        tracing::info!("Loaded page from API: {}", page.title);
                        tracing::debug!("Page content: {:?}", page.content);
                        let _ = state_guard.storage.store_page(&page.id, &page);
                        let content = Self::extract_text_content_static(&page);
                        tracing::info!("Extracted content length: {} chars", content.len());
                        let mut data = page_data.lock().unwrap();
                        data.title = page.title.clone();
                        data.content = content;
                        data.page = Some(page);
                    }
                    Err(e) => {
                        tracing::error!("Failed to load page from API: {}", e);
                        // Fall back to local storage
                        if let Ok(Some(page)) = state_guard.storage.get_page::<Page>(&page_id) {
                            tracing::info!("Falling back to local storage: {}", page.title);
                            let content = Self::extract_text_content_static(&page);
                            let mut data = page_data.lock().unwrap();
                            data.title = page.title.clone();
                            data.content = content;
                            data.page = Some(page);
                        }
                    }
                }
            } else {
                // Offline - use local storage
                if let Ok(Some(page)) = state_guard.storage.get_page::<Page>(&page_id) {
                    tracing::info!("Offline, using local storage: {}", page.title);
                    let content = Self::extract_text_content_static(&page);
                    let mut data = page_data.lock().unwrap();
                    data.title = page.title.clone();
                    data.content = content;
                    data.page = Some(page);
                }
            }
            *loading.lock().unwrap() = false;
        });
    }

    fn extract_text_content_static(page: &Page) -> String {
        // Extract plain text from ProseMirror JSON content
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

                // Add newlines for block elements
                if let Some(type_val) = obj.get("type") {
                    if let Some(t) = type_val.as_str() {
                        if matches!(t, "paragraph" | "heading") && !text.is_empty() {
                            text.push('\n');
                        }
                    }
                }
            }

            text
        }

        if let Some(content) = &page.content.content {
            content
                .iter()
                .map(extract_from_value)
                .collect::<Vec<_>>()
                .join("")
        } else {
            String::new()
        }
    }

    fn save_page(&mut self, state: &Arc<RwLock<AppState>>) {
        let page_id = self.page_id.clone();
        let title = self.local_title.clone();
        let content = self.local_content.clone();
        let state_clone = state.clone();

        tokio::spawn(async move {
            let state_guard = state_clone.read().await;

            // Convert plain text back to ProseMirror format
            let paragraphs: Vec<serde_json::Value> = content
                .split('\n')
                .map(|line| {
                    serde_json::json!({
                        "type": "paragraph",
                        "content": if line.is_empty() {
                            vec![]
                        } else {
                            vec![serde_json::json!({"type": "text", "text": line})]
                        }
                    })
                })
                .collect();

            let page_content = maple_shared::PageContent {
                content_type: "doc".to_string(),
                content: Some(paragraphs),
                attrs: None,
                text: None,
            };

            let input = maple_shared::UpdatePageInput {
                title: Some(title),
                content: Some(page_content),
                ..Default::default()
            };

            if let Some(api) = state_guard.sync.api().await {
                match api.update_page(&page_id, &input).await {
                    Ok(page) => {
                        let _ = state_guard.storage.store_page(&page.id, &page);
                        tracing::info!("Page saved");
                    }
                    Err(e) => {
                        tracing::error!("Failed to save page: {}", e);
                        // Queue for offline sync
                        state_guard.sync.queue_offline(
                            crate::sync::offline::OfflineOperation::UpdatePage {
                                id: page_id,
                                input,
                            },
                        );
                    }
                }
            } else {
                // Queue for offline sync
                state_guard.sync.queue_offline(
                    crate::sync::offline::OfflineOperation::UpdatePage {
                        id: page_id,
                        input,
                    },
                );
            }
        });

        self.is_dirty = false;
    }

    fn render_keyboard(&mut self, ui: &mut Ui) {
        let keys = [
            vec!["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
            vec!["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"],
            vec!["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "⏎"],
            vec!["⇧", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "⌫"],
            vec!["        space        "],
        ];

        egui::Frame::none()
            .fill(Color32::from_gray(245))
            .inner_margin(8.0)
            .show(ui, |ui| {
                for row in &keys {
                    ui.horizontal(|ui| {
                        ui.add_space(4.0);
                        for key in row {
                            let key_width = if key.contains("space") {
                                300.0
                            } else {
                                45.0
                            };

                            let button = egui::Button::new(*key).min_size(egui::vec2(key_width, 45.0));

                            if ui.add(button).clicked() {
                                match *key {
                                    "⌫" => {
                                        self.local_content.pop();
                                        self.is_dirty = true;
                                    }
                                    "⏎" => {
                                        self.local_content.push('\n');
                                        self.is_dirty = true;
                                    }
                                    "⇧" => {
                                        // Shift - TODO: implement shift state
                                    }
                                    k if k.contains("space") => {
                                        self.local_content.push(' ');
                                        self.is_dirty = true;
                                    }
                                    k => {
                                        self.local_content.push_str(k);
                                        self.is_dirty = true;
                                    }
                                }
                            }
                        }
                    });
                }
            });
    }
}

impl Default for NoteEditorScreen {
    fn default() -> Self {
        Self::new()
    }
}
