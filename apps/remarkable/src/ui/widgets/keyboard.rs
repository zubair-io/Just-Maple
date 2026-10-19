//! Shared virtual-keyboard shift state for notes and messages.
#[derive(Default)]
pub struct KeyboardState {
    shifted: bool,
}
impl KeyboardState {
    pub fn shifted(&self) -> bool {
        self.shifted
    }
    pub fn label(&self, key: &str) -> String {
        if !self.shifted {
            return key.to_owned();
        }
        match key {
            "1" => "!",
            "2" => "@",
            "3" => "#",
            "4" => "$",
            "5" => "%",
            "6" => "^",
            "7" => "&",
            "8" => "*",
            "9" => "(",
            "0" => ")",
            "-" => "_",
            "=" => "+",
            "[" => "{",
            "]" => "}",
            ";" => ":",
            "'" => "\"",
            "," => "<",
            "." => ">",
            "/" => "?",
            _ if key.len() == 1 => return key.to_ascii_uppercase(),
            _ => return key.to_owned(),
        }
        .to_owned()
    }
    /// Returns true only when document text changed (Shift alone never edits it).
    pub fn press(&mut self, key: &str, text: &mut String) -> bool {
        match key.trim() {
            "⇧" => {
                self.shifted = !self.shifted;
                false
            }
            "⌫" => text.pop().is_some(),
            "⏎" => {
                text.push('\n');
                true
            }
            "space" => {
                text.push(' ');
                true
            }
            _ => {
                text.push_str(&self.label(key));
                !key.is_empty()
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn toggles_shift_without_editing_and_preserves_control_keys() {
        let mut keys = KeyboardState::default();
        let mut text = String::new();
        assert!(keys.press("a", &mut text));
        assert!(!keys.press("⇧", &mut text));
        assert_eq!(keys.label("b"), "B");
        assert!(keys.shifted());
        keys.press("b", &mut text);
        keys.press("1", &mut text);
        keys.press("        space        ", &mut text);
        keys.press("⏎", &mut text);
        keys.press("⌫", &mut text);
        keys.press("⇧", &mut text);
        keys.press("c", &mut text);
        assert_eq!(text, "aB! c");
        assert!(!keys.shifted());
        text.clear();
        assert!(!keys.press("⌫", &mut text));
    }
}
