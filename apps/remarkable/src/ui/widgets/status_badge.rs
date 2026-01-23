//! Status badge widget

use egui::{Color32, RichText, Ui};
use maple_shared::CollectableStatus;

/// Status badge for collectables
pub struct StatusBadge {
    status: CollectableStatus,
}

impl StatusBadge {
    pub fn new(status: CollectableStatus) -> Self {
        Self { status }
    }

    pub fn ui(&self, ui: &mut Ui) {
        let (text, color) = match self.status {
            CollectableStatus::Have => ("HAVE", Color32::from_rgb(76, 175, 80)),
            CollectableStatus::Want => ("WANT", Color32::from_rgb(33, 150, 243)),
            CollectableStatus::Sold => ("SOLD", Color32::from_rgb(158, 158, 158)),
            CollectableStatus::None => ("NONE", Color32::from_gray(200)),
        };

        egui::Frame::none()
            .fill(color)
            .inner_margin(egui::vec2(8.0, 4.0))
            .rounding(4.0)
            .show(ui, |ui| {
                ui.label(RichText::new(text).size(11.0).color(Color32::WHITE));
            });
    }
}
