# Just Maple Theme Reference

_Light and Dark theme tokens as implemented in `styles.scss`._

**Version 2.0 — February 2025**

---

## Theme Switching

Themes are applied via class and data attribute on `<html>`:

- **Light (default):** No class needed
- **Dark:** `class="dark"` + `data-theme="dark"`

Persisted to `localStorage` under key `maple-theme`. System preference is respected via `prefers-color-scheme: dark`.

---

## Color Tokens

### Primary

| Token                   | Light     | Dark      | Usage                                  |
| ----------------------- | --------- | --------- | -------------------------------------- |
| `--color-primary`       | `#993629` | `#993629` | Buttons, links, active states          |
| `--color-primary-hover` | `#7a2b21` | `#7a2b21` | Hover on primary actions               |
| `--color-primary-light` | `#f5e6e4` | `#422016` | Subtle primary backgrounds, highlights |

### Backgrounds

| Token                   | Light              | Dark                     | Usage                         |
| ----------------------- | ------------------ | ------------------------ | ----------------------------- |
| `--color-bg`            | `#fdfbf7`          | `#1c1917`                | Page background               |
| `--color-surface`       | `#ffffff`          | `#262524`                | Cards, panels, elevated areas |
| `--color-surface-alt`   | `#f5f2eb`          | `#2e2c2a`                | Alternate surface, sidebar    |
| `--color-surface-hover` | `#f5f5f4`          | `#3a3836`                | Surface hover state           |
| `--color-sidebar`       | `#f5f2eb`          | `#292524`                | Sidebar background            |
| `--color-input-bg`      | `#ffffff`          | `#1c1917`                | Input fields                  |
| `--color-bg-hover`      | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.1)`  | Generic hover overlay         |
| `--color-bg-active`     | `rgba(0,0,0,0.1)`  | `rgba(255,255,255,0.15)` | Active/pressed overlay        |
| `--color-bg-secondary`  | `#f5f2eb`          | `#292524`                | Secondary content areas       |

### Text

| Token                | Light     | Dark      | Usage                        |
| -------------------- | --------- | --------- | ---------------------------- |
| `--color-text-main`  | `#292524` | `#e7e5e4` | Primary text, headings       |
| `--color-text-muted` | `#78716c` | `#a8a29e` | Secondary text, placeholders |

### Borders

| Token            | Light     | Dark      | Usage                   |
| ---------------- | --------- | --------- | ----------------------- |
| `--color-border` | `#e7e5e4` | `#44403c` | Dividers, input borders |

### Semantic

| Token                | Light     | Dark      | Usage           |
| -------------------- | --------- | --------- | --------------- |
| `--color-error`      | `#dc3545` | `#dc3545` | Error states    |
| `--color-error-bg`   | `#f8d7da` | `#f8d7da` | Error banners   |
| `--color-success`    | `#28a745` | `#28a745` | Success states  |
| `--color-success-bg` | `#d4edda` | `#d4edda` | Success banners |
| `--color-info`       | `#007bff` | `#007bff` | Info states     |
| `--color-info-bg`    | `#e7f3ff` | `#e7f3ff` | Info banners    |

---

## Legacy Aliases

These map to the same values as their modern equivalents. Kept for backwards compatibility.

| Legacy Token          | Light     | Dark      | Maps To              |
| --------------------- | --------- | --------- | -------------------- |
| `--color-maple`       | `#d94e3b` | `#d94e3b` | Brand red (original) |
| `--color-maple-light` | `#fbeae5` | `#fbeae5` | —                    |
| `--color-maple-hover` | `#b93826` | `#b93826` | —                    |
| `--color-charcoal`    | `#292524` | `#e7e5e4` | `--color-text-main`  |
| `--color-warm-gray`   | `#78716c` | `#a8a29e` | `--color-text-muted` |
| `--color-mist`        | `#a8a29e` | `#a8a29e` | —                    |
| `--color-pearl`       | `#e7e5e4` | `#44403c` | `--color-border`     |
| `--color-cream`       | `#fdfbf7` | `#1c1917` | `--color-bg`         |
| `--color-snow`        | `#ffffff` | `#262524` | `--color-surface`    |

---

## Typography

| Token          | Value                                                                       | Usage             |
| -------------- | --------------------------------------------------------------------------- | ----------------- |
| `--font-sans`  | `'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | Body, UI          |
| `--font-serif` | `'Merriweather', Georgia, serif`                                            | Display headings  |
| `--font-mono`  | `'JetBrains Mono', 'Fira Code', monospace`                                  | Code, JSON editor |

---

## Shadows

| Token             | Value                                                              | Usage            |
| ----------------- | ------------------------------------------------------------------ | ---------------- |
| `--shadow-soft`   | `0 2px 8px -1px rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.02)` | Cards, dropdowns |
| `--shadow-lifted` | `0 10px 30px -5px rgba(0,0,0,0.08)`                                | Modals, popovers |

> In dark mode, elevation is conveyed by lighter backgrounds rather than shadows.

---

## Scrollbars

| State | Light                      | Dark                       |
| ----- | -------------------------- | -------------------------- |
| Thumb | `rgba(120, 113, 108, 0.2)` | `rgba(168, 162, 158, 0.2)` |
| Hover | `rgba(120, 113, 108, 0.4)` | `rgba(168, 162, 158, 0.4)` |

---

## Visual Comparison

### Light Theme

```
Background  ████████  #fdfbf7  (warm off-white)
Surface     ████████  #ffffff  (pure white)
Surface Alt ████████  #f5f2eb  (warm pearl)
Border      ████████  #e7e5e4  (soft gray)
Text Main   ████████  #292524  (warm charcoal)
Text Muted  ████████  #78716c  (warm gray)
Primary     ████████  #993629  (maple brown)
```

### Dark Theme

```
Background  ████████  #1c1917  (warm black)
Surface     ████████  #262524  (dark stone)
Surface Alt ████████  #2e2c2a  (medium stone)
Border      ████████  #44403c  (warm dark gray)
Text Main   ████████  #e7e5e4  (warm white)
Text Muted  ████████  #a8a29e  (mist)
Primary     ████████  #993629  (maple brown)
```

---

## Design Principles

1. **Never pure black** — Dark mode uses `#1c1917` (warm charcoal), not `#000000`
2. **Never pure white backgrounds** — Light mode uses `#fdfbf7` (warm cream)
3. **Primary stays constant** — `#993629` works on both themes
4. **Semantic colors are stable** — Error/success/info don't change between themes
5. **Overlays adapt** — Hover uses black overlay in light mode, white overlay in dark
6. **Warm undertones throughout** — Stone-based neutrals from the `stone` color scale

---

## Usage in Code

### Tailwind Classes

```html
<div class="bg-[var(--color-bg)] text-[var(--color-text-main)] border-[var(--color-border)]">
    <button class="bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]">
        Action
    </button>
    <p class="text-[var(--color-text-muted)]">Secondary text</p>
</div>
```

### SCSS

```scss
.component {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text-main);

    &:hover {
        background: var(--color-surface-hover);
    }
}
```

---

_Just Maple Theme Reference v2.0_
