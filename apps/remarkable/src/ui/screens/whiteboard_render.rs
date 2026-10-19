//! Tessellate in element coordinates, then apply the same transform as the web canvas.
use egui::{
    epaint::{ClippedShape, Primitive},
    Color32, FontFamily, FontId, Painter, Pos2, Rect, Shape, Stroke,
};
use maple_shared::{ShapeType, Transform, WhiteboardElement};

fn color(raw: &str, opacity: f64) -> Color32 {
    let hex = raw.strip_prefix('#').unwrap_or(raw);
    let expanded;
    let hex = if hex.len() == 3 || hex.len() == 4 {
        expanded = hex.chars().flat_map(|c| [c, c]).collect::<String>();
        expanded.as_str()
    } else {
        hex
    };
    let rgba = if raw == "transparent" {
        [0, 0, 0, 0]
    } else if (hex.len() == 6 || hex.len() == 8) && hex.is_ascii() {
        let mut rgba = [0, 0, 0, 255];
        for (i, pair) in hex.as_bytes().chunks(2).enumerate() {
            rgba[i] =
                u8::from_str_radix(std::str::from_utf8(pair).unwrap_or("00"), 16).unwrap_or(0);
        }
        rgba
    } else if raw == "white" {
        [255, 255, 255, 255]
    } else {
        [0, 0, 0, 255]
    };
    Color32::from_rgba_unmultiplied(
        rgba[0],
        rgba[1],
        rgba[2],
        (f64::from(rgba[3]) * opacity.clamp(0., 1.)) as u8,
    )
}

pub(super) fn point(
    local: Pos2,
    transform: &Transform,
    camera: Pos2,
    zoom: f32,
    rect: Rect,
) -> Pos2 {
    let x = local.x as f64 * transform.scale_x;
    let y = local.y as f64 * transform.scale_y;
    let (sin, cos) = transform.rotation.unwrap_or(0.).sin_cos();
    Pos2::new(
        ((x * cos - y * sin + transform.x) as f32) * zoom + camera.x + rect.left(),
        ((x * sin + y * cos + transform.y) as f32) * zoom + camera.y + rect.top(),
    )
}

pub(super) fn paint(
    painter: &Painter,
    element: &WhiteboardElement,
    camera: Pos2,
    zoom: f32,
    rect: Rect,
) {
    let (transform, shapes) = shapes(painter, element);
    let clipped = shapes
        .into_iter()
        .map(|shape| ClippedShape {
            clip_rect: Rect::EVERYTHING,
            shape,
        })
        .collect();
    for primitive in painter
        .ctx()
        .tessellate(clipped, painter.ctx().pixels_per_point())
    {
        if let Primitive::Mesh(mut mesh) = primitive.primitive {
            for vertex in &mut mesh.vertices {
                vertex.pos = point(vertex.pos, transform, camera, zoom, rect);
            }
            if mesh
                .vertices
                .iter()
                .all(|v| v.pos.x.is_finite() && v.pos.y.is_finite())
            {
                painter.add(Shape::mesh(mesh));
            }
        }
    }
}

fn shapes<'a>(painter: &Painter, element: &'a WhiteboardElement) -> (&'a Transform, Vec<Shape>) {
    match element {
        WhiteboardElement::Stroke(stroke) => {
            let color = color(&stroke.style.color, stroke.style.opacity.unwrap_or(1.));
            let shapes = stroke
                .points
                .windows(2)
                .map(|p| {
                    Shape::line_segment(
                        [
                            Pos2::new(p[0].x as f32, p[0].y as f32),
                            Pos2::new(p[1].x as f32, p[1].y as f32),
                        ],
                        Stroke::new(
                            (stroke.style.size * ((p[0].pressure + p[1].pressure) / 2. + 0.5))
                                as f32,
                            color,
                        ),
                    )
                })
                .collect();
            (&stroke.base.transform, shapes)
        }
        WhiteboardElement::Shape(shape) => {
            let width = shape.width as f32;
            let height = shape.height as f32;
            let stroke = Stroke::new(
                shape.style.stroke_width as f32,
                color(&shape.style.stroke_color, shape.style.opacity.unwrap_or(1.)),
            );
            let fill = shape
                .style
                .fill_color
                .as_ref()
                .map(|c| color(c, shape.style.opacity.unwrap_or(1.)))
                .unwrap_or(Color32::TRANSPARENT);
            let end = Pos2::new(width, height);
            let shapes = match shape.shape_type {
                ShapeType::Rectangle => vec![Shape::convex_polygon(
                    vec![Pos2::ZERO, Pos2::new(width, 0.), end, Pos2::new(0., height)],
                    fill,
                    stroke,
                )],
                ShapeType::Ellipse => vec![Shape::convex_polygon(
                    (0..64)
                        .map(|i| {
                            let angle = i as f32 * std::f32::consts::TAU / 64.;
                            Pos2::new(
                                width / 2. * (1. + angle.cos()),
                                height / 2. * (1. + angle.sin()),
                            )
                        })
                        .collect(),
                    fill,
                    stroke,
                )],
                ShapeType::Line => vec![Shape::line_segment([Pos2::ZERO, end], stroke)],
                ShapeType::Arrow => {
                    let angle = height.atan2(width);
                    let length = (stroke.width * 3.).max(10.);
                    vec![
                        Shape::line_segment([Pos2::ZERO, end], stroke),
                        Shape::line_segment(
                            [
                                end,
                                end - egui::vec2(
                                    (angle - std::f32::consts::FRAC_PI_6).cos(),
                                    (angle - std::f32::consts::FRAC_PI_6).sin(),
                                ) * length,
                            ],
                            stroke,
                        ),
                        Shape::line_segment(
                            [
                                end,
                                end - egui::vec2(
                                    (angle + std::f32::consts::FRAC_PI_6).cos(),
                                    (angle + std::f32::consts::FRAC_PI_6).sin(),
                                ) * length,
                            ],
                            stroke,
                        ),
                    ]
                }
            };
            (&shape.base.transform, shapes)
        }
        WhiteboardElement::Text(text) => {
            let family = if text.font_family.to_lowercase().contains("mono") {
                FontFamily::Monospace
            } else {
                FontFamily::Proportional
            };
            let ink = color(&text.color, 1.);
            let galley = painter.layout_no_wrap(
                text.content.clone(),
                FontId::new(text.font_size as f32, family),
                ink,
            );
            let x = match text.text_align.as_deref() {
                Some("center") => -galley.size().x / 2.,
                Some("right" | "end") => -galley.size().x,
                _ => 0.,
            };
            (
                &text.base.transform,
                vec![Shape::galley(Pos2::new(x, 0.), galley, ink)],
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transform_applies_scale_rotation_translation_camera_and_zoom() {
        let t = Transform {
            x: 10.,
            y: 20.,
            rotation: Some(std::f64::consts::FRAC_PI_2),
            scale_x: 2.,
            scale_y: 3.,
        };
        let p = point(
            Pos2::new(1., 2.),
            &t,
            Pos2::new(5., 7.),
            2.,
            Rect::from_min_max(Pos2::new(100., 200.), Pos2::new(1000., 1000.)),
        );
        assert!((p.x - 113.).abs() < 0.001);
        assert!((p.y - 251.).abs() < 0.001);
    }
    #[test]
    fn paints_every_shape_and_text_as_transformed_meshes() {
        let ctx = egui::Context::default();
        let output=ctx.run(egui::RawInput::default(),|ctx|{
            let painter=ctx.layer_painter(egui::LayerId::background());
            let base=serde_json::json!({"id":"test","type":"shape","createdBy":"test","createdAt":1,"updatedAt":1,"transform":{"x":0,"y":0},"shapeType":"rectangle","width":50,"height":30,"style":{"strokeColor":"#000000","strokeWidth":2,"fillColor":"#fff"}});
            for kind in ["rectangle","ellipse","line","arrow"] {
                let mut value=base.clone();value["shapeType"]=kind.into();
                let shape=WhiteboardElement::Shape(serde_json::from_value(value).unwrap());
                let (_,pieces)=shapes(&painter,&shape);assert!(!pieces.is_empty());
                paint(&painter,&shape,Pos2::ZERO,1.,Rect::from_min_size(Pos2::ZERO, egui::vec2(500.,500.)));
            }
            let text=WhiteboardElement::Text(serde_json::from_value(serde_json::json!({"id":"text","type":"text","createdBy":"test","createdAt":1,"updatedAt":1,"transform":{"x":5,"y":8,"scaleX":2,"scaleY":3,"rotation":0.2},"content":"Hello","fontSize":16,"fontFamily":"Inter","color":"#000000","textAlign":"center"})).unwrap());
            paint(&painter,&text,Pos2::ZERO,2.,Rect::from_min_size(Pos2::ZERO, egui::vec2(500.,500.)));
        });
        assert!(output.shapes.len() >= 5);
    }
    #[test]
    fn opacity_and_short_hex_are_preserved() {
        assert_eq!(
            color("#fff", 0.5),
            Color32::from_rgba_unmultiplied(255, 255, 255, 127)
        );
        assert_eq!(color("transparent", 1.), Color32::TRANSPARENT);
    }
}
