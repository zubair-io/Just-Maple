# Just Maple Style Guide

A practical reference for building consistent UI in Just Maple. For the full design system specification, see [`designs/Just_Maple_Design_System.md`](../designs/Just_Maple_Design_System.md).

---

## Design Philosophy

1. **Warmth Over Coldness** — Soft edges, warm colors, organic shapes
2. **Quiet Confidence** — UI recedes during focus, controls appear when needed
3. **Progressive Disclosure** — Simple by default, powerful when explored
4. **Spatial Consistency** — Predictable element placement, drag-and-drop confidence
5. **Living Documents** — Documents breathe with widgets and respond to context

---

## Color Palette

All colors are CSS custom properties defined in `styles.scss` via Tailwind's `@theme` directive. Never hardcode hex values in components.

### Primary

| Token                   | Value     | Usage                          |
| ----------------------- | --------- | ------------------------------ |
| `--color-primary`       | `#993629` | Primary actions, active states |
| `--color-primary-hover` | `#7a2b21` | Hover states                   |
| `--color-primary-light` | `#f5e6e4` | Selection backgrounds          |

### Backgrounds

| Token                   | Value     | Usage                           |
| ----------------------- | --------- | ------------------------------- |
| `--color-bg`            | `#fdfbf7` | Page background (Cream)         |
| `--color-surface`       | `#ffffff` | Elevated surfaces, cards        |
| `--color-surface-alt`   | `#f5f2eb` | Secondary surfaces, inline code |
| `--color-surface-hover` | `#f5f5f4` | Hover state on surfaces         |
| `--color-sidebar`       | `#f5f2eb` | Sidebar background              |
| `--color-input-bg`      | `#ffffff` | Input field backgrounds         |

### Text & Borders

| Token                | Value     | Usage                        |
| -------------------- | --------- | ---------------------------- |
| `--color-text-main`  | `#292524` | Primary text, headings       |
| `--color-text-muted` | `#78716c` | Secondary text, placeholders |
| `--color-border`     | `#e7e5e4` | Borders, dividers            |

### Semantic

| Token                | Value     | Usage         |
| -------------------- | --------- | ------------- |
| `--color-error`      | `#dc3545` | Error states  |
| `--color-error-bg`   | `#f8d7da` | Error bg      |
| `--color-success`    | `#28a745` | Success       |
| `--color-success-bg` | `#d4edda` | Success bg    |
| `--color-info`       | `#007bff` | Informational |
| `--color-info-bg`    | `#e7f3ff` | Info bg       |

### Usage Rules

- Use `--color-primary` sparingly — draw the eye to what matters
- Reserve `--color-surface` for elevated elements; `--color-bg` for large areas
- Text must maintain **4.5:1 contrast ratio** minimum (WCAG AA)

---

## Typography

### Font Stacks

| Token          | Font                    | Usage               |
| -------------- | ----------------------- | ------------------- |
| `--font-sans`  | Lato + system fallbacks | Headings, UI text   |
| `--font-serif` | Merriweather, Georgia   | Editor body content |
| `--font-mono`  | JetBrains Mono          | Code blocks         |

### Type Scale

| Element       | Font  | Size     | Weight | Line Height |
| ------------- | ----- | -------- | ------ | ----------- |
| H1 (global)   | Sans  | 2.5rem   | 600    | 1.2         |
| H2 (global)   | Sans  | 2rem     | 600    | 1.2         |
| H3 (global)   | Sans  | 1.5rem   | 600    | 1.3         |
| H1 (editor)   | Sans  | 1.75rem  | 600    | 1.2         |
| H2 (editor)   | Sans  | 1.375rem | 600    | 1.3         |
| H3 (editor)   | Sans  | 1.125rem | 600    | 1.3         |
| Body (editor) | Serif | 0.9rem   | 400    | 1.65        |
| Inline code   | Mono  | 0.875em  | 400    | —           |
| Code block    | Mono  | 0.875rem | 400    | —           |

### Guidelines

- Headings: Lato (sans-serif) for clarity at all sizes
- Editor body: Merriweather (serif) for comfortable long-form reading
- Line height of **1.65** for body text
- Paragraph spacing: `margin-bottom: 0.75rem` (no indentation)

---

## Spacing

Based on a **4px grid**. Use Tailwind spacing utilities exclusively.

| Class             | Value | Usage                             |
| ----------------- | ----- | --------------------------------- |
| `p-1` / `gap-1`   | 4px   | Icon padding, tight grouping      |
| `p-2` / `gap-2`   | 8px   | Related elements, inline padding  |
| `p-3` / `gap-3`   | 12px  | Compact padding, small components |
| `p-4` / `gap-4`   | 16px  | Standard padding, buttons         |
| `p-6` / `gap-6`   | 24px  | Section spacing, card padding     |
| `p-8` / `gap-8`   | 32px  | Major section breaks              |
| `p-12` / `gap-12` | 48px  | Page-level spacing                |

- Prefer `gap-*` with flexbox/grid over individual margin utilities
- Editor content: `max-width: 720px`, centered

---

## Shadows

| Token             | Usage                      |
| ----------------- | -------------------------- |
| `--shadow-soft`   | Cards, subtle elevation    |
| `--shadow-lifted` | Modals, popovers, tooltips |

---

## Iconography

**Material Symbols Rounded** via the `ui-icon` component.

```html
<ui-icon name="settings" size="md" />
```

### Sizes

| Size | Class       | Usage                       |
| ---- | ----------- | --------------------------- |
| `xs` | `text-sm`   | Inline with small text      |
| `sm` | `text-base` | Secondary actions, metadata |
| `md` | `text-lg`   | Default UI elements         |
| `lg` | `text-xl`   | Primary actions, emphasis   |
| `xl` | `text-2xl`  | Hero elements, empty states |

---

## Theming

Switched via CSS class or `data-theme` attribute on the root element.

### Light (Default)

No class needed — this is the default theme.

| Token                   | Value     | Description              |
| ----------------------- | --------- | ------------------------ |
| `--color-primary`       | `#993629` | Maple Red                |
| `--color-primary-hover` | `#7a2b21` | Darker maple             |
| `--color-primary-light` | `#f5e6e4` | Subtle primary highlight |
| `--color-bg`            | `#fdfbf7` | Cream page background    |
| `--color-surface`       | `#ffffff` | Cards, elevated surfaces |
| `--color-surface-alt`   | `#f5f2eb` | Secondary surfaces       |
| `--color-sidebar`       | `#f5f2eb` | Sidebar background       |
| `--color-text-main`     | `#292524` | Charcoal primary text    |
| `--color-text-muted`    | `#78716c` | Secondary text           |
| `--color-border`        | `#e7e5e4` | Borders and dividers     |

**Character**: Warm, organic, earthy — inspired by autumn maple leaves.

### Dark

Activated with `.dark` class or `[data-theme='dark']`.

| Token                | Value     | Description          |
| -------------------- | --------- | -------------------- |
| `--color-primary`    | `#993629` | Maple Red (same)     |
| `--color-bg`         | `#1c1917` | Very dark warm brown |
| `--color-surface`    | `#262524` | Elevated surfaces    |
| `--color-text-main`  | `#e7e5e4` | Light text           |
| `--color-text-muted` | `#a8a29e` | Muted light text     |

**Character**: Warm dark tones — never pure black.

### Theme Rules

- Components never need theme-specific logic — CSS variables handle everything
- Dark mode uses **lighter backgrounds for elevation** instead of shadows
- Never use pure black (`#000000`) in dark mode — it creates harsh contrast
- Accent colors shift slightly to maintain vibrancy on dark surfaces
- Text maintains **4.5:1+** contrast across both themes

---

## Component Library

All components are **standalone Angular components** following atomic design.

### Atoms

| Component      | Selector             | Purpose                             |
| -------------- | -------------------- | ----------------------------------- |
| Button         | `ui-button`          | Primary, secondary, outline actions |
| Input          | `ui-input`           | Text input with CVA support         |
| Icon           | `ui-icon`            | Material Symbols wrapper            |
| Profile Avatar | `app-profile-avatar` | User avatar with initials fallback  |
| Toast          | `app-toast`          | Notification with type styling      |
| Divider        | `ui-divider`         | Separator with optional text        |

### Molecules

| Component         | Selector                  | Purpose                           |
| ----------------- | ------------------------- | --------------------------------- |
| Form Field        | `ui-form-field`           | Label + input + error wrapper     |
| Dialog            | `app-dialog`              | Modal (confirm, prompt, alert)    |
| Avatar Group      | `app-member-avatar-group` | Overlapping avatars with overflow |
| Todo Popover      | `app-todo-popover`        | Task attribute editor             |
| Bubble Menu       | `app-editor-bubble-menu`  | Floating text formatting toolbar  |
| Offline Indicator | `app-offline-indicator`   | Connection status banner          |

### Organisms

| Component       | Selector              | Purpose                    |
| --------------- | --------------------- | -------------------------- |
| Sidebar         | `app-sidebar`         | Primary navigation (280px) |
| Notebook Editor | `app-notebook-editor` | TipTap rich text editor    |
| Chat            | `app-chat`            | Real-time messaging        |
| Search Modal    | `app-search-modal`    | Global search (Cmd+K)      |

### Selector Prefixes

- `ui-` — Design system components (reusable across projects)
- `app-` — Application-specific components

---

## Styling Approach

### Tailwind First

```html
<button
    class="px-4 py-3 rounded-lg bg-[var(--color-primary)] text-white
           hover:bg-[var(--color-primary-hover)] transition-all duration-200"
>
    Click me
</button>
```

### When to Use SCSS

Only for:

- Complex animations
- `::before` / `::after` pseudo-elements
- Styles that can't be expressed in Tailwind

### Never

- Inline styles in templates
- Hardcoded color values
- Custom CSS when Tailwind suffices

---

## Motion & Animation

Animation is purposeful and restrained — guides attention, never distracts.

### Timing

| Duration | Value | Usage                                |
| -------- | ----- | ------------------------------------ |
| Instant  | 0ms   | State changes, no transition         |
| Fast     | 100ms | Hover states, micro-interactions     |
| Normal   | 200ms | Most transitions, panel animations   |
| Slow     | 300ms | Complex animations, page transitions |

### Easing

| Curve         | Usage                        |
| ------------- | ---------------------------- |
| `ease-out`    | Elements entering the screen |
| `ease-in-out` | Elements moving on screen    |

### Common Patterns

- Sidebar collapse: 200ms ease-out
- Hover states: 100ms immediate
- Modal dialogs: Scale 95% with 150ms ease-out
- Toast notifications: slideIn 0.3s ease-out
- Button hover: `-translate-y-0.5` lift, 200ms

---

## Responsive Design

| Breakpoint | Tailwind | Range       | Layout                           |
| ---------- | -------- | ----------- | -------------------------------- |
| Mobile     | default  | < 640px     | Single column, overlay sidebar   |
| Tablet     | `sm:`    | 640–1024px  | Collapsible sidebar, full editor |
| Desktop    | `lg:`    | 1024–1440px | Fixed sidebar, centered editor   |
| Wide       | `xl:`    | > 1440px    | Sidebar + editor + panel         |

### Mobile Adaptations

- Sidebar becomes full-screen overlay with gesture dismissal
- Editor expands to full width (16px side padding)
- Floating toolbar becomes fixed bottom bar
- Touch targets: minimum **44x44px**

---

## Accessibility

| Area             | Standard                                                |
| ---------------- | ------------------------------------------------------- |
| Color Contrast   | 4.5:1 body text, 3:1 large text and UI components       |
| Keyboard         | Full functionality, visible 2px focus rings             |
| Screen Readers   | Semantic HTML, ARIA labels, live regions                |
| Touch Targets    | Minimum 44x44px                                         |
| Text Scaling     | Support up to 200% zoom without horizontal scroll       |
| Focus Indicators | 2px ring `--color-primary`, offset 2px                  |
| Dialogs          | Escape to cancel, Enter to confirm, backdrop to dismiss |

---

## Scrollbar Styling

- **Width**: 8px
- **Track**: Transparent
- **Thumb**: `rgba(120, 113, 108, 0.2)`, 4px radius
- **Thumb hover**: `rgba(120, 113, 108, 0.4)`
- **Dark mode**: `rgba(168, 162, 158, 0.2)`, hover `0.4`

---

## Quick Reference

| Do                                    | Don't                             |
| ------------------------------------- | --------------------------------- |
| Use Tailwind utility classes          | Write custom CSS unless necessary |
| Reference CSS variables for colors    | Hardcode hex values in components |
| Use `ui-icon` for icons               | Import icon libraries directly    |
| Follow atomic design hierarchy        | Mix component abstraction levels  |
| Use signals for component state       | Use BehaviorSubject in components |
| Separate template, style, logic files | Inline templates or styles        |
| Use `input()` / `output()` functions  | Use decorators for inputs/outputs |
| Ensure 4.5:1 contrast ratio           | Use low-contrast text             |
| Minimum 44x44px touch targets         | Use tiny interactive elements     |
| Animate with purpose (100–300ms)      | Add gratuitous animations         |
