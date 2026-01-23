//! Header component

use egui::{RichText, Ui};

/// Header component with back button and title
pub struct Header {
    title: String,
    show_back: bool,
}

impl Header {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            show_back: true,
        }
    }

    pub fn without_back(mut self) -> Self {
        self.show_back = false;
        self
    }

    /// Render header and return true if back button was clicked
    pub fn ui(&self, ui: &mut Ui) -> bool {
        let mut back_clicked = false;

        ui.horizontal(|ui| {
            if self.show_back {
                if ui.button("← Back").clicked() {
                    back_clicked = true;
                }
                ui.add_space(16.0);
            }

            ui.heading(RichText::new(&self.title).size(24.0));
        });

        ui.separator();

        back_clicked
    }
}
