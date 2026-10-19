//! Frame-based Linux input decoding. Coordinates and pressure are normalized to 0..1.
use super::*;
use std::collections::BTreeMap;

#[derive(Clone, Copy)]
pub struct Axis {
    pub min: i32,
    pub max: i32,
}
impl Axis {
    pub fn normalize(self, value: i32) -> f32 {
        if self.max <= self.min {
            return 0.;
        }
        ((value as f64 - self.min as f64) / (self.max as f64 - self.min as f64)).clamp(0., 1.)
            as f32
    }
}

pub struct StylusAccumulator {
    pub x_axis: Axis,
    pub y_axis: Axis,
    pub pressure_axis: Axis,
    x: f32,
    y: f32,
    pressure: f32,
    tilt_x: f32,
    tilt_y: f32,
    touching: bool,
    was_touching: bool,
    in_range: bool,
    dirty: bool,
}
impl StylusAccumulator {
    pub fn new(x_axis: Axis, y_axis: Axis, pressure_axis: Axis) -> Self {
        Self {
            x_axis,
            y_axis,
            pressure_axis,
            x: 0.,
            y: 0.,
            pressure: 0.,
            tilt_x: 0.,
            tilt_y: 0.,
            touching: false,
            was_touching: false,
            in_range: false,
            dirty: false,
        }
    }
    pub fn axis(&mut self, code: u16, value: i32) {
        match code {
            0 => self.x = self.x_axis.normalize(value),
            1 => self.y = self.y_axis.normalize(value),
            24 => self.pressure = self.pressure_axis.normalize(value),
            26 => self.tilt_x = value as f32,
            27 => self.tilt_y = value as f32,
            _ => return,
        }
        self.dirty = true;
    }
    pub fn key(&mut self, code: u16, value: i32) {
        match code {
            330 => self.touching = value != 0,
            320 | 321 => self.in_range = value != 0,
            _ => return,
        }
        self.dirty = true;
    }
    pub fn report(&mut self) -> Option<StylusEvent> {
        if !self.dirty {
            return None;
        }
        self.dirty = false;
        let event_type = match (self.was_touching, self.touching) {
            (false, true) => StylusEventType::Down,
            (true, true) => StylusEventType::Move,
            (true, false) => StylusEventType::Up,
            (false, false) if self.in_range => StylusEventType::Hover,
            _ => return None,
        };
        self.was_touching = self.touching;
        Some(StylusEvent {
            x: self.x,
            y: self.y,
            pressure: if self.touching { self.pressure } else { 0. },
            tilt_x: self.tilt_x,
            tilt_y: self.tilt_y,
            event_type,
        })
    }
}
#[derive(Default)]
struct Contact {
    id: Option<u32>,
    previous: Option<u32>,
    x: f32,
    y: f32,
    dirty: bool,
    released: Vec<(u32, f32, f32)>,
}
pub struct TouchAccumulator {
    pub x_axis: Axis,
    pub y_axis: Axis,
    slot: i32,
    slots: BTreeMap<i32, Contact>,
}
impl TouchAccumulator {
    pub fn new(x_axis: Axis, y_axis: Axis) -> Self {
        Self {
            x_axis,
            y_axis,
            slot: 0,
            slots: BTreeMap::new(),
        }
    }
    pub fn axis(&mut self, code: u16, value: i32) {
        if code == 47 {
            self.slot = value;
            return;
        }
        // Reject invalid slots instead of growing state from corrupt input.
        if !(0..32).contains(&self.slot) {
            return;
        }
        let contact = self.slots.entry(self.slot).or_default();
        match code {
            57 => {
                let next = u32::try_from(value).ok();
                if contact.id != next {
                    if let Some(old) = contact.previous.take() {
                        contact.released.push((old, contact.x, contact.y));
                    }
                    contact.id = next;
                }
            }
            53 => contact.x = self.x_axis.normalize(value),
            54 => contact.y = self.y_axis.normalize(value),
            _ => return,
        }
        contact.dirty = true;
    }
    pub fn report(&mut self) -> Vec<TouchEvent> {
        let mut events = Vec::new();
        for contact in self.slots.values_mut() {
            for (id, x, y) in contact.released.drain(..) {
                events.push(TouchEvent {
                    x,
                    y,
                    finger_id: id,
                    event_type: TouchEventType::Up,
                });
            }
            if contact.dirty {
                if let Some(id) = contact.id {
                    events.push(TouchEvent {
                        x: contact.x,
                        y: contact.y,
                        finger_id: id,
                        event_type: if contact.previous == Some(id) {
                            TouchEventType::Move
                        } else {
                            TouchEventType::Down
                        },
                    });
                }
                contact.previous = contact.id;
                contact.dirty = false;
            }
        }
        events
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn axis() -> Axis {
        Axis { min: 10, max: 110 }
    }
    #[test]
    fn stylus_frames_retain_axes_pressure_and_lifecycle() {
        let mut s = StylusAccumulator::new(axis(), axis(), axis());
        s.key(320, 1);
        s.axis(0, 60);
        s.axis(1, 35);
        let e = s.report().unwrap();
        assert_eq!(e.event_type, StylusEventType::Hover);
        assert_eq!((e.x, e.y), (0.5, 0.25));
        s.key(330, 1);
        s.axis(24, 30);
        assert_eq!(s.report().unwrap().pressure, 0.2);
        s.axis(0, 110);
        s.axis(24, 90);
        s.axis(26, -20);
        let e = s.report().unwrap();
        assert_eq!(e.event_type, StylusEventType::Move);
        assert_eq!((e.y, e.pressure, e.tilt_x), (0.25, 0.8, -20.));
        s.key(330, 0);
        assert_eq!(s.report().unwrap().event_type, StylusEventType::Up);
        assert!(s.report().is_none());
        s.key(320, 0);
        assert!(s.report().is_none());
    }
    #[test]
    fn multitouch_tracks_slots_releases_and_replacements() {
        let mut t = TouchAccumulator::new(axis(), axis());
        for (code, value) in [
            (47, 0),
            (57, 42),
            (53, 60),
            (54, 35),
            (47, 1),
            (57, 88),
            (53, 110),
            (54, 60),
        ] {
            t.axis(code, value);
        }
        let events = t.report();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].finger_id, 42);
        assert_eq!(events[1].x, 1.);
        t.axis(47, 0);
        t.axis(53, 80);
        let e = t.report();
        assert_eq!(e[0].event_type, TouchEventType::Move);
        assert_eq!(e[0].y, 0.25);
        t.axis(57, -1);
        t.axis(57, 99);
        t.axis(53, 10);
        let e = t.report();
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].event_type, TouchEventType::Up);
        assert_eq!(e[0].finger_id, 42);
        assert_eq!(e[1].finger_id, 99);
        assert_eq!(e[1].event_type, TouchEventType::Down);
        t.axis(47, 1);
        t.axis(57, -1);
        assert_eq!(t.report()[0].event_type, TouchEventType::Up);
        assert!(t.report().is_empty());
    }
    #[test]
    fn axis_handles_offsets_clamping_and_invalid_ranges() {
        assert_eq!(axis().normalize(-1), 0.);
        assert_eq!(axis().normalize(999), 1.);
        assert_eq!(Axis { min: 2, max: 2 }.normalize(5), 0.);
    }
}
