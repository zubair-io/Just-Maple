//! List item component

use egui::{Color32, RichText, Sense, Ui};

/// Clickable list item
pub struct ListItem {
    primary: String,
    secondary: Option<String>,
    icon: Option<String>,
    selected: bool,
}

impl ListItem {
    pub fn new(primary: impl Into<String>) -> Self {
        Self {
            primary: primary.into(),
            secondary: None,
            icon: None,
            selected: false,
        }
    }

    pub fn secondary(mut self, text: impl Into<String>) -> Self {
        self.secondary = Some(text.into());
        self
    }

    pub fn icon(mut self, icon: impl Into<String>) -> Self {
        self.icon = Some(icon.into());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// Render list item and return true if clicked
    pub fn ui(&self, ui: &mut Ui) -> bool {
        let bg_color = if self.selected {
            Color32::from_gray(220)
        } else {
            Color32::WHITE
        };

        let mut clicked = false;

        egui::Frame::none()
            .fill(bg_color)
            .inner_margin(12.0)
            .stroke(egui::Stroke::new(1.0, Color32::from_gray(200)))
            .show(ui, |ui| {
                ui.set_width(ui.available_width());

                let response = ui.horizontal(|ui| {
                    if let Some(icon) = &self.icon {
                        ui.label(icon);
                        ui.add_space(8.0);
                    }

                    ui.vertical(|ui| {
                        ui.label(RichText::new(&self.primary).size(16.0));

                        if let Some(secondary) = &self.secondary {
                            ui.label(
                                RichText::new(secondary)
                                    .size(12.0)
                                    .color(Color32::DARK_GRAY),
                            );
                        }
                    });
                });

                // Make the entire frame clickable
                if ui
                    .interact(response.response.rect, ui.id().with("item"), Sense::click())
                    .clicked()
                {
                    clicked = true;
                }
            });

        clicked
    }
}
