//! Input handling module
//!
//! Handles stylus, touch, and button input on reMarkable devices.

use tokio::sync::mpsc;

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

/// Stylus event data
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

/// Touch event data
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
    Pinch { center_x: f32, center_y: f32, scale: f32 },
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

    /// Start listening for input events (reMarkable device)
    #[cfg(feature = "remarkable")]
    pub async fn start(&self) -> anyhow::Result<()> {
        use evdev::{Device, InputEventKind};
        use tracing::{debug, error, info};

        info!("Starting input listener");

        // Find input devices
        let mut devices = Vec::new();

        // Stylus device (typically /dev/input/event1 on rM2)
        if let Ok(device) = Device::open("/dev/input/event1") {
            devices.push(("stylus", device));
        }

        // Touch device (typically /dev/input/event2 on rM2)
        if let Ok(device) = Device::open("/dev/input/event2") {
            devices.push(("touch", device));
        }

        // Button device
        if let Ok(device) = Device::open("/dev/input/event0") {
            devices.push(("buttons", device));
        }

        let tx = self.event_tx.clone();

        for (name, mut device) in devices {
            let tx_clone = tx.clone();
            tokio::spawn(async move {
                loop {
                    match device.fetch_events() {
                        Ok(events) => {
                            for event in events {
                                match event.kind() {
                                    InputEventKind::AbsAxis(_) if name == "stylus" => {
                                        // Process stylus events
                                        // TODO: Accumulate axis events into StylusEvent
                                    }
                                    InputEventKind::AbsAxis(_) if name == "touch" => {
                                        // Process touch events
                                        // TODO: Accumulate axis events into TouchEvent
                                    }
                                    InputEventKind::Key(_) if name == "buttons" => {
                                        // Process button events
                                        debug!("Button event: {:?}", event);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Err(e) => {
                            error!("Error reading {} events: {}", name, e);
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        }
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
