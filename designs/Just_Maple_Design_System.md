# Just Maple

## UI/UX Design System

_A design language for documents and conversations that feel like home. Inspired by the warmth of Bear and the clarity of Notion._

**Version 1.0 — December 2024**

---

# Design Philosophy

Just Maple is built on the belief that the best tools disappear into your workflow. We draw inspiration from Bear's singular focus on writing and Notion's structural clarity, combining them into something that feels both personal and powerful.

## Core Principles

1. **Warmth Over Coldness** — Soft edges, warm colors, and organic shapes create a space that feels inviting rather than clinical. Technology should feel like a craftsman's tool, not a sterile interface.

2. **Quiet Confidence** — The UI recedes when you're focused on content. Controls appear when needed and gracefully fade when not. Every element earns its place.

3. **Progressive Disclosure** — Simple by default, powerful when needed. Advanced features reveal themselves naturally as users explore, never overwhelming newcomers.

4. **Spatial Consistency** — Like Notion, every element has a predictable home. Drag, drop, and rearrange with confidence. The interface respects your mental model.

5. **Living Documents** — Documents aren't static. They breathe with widgets, respond to context, and evolve with your thinking. Content and computation interweave seamlessly.

---

# Visual Identity

## Color Palette

Our palette draws from autumn maple leaves—warm, inviting, and grounded. The system balances vibrant accents with neutral foundations to create hierarchy without visual noise.

### Primary Colors

| Name        | Value     | Usage                                                     |
| ----------- | --------- | --------------------------------------------------------- |
| Maple       | `#C75B39` | Primary actions, active states, key navigation highlights |
| Maple Light | `#E8A87C` | Hover states, secondary accents, subtle highlights        |
| Sunset Gold | `#D4A574` | Tertiary accent, tag colors, warm backgrounds             |

### Neutral Colors

| Name      | Value     | Usage                                         |
| --------- | --------- | --------------------------------------------- |
| Charcoal  | `#2C2C2C` | Primary text, headings, dark mode backgrounds |
| Warm Gray | `#6B6B6B` | Secondary text, placeholders, metadata        |
| Mist      | `#9CA3AF` | Disabled states, dividers, tertiary text      |
| Pearl     | `#E5E5E5` | Borders, separators, subtle containers        |
| Cream     | `#FAF8F5` | Primary background, content areas             |
| Snow      | `#FFFFFF` | Cards, elevated surfaces, input fields        |

### Color Usage Guidelines

- Use Maple (#C75B39) sparingly—it should draw the eye to what matters most
- Reserve pure white for elevated surfaces; cream backgrounds add warmth to large areas
- Text colors maintain a 4.5:1 contrast ratio minimum for accessibility
- Tag colors use softer, desaturated versions of the accent palette

## Typography

Typography balances readability with personality. We pair a refined serif for display text with a clean sans-serif for body content, following Bear's elegant approach to typographic hierarchy.

| Element | Font           | Size | Weight   | Line Height |
| ------- | -------------- | ---- | -------- | ----------- |
| H1      | Georgia        | 28px | Bold     | 1.2         |
| H2      | Georgia        | 22px | Bold     | 1.3         |
| H3      | Inter          | 18px | Semibold | 1.4         |
| Body    | Inter          | 16px | Regular  | 1.6         |
| Small   | Inter          | 14px | Regular  | 1.5         |
| Caption | Inter          | 12px | Regular  | 1.4         |
| Code    | JetBrains Mono | 14px | Regular  | 1.5         |

### Typography Guidelines

- Display headings (H1, H2) use Georgia for warmth and distinction
- Body text and UI elements use Inter for clarity and legibility
- Monospace (JetBrains Mono) for code blocks and technical content
- Line height of 1.6 for body text ensures comfortable reading
- Paragraph spacing replaces indentation for modern document feel

## Spacing System

A consistent 4px base grid creates rhythmic harmony across all components. Spacing scales geometrically for predictable visual relationships.

| Token       | Value | Usage                                         |
| ----------- | ----- | --------------------------------------------- |
| `space-xs`  | 4px   | Icon padding, tight element grouping          |
| `space-sm`  | 8px   | Related element spacing, inline padding       |
| `space-md`  | 16px  | Component internal padding, paragraph spacing |
| `space-lg`  | 24px  | Section spacing, card padding                 |
| `space-xl`  | 32px  | Major section breaks                          |
| `space-2xl` | 48px  | Page-level spacing, hero sections             |

---

# Core Components

## Sidebar Navigation

The sidebar is the organizational backbone of Just Maple, inspired by Bear's elegant simplicity. It presents tags (which function as folders) in a collapsible tree structure with integrated chat and document indicators.

### Sidebar Specifications

- **Width:** 280px default, collapsible to 0px (icons only on mobile)
- **Background:** Cream (#FAF8F5) with subtle left border
- **Item Height:** 36px with 12px horizontal padding
- **Active State:** Maple background at 10% opacity, left border accent
- **Hover State:** Pearl background (#E5E5E5)
- **Unread Indicator:** Maple dot (8px) positioned right of tag name

### Tag Item Anatomy

Each tag item contains: collapse chevron (when applicable), color dot or icon, tag name, unread indicator, and document count. Items indent 16px per nesting level, with a maximum depth of 4 levels for usability.

## Document Editor

The editor is where content comes to life. Like Bear, we provide a distraction-free writing environment. Like Notion, we support blocks and embedded widgets. The result is a canvas that adapts to your content.

### Editor Specifications

- **Max Width:** 720px centered, with 48px side padding
- **Title Field:** 28px Georgia, placeholder 'Untitled' in Mist color
- **Body Text:** 16px Inter, #2C2C2C, line-height 1.6
- **Block Spacing:** 16px between paragraphs, 24px before headings
- **Selection Color:** Maple Light at 30% opacity
- **Cursor Color:** Maple (#C75B39)

### Floating Toolbar

Text selection reveals a floating toolbar with formatting options. The toolbar appears above the selection with a subtle shadow and 8px border radius. Actions include: bold, italic, strikethrough, link, highlight, and block type selector.

## Chat Interface

Each tag has an associated chat, providing a space for conversation alongside documents. The chat interface is clean and minimal, focusing on the message content rather than decorative elements.

| Property               | Specification                                                   |
| ---------------------- | --------------------------------------------------------------- |
| Message Bubble (Self)  | Maple at 10% opacity, right-aligned, 12px radius                |
| Message Bubble (Other) | White background, left-aligned, 12px radius                     |
| Avatar                 | 32px circle, initials or image, positioned left of message      |
| Timestamp              | 12px Inter, Mist color, grouped by day                          |
| Input Area             | White background, 1px Pearl border, 8px radius, 48px min height |
| Send Button            | Maple background, white arrow icon, 36px circle                 |

---

# Widget System

Widgets transform documents into living, interactive spaces. They embed seamlessly within the document flow, maintaining visual consistency while providing powerful functionality.

## Widget Design Principles

- **Contained:** Widgets live within a subtle rounded container (8px radius, 1px Pearl border)
- **Labeled:** Small type label in top-left corner indicates widget type
- **Interactive:** Hover reveals controls (minimize, configure, remove)
- **Responsive:** Widgets adapt to document width gracefully

## Widget Types

| Widget          | Visual Treatment                                                          |
| --------------- | ------------------------------------------------------------------------- |
| Audio Recorder  | Waveform visualization in Maple, recording time display, transcript below |
| Dropdown/Select | Clean dropdown with subtle border, checkmarks for multi-select            |
| Rating          | Star icons that fill with Sunset Gold on hover/selection                  |
| AI Summary      | Shimmering loading state, quoted-text styling with left Maple border      |
| Live Data       | Subtle pulse animation on refresh, clear data visualization               |

---

# Motion & Animation

Animation in Just Maple is purposeful and restrained. Motion should guide attention and provide feedback, never distract or delay. We follow the principle of 'invisible animation'—users should feel the interface respond, not watch it perform.

## Timing Tokens

| Token              | Value                            | Usage                                |
| ------------------ | -------------------------------- | ------------------------------------ |
| `duration-instant` | 0ms                              | State changes with no transition     |
| `duration-fast`    | 100ms                            | Hover states, micro-interactions     |
| `duration-normal`  | 200ms                            | Most transitions, panel animations   |
| `duration-slow`    | 300ms                            | Complex animations, page transitions |
| `ease-out`         | `cubic-bezier(0.0, 0.0, 0.2, 1)` | Elements entering the screen         |
| `ease-in-out`      | `cubic-bezier(0.4, 0.0, 0.2, 1)` | Elements moving on screen            |

## Animation Guidelines

- Sidebar collapse uses 200ms ease-out for responsive feel
- Document transitions fade content (150ms) while sliding container (200ms)
- Hover states transition at 100ms for immediate feedback
- Modal dialogs scale from 95% with 150ms ease-out
- Toast notifications slide in from bottom-right with 200ms timing

---

# Dark Mode

Dark mode isn't simply inverted colors—it's a carefully calibrated palette that maintains warmth while reducing eye strain. Inspired by Bear's excellent dark theme, we preserve the organic feel while optimizing for low-light conditions.

| Element        | Light Mode       | Dark Mode |
| -------------- | ---------------- | --------- |
| Background     | #FAF8F5 (Cream)  | #1C1C1E   |
| Surface        | #FFFFFF          | #2C2C2E   |
| Elevated       | #FFFFFF + shadow | #3C3C3E   |
| Primary Text   | #2C2C2C          | #F5F5F5   |
| Secondary Text | #6B6B6B          | #A0A0A0   |
| Accent         | #C75B39 (Maple)  | #E07A5F   |
| Border         | #E5E5E5          | #404040   |

## Dark Mode Guidelines

- Never use pure black (#000000)—it creates harsh contrast
- Maple accent shifts slightly warmer to maintain vibrancy on dark surfaces
- Elevation is indicated by lighter backgrounds, not shadows
- Text maintains 7:1 contrast ratio for accessibility

---

# Responsive Design

Just Maple adapts gracefully from desktop to mobile, with native apps (RedSunsetMaple) wrapping the shared web UI (SugarMaple). Each breakpoint considers not just screen size, but interaction patterns and context of use.

| Breakpoint | Range       | Layout                                     |
| ---------- | ----------- | ------------------------------------------ |
| Mobile     | < 640px     | Single column, overlay sidebar, bottom nav |
| Tablet     | 640–1024px  | Collapsible sidebar, full-width editor     |
| Desktop    | 1024–1440px | Fixed sidebar, centered editor             |
| Wide       | > 1440px    | Sidebar + editor + panel (split view)      |

## Mobile Adaptations

- Sidebar becomes full-screen overlay with gesture dismissal
- Bottom navigation bar for primary actions (new note, search, settings)
- Editor expands to full width with reduced side padding (16px)
- Floating toolbar becomes fixed bottom bar during selection
- Swipe gestures for navigation: left for sidebar, right for chat

---

# Iconography

Icons use a consistent stroke-based style at 1.5px weight, rendered at 20px for UI elements and 24px for primary actions. We use Lucide icons as our foundation, customized where needed to match our warmer aesthetic.

| Category   | Icons                                               |
| ---------- | --------------------------------------------------- |
| Navigation | Home, Folder, File, ChevronRight, ChevronDown, Menu |
| Actions    | Plus, Edit, Trash, Search, Settings, MoreHorizontal |
| Formatting | Bold, Italic, Link, List, Quote, Code               |
| Status     | Check, AlertCircle, Loader, Wifi, WifiOff, Cloud    |
| Media      | Mic, Play, Pause, Volume, Image, Paperclip          |

---

# Accessibility

Just Maple is designed to be usable by everyone. We follow WCAG 2.1 AA guidelines and go beyond compliance to create a genuinely inclusive experience.

## Key Commitments

| Area                | Commitment                                                    |
| ------------------- | ------------------------------------------------------------- |
| Color Contrast      | 4.5:1 for body text, 3:1 for large text and UI components     |
| Keyboard Navigation | Full app functionality via keyboard, visible focus indicators |
| Screen Readers      | Semantic HTML, ARIA labels, live regions for dynamic content  |
| Motion              | Respect prefers-reduced-motion, pause/stop for animations     |
| Touch Targets       | Minimum 44x44px for all interactive elements                  |
| Text Scaling        | Support up to 200% zoom without horizontal scrolling          |

---

# Implementation Notes

This design system is implemented across three codebases: SugarMaple (Angular web app), RedSunsetMaple (Swift native shell), and eventually Android. The shared TypeBox schemas in @maple/shared ensure consistency, while CSS custom properties enable runtime theming.

Design tokens are exported as CSS variables, Tailwind config, and Swift asset catalogs. This single source of truth ensures visual consistency regardless of platform.

**Remember:** The best interface is one that disappears. Every pixel should serve the user's goals, not our ego. When in doubt, simplify.

---

_Just Maple Design System v1.0 — Made with care by the Maple team_
