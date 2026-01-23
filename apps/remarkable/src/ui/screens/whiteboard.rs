//! Whiteboard screen with stylus drawing

use crate::ui::Screen;
use crate::AppState;
use egui::{Color32, Painter, Pos2, Rect, Sense, Stroke, Ui};
use maple_shared::{Page, StrokeElement, StrokePoint, StrokeStyle, WhiteboardElement};
use std::sync::Arc;
use tokio::sync::RwLock;

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
        }
    }

    pub fn ui(&mut self, ui: &mut Ui, state: &Arc<RwLock<AppState>>) -> Option<Screen> {
        let mut navigation = None;

        // Load page if needed
        if self.loading && self.page.is_none() {
            self.load_page(state);
        }

        // Toolbar
        if self.show_toolbar {
            ui.horizontal(|ui| {
                if ui.button("← Back").clicked() {
                    if self.is_dirty {
                        self.save_page(state);
                    }
                    navigation = Some(Screen::NotebookList);
                }

                ui.separator();

                // Tool buttons
                let pen_selected = self.current_tool == Tool::Pen;
                let eraser_selected = self.current_tool == Tool::Eraser;
                let select_selected = self.current_tool == Tool::Select;

                if ui
                    .selectable_label(pen_selected, "✏️ Pen")
                    .clicked()
                {
                    self.current_tool = Tool::Pen;
                }
                if ui
                    .selectable_label(eraser_selected, "🧹 Eraser")
                    .clicked()
                {
                    self.current_tool = Tool::Eraser;
                }
                if ui
                    .selectable_label(select_selected, "👆 Select")
                    .clicked()
                {
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
                    ui.painter()
                        .rect_filled(rect, 4.0, *color);
                    ui.painter()
                        .rect_stroke(
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
                        if ui.button("Save").clicked() {
                            self.save_page(state);
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
            self.render_stroke(&painter, canvas_rect, points, &self.stroke_color, self.stroke_size);
        }

        navigation
    }

    fn load_page(&mut self, state: &Arc<RwLock<AppState>>) {
        let page_id = self.page_id.clone();
        let state_clone = state.clone();

        // Try local storage first
        let page = tokio::task::block_in_place(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                let state_guard = state_clone.read().await;
                state_guard.storage.get_page::<Page>(&page_id).ok().flatten()
            })
        });

        if let Some(page) = page {
            // TODO: Extract whiteboard elements from Automerge document
            self.page = Some(page);
        }

        self.loading = false;
    }

    fn save_page(&mut self, state: &Arc<RwLock<AppState>>) {
        // TODO: Serialize elements to Automerge and save
        let page_id = self.page_id.clone();
        let state_clone = state.clone();

        tokio::spawn(async move {
            let _state_guard = state_clone.read().await;
            tracing::info!("Saving whiteboard: {}", page_id);
            // TODO: Implement whiteboard save
        });

        self.is_dirty = false;
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
