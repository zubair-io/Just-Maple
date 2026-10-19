//! Whiteboard screen with stylus drawing

use crate::ui::Screen;
use crate::AppState;
use egui::{Color32, Painter, Pos2, Rect, Sense, Stroke, Ui};
use maple_shared::{Page, StrokeElement, StrokePoint, StrokeStyle, WhiteboardElement};
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};

struct PendingSave {
    receipt: oneshot::Receiver<Result<(), String>>,
    count: usize,
    leave_after: bool,
}

/// Whiteboard screen
pub struct WhiteboardScreen {
    page_id: String,
    page: Option<Page>,
    loading: bool,
    // Drawing state
    elements: Vec<WhiteboardElement>,
    current_stroke: Option<Vec<StrokePoint>>,
    // View state
    camera_x: f32,
    camera_y: f32,
    zoom: f32,
    // Tool state
    current_tool: Tool,
    stroke_color: String,
    stroke_size: f32,
    // UI state
    show_toolbar: bool,
    is_dirty: bool,
    unsaved: Vec<WhiteboardElement>,
    saving: Option<PendingSave>,
    save_error: Option<String>,
    load_error: Option<String>,
    saved_locally: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Tool {
    Pen,
    Eraser,
    Select,
}

impl WhiteboardScreen {
    pub fn new() -> Self {
        Self {
            page_id: String::new(),
            page: None,
            loading: false,
            elements: Vec::new(),
            current_stroke: None,
            camera_x: 0.0,
            camera_y: 0.0,
            zoom: 1.0,
            current_tool: Tool::Pen,
            stroke_color: "#000000".to_string(),
            stroke_size: 4.0,
            show_toolbar: true,
            is_dirty: false,
            unsaved: Vec::new(),
            saving: None,
            save_error: None,
            load_error: None,
            saved_locally: false,
        }
    }

    pub fn set_page_id(&mut self, page_id: String) {
        if self.page_id != page_id {
            self.page_id = page_id;
            self.page = None;
            self.elements.clear();
            self.current_stroke = None;
            self.loading = true;
            self.is_dirty = false;
            self.unsaved.clear();
            self.saving = None;
            self.save_error = None;
            self.load_error = None;
            self.saved_locally = false;
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        let mut navigation = self.poll_save();
        if navigation.is_some() {
            return navigation;
        }
        if self.saving.is_some() {
            ui.ctx()
                .request_repaint_after(std::time::Duration::from_millis(50));
        }

        // Load page if needed
        if self.loading && self.page.is_none() {
            self.load_page(state);
        }

        // Toolbar
        if self.show_toolbar {
            ui.horizontal(|ui| {
                if ui.button("← Back").clicked() {
                    if self.is_dirty {
                        self.save_page(state, true);
                    } else if self.saving.is_none() {
                        navigation = Some(Screen::NotebookList);
                    }
                }

                ui.separator();

                // Tool buttons
                let pen_selected = self.current_tool == Tool::Pen;
                let eraser_selected = self.current_tool == Tool::Eraser;
                let select_selected = self.current_tool == Tool::Select;

                if ui.selectable_label(pen_selected, "✏️ Pen").clicked() {
                    self.current_tool = Tool::Pen;
                }
                if ui.selectable_label(eraser_selected, "🧹 Eraser").clicked() {
                    self.current_tool = Tool::Eraser;
                }
                if ui.selectable_label(select_selected, "👆 Select").clicked() {
                    self.current_tool = Tool::Select;
                }

                ui.separator();

                // Stroke size
                ui.label("Size:");
                ui.add(egui::Slider::new(&mut self.stroke_size, 1.0..=20.0).show_value(false));

                ui.separator();

                // Color presets
                let colors = [
                    ("#000000", Color32::BLACK),
                    ("#808080", Color32::GRAY),
                    ("#FFFFFF", Color32::WHITE),
                ];

                for (hex, color) in &colors {
                    let size = egui::vec2(24.0, 24.0);
                    let selected = &self.stroke_color == *hex;

                    let (rect, response) = ui.allocate_exact_size(size, Sense::click());
                    ui.painter().rect_filled(rect, 4.0, *color);
                    ui.painter().rect_stroke(
                        rect,
                        4.0,
                        if selected {
                            Stroke::new(3.0, Color32::DARK_BLUE)
                        } else {
                            Stroke::new(1.0, Color32::DARK_GRAY)
                        },
                    );

                    if response.clicked() {
                        self.stroke_color = hex.to_string();
                    }
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if self.is_dirty {
                        if ui
                            .add_enabled(self.saving.is_none(), egui::Button::new("Save"))
                            .clicked()
                        {
                            self.save_page(state, false);
                        }
                    }

                    // Zoom controls
                    if ui.button("+").clicked() {
                        self.zoom = (self.zoom * 1.2).min(4.0);
                    }
                    ui.label(format!("{:.0}%", self.zoom * 100.0));
                    if ui.button("-").clicked() {
                        self.zoom = (self.zoom / 1.2).max(0.25);
                    }
                });
            });

            ui.separator();
        }

        if let Some(error) = &self.save_error {
            ui.colored_label(Color32::DARK_RED, error);
        }
        if self.saving.is_some() {
            ui.label("Saving on this device…");
        } else if self.saved_locally && !self.is_dirty {
            ui.label("Saved on this device");
        }
        if let Some(error) = &self.load_error {
            ui.colored_label(Color32::DARK_RED, error);
            if ui.button("Retry loading").clicked() {
                self.loading = true;
                self.load_error = None;
            }
            return navigation;
        }

        // Canvas area
        let canvas_rect = ui.available_rect_before_wrap();
        let response = ui.allocate_rect(canvas_rect, Sense::click_and_drag());
        let painter = ui.painter_at(canvas_rect);

        // Fill background
        painter.rect_filled(canvas_rect, 0.0, Color32::WHITE);

        // Handle input
        if response.drag_started() {
            if let Some(pos) = response.interact_pointer_pos() {
                self.handle_stroke_start(pos, canvas_rect);
            }
        } else if response.dragged() {
            if let Some(pos) = response.interact_pointer_pos() {
                self.handle_stroke_move(pos, canvas_rect);
            }
        } else if response.drag_stopped() {
            self.handle_stroke_end(state);
        }

        // Toggle toolbar with tap
        if response.clicked() && !response.dragged() {
            self.show_toolbar = !self.show_toolbar;
        }

        // Render elements
        self.render_elements(&painter, canvas_rect);

        // Render current stroke
        if let Some(points) = &self.current_stroke {
            self.render_stroke(
                &painter,
                canvas_rect,
                points,
                &self.stroke_color,
                self.stroke_size,
            );
        }

        navigation
    }

    fn load_page(&mut self, state: &Arc<RwLock<AppState>>) {
        let result = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let state = state.read().await;
                let page = state.storage.get_page::<Page>(&self.page_id)?;
                let elements = match state.storage.get_document(&self.page_id)? {
                    Some(bytes) => crate::storage::whiteboard::elements(&bytes)?,
                    None => Vec::new(),
                };
                Ok::<_, anyhow::Error>((page, elements))
            })
        });
        match result {
            Ok((page, elements)) => {
                self.page = page;
                self.elements = elements;
                self.load_error = None;
            }
            Err(_) => {
                self.load_error =
                    Some("Unable to load this whiteboard. Retry before drawing.".into());
            }
        }
        self.loading = false;
    }

    fn save_page(&mut self, state: &Arc<RwLock<AppState>>, leave_after: bool) {
        if let Some(pending) = &mut self.saving {
            pending.leave_after |= leave_after;
            return;
        }
        if self.load_error.is_some() {
            return;
        }
        let page_id = self.page_id.clone();
        let additions = self.unsaved.clone();
        let count = additions.len();
        let state = state.clone();
        let (sender, receipt) = oneshot::channel();
        self.save_error = None;
        self.saving = Some(PendingSave {
            receipt,
            count,
            leave_after,
        });
        tokio::spawn(async move {
            let storage = state.read().await.storage.clone();
            let result =
                tokio::task::spawn_blocking(move || storage.save_whiteboard(&page_id, &additions))
                    .await;
            let outcome = match result {
                Ok(Ok(())) => Ok(()),
                _ => Err(
                    "Could not save this whiteboard. Your changes are still unsaved; retry Save."
                        .into(),
                ),
            };
            let _ = sender.send(outcome);
        });
    }

    fn poll_save(&mut self) -> Option<Screen> {
        let pending = self.saving.as_mut()?;
        let result = match pending.receipt.try_recv() {
            Ok(result) => result,
            Err(oneshot::error::TryRecvError::Empty) => return None,
            Err(_) => Err("Whiteboard save was interrupted. Retry Save before leaving.".into()),
        };
        let pending = self.saving.take().unwrap();
        match result {
            Ok(()) => {
                self.unsaved.drain(..pending.count);
                self.is_dirty = !self.unsaved.is_empty();
                self.saved_locally = true;
                if pending.leave_after && !self.is_dirty {
                    return Some(Screen::NotebookList);
                }
            }
            Err(error) => {
                self.save_error = Some(error);
            }
        }
        None
    }

    fn handle_stroke_start(&mut self, pos: Pos2, canvas_rect: Rect) {
        if self.current_tool == Tool::Pen {
            let point = self.screen_to_canvas(pos, canvas_rect);
            self.current_stroke = Some(vec![StrokePoint {
                x: point.x as f64,
                y: point.y as f64,
                pressure: 0.5,
            }]);
        }
    }

    fn handle_stroke_move(&mut self, pos: Pos2, canvas_rect: Rect) {
        // Calculate canvas point before borrowing current_stroke mutably
        let canvas_point = self.screen_to_canvas(pos, canvas_rect);
        if let Some(points) = &mut self.current_stroke {
            points.push(StrokePoint {
                x: canvas_point.x as f64,
                y: canvas_point.y as f64,
                pressure: 0.5, // TODO: Get actual pressure from stylus
            });
        }
    }

    fn handle_stroke_end(&mut self, _state: &Arc<RwLock<AppState>>) {
        if let Some(points) = self.current_stroke.take() {
            if points.len() >= 2 {
                // Create stroke element
                let stroke = WhiteboardElement::Stroke(StrokeElement {
                    base: maple_shared::BaseElement {
                        id: uuid::Uuid::new_v4().to_string(),
                        created_by: "local".to_string(),
                        created_at: chrono::Utc::now().timestamp(),
                        updated_at: chrono::Utc::now().timestamp(),
                        transform: maple_shared::Transform::default(),
                        locked: None,
                    },
                    element_type: "stroke".to_string(),
                    points,
                    style: StrokeStyle {
                        color: self.stroke_color.clone(),
                        size: self.stroke_size as f64,
                        opacity: None,
                    },
                });

                self.unsaved.push(stroke.clone());
                self.elements.push(stroke);
                self.is_dirty = true;
            }
        }
    }

    fn screen_to_canvas(&self, pos: Pos2, canvas_rect: Rect) -> Pos2 {
        let x = (pos.x - canvas_rect.left() - self.camera_x) / self.zoom;
        let y = (pos.y - canvas_rect.top() - self.camera_y) / self.zoom;
        Pos2::new(x, y)
    }

    fn canvas_to_screen(&self, pos: Pos2, canvas_rect: Rect) -> Pos2 {
        let x = pos.x * self.zoom + self.camera_x + canvas_rect.left();
        let y = pos.y * self.zoom + self.camera_y + canvas_rect.top();
        Pos2::new(x, y)
    }

    fn render_elements(&self, painter: &Painter, canvas_rect: Rect) {
        for element in &self.elements {
            match element {
                WhiteboardElement::Stroke(stroke) => {
                    self.render_stroke(
                        painter,
                        canvas_rect,
                        &stroke.points,
                        &stroke.style.color,
                        stroke.style.size as f32,
                    );
                }
                _ => {
                    // TODO: Render shapes and text
                }
            }
        }
    }

    fn render_stroke(
        &self,
        painter: &Painter,
        canvas_rect: Rect,
        points: &[StrokePoint],
        color: &str,
        size: f32,
    ) {
        if points.len() < 2 {
            return;
        }

        // Parse color
        let color = Self::parse_color(color);

        // Convert points to screen coordinates
        let screen_points: Vec<Pos2> = points
            .iter()
            .map(|p| self.canvas_to_screen(Pos2::new(p.x as f32, p.y as f32), canvas_rect))
            .collect();

        // Draw stroke segments
        for i in 1..screen_points.len() {
            let p1 = screen_points[i - 1];
            let p2 = screen_points[i];

            // Use pressure for width variation
            let pressure1 = points[i - 1].pressure as f32;
            let pressure2 = points[i].pressure as f32;
            let width = size * ((pressure1 + pressure2) / 2.0 + 0.5);

            painter.line_segment([p1, p2], Stroke::new(width * self.zoom, color));
        }
    }

    fn parse_color(hex: &str) -> Color32 {
        if hex.starts_with('#') && hex.len() == 7 {
            let r = u8::from_str_radix(&hex[1..3], 16).unwrap_or(0);
            let g = u8::from_str_radix(&hex[3..5], 16).unwrap_or(0);
            let b = u8::from_str_radix(&hex[5..7], 16).unwrap_or(0);
            Color32::from_rgb(r, g, b)
        } else {
            Color32::BLACK
        }
    }
}

impl Default for WhiteboardScreen {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirty_screen() -> WhiteboardScreen {
        let mut screen = WhiteboardScreen::new();
        let rect = Rect::from_min_size(Pos2::ZERO, egui::vec2(100., 100.));
        screen.handle_stroke_start(Pos2::new(1., 2.), rect);
        screen.handle_stroke_move(Pos2::new(3., 4.), rect);
        // handle_stroke_end does not use the app state; construct the stroke through its pending points.
        let points = screen.current_stroke.take().unwrap();
        let element = WhiteboardElement::Stroke(StrokeElement {
            base: maple_shared::BaseElement {
                id: "one".into(),
                created_by: "test".into(),
                created_at: 1,
                updated_at: 1,
                transform: maple_shared::Transform::default(),
                locked: None,
            },
            element_type: "stroke".into(),
            points,
            style: StrokeStyle::default(),
        });
        screen.elements.push(element.clone());
        screen.unsaved.push(element);
        screen.is_dirty = true;
        screen
    }

    #[test]
    fn failed_or_interrupted_save_retains_dirty_state_and_blocks_navigation() {
        for interrupted in [false, true] {
            let mut screen = dirty_screen();
            let (sender, receipt) = oneshot::channel();
            screen.saving = Some(PendingSave {
                receipt,
                count: 1,
                leave_after: true,
            });
            assert_eq!(screen.poll_save(), None);
            assert!(screen.is_dirty);
            if interrupted {
                drop(sender);
            } else {
                sender.send(Err("Disk full".into())).unwrap();
            }
            assert_eq!(screen.poll_save(), None);
            assert!(screen.is_dirty);
            assert_eq!(screen.unsaved.len(), 1);
            assert!(screen.save_error.is_some());
        }
    }

    #[test]
    fn acknowledged_save_only_clears_the_saved_revision() {
        for edit_during_save in [false, true] {
            let mut screen = dirty_screen();
            let (sender, receipt) = oneshot::channel();
            screen.saving = Some(PendingSave {
                receipt,
                count: 1,
                leave_after: true,
            });
            if edit_during_save {
                screen.unsaved.push(screen.elements[0].clone());
            }
            sender.send(Ok(())).unwrap();
            assert_eq!(
                screen.poll_save(),
                if edit_during_save {
                    None
                } else {
                    Some(Screen::NotebookList)
                }
            );
            assert_eq!(screen.is_dirty, edit_during_save);
            assert_eq!(screen.unsaved.len(), usize::from(edit_during_save));
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_save_acknowledges_durable_data_then_reloads_it() -> anyhow::Result<()> {
        let path = std::env::temp_dir().join(format!("maple-ui-save-{}", uuid::Uuid::new_v4()));
        {
            let state = Arc::new(RwLock::new(
                AppState::new(crate::Config {
                    storage_path: path.to_string_lossy().into_owned(),
                    ..Default::default()
                })
                .await?,
            ));
            let mut screen = dirty_screen();
            screen.page_id = "board".into();
            screen.save_page(&state, true);
            assert!(screen.is_dirty);
            let navigation = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                loop {
                    if screen.saving.is_none() {
                        break None;
                    }
                    if let Some(destination) = screen.poll_save() {
                        break Some(destination);
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
            })
            .await?;
            assert_eq!(navigation, Some(Screen::NotebookList));
            assert!(!screen.is_dirty);
            let mut reopened = WhiteboardScreen::new();
            reopened.set_page_id("board".into());
            reopened.load_page(&state);
            assert!(reopened.load_error.is_none());
            assert_eq!(reopened.elements.len(), 1);
        }
        std::fs::remove_dir_all(path)?;
        Ok(())
    }
}
