//! Notebook list screen

use crate::ui::Screen;
use crate::AppState;
use egui::{Color32, RichText, ScrollArea, Ui};
use maple_shared::{Notebook, Page, PageType};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

/// Notebook list screen
pub struct NotebookListScreen {
    notebooks: Arc<Mutex<Vec<Notebook>>>,
    pages: Arc<Mutex<Vec<Page>>>,
    selected_notebook: Option<String>,
    loading: Arc<Mutex<bool>>,
    last_refresh: Option<std::time::Instant>,
    pending_notebook_select: Option<String>,
}

impl NotebookListScreen {
    pub fn new() -> Self {
        Self {
            notebooks: Arc::new(Mutex::new(Vec::new())),
            pages: Arc::new(Mutex::new(Vec::new())),
            selected_notebook: None,
            loading: Arc::new(Mutex::new(false)),
            last_refresh: None,
            pending_notebook_select: None,
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        let mut navigation = None;

        // Check loading state
        let is_loading = *self.loading.lock().unwrap();

        // Check if we need to refresh data
        let should_refresh = self
            .last_refresh
            .map(|t| t.elapsed().as_secs() > 60)
            .unwrap_or(true);

        if should_refresh && !is_loading {
            self.refresh_data(state);
        }

        // Handle pending notebook selection (deferred to avoid borrow issues)
        if let Some(notebook_id) = self.pending_notebook_select.take() {
            self.selected_notebook = Some(notebook_id.clone());
            self.load_pages(state, &notebook_id);
        }

        // Header
        ui.horizontal(|ui| {
            ui.heading(RichText::new("Just Maple").size(28.0));
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Refresh").clicked() {
                    self.refresh_data(state);
                }
                ui.add_space(8.0);
                if ui.button("Lego").clicked() {
                    navigation = Some(Screen::Lego);
                }
            });
        });

        ui.separator();

        // Collect notebook click info outside the borrow
        let mut clicked_notebook_id: Option<String> = None;

        // Main content area - fill available height
        let available_height = ui.available_height();
        ui.horizontal(|ui| {
            // Left panel - notebooks
            ui.vertical(|ui| {
                ui.set_width(300.0);
                ui.set_min_height(available_height);
                ui.heading("Notebooks");
                ui.add_space(8.0);

                ScrollArea::vertical()
                    .id_salt("notebooks_scroll")
                    .max_height(available_height - 100.0)
                    .show(ui, |ui| {
                        let notebooks = self.notebooks.lock().unwrap().clone();
                        if is_loading && notebooks.is_empty() {
                            ui.spinner();
                        } else if notebooks.is_empty() {
                            ui.label("No notebooks yet");
                        } else {
                            for notebook in &notebooks {
                                let selected = self
                                    .selected_notebook
                                    .as_ref()
                                    .map(|id| id == &notebook.id)
                                    .unwrap_or(false);

                                let bg_color = if selected {
                                    Color32::from_gray(220)
                                } else {
                                    Color32::WHITE
                                };

                                let notebook_id = notebook.id.clone();
                                let notebook_label = notebook.label.clone();

                                egui::Frame::none()
                                    .fill(bg_color)
                                    .inner_margin(12.0)
                                    .stroke(egui::Stroke::new(1.0, Color32::from_gray(180)))
                                    .show(ui, |ui| {
                                        ui.set_width(ui.available_width());
                                        if ui
                                            .add(
                                                egui::Label::new(
                                                    RichText::new(&notebook_label).size(16.0),
                                                )
                                                .sense(egui::Sense::click()),
                                            )
                                            .clicked()
                                        {
                                            clicked_notebook_id = Some(notebook_id);
                                        }
                                    });
                                ui.add_space(4.0);
                            }
                        }
                    });

                // Messages button at bottom
                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    if let Some(notebook_id) = &self.selected_notebook {
                        if ui.button("Messages").clicked() {
                            navigation = Some(Screen::Messages {
                                notebook_id: notebook_id.clone(),
                            });
                        }
                    }
                });
            });

            ui.separator();

            // Right panel - pages
            ui.vertical(|ui| {
                ui.set_min_height(available_height);
                ui.heading("Pages");
                ui.add_space(8.0);

                if self.selected_notebook.is_some() {
                    // New page buttons
                    ui.horizontal(|ui| {
                        if ui.button("+ Note").clicked() {
                            self.create_page(state, PageType::Memo);
                        }
                        if ui.button("+ Whiteboard").clicked() {
                            self.create_page(state, PageType::Whiteboard);
                        }
                    });
                    ui.add_space(8.0);
                }

                ScrollArea::vertical()
                    .id_salt("pages_scroll")
                    .show(ui, |ui| {
                        let pages = self.pages.lock().unwrap().clone();
                        if self.selected_notebook.is_none() {
                            ui.label("Select a notebook");
                        } else if pages.is_empty() {
                            ui.label("No pages in this notebook");
                        } else {
                            for page in &pages {
                                let icon = match page.page_type {
                                    PageType::Memo => "📝",
                                    PageType::Whiteboard => "🎨",
                                    PageType::Collectable => "🧱",
                                    PageType::Message => "💬",
                                    _ => "📄",
                                };

                                egui::Frame::none()
                                    .inner_margin(12.0)
                                    .stroke(egui::Stroke::new(1.0, Color32::from_gray(180)))
                                    .show(ui, |ui| {
                                        ui.set_width(ui.available_width());
                                        ui.horizontal(|ui| {
                                            ui.label(icon);
                                            let response = ui.add(
                                                egui::Label::new(
                                                    RichText::new(&page.title).size(16.0),
                                                )
                                                .sense(egui::Sense::click()),
                                            );
                                            if response.clicked() {
                                                navigation = Some(match page.page_type {
                                                    PageType::Whiteboard => Screen::Whiteboard {
                                                        page_id: page.id.clone(),
                                                    },
                                                    _ => Screen::NoteEditor {
                                                        page_id: page.id.clone(),
                                                    },
                                                });
                                            }
                                        });
                                    });
                                ui.add_space(4.0);
                            }
                        }
                    });
            });
        });

        // Handle notebook click after the borrow ends
        if let Some(id) = clicked_notebook_id {
            self.pending_notebook_select = Some(id);
        }

        navigation
    }

    fn refresh_data(&mut self, state: &Arc<RwLock<AppState>>) {
        *self.loading.lock().unwrap() = true;
        self.last_refresh = Some(std::time::Instant::now());

        let state_clone = state.clone();
        let notebooks_arc = self.notebooks.clone();
        let loading_arc = self.loading.clone();

        tokio::spawn(async move {
            let state_guard = state_clone.read().await;
            if let Err(e) = state_guard.sync.init_api().await {
                tracing::error!("Failed to init API: {}", e);
                *loading_arc.lock().unwrap() = false;
                return;
            }

            if let Some(api) = state_guard.sync.api().await {
                match api.get_notebooks().await {
                    Ok(notebooks) => {
                        tracing::info!("Loaded {} notebooks", notebooks.len());
                        // Store in local storage
                        for nb in &notebooks {
                            let _ = state_guard.storage.store_notebook(&nb.id, nb);
                        }
                        // Update the shared state directly
                        *notebooks_arc.lock().unwrap() = notebooks;
                    }
                    Err(e) => {
                        tracing::error!("Failed to load notebooks: {}", e);
                    }
                }
            }
            *loading_arc.lock().unwrap() = false;
        });
    }

    fn load_pages(&mut self, state: &Arc<RwLock<AppState>>, notebook_id: &str) {
        let notebook_id = notebook_id.to_string();
        let state_clone = state.clone();
        let pages_arc = self.pages.clone();

        tokio::spawn(async move {
            let state_guard = state_clone.read().await;
            if let Some(api) = state_guard.sync.api().await {
                match api.get_pages(&notebook_id).await {
                    Ok(pages) => {
                        tracing::info!("Loaded {} pages", pages.len());
                        // Store in local storage
                        for page in &pages {
                            let _ = state_guard.storage.store_page(&page.id, page);
                        }
                        // Update the shared state directly
                        *pages_arc.lock().unwrap() = pages;
                    }
                    Err(e) => {
                        tracing::error!("Failed to load pages: {}", e);
                    }
                }
            }
        });
    }

    fn create_page(&mut self, state: &Arc<RwLock<AppState>>, page_type: PageType) {
        if let Some(notebook_id) = &self.selected_notebook {
            let notebook_id = notebook_id.clone();
            let state_clone = state.clone();

            tokio::spawn(async move {
                let state_guard = state_clone.read().await;
                if let Some(api) = state_guard.sync.api().await {
                    let input = maple_shared::CreatePageInput {
                        page_type: Some(page_type),
                        title: Some("Untitled".to_string()),
                        tag_id: Some(notebook_id),
                        ..Default::default()
                    };

                    match api.create_page(&input).await {
                        Ok(page) => {
                            tracing::info!("Created page: {}", page.id);
                            let _ = state_guard.storage.store_page(&page.id, &page);
                        }
                        Err(e) => {
                            tracing::error!("Failed to create page: {}", e);
                        }
                    }
                }
            });
        }
    }
}

impl Default for NotebookListScreen {
    fn default() -> Self {
        Self::new()
    }
}
