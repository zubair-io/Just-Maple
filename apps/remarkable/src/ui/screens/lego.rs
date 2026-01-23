//! Lego catalog screen

use crate::ui::Screen;
use crate::AppState;
use egui::{Color32, RichText, ScrollArea, Ui};
use maple_shared::{Collectable, CollectableStatus, UpdateCollectableInput, UpdateCollectableData};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Lego catalog screen
pub struct LegoScreen {
    collectables: Vec<Collectable>,
    loading: bool,
    filter: StatusFilter,
    search_query: String,
}

#[derive(Clone, Copy, PartialEq)]
enum StatusFilter {
    All,
    Have,
    Want,
    Sold,
}

impl LegoScreen {
    pub fn new() -> Self {
        Self {
            collectables: Vec::new(),
            loading: false,
            filter: StatusFilter::All,
            search_query: String::new(),
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        let mut navigation = None;

        // Load data if needed
        if self.collectables.is_empty() && !self.loading {
            self.load_collectables(state);
        }

        // Header
        ui.horizontal(|ui| {
            if ui.button("← Back").clicked() {
                navigation = Some(Screen::NotebookList);
            }
            ui.add_space(16.0);
            ui.heading("Lego Collection");

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("Refresh").clicked() {
                    self.loading = true;
                    self.load_collectables(state);
                }
            });
        });

        ui.separator();

        // Filter bar
        ui.horizontal(|ui| {
            // Search
            let search = egui::TextEdit::singleline(&mut self.search_query)
                .hint_text("Search...")
                .desired_width(200.0);
            ui.add(search);

            ui.separator();

            // Status filters
            ui.label("Filter:");
            if ui
                .selectable_label(self.filter == StatusFilter::All, "All")
                .clicked()
            {
                self.filter = StatusFilter::All;
            }
            if ui
                .selectable_label(self.filter == StatusFilter::Have, "Have")
                .clicked()
            {
                self.filter = StatusFilter::Have;
            }
            if ui
                .selectable_label(self.filter == StatusFilter::Want, "Want")
                .clicked()
            {
                self.filter = StatusFilter::Want;
            }
            if ui
                .selectable_label(self.filter == StatusFilter::Sold, "Sold")
                .clicked()
            {
                self.filter = StatusFilter::Sold;
            }
        });

        ui.separator();

        // Collection grid
        ScrollArea::vertical()
            .id_salt("lego_scroll")
            .show(ui, |ui| {
                if self.loading {
                    ui.centered_and_justified(|ui| {
                        ui.spinner();
                    });
                } else if self.collectables.is_empty() {
                    ui.centered_and_justified(|ui| {
                        ui.label("No collectables found");
                    });
                } else {
                    // Filter collectables
                    let filtered: Vec<_> = self
                        .collectables
                        .iter()
                        .filter(|c| {
                            // Status filter
                            let status_match = match self.filter {
                                StatusFilter::All => true,
                                StatusFilter::Have => c.data.status == CollectableStatus::Have,
                                StatusFilter::Want => c.data.status == CollectableStatus::Want,
                                StatusFilter::Sold => c.data.status == CollectableStatus::Sold,
                            };

                            // Search filter
                            let search_match = if self.search_query.is_empty() {
                                true
                            } else {
                                c.data
                                    .item_id
                                    .to_lowercase()
                                    .contains(&self.search_query.to_lowercase())
                            };

                            status_match && search_match
                        })
                        .collect();

                    // Display count
                    ui.label(format!(
                        "Showing {} of {} items",
                        filtered.len(),
                        self.collectables.len()
                    ));
                    ui.add_space(8.0);

                    // Grid layout
                    let available_width = ui.available_width();
                    let item_width = 180.0;
                    let columns = (available_width / item_width).floor() as usize;
                    let columns = columns.max(1);

                    egui::Grid::new("lego_grid")
                        .num_columns(columns)
                        .spacing([8.0, 8.0])
                        .show(ui, |ui| {
                            for (i, collectable) in filtered.iter().enumerate() {
                                self.render_item(ui, collectable, state);
                                if (i + 1) % columns == 0 {
                                    ui.end_row();
                                }
                            }
                        });
                }
            });

        navigation
    }

    fn load_collectables(&mut self, state: &Arc<RwLock<AppState>>) {
        self.loading = true;
        let state_clone = state.clone();

        tokio::spawn(async move {
            let state_guard = state_clone.read().await;
            if let Some(api) = state_guard.sync.api().await {
                match api.get_collectables().await {
                    Ok(collectables) => {
                        tracing::info!("Loaded {} collectables", collectables.len());
                        for c in &collectables {
                            let _ = state_guard.storage.store_collectable(&c.id, c);
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to load collectables: {}", e);
                    }
                }
            }
        });

        // Load from local storage
        let state_clone = state.clone();
        self.collectables = tokio::task::block_in_place(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                let state_guard = state_clone.read().await;
                state_guard
                    .storage
                    .get_all_collectables::<Collectable>()
                    .unwrap_or_default()
            })
        });

        self.loading = false;
    }

    fn render_item(&self, ui: &mut Ui, collectable: &Collectable, state: &Arc<RwLock<AppState>>) {
        let status_color = match collectable.data.status {
            CollectableStatus::Have => Color32::from_rgb(76, 175, 80),
            CollectableStatus::Want => Color32::from_rgb(33, 150, 243),
            CollectableStatus::Sold => Color32::from_rgb(158, 158, 158),
            CollectableStatus::None => Color32::from_gray(200),
        };

        egui::Frame::none()
            .fill(Color32::WHITE)
            .stroke(egui::Stroke::new(2.0, status_color))
            .inner_margin(8.0)
            .rounding(4.0)
            .show(ui, |ui| {
                ui.set_width(170.0);
                ui.set_height(120.0);

                ui.vertical(|ui| {
                    // Item ID
                    ui.label(
                        RichText::new(&collectable.data.item_id)
                            .size(14.0)
                            .strong(),
                    );

                    // Provider
                    ui.label(
                        RichText::new(&collectable.data.provider)
                            .size(12.0)
                            .color(Color32::DARK_GRAY),
                    );

                    ui.add_space(8.0);

                    // Status badge
                    let status_text = match collectable.data.status {
                        CollectableStatus::Have => "HAVE",
                        CollectableStatus::Want => "WANT",
                        CollectableStatus::Sold => "SOLD",
                        CollectableStatus::None => "NONE",
                    };

                    egui::Frame::none()
                        .fill(status_color)
                        .inner_margin(egui::vec2(8.0, 4.0))
                        .rounding(4.0)
                        .show(ui, |ui| {
                            ui.label(
                                RichText::new(status_text)
                                    .size(11.0)
                                    .color(Color32::WHITE),
                            );
                        });

                    // Quantity
                    if collectable.data.quantity > 1 {
                        ui.label(format!("Qty: {}", collectable.data.quantity));
                    }

                    // Status change buttons
                    ui.horizontal(|ui| {
                        let id = collectable.id.clone();
                        let state_clone = state.clone();

                        if collectable.data.status != CollectableStatus::Have {
                            if ui.small_button("✓").clicked() {
                                Self::update_status(
                                    state_clone.clone(),
                                    &id,
                                    CollectableStatus::Have,
                                );
                            }
                        }
                        if collectable.data.status != CollectableStatus::Want {
                            if ui.small_button("♡").clicked() {
                                Self::update_status(
                                    state_clone.clone(),
                                    &id,
                                    CollectableStatus::Want,
                                );
                            }
                        }
                        if collectable.data.status != CollectableStatus::Sold {
                            if ui.small_button("$").clicked() {
                                Self::update_status(state_clone, &id, CollectableStatus::Sold);
                            }
                        }
                    });
                });
            });
    }

    fn update_status(state: Arc<RwLock<AppState>>, id: &str, status: CollectableStatus) {
        let id = id.to_string();

        tokio::spawn(async move {
            let state_guard = state.read().await;

            let input = UpdateCollectableInput {
                tags: None,
                data: Some(UpdateCollectableData {
                    status: Some(status),
                    ..Default::default()
                }),
            };

            if let Some(api) = state_guard.sync.api().await {
                match api.update_collectable(&id, &input).await {
                    Ok(collectable) => {
                        let _ = state_guard.storage.store_collectable(&collectable.id, &collectable);
                        tracing::info!("Updated collectable status");
                    }
                    Err(e) => {
                        tracing::error!("Failed to update collectable: {}", e);
                        // Queue for offline
                        state_guard.sync.queue_offline(
                            crate::sync::offline::OfflineOperation::UpdateCollectable { id, input },
                        );
                    }
                }
            } else {
                // Queue for offline
                state_guard.sync.queue_offline(
                    crate::sync::offline::OfflineOperation::UpdateCollectable { id, input },
                );
            }
        });
    }
}

impl Default for LegoScreen {
    fn default() -> Self {
        Self::new()
    }
}
