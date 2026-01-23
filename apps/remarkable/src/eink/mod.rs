//! E-ink display management
//!
//! Handles display refresh modes and optimization for e-ink screens.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

/// E-ink refresh modes optimized for different operations
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshMode {
    /// Full refresh - slowest but best quality, clears ghosting
    /// Use for: navigation, major UI changes
    /// Latency: ~300ms
    Full,

    /// Partial refresh - moderate speed and quality
    /// Use for: UI element updates, text changes
    /// Latency: ~120ms
    Partial,

    /// Direct Update (DU) - fast grayscale update
    /// Use for: scrolling, animations
    /// Latency: ~80ms
    DirectUpdate,

    /// A2 mode - binary (black/white) only, fastest
    /// Use for: real-time drawing, cursor movement
    /// Latency: ~50ms
    A2,
}

impl RefreshMode {
    /// Get the libremarkable waveform constant
    #[cfg(feature = "remarkable")]
    pub fn to_waveform(&self) -> libremarkable::framebuffer::common::waveform_mode {
        use libremarkable::framebuffer::common::waveform_mode;
        match self {
            RefreshMode::Full => waveform_mode::WAVEFORM_MODE_GC16,
            RefreshMode::Partial => waveform_mode::WAVEFORM_MODE_GC16_FAST,
            RefreshMode::DirectUpdate => waveform_mode::WAVEFORM_MODE_DU,
            RefreshMode::A2 => waveform_mode::WAVEFORM_MODE_A2,
        }
    }

    /// Approximate latency in milliseconds
    pub fn latency_ms(&self) -> u32 {
        match self {
            RefreshMode::Full => 300,
            RefreshMode::Partial => 120,
            RefreshMode::DirectUpdate => 80,
            RefreshMode::A2 => 50,
        }
    }
}

/// Display region for partial updates
#[derive(Debug, Clone, Copy)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Region {
    pub fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// Full screen region for reMarkable 2 (1872x1404)
    pub fn full_screen() -> Self {
        Self {
            x: 0,
            y: 0,
            width: 1404,
            height: 1872,
        }
    }
}

/// E-ink display manager
pub struct DisplayManager {
    /// Counter for tracking refresh cycles (for ghosting prevention)
    refresh_counter: Arc<AtomicU32>,
    /// Number of partial refreshes before forcing a full refresh
    ghost_prevention_threshold: u32,
}

impl DisplayManager {
    pub fn new() -> Self {
        Self {
            refresh_counter: Arc::new(AtomicU32::new(0)),
            ghost_prevention_threshold: 20,
        }
    }

    /// Increment refresh counter and check if full refresh needed
    pub fn should_force_full_refresh(&self) -> bool {
        let count = self.refresh_counter.fetch_add(1, Ordering::SeqCst);
        count >= self.ghost_prevention_threshold
    }

    /// Reset refresh counter (after full refresh)
    pub fn reset_refresh_counter(&self) {
        self.refresh_counter.store(0, Ordering::SeqCst);
    }

    /// Choose optimal refresh mode based on the action
    pub fn optimal_mode_for_action(&self, action: DisplayAction) -> RefreshMode {
        // Check if we need a full refresh for ghosting prevention
        if self.should_force_full_refresh() {
            self.reset_refresh_counter();
            return RefreshMode::Full;
        }

        match action {
            DisplayAction::Drawing => RefreshMode::A2,
            DisplayAction::Scrolling => RefreshMode::DirectUpdate,
            DisplayAction::UiUpdate => RefreshMode::Partial,
            DisplayAction::Navigation => RefreshMode::Full,
            DisplayAction::TextInput => RefreshMode::Partial,
        }
    }

    /// Request display refresh (reMarkable device)
    #[cfg(feature = "remarkable")]
    pub fn refresh(&self, region: Region, mode: RefreshMode) {
        use libremarkable::framebuffer::{
            common::{display_temp, dither_mode, mxcfb_rect, update_mode},
            FramebufferRefresh,
        };

        let rect = mxcfb_rect {
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
        };

        // Get the framebuffer
        if let Ok(fb) = libremarkable::framebuffer::Framebuffer::from_path("/dev/fb0") {
            fb.partial_refresh(
                &rect,
                update_mode::UPDATE_MODE_PARTIAL,
                mode.to_waveform(),
                display_temp::TEMP_USE_REMARKABLE_DRAW,
                dither_mode::EPDC_FLAG_USE_DITHERING_PASSTHROUGH,
                0,
                false,
            );
        }
    }

    /// Request display refresh (desktop stub)
    #[cfg(not(feature = "remarkable"))]
    pub fn refresh(&self, _region: Region, _mode: RefreshMode) {
        // No-op on desktop (development mode)
    }

    /// Convert color to e-ink grayscale
    pub fn to_eink_gray(r: u8, g: u8, b: u8) -> u8 {
        // Weighted grayscale conversion
        let gray = (0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32) as u8;

        // Quantize to e-ink levels (16 levels for most e-ink)
        (gray / 16) * 16
    }

    /// Dither an image for e-ink display using Floyd-Steinberg
    pub fn dither_image(pixels: &mut [u8], width: usize, height: usize) {
        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                let old_pixel = pixels[idx] as i16;
                let new_pixel = if old_pixel > 127 { 255 } else { 0 };
                pixels[idx] = new_pixel as u8;

                let error = old_pixel - new_pixel as i16;

                // Floyd-Steinberg error diffusion
                if x + 1 < width {
                    pixels[idx + 1] =
                        (pixels[idx + 1] as i16 + error * 7 / 16).clamp(0, 255) as u8;
                }
                if y + 1 < height {
                    if x > 0 {
                        pixels[(y + 1) * width + x - 1] =
                            (pixels[(y + 1) * width + x - 1] as i16 + error * 3 / 16).clamp(0, 255)
                                as u8;
                    }
                    pixels[(y + 1) * width + x] =
                        (pixels[(y + 1) * width + x] as i16 + error * 5 / 16).clamp(0, 255) as u8;
                    if x + 1 < width {
                        pixels[(y + 1) * width + x + 1] =
                            (pixels[(y + 1) * width + x + 1] as i16 + error * 1 / 16).clamp(0, 255)
                                as u8;
                    }
                }
            }
        }
    }
}

impl Default for DisplayManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Actions that determine refresh mode
#[derive(Debug, Clone, Copy)]
pub enum DisplayAction {
    /// Real-time drawing with stylus
    Drawing,
    /// Scrolling through content
    Scrolling,
    /// UI element updates (buttons, selections)
    UiUpdate,
    /// Screen navigation (page changes)
    Navigation,
    /// Text input/keyboard
    TextInput,
}
