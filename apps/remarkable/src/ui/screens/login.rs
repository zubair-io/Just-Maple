//! Passkey sign-in requires a WebAuthn-capable client.
use crate::ui::Screen;
use crate::AppState;
use egui::{RichText, Ui};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct LoginScreen;

impl LoginScreen {
    pub fn new() -> Self {
        Self
    }

    pub fn ui(&mut self, ui: &mut Ui, _state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        ui.vertical_centered(|ui| {
            ui.add_space(100.0);
            ui.heading(RichText::new("Just Maple").size(48.0));
            ui.add_space(24.0);
            ui.label("Just Maple uses passkeys to sign in.");
            ui.label("Passkey sign-in is not yet supported by this reMarkable client.");
            ui.label("Use https://justmaple.app in a browser that supports passkeys.");
        });
        None
    }
}
