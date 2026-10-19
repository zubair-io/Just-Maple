//! Input handling module
//!
//! Handles stylus, touch, and button input on reMarkable devices.

use tokio::sync::mpsc;
mod accumulator;

/// Input event types
#[derive(Debug, Clone)]
pub enum InputEvent {
    /// Stylus moved/pressed
    Stylus(StylusEvent),
    /// Touch input
    Touch(TouchEvent),
    /// Physical button press
    Button(ButtonEvent),
}

/// Stylus event data; x/y and pressure are normalized to 0..1.
#[derive(Debug, Clone)]
pub struct StylusEvent {
    pub x: f32,
    pub y: f32,
    pub pressure: f32,
    pub tilt_x: f32,
    pub tilt_y: f32,
    pub event_type: StylusEventType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StylusEventType {
    /// Stylus touching the screen
    Down,
    /// Stylus moving while touching
    Move,
    /// Stylus lifted from screen
    Up,
    /// Stylus hovering (detected but not touching)
    Hover,
}

/// Touch event data; x/y are normalized to 0..1.
#[derive(Debug, Clone)]
pub struct TouchEvent {
    pub x: f32,
    pub y: f32,
    pub finger_id: u32,
    pub event_type: TouchEventType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TouchEventType {
    Down,
    Move,
    Up,
}

/// Button event data
#[derive(Debug, Clone)]
pub struct ButtonEvent {
    pub button: Button,
    pub pressed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Button {
    /// Home button (center)
    Home,
    /// Left button
    Left,
    /// Right button
    Right,
    /// Power button
    Power,
}

/// Processed gesture
#[derive(Debug, Clone)]
pub enum Gesture {
    /// Single tap at position
    Tap { x: f32, y: f32 },
    /// Double tap at position
    DoubleTap { x: f32, y: f32 },
    /// Long press at position
    LongPress { x: f32, y: f32 },
    /// Swipe gesture
    Swipe {
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        direction: SwipeDirection,
    },
    /// Pinch zoom
    Pinch {
        center_x: f32,
        center_y: f32,
        scale: f32,
    },
    /// Two-finger scroll
    Scroll { delta_x: f32, delta_y: f32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwipeDirection {
    Up,
    Down,
    Left,
    Right,
}

/// Input manager handles device input and gesture recognition
pub struct InputManager {
    event_tx: mpsc::Sender<InputEvent>,
    event_rx: Option<mpsc::Receiver<InputEvent>>,
    /// Stylus prediction for smoother drawing
    stroke_predictor: StrokePredictor,
}

impl InputManager {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(256);
        Self {
            event_tx: tx,
            event_rx: Some(rx),
            stroke_predictor: StrokePredictor::new(),
        }
    }

    /// Take the event receiver (can only be called once)
    pub fn take_receiver(&mut self) -> Option<mpsc::Receiver<InputEvent>> {
        self.event_rx.take()
    }

    pub fn drain(&mut self) -> Vec<InputEvent> {
        let mut events = Vec::new();
        if let Some(rx) = self.event_rx.as_mut() {
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
        }
        events
    }

    /// Start listening for input events (reMarkable device)
    #[cfg(feature = "remarkable")]
    pub async fn start(&self) -> anyhow::Result<()> {
        use accumulator::{Axis, StylusAccumulator, TouchAccumulator};
        use evdev::{Device, InputEventKind};
        // evdev's synchronized Device stream reconstructs state after SYN_DROPPED.
        // Blocking reads must not occupy Tokio's asynchronous worker threads.
        for (name, path) in [
            ("stylus", "/dev/input/event1"),
            ("touch", "/dev/input/event2"),
            ("buttons", "/dev/input/event0"),
        ] {
            let Ok(mut device) = Device::open(path) else {
                continue;
            };
            let state = device.get_abs_state()?;
            let axis = |code: usize| Axis {
                min: state[code].minimum,
                max: state[code].maximum,
            };
            let mut stylus = StylusAccumulator::new(axis(0), axis(1), axis(24));
            let mut touch = TouchAccumulator::new(axis(53), axis(54));
            // Seed persistent axis state: Linux emits only changed axes.
            for code in [0, 1, 24, 26, 27] {
                stylus.axis(code as u16, state[code].value);
            }
            if let Ok(keys) = device.get_key_state() {
                stylus.key(320, i32::from(keys.contains(evdev::Key::BTN_TOOL_PEN)));
                stylus.key(330, i32::from(keys.contains(evdev::Key::BTN_TOUCH)));
            }
            let tx = self.event_tx.clone();
            std::thread::spawn(move || loop {
                if tx.is_closed() {
                    break;
                }
                match device.fetch_events() {
                    Ok(events) => {
                        for event in events {
                            match event.kind() {
                                InputEventKind::AbsAxis(axis) if name == "stylus" => {
                                    stylus.axis(axis.0, event.value())
                                }
                                InputEventKind::Key(key) if name == "stylus" => {
                                    stylus.key(key.0, event.value())
                                }
                                InputEventKind::AbsAxis(axis) if name == "touch" => {
                                    touch.axis(axis.0, event.value())
                                }
                                InputEventKind::Synchronization(code) if code.0 == 0 => {
                                    let events = if name == "stylus" {
                                        stylus
                                            .report()
                                            .map(InputEvent::Stylus)
                                            .into_iter()
                                            .collect::<Vec<_>>()
                                    } else if name == "touch" {
                                        touch.report().into_iter().map(InputEvent::Touch).collect()
                                    } else {
                                        Vec::new()
                                    };
                                    for mut event in events {
                                        orient(&mut event);
                                        if tx.blocking_send(event).is_err() {
                                            return;
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    Err(error) => {
                        tracing::error!(%error, name, "Input device disconnected");
                        break;
                    }
                }
            });
        }

        Ok(())
    }

    /// Start listening for input events (desktop mode - uses egui input)
    #[cfg(not(feature = "remarkable"))]
    pub async fn start(&self) -> anyhow::Result<()> {
        tracing::info!("Input manager started (desktop mode - using egui input)");
        Ok(())
    }

    /// Get predicted stylus position for smoother drawing
    pub fn predict_stylus(&mut self, current: &StylusEvent) -> Option<StylusEvent> {
        self.stroke_predictor.predict(current)
    }
}

#[cfg(feature = "remarkable")]
fn orient(event: &mut InputEvent) {
    use libremarkable::device::{rotate::InputDeviceRotation, CURRENT_DEVICE};
    let (x, y, placement) = match event {
        InputEvent::Stylus(e) => (&mut e.x, &mut e.y, CURRENT_DEVICE.get_wacom_placement()),
        InputEvent::Touch(e) => (
            &mut e.x,
            &mut e.y,
            CURRENT_DEVICE.get_multitouch_placement(),
        ),
        _ => return,
    };
    let (rx, ry) = match placement.rotation {
        InputDeviceRotation::Rot0 => (*x, *y),
        InputDeviceRotation::Rot90 => (1. - *y, *x),
        InputDeviceRotation::Rot180 => (1. - *x, 1. - *y),
        InputDeviceRotation::Rot270 => (*y, 1. - *x),
    };
    *x = if placement.invert_x { 1. - rx } else { rx };
    *y = if placement.invert_y { 1. - ry } else { ry };
}

impl Default for InputManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Stroke prediction for smoother drawing
pub struct StrokePredictor {
    history: Vec<StylusEvent>,
    history_size: usize,
}

impl StrokePredictor {
    pub fn new() -> Self {
        Self {
            history: Vec::with_capacity(5),
            history_size: 5,
        }
    }

    /// Add event to history and return predicted next position
    pub fn predict(&mut self, event: &StylusEvent) -> Option<StylusEvent> {
        // Only predict during movement
        if event.event_type != StylusEventType::Move {
            self.history.clear();
            return None;
        }

        self.history.push(event.clone());
        if self.history.len() > self.history_size {
            self.history.remove(0);
        }

        // Need at least 2 points for prediction
        if self.history.len() < 2 {
            return None;
        }

        // Simple linear prediction based on velocity
        let len = self.history.len();
        let prev = &self.history[len - 2];
        let curr = &self.history[len - 1];

        let dx = curr.x - prev.x;
        let dy = curr.y - prev.y;

        // Predict one frame ahead (reduce prediction distance for stability)
        let prediction_factor = 0.5;
        Some(StylusEvent {
            x: curr.x + dx * prediction_factor,
            y: curr.y + dy * prediction_factor,
            pressure: curr.pressure,
            tilt_x: curr.tilt_x,
            tilt_y: curr.tilt_y,
            event_type: StylusEventType::Move,
        })
    }

    /// Clear history (on stroke end)
    pub fn reset(&mut self) {
        self.history.clear();
    }
}

impl Default for StrokePredictor {
    fn default() -> Self {
        Self::new()
    }
}

/// Gesture recognizer for touch input
pub struct GestureRecognizer {
    touch_start: Option<(f32, f32, std::time::Instant)>,
    last_tap: Option<(f32, f32, std::time::Instant)>,
    tap_threshold_px: f32,
    tap_threshold_ms: u64,
    double_tap_threshold_ms: u64,
    long_press_threshold_ms: u64,
    swipe_threshold_px: f32,
}

impl GestureRecognizer {
    pub fn new() -> Self {
        Self {
            touch_start: None,
            last_tap: None,
            tap_threshold_px: 20.0,
            tap_threshold_ms: 300,
            double_tap_threshold_ms: 400,
            long_press_threshold_ms: 500,
            swipe_threshold_px: 50.0,
        }
    }

    /// Process touch event and return recognized gesture
    pub fn process(&mut self, event: &TouchEvent) -> Option<Gesture> {
        match event.event_type {
            TouchEventType::Down => {
                self.touch_start = Some((event.x, event.y, std::time::Instant::now()));
                None
            }
            TouchEventType::Move => {
                // Could detect swipe during movement for visual feedback
                None
            }
            TouchEventType::Up => {
                let (start_x, start_y, start_time) = self.touch_start.take()?;
                let duration = start_time.elapsed();
                let dx = event.x - start_x;
                let dy = event.y - start_y;
                let distance = (dx * dx + dy * dy).sqrt();

                // Check for swipe
                if distance > self.swipe_threshold_px {
                    let direction = if dx.abs() > dy.abs() {
                        if dx > 0.0 {
                            SwipeDirection::Right
                        } else {
                            SwipeDirection::Left
                        }
                    } else if dy > 0.0 {
                        SwipeDirection::Down
                    } else {
                        SwipeDirection::Up
                    };

                    return Some(Gesture::Swipe {
                        start_x,
                        start_y,
                        end_x: event.x,
                        end_y: event.y,
                        direction,
                    });
                }

                // Check for tap
                if distance < self.tap_threshold_px
                    && duration.as_millis() < self.tap_threshold_ms as u128
                {
                    // Check for double tap
                    if let Some((last_x, last_y, last_time)) = self.last_tap {
                        let tap_distance =
                            ((event.x - last_x).powi(2) + (event.y - last_y).powi(2)).sqrt();
                        if tap_distance < self.tap_threshold_px
                            && last_time.elapsed().as_millis()
                                < self.double_tap_threshold_ms as u128
                        {
                            self.last_tap = None;
                            return Some(Gesture::DoubleTap {
                                x: event.x,
                                y: event.y,
                            });
                        }
                    }

                    self.last_tap = Some((event.x, event.y, std::time::Instant::now()));
                    return Some(Gesture::Tap {
                        x: event.x,
                        y: event.y,
                    });
                }

                // Check for long press
                if distance < self.tap_threshold_px
                    && duration.as_millis() >= self.long_press_threshold_ms as u128
                {
                    return Some(Gesture::LongPress {
                        x: event.x,
                        y: event.y,
                    });
                }

                None
            }
        }
    }
}

impl Default for GestureRecognizer {
    fn default() -> Self {
        Self::new()
    }
}
