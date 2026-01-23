//! Toolbar widget

use egui::{Color32, Ui};

/// Generic toolbar with action buttons
pub struct Toolbar {
    items: Vec<ToolbarItem>,
}

pub struct ToolbarItem {
    pub label: String,
    pub icon: Option<String>,
    pub selected: bool,
}

impl Toolbar {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    pub fn item(mut self, label: impl Into<String>) -> Self {
        self.items.push(ToolbarItem {
            label: label.into(),
            icon: None,
            selected: false,
        });
        self
    }

    pub fn item_with_icon(mut self, label: impl Into<String>, icon: impl Into<String>) -> Self {
        self.items.push(ToolbarItem {
            label: label.into(),
            icon: Some(icon.into()),
            selected: false,
        });
        self
    }

    pub fn selected(mut self, index: usize) -> Self {
        if index < self.items.len() {
            self.items[index].selected = true;
        }
        self
    }

    /// Render toolbar and return index of clicked item (if any)
    pub fn ui(&self, ui: &mut Ui) -> Option<usize> {
        let mut clicked = None;

        ui.horizontal(|ui| {
            for (i, item) in self.items.iter().enumerate() {
                let bg_color = if item.selected {
                    Color32::from_gray(220)
                } else {
                    Color32::WHITE
                };

                let text = if let Some(icon) = &item.icon {
                    format!("{} {}", icon, item.label)
                } else {
                    item.label.clone()
                };

                let button = egui::Button::new(text).fill(bg_color);

                if ui.add(button).clicked() {
                    clicked = Some(i);
                }
            }
        });

        clicked
    }
}

impl Default for Toolbar {
    fn default() -> Self {
        Self::new()
    }
}
