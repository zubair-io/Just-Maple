//! UI module
//!
//! egui-based user interface optimized for e-ink displays.

pub mod components;
pub mod screens;
pub mod widgets;

use anyhow::Result;
use egui::{Color32, FontFamily, FontId, TextStyle, Visuals};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::eink::{DisplayManager, RefreshMode, Region};
use crate::input::InputManager;
use crate::AppState;

use screens::{
    LegoScreen, LoginScreen, MessagesScreen, NoteEditorScreen, NotebookListScreen, WhiteboardScreen,
};

/// Current screen in the app
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Screen {
    Login,
    NotebookList,
    NoteEditor { page_id: String },
    Whiteboard { page_id: String },
    Messages { notebook_id: String },
    Lego,
}

/// Main application struct
pub struct App {
    state: Arc<RwLock<AppState>>,
    current_screen: Screen,
    display: DisplayManager,
    input: InputManager,
    // Screen instances
    login_screen: LoginScreen,
    notebook_list_screen: NotebookListScreen,
    note_editor_screen: NoteEditorScreen,
    whiteboard_screen: WhiteboardScreen,
    messages_screen: MessagesScreen,
    lego_screen: LegoScreen,
    // UI state
    needs_full_refresh: bool,
    realtime_error: Option<String>,
    primary_touch: Option<u32>,
    stylus_down: bool,
}

impl App {
    /// Run the application
    pub async fn run(state: Arc<RwLock<AppState>>) -> Result<()> {
        let app = Self {
            state,
            current_screen: Screen::Login,
            display: DisplayManager::new(),
            input: InputManager::new(),
            login_screen: LoginScreen::new(),
            notebook_list_screen: NotebookListScreen::new(),
            note_editor_screen: NoteEditorScreen::new(),
            whiteboard_screen: WhiteboardScreen::new(),
            messages_screen: MessagesScreen::new(),
            lego_screen: LegoScreen::new(),
            needs_full_refresh: true,
            realtime_error: None,
            primary_touch: None,
            stylus_down: false,
        };

        // Check if already authenticated
        let is_authenticated = {
            let state_guard = app.state.read().await;
            state_guard.auth.is_authenticated().await
        };

        // Set initial screen based on auth state
        let mut app = app;
        if is_authenticated {
            app.current_screen = Screen::NotebookList;
        }

        info!("Starting UI loop");
        app.run_ui_loop().await
    }

    /// Main UI loop using eframe/egui
    async fn run_ui_loop(self) -> Result<()> {
        // Start input listener
        self.input.start().await?;
        let (sync, auth) = {
            let state = self.state.read().await;
            (state.sync.clone(), state.auth.clone())
        };
        tokio::spawn(async move {
            loop {
                if auth.is_authenticated().await && !sync.is_online().await {
                    if let Err(error) = async {
                        sync.init_api().await?;
                        sync.connect_websocket().await
                    }
                    .await
                    {
                        tracing::warn!(%error,"Realtime connection unavailable; retrying");
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        });

        // Create egui context with e-ink optimized settings
        let options = eframe::NativeOptions {
            viewport: egui::ViewportBuilder::default()
                .with_inner_size([1404.0, 1872.0]) // reMarkable 2 resolution
                .with_resizable(false),
            ..Default::default()
        };

        let state = self.state.clone();

        eframe::run_native(
            "Just Maple",
            options,
            Box::new(move |cc| {
                // Configure fonts and style for e-ink
                Self::configure_style(&cc.egui_ctx);
                Ok(Box::new(EframeApp { inner: self, state }))
            }),
        )
        .map_err(|e| anyhow::anyhow!("eframe error: {}", e))
    }

    /// Configure egui style for e-ink display
    fn configure_style(ctx: &egui::Context) {
        // Use high-contrast black and white
        let mut visuals = Visuals::light();
        visuals.override_text_color = Some(Color32::BLACK);
        visuals.widgets.noninteractive.bg_fill = Color32::WHITE;
        visuals.widgets.inactive.bg_fill = Color32::from_gray(240);
        visuals.widgets.hovered.bg_fill = Color32::from_gray(220);
        visuals.widgets.active.bg_fill = Color32::from_gray(200);
        visuals.selection.bg_fill = Color32::from_gray(180);

        // Increase contrast for better e-ink visibility
        visuals.widgets.noninteractive.fg_stroke.color = Color32::BLACK;
        visuals.widgets.inactive.fg_stroke.color = Color32::BLACK;
        visuals.widgets.hovered.fg_stroke.color = Color32::BLACK;
        visuals.widgets.active.fg_stroke.color = Color32::BLACK;

        // Thicker borders for better visibility
        visuals.widgets.noninteractive.bg_stroke.width = 2.0;
        visuals.widgets.inactive.bg_stroke.width = 2.0;

        ctx.set_visuals(visuals);

        // Configure fonts - larger for e-ink readability
        // Note: To use custom Inter font, place Inter-Regular.ttf in assets/fonts/
        // and enable the "custom-font" feature in Cargo.toml
        #[cfg(feature = "custom-font")]
        {
            let mut fonts = egui::FontDefinitions::default();
            fonts.font_data.insert(
                "inter".to_string(),
                egui::FontData::from_static(include_bytes!("../../assets/fonts/Inter-Regular.ttf")),
            );
            fonts
                .families
                .get_mut(&FontFamily::Proportional)
                .unwrap()
                .insert(0, "inter".to_string());
            ctx.set_fonts(fonts);
        }

        // Larger text styles for e-ink
        let mut style = (*ctx.style()).clone();
        style.text_styles = [
            (
                TextStyle::Heading,
                FontId::new(28.0, FontFamily::Proportional),
            ),
            (TextStyle::Body, FontId::new(18.0, FontFamily::Proportional)),
            (
                TextStyle::Monospace,
                FontId::new(16.0, FontFamily::Monospace),
            ),
            (
                TextStyle::Button,
                FontId::new(18.0, FontFamily::Proportional),
            ),
            (
                TextStyle::Small,
                FontId::new(14.0, FontFamily::Proportional),
            ),
        ]
        .into();

        // Larger spacing and padding
        style.spacing.item_spacing = egui::vec2(12.0, 12.0);
        style.spacing.button_padding = egui::vec2(16.0, 12.0);

        ctx.set_style(style);
    }

    /// Navigate to a new screen
    fn navigate(&mut self, screen: Screen) {
        if self.current_screen != screen {
            let next_page = match &screen {
                Screen::Whiteboard { page_id } | Screen::NoteEditor { page_id } => {
                    Some(page_id.clone())
                }
                _ => None,
            };
            let previous_page = match &self.current_screen {
                Screen::Whiteboard { page_id } | Screen::NoteEditor { page_id } => {
                    Some(page_id.clone())
                }
                _ => None,
            };
            let state = self.state.clone();
            tokio::spawn(async move {
                let state = state.read().await;
                state.sync.set_active_page(previous_page, next_page).await;
            });
            self.current_screen = screen;
            self.needs_full_refresh = true;
        }
    }
}

/// eframe App wrapper
struct EframeApp {
    inner: App,
    state: Arc<RwLock<AppState>>,
}

impl eframe::App for EframeApp {
    fn raw_input_hook(&mut self, ctx: &egui::Context, input: &mut egui::RawInput) {
        use crate::input::{InputEvent, StylusEventType, TouchEventType};
        let rect = input.screen_rect.unwrap_or_else(|| ctx.screen_rect());
        for event in self.inner.input.drain() {
            match event {
                InputEvent::Stylus(e) => {
                    if e.event_type == StylusEventType::Down {
                        self.inner.stylus_down = true;
                        if self.inner.primary_touch.take().is_some() {
                            input.events.push(egui::Event::PointerButton {
                                pos: egui::pos2(
                                    rect.left() + e.x * rect.width(),
                                    rect.top() + e.y * rect.height(),
                                ),
                                button: egui::PointerButton::Primary,
                                pressed: false,
                                modifiers: input.modifiers,
                            });
                        }
                    }
                    if e.event_type == StylusEventType::Up {
                        self.inner.stylus_down = false;
                    }
                    let pos = egui::pos2(
                        rect.left() + e.x * rect.width(),
                        rect.top() + e.y * rect.height(),
                    );
                    input.events.push(egui::Event::PointerMoved(pos));
                    if matches!(e.event_type, StylusEventType::Down | StylusEventType::Up) {
                        input.events.push(egui::Event::PointerButton {
                            pos,
                            button: egui::PointerButton::Primary,
                            pressed: e.event_type == StylusEventType::Down,
                            modifiers: input.modifiers,
                        });
                    }
                    if matches!(self.inner.current_screen, Screen::Whiteboard { .. }) {
                        self.inner.whiteboard_screen.queue_stylus(e, pos);
                    }
                }
                InputEvent::Touch(e) => {
                    let pos = egui::pos2(
                        rect.left() + e.x * rect.width(),
                        rect.top() + e.y * rect.height(),
                    );
                    input.events.push(egui::Event::Touch {
                        device_id: egui::TouchDeviceId(0),
                        id: egui::TouchId(e.finger_id.into()),
                        phase: match e.event_type {
                            TouchEventType::Down => egui::TouchPhase::Start,
                            TouchEventType::Move => egui::TouchPhase::Move,
                            TouchEventType::Up => egui::TouchPhase::End,
                        },
                        pos,
                        force: None,
                    });
                    if !self.inner.stylus_down {
                        if e.event_type == TouchEventType::Down
                            && self.inner.primary_touch.is_none()
                        {
                            self.inner.primary_touch = Some(e.finger_id);
                        }
                        if self.inner.primary_touch == Some(e.finger_id) {
                            input.events.push(egui::Event::PointerMoved(pos));
                            if matches!(e.event_type, TouchEventType::Down | TouchEventType::Up) {
                                input.events.push(egui::Event::PointerButton {
                                    pos,
                                    button: egui::PointerButton::Primary,
                                    pressed: e.event_type == TouchEventType::Down,
                                    modifiers: input.modifiers,
                                });
                            }
                            if e.event_type == TouchEventType::Up {
                                self.inner.primary_touch = None;
                            }
                        }
                    }
                }
                InputEvent::Button(_) => {}
            }
        }
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Consume bounded network events on the UI thread. Never replace dirty editor state.
        if let Ok(state) = self.state.try_read() {
            for event in state.sync.drain_events() {
                use crate::sync::RealtimeEvent;
                let result: anyhow::Result<()> = match event {
                    RealtimeEvent::Connected => {
                        self.inner.realtime_error = None;
                        Ok(())
                    }
                    RealtimeEvent::Chat(event) => self
                        .inner
                        .messages_screen
                        .realtime_changed(&event, &state.storage),
                    RealtimeEvent::Sync { page_id, event } => {
                        use base64::Engine;
                        let data = &event["data"];
                        let encoded = data
                            .get("update")
                            .or_else(|| data.get("state"))
                            .and_then(serde_json::Value::as_str);
                        if matches!(event["type"].as_str(), Some("ydoc-init" | "ydoc-update")) {
                            if let Some(encoded) = encoded {
                                match base64::engine::general_purpose::STANDARD.decode(encoded) {
                                    Ok(bytes) => match state
                                        .storage
                                        .merge_document(&page_id, &bytes)
                                    {
                                        Ok(()) => {
                                            self.inner.whiteboard_screen.remote_changed(&page_id);
                                            Ok(())
                                        }
                                        Err(error) => Err(error),
                                    },
                                    Err(error) => Err(error.into()),
                                }
                            } else {
                                Err(anyhow::anyhow!("Realtime document update is missing state"))
                            }
                        } else {
                            Ok(())
                        }
                    }
                    RealtimeEvent::App(_event) => {
                        self.inner.notebook_list_screen.invalidate();
                        Ok(())
                    }
                    RealtimeEvent::Error(message) => {
                        self.inner.realtime_error = Some(message);
                        Ok(())
                    }
                    RealtimeEvent::Disconnected => {
                        self.inner.realtime_error =
                            Some("Realtime disconnected; reconnecting".into());
                        Ok(())
                    }
                };
                if let Err(error) = result {
                    self.inner.realtime_error = Some(format!("Realtime update failed: {error}"));
                }
            }
        }
        // Determine refresh mode based on current activity
        let refresh_mode = if self.inner.needs_full_refresh {
            self.inner.needs_full_refresh = false;
            RefreshMode::Full
        } else {
            match &self.inner.current_screen {
                Screen::Whiteboard { .. } => {
                    // Use A2 for whiteboard drawing
                    RefreshMode::A2
                }
                _ => RefreshMode::Partial,
            }
        };

        // Render current screen
        egui::CentralPanel::default().show(ctx, |ui| {
            if let Some(error) = self.inner.realtime_error.clone() {
                ui.horizontal(|ui| {
                    ui.colored_label(Color32::DARK_RED, error);
                    if ui.button("Dismiss").clicked() {
                        self.inner.realtime_error = None;
                    }
                });
            }
            let navigation = match &self.inner.current_screen {
                Screen::Login => self.inner.login_screen.ui(ui, &self.state),
                Screen::NotebookList => self.inner.notebook_list_screen.ui(ui, &self.state),
                Screen::NoteEditor { page_id } => {
                    self.inner.note_editor_screen.set_page_id(page_id.clone());
                    self.inner.note_editor_screen.ui(ui, &self.state)
                }
                Screen::Whiteboard { page_id } => {
                    self.inner.whiteboard_screen.set_page_id(page_id.clone());
                    self.inner.whiteboard_screen.ui(ui, &self.state)
                }
                Screen::Messages { notebook_id } => {
                    self.inner
                        .messages_screen
                        .set_notebook_id(notebook_id.clone());
                    self.inner.messages_screen.ui(ui, &self.state)
                }
                Screen::Lego => self.inner.lego_screen.ui(ui, &self.state),
            };

            // Handle navigation requests from screens
            if let Some(new_screen) = navigation {
                self.inner.navigate(new_screen);
            }
        });

        // Request display refresh with appropriate mode
        self.inner
            .display
            .refresh(Region::full_screen(), refresh_mode);

        // Request repaint at 30fps for responsive feel
        ctx.request_repaint_after(std::time::Duration::from_millis(33));
    }
}
