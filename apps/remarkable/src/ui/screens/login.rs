//! Login screen

use crate::ui::Screen;
use crate::AppState;
use egui::{Align, Color32, Layout, RichText, Ui};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

/// Login screen state
pub struct LoginScreen {
    email: String,
    verification_code: String,
    state: LoginState,
    error_message: Option<String>,
    /// Dev code shown in development mode (shared with async tasks)
    dev_code: Arc<Mutex<Option<String>>>,
}

#[derive(Clone, PartialEq)]
enum LoginState {
    EnterEmail,
    EnterCode,
    Verifying,
}

impl LoginScreen {
    pub fn new() -> Self {
        Self {
            email: String::new(),
            verification_code: String::new(),
            state: LoginState::EnterEmail,
            error_message: None,
            dev_code: Arc::new(Mutex::new(None)),
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        let mut navigation = None;

        ui.vertical_centered(|ui| {
            ui.add_space(100.0);

            // Logo/Title
            ui.heading(RichText::new("Just Maple").size(48.0).color(Color32::BLACK));
            ui.add_space(8.0);
            ui.label(RichText::new("for reMarkable").size(18.0).color(Color32::DARK_GRAY));

            ui.add_space(60.0);

            match self.state.clone() {
                LoginState::EnterEmail => {
                    self.render_email_form(ui, state);
                }
                LoginState::EnterCode => {
                    self.render_code_form(ui, state, &mut navigation);
                }
                LoginState::Verifying => {
                    ui.spinner();
                    ui.label("Verifying...");
                }
            }

            // Error message
            if let Some(error) = &self.error_message {
                ui.add_space(20.0);
                ui.label(RichText::new(error).color(Color32::DARK_RED));
            }
        });

        navigation
    }

    fn render_email_form(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) {
        ui.label("Enter your email to sign in:");
        ui.add_space(16.0);

        let email_edit = egui::TextEdit::singleline(&mut self.email)
            .hint_text("email@example.com")
            .desired_width(300.0)
            .font(egui::TextStyle::Body);

        ui.add(email_edit);

        ui.add_space(24.0);

        if ui.button(RichText::new("Send Magic Link").size(18.0)).clicked() {
            if self.email.contains('@') && self.email.contains('.') {
                let email = self.email.clone();
                let state_clone = state.clone();
                let dev_code = self.dev_code.clone();

                // Request magic link
                tokio::spawn(async move {
                    let state_guard = state_clone.read().await;
                    match state_guard.auth.request_magic_link(&email).await {
                        Ok(response) => {
                            // In dev mode, store the code for display
                            if let Some(code) = response.dev_code {
                                tracing::info!("DEV MODE: Verification code is: {}", code);
                                if let Ok(mut dev_code_guard) = dev_code.lock() {
                                    *dev_code_guard = Some(code);
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("Magic link request failed: {}", e);
                        }
                    }
                });

                self.state = LoginState::EnterCode;
                self.error_message = None;
            } else {
                self.error_message = Some("Please enter a valid email address".to_string());
            }
        }
    }

    fn render_code_form(
        &mut self,
        ui: &mut Ui,
        state: &Arc<RwLock<AppState>>,
        navigation: &mut Option<Screen>,
    ) {
        ui.label(format!("Enter the verification code sent to {}", self.email));
        ui.add_space(16.0);

        // Show dev code in development mode
        if let Ok(dev_code_guard) = self.dev_code.lock() {
            if let Some(code) = dev_code_guard.as_ref() {
                ui.label(
                    RichText::new(format!("DEV CODE: {}", code))
                        .color(Color32::from_rgb(0, 128, 0))
                        .strong(),
                );
                ui.add_space(8.0);
            }
        }

        let code_edit = egui::TextEdit::singleline(&mut self.verification_code)
            .hint_text("Enter code")
            .desired_width(200.0)
            .font(egui::TextStyle::Body);

        ui.add(code_edit);

        ui.add_space(24.0);

        ui.with_layout(Layout::left_to_right(Align::Center), |ui| {
            if ui.button("Back").clicked() {
                self.state = LoginState::EnterEmail;
                self.verification_code.clear();
                self.error_message = None;
                if let Ok(mut dev_code_guard) = self.dev_code.lock() {
                    *dev_code_guard = None;
                }
            }

            ui.add_space(16.0);

            if ui.button(RichText::new("Verify").size(18.0)).clicked() {
                if !self.verification_code.is_empty() {
                    self.state = LoginState::Verifying;
                    let code = self.verification_code.clone();
                    let email = self.email.clone();
                    let state_clone = state.clone();

                    // Verify code with email
                    tokio::spawn(async move {
                        let state_guard = state_clone.read().await;
                        match state_guard.auth.verify_code(&email, &code).await {
                            Ok(_response) => {
                                tracing::info!("Login successful");
                                // Navigation will be handled by the app checking auth state
                            }
                            Err(e) => {
                                tracing::error!("Verification failed: {}", e);
                            }
                        }
                    });

                    // Optimistically navigate
                    *navigation = Some(Screen::NotebookList);
                } else {
                    self.error_message = Some("Please enter the verification code".to_string());
                }
            }
        });

        ui.add_space(24.0);

        if ui.small_button("Resend code").clicked() {
            let email = self.email.clone();
            let state_clone = state.clone();

            tokio::spawn(async move {
                let state_guard = state_clone.read().await;
                let _ = state_guard.auth.request_magic_link(&email).await;
            });
        }
    }
}

impl Default for LoginScreen {
    fn default() -> Self {
        Self::new()
    }
}
