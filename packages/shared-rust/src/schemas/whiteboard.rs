//! Whiteboard schemas
//! Port of packages/shared/src/schemas/whiteboard.ts

use serde::{Deserialize, Serialize};

/// Tool types available in the whiteboard
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhiteboardToolType {
    Select,
    Pen,
    Line,
    Rectangle,
    Ellipse,
    Arrow,
    Text,
    Eraser,
}

impl Default for WhiteboardToolType {
    fn default() -> Self {
        Self::Pen
    }
}

/// Transform for positioning elements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    #[serde(default = "default_scale", rename = "scaleX", skip_serializing_if = "is_default_scale")]
    pub scale_x: f64,
    #[serde(default = "default_scale", rename = "scaleY", skip_serializing_if = "is_default_scale")]
    pub scale_y: f64,
}

fn default_scale() -> f64 {
    1.0
}

fn is_default_scale(v: &f64) -> bool {
    (*v - 1.0).abs() < f64::EPSILON
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            rotation: None,
            scale_x: 1.0,
            scale_y: 1.0,
        }
    }
}

/// Individual point in a stroke with pressure data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokePoint {
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_pressure", skip_serializing_if = "is_default_pressure")]
    pub pressure: f64,
}

fn default_pressure() -> f64 {
    0.5
}

fn is_default_pressure(v: &f64) -> bool {
    (*v - 0.5).abs() < f64::EPSILON
}

/// Stroke style properties
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokeStyle {
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default = "default_size")]
    pub size: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

fn default_color() -> String {
    "#000000".to_string()
}

fn default_size() -> f64 {
    4.0
}

impl Default for StrokeStyle {
    fn default() -> Self {
        Self {
            color: default_color(),
            size: default_size(),
            opacity: None,
        }
    }
}

/// Base element properties shared by all elements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseElement {
    pub id: String,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    pub transform: Transform,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
}

/// Freehand stroke element
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrokeElement {
    #[serde(flatten)]
    pub base: BaseElement,
    #[serde(rename = "type")]
    pub element_type: String, // Always "stroke"
    pub points: Vec<StrokePoint>,
    pub style: StrokeStyle,
}

/// Shape types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShapeType {
    Rectangle,
    Ellipse,
    Line,
    Arrow,
}

/// Shape style
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeStyle {
    #[serde(rename = "strokeColor", default = "default_color")]
    pub stroke_color: String,
    #[serde(rename = "fillColor", skip_serializing_if = "Option::is_none")]
    pub fill_color: Option<String>,
    #[serde(rename = "strokeWidth", default = "default_stroke_width")]
    pub stroke_width: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

fn default_stroke_width() -> f64 {
    2.0
}

impl Default for ShapeStyle {
    fn default() -> Self {
        Self {
            stroke_color: default_color(),
            fill_color: None,
            stroke_width: default_stroke_width(),
            opacity: None,
        }
    }
}

/// Point for line/arrow endpoints
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Shape element (rectangle, ellipse, line, arrow)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeElement {
    #[serde(flatten)]
    pub base: BaseElement,
    #[serde(rename = "type")]
    pub element_type: String, // Always "shape"
    #[serde(rename = "shapeType")]
    pub shape_type: ShapeType,
    pub width: f64,
    pub height: f64,
    pub style: ShapeStyle,
    #[serde(rename = "startPoint", skip_serializing_if = "Option::is_none")]
    pub start_point: Option<Point>,
    #[serde(rename = "endPoint", skip_serializing_if = "Option::is_none")]
    pub end_point: Option<Point>,
}

/// Text element
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextElement {
    #[serde(flatten)]
    pub base: BaseElement,
    #[serde(rename = "type")]
    pub element_type: String, // Always "text"
    pub content: String,
    #[serde(rename = "fontSize", default = "default_font_size")]
    pub font_size: f64,
    #[serde(rename = "fontFamily", default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(rename = "textAlign", skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
}

fn default_font_size() -> f64 {
    16.0
}

fn default_font_family() -> String {
    "Inter, sans-serif".to_string()
}

/// Union of all element types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WhiteboardElement {
    #[serde(rename = "stroke")]
    Stroke(StrokeElement),
    #[serde(rename = "shape")]
    Shape(ShapeElement),
    #[serde(rename = "text")]
    Text(TextElement),
}

/// Layer containing multiple elements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    #[serde(default = "default_layer_name")]
    pub name: String,
    #[serde(default = "default_true")]
    pub visible: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    pub elements: Vec<String>, // Array of element IDs
}

fn default_layer_name() -> String {
    "Layer 1".to_string()
}

fn default_true() -> bool {
    true
}

fn default_opacity() -> f64 {
    1.0
}

/// Camera/viewport state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Camera {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

fn default_zoom() -> f64 {
    1.0
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

/// Whiteboard metadata stored in Y.Map
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhiteboardMetadata {
    pub camera: Camera,
    #[serde(rename = "activeLayerId")]
    pub active_layer_id: String,
    #[serde(rename = "gridVisible", skip_serializing_if = "Option::is_none")]
    pub grid_visible: Option<bool>,
    #[serde(rename = "snapToGrid", skip_serializing_if = "Option::is_none")]
    pub snap_to_grid: Option<bool>,
    #[serde(rename = "gridSize", skip_serializing_if = "Option::is_none")]
    pub grid_size: Option<f64>,
}

/// User info for awareness
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwarenessUser {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// Cursor position
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwarenessCursor {
    pub x: f64,
    pub y: f64,
}

/// Pending stroke being drawn (for real-time collaboration)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingStroke {
    pub points: Vec<StrokePoint>,
    pub color: String,
    pub size: f64,
}

/// Pending shape being drawn (for real-time collaboration)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingShape {
    #[serde(rename = "type")]
    pub shape_type: ShapeType,
    #[serde(rename = "startPoint")]
    pub start_point: Point,
    #[serde(rename = "endPoint")]
    pub end_point: Point,
    pub style: PendingShapeStyle,
}

/// Style for pending shape
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingShapeStyle {
    #[serde(rename = "strokeColor")]
    pub stroke_color: String,
    #[serde(rename = "strokeWidth")]
    pub stroke_width: f64,
}

/// Awareness state for collaborative cursors and pending strokes
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WhiteboardAwarenessState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<AwarenessUser>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<AwarenessCursor>,
    #[serde(rename = "selectedIds", skip_serializing_if = "Option::is_none")]
    pub selected_ids: Option<Vec<String>>,
    #[serde(rename = "activeTool", skip_serializing_if = "Option::is_none")]
    pub active_tool: Option<WhiteboardToolType>,
    #[serde(rename = "pendingStroke", skip_serializing_if = "Option::is_none")]
    pub pending_stroke: Option<PendingStroke>,
    #[serde(rename = "pendingShape", skip_serializing_if = "Option::is_none")]
    pub pending_shape: Option<PendingShape>,
}
