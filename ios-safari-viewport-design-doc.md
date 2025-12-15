# iOS Safari Keyboard Viewport Handling

## Overview

This document outlines a solution for handling viewport height changes when the virtual keyboard appears in iOS Safari. The goal is to ensure a chat application properly resizes its container to fit the visible viewport, keeping the input field accessible and the message list appropriately sized.

## Problem Statement

iOS Safari does not resize the viewport when the virtual keyboard appears. Instead, it scrolls the page content upward while maintaining the original viewport height. This behavior causes several issues in chat applications:

1. The chat container remains at full height, extending behind the keyboard
2. The input field may become obscured or positioned incorrectly
3. Users cannot see recent messages while typing
4. The overall UX feels broken compared to native apps

## Technical Background

### Viewport Units in CSS

| Unit | Behavior |
|------|----------|
| `vh` | Based on the "large" viewport (excludes browser chrome, ignores keyboard) |
| `svh` | Small viewport height (accounts for browser chrome when visible) |
| `dvh` | Dynamic viewport height (adjusts for keyboard and browser chrome) |
| `lvh` | Large viewport height (maximum possible viewport) |

While `dvh` is the ideal solution, it requires iOS 15.4+ and may not cover all target devices.

### Visual Viewport API

The `window.visualViewport` object provides real-time information about the visible portion of the page:

- `visualViewport.height`: Current visible height (accounts for keyboard)
- `visualViewport.width`: Current visible width
- `visualViewport.offsetTop`: Scroll offset from the top
- `visualViewport.scale`: Current zoom level

## Solution Design

### Architecture

```
┌─────────────────────────────────────┐
│         ViewportManager             │
│  ┌───────────────────────────────┐  │
│  │   Visual Viewport Listener    │  │
│  └───────────────┬───────────────┘  │
│                  │                   │
│                  ▼                   │
│  ┌───────────────────────────────┐  │
│  │   CSS Custom Property Update  │  │
│  │   (--viewport-height)         │  │
│  └───────────────┬───────────────┘  │
│                  │                   │
└──────────────────┼──────────────────┘
                   │
                   ▼
┌─────────────────────────────────────┐
│         Chat Container              │
│  height: var(--viewport-height)     │
│  ┌───────────────────────────────┐  │
│  │   Message List (flex: 1)      │  │
│  │   overflow-y: auto            │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │   Input Area (flex-shrink: 0) │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Implementation

#### JavaScript: ViewportManager

```javascript
class ViewportManager {
  constructor() {
    this.init();
  }

  init() {
    this.updateViewportHeight();
    this.attachListeners();
  }

  updateViewportHeight() {
    // Prefer visualViewport API, fall back to innerHeight
    const height = window.visualViewport?.height ?? window.innerHeight;
    
    document.documentElement.style.setProperty(
      '--viewport-height',
      `${height}px`
    );

    // Also set offset for fixed positioning adjustments
    const offsetTop = window.visualViewport?.offsetTop ?? 0;
    document.documentElement.style.setProperty(
      '--viewport-offset-top',
      `${offsetTop}px`
    );
  }

  attachListeners() {
    // Throttle updates for performance
    const throttledUpdate = this.throttle(
      () => this.updateViewportHeight(),
      50
    );

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', throttledUpdate);
      window.visualViewport.addEventListener('scroll', throttledUpdate);
    }

    // Fallback for browsers without visualViewport
    window.addEventListener('resize', throttledUpdate);
    
    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.updateViewportHeight(), 100);
    });
  }

  throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  destroy() {
    // Clean up listeners if needed
    window.visualViewport?.removeEventListener('resize', this.updateViewportHeight);
    window.visualViewport?.removeEventListener('scroll', this.updateViewportHeight);
    window.removeEventListener('resize', this.updateViewportHeight);
  }
}

// Initialize
const viewportManager = new ViewportManager();
```

#### CSS: Chat Container Styles

```css
:root {
  /* Fallback to dvh, then vh */
  --viewport-height: 100dvh;
}

/* Prevent overscroll/bounce */
html, body {
  height: 100%;
  overflow: hidden;
  position: fixed;
  width: 100%;
}

.chat-container {
  height: var(--viewport-height);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-header {
  flex-shrink: 0;
  /* Header styles */
}

.message-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.input-area {
  flex-shrink: 0;
  padding: 12px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  background: var(--input-background);
}

.input-area input,
.input-area textarea {
  width: 100%;
  /* Prevent zoom on focus in iOS */
  font-size: 16px;
}
```

#### Optional: Auto-scroll to Input on Focus

```javascript
class ChatInputManager {
  constructor(inputElement, messageListElement) {
    this.input = inputElement;
    this.messageList = messageListElement;
    this.attachListeners();
  }

  attachListeners() {
    this.input.addEventListener('focus', () => this.handleFocus());
  }

  handleFocus() {
    // Wait for keyboard animation to complete
    setTimeout(() => {
      // Scroll message list to bottom
      this.messageList.scrollTop = this.messageList.scrollHeight;
      
      // Ensure input is visible
      this.input.scrollIntoView({ 
        block: 'end', 
        behavior: 'smooth' 
      });
    }, 300);
  }
}
```

## Browser Support

| Browser | Visual Viewport API | dvh/svh/lvh |
|---------|---------------------|-------------|
| iOS Safari 13+ | ✅ | ❌ |
| iOS Safari 15.4+ | ✅ | ✅ |
| Chrome (Android) | ✅ | ✅ |
| Firefox (Android) | ✅ | ✅ |
| Desktop Browsers | ✅ | ✅ |

The combined approach ensures compatibility with iOS Safari 13+ while leveraging modern CSS units where available.

## Edge Cases and Considerations

### 1. Orientation Changes

Orientation changes can cause temporary incorrect values. The solution includes a delayed update after orientation change events.

### 2. External Keyboards

When a physical keyboard is connected, the virtual keyboard won't appear. The solution handles this gracefully since `visualViewport.height` will remain unchanged.

### 3. Split View / Slide Over (iPad)

The Visual Viewport API correctly reports dimensions during iPad multitasking modes.

### 4. Input Zoom Prevention

iOS Safari zooms in when focusing inputs with font-size less than 16px. Always use `font-size: 16px` or larger on input elements.

### 5. Safe Areas

Use `env(safe-area-inset-bottom)` to account for the home indicator on notched devices.

## Testing Checklist

- [ ] Keyboard appears: container resizes correctly
- [ ] Keyboard dismisses: container returns to full height
- [ ] Orientation change: proper resize after rotation
- [ ] Input focus: input remains visible and usable
- [ ] Message list: remains scrollable when keyboard is open
- [ ] Fast typing: no jank or layout thrashing
- [ ] External keyboard: layout remains stable
- [ ] Notched devices: safe areas respected

## Performance Considerations

1. **Throttling**: Viewport updates are throttled to 50ms to prevent excessive style recalculations
2. **CSS Custom Properties**: Using a single CSS variable minimizes reflow when the value changes
3. **Avoid Layout Thrashing**: The solution batches reads and writes to the DOM
4. **Will-Change**: Consider adding `will-change: height` to the chat container if animations are used

## Alternatives Considered

### CSS-Only with `dvh`

**Pros**: Simplest implementation, no JavaScript required

**Cons**: Requires iOS 15.4+, leaving older devices unsupported

### `position: fixed` with Bottom Offset

**Pros**: Works without JavaScript

**Cons**: Breaks document flow, causes issues with scrolling, inconsistent behavior across browsers

### Native App / PWA

**Pros**: Full control over keyboard behavior

**Cons**: Requires app store distribution or PWA support, increased development complexity

## Conclusion

The combined Visual Viewport API and CSS custom property approach provides the most robust solution for handling iOS Safari's keyboard behavior. It maintains backward compatibility while leveraging modern browser features where available.
