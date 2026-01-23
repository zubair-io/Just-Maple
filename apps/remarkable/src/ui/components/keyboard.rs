//! On-screen keyboard component

use egui::{Color32, Ui};

/// On-screen keyboard for text input
pub struct OnScreenKeyboard {
    shift_active: bool,
    caps_lock: bool,
}

impl OnScreenKeyboard {
    pub fn new() -> Self {
        Self {
            shift_active: false,
            caps_lock: false,
        }
    }

    /// Render keyboard and return any typed character
    pub fn ui(&mut self, ui: &mut Ui) -> Option<KeyboardAction> {
        let mut action = None;

        let keys = if self.shift_active || self.caps_lock {
            [
                vec!["!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+"],
                vec!["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "{", "}"],
                vec!["A", "S", "D", "F", "G", "H", "J", "K", "L", ":", "\"", "⏎"],
                vec!["⇧", "Z", "X", "C", "V", "B", "N", "M", "<", ">", "?", "⌫"],
                vec!["        space        "],
            ]
        } else {
            [
                vec!["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
                vec!["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"],
                vec!["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "⏎"],
                vec!["⇧", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "⌫"],
                vec!["        space        "],
            ]
        };

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

                            let highlight = *key == "⇧" && (self.shift_active || self.caps_lock);
                            let bg_color = if highlight {
                                Color32::from_gray(200)
                            } else {
                                Color32::WHITE
                            };

                            let button = egui::Button::new(*key)
                                .min_size(egui::vec2(key_width, 45.0))
                                .fill(bg_color);

                            if ui.add(button).clicked() {
                                action = Some(self.handle_key(*key));
                            }
                        }
                    });
                }
            });

        action
    }

    fn handle_key(&mut self, key: &str) -> KeyboardAction {
        match key {
            "⌫" => KeyboardAction::Backspace,
            "⏎" => KeyboardAction::Enter,
            "⇧" => {
                if self.shift_active {
                    self.caps_lock = !self.caps_lock;
                }
                self.shift_active = !self.shift_active;
                KeyboardAction::None
            }
            k if k.contains("space") => {
                if self.shift_active && !self.caps_lock {
                    self.shift_active = false;
                }
                KeyboardAction::Character(' ')
            }
            k => {
                if self.shift_active && !self.caps_lock {
                    self.shift_active = false;
                }
                if let Some(c) = k.chars().next() {
                    KeyboardAction::Character(c)
                } else {
                    KeyboardAction::None
                }
            }
        }
    }
}

impl Default for OnScreenKeyboard {
    fn default() -> Self {
        Self::new()
    }
}

/// Action from keyboard
#[derive(Debug, Clone)]
pub enum KeyboardAction {
    None,
    Character(char),
    Backspace,
    Enter,
}
