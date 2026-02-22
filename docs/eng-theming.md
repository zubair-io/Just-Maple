# Theming & Design Tokens

This guide covers Just Maple's theming system: design tokens, available themes, how theme switching works, and how to write theme-aware components.

---

## Architecture

Theming is powered by **CSS custom properties** (design tokens) defined in `styles.scss` and a **ThemeService** that applies theme classes to `<html>`.

```
styles.scss          ThemeService              Components
┌──────────────┐     ┌─────────────────┐       ┌──────────────────┐
│ @theme {     │     │ setTheme('dark')│       │ bg-[var(--color- │
│   --color-bg │────>│ html.classList  │──────>│    bg)]           │
│   --color-*  │     │   .add('dark')  │       │                  │
│ }            │     │ localStorage    │       │ var(--color-text- │
│              │     │   persist       │       │    main)          │
│ .dark {      │     └─────────────────┘       └──────────────────┘
│   --color-bg │
│ }            │
└──────────────┘
```

---

## Design Tokens

All tokens are defined in the `@theme {}` block in `styles.scss`. Each theme overrides a subset of these tokens.

### Core Tokens

These tokens **must** be overridden by every theme:

| Token                   | Light Value        | Purpose                                         |
| ----------------------- | ------------------ | ----------------------------------------------- |
| `--color-primary`       | `#993629`          | Primary brand color (buttons, links, accents)   |
| `--color-primary-hover` | `#7a2b21`          | Primary hover state                             |
| `--color-primary-light` | `#f5e6e4`          | Tinted background for primary highlights        |
| `--color-bg`            | `#fdfbf7`          | Page background                                 |
| `--color-surface`       | `#ffffff`          | Card/panel background                           |
| `--color-surface-alt`   | `#f5f2eb`          | Alternate surface (e.g., code blocks, sidebars) |
| `--color-surface-hover` | `#f5f5f4`          | Surface hover state                             |
| `--color-sidebar`       | `#f5f2eb`          | Sidebar background                              |
| `--color-input-bg`      | `#ffffff`          | Form input background                           |
| `--color-bg-hover`      | `rgba(0,0,0,0.06)` | Generic hover overlay                           |
| `--color-bg-active`     | `rgba(0,0,0,0.1)`  | Generic active/pressed overlay                  |
| `--color-bg-secondary`  | `#f5f2eb`          | Secondary background (headers, footers)         |
| `--color-text-main`     | `#292524`          | Primary text                                    |
| `--color-text-muted`    | `#78716c`          | Secondary/muted text                            |
| `--color-border`        | `#e7e5e4`          | Borders and dividers                            |

### Semantic Tokens

Used for status indicators. Only `--color-status-*` are overridden in dark mode:

| Token                | Value     | Purpose            |
| -------------------- | --------- | ------------------ |
| `--color-error`      | `#dc3545` | Error text/icons   |
| `--color-error-bg`   | `#f8d7da` | Error background   |
| `--color-success`    | `#28a745` | Success text/icons |
| `--color-success-bg` | `#d4edda` | Success background |
| `--color-info`       | `#007bff` | Info text/icons    |
| `--color-info-bg`    | `#e7f3ff` | Info background    |

### API-specific Tokens

Used in JSON page API testing UI:

| Token                         | Value     | Purpose                     |
| ----------------------------- | --------- | --------------------------- |
| `--color-method-get`          | `#22c55e` | GET method badge            |
| `--color-method-post`         | `#3b82f6` | POST method badge           |
| `--color-method-put`          | `#f59e0b` | PUT method badge            |
| `--color-method-patch`        | `#a855f7` | PATCH method badge          |
| `--color-method-delete`       | `#ef4444` | DELETE method badge         |
| `--color-status-success-bg`   | `#dcfce7` | 2xx response background     |
| `--color-status-success-text` | `#166534` | 2xx response text           |
| `--color-status-error-bg`     | `#fee2e2` | 4xx/5xx response background |
| `--color-status-error-text`   | `#991b1b` | 4xx/5xx response text       |

### Typography Tokens

| Token          | Value                                | Purpose              |
| -------------- | ------------------------------------ | -------------------- |
| `--font-sans`  | `'Lato', -apple-system, ...`         | Default body/UI font |
| `--font-serif` | `'Merriweather', Georgia, ...`       | Editor headings      |
| `--font-mono`  | `'JetBrains Mono', 'Fira Code', ...` | Code blocks          |

### Shadow Tokens

| Token             | Value             | Purpose                 |
| ----------------- | ----------------- | ----------------------- |
| `--shadow-soft`   | `0 2px 8px ...`   | Subtle card elevation   |
| `--shadow-lifted` | `0 10px 30px ...` | Modals, floating panels |

### Legacy Tokens

These map to the same values as core tokens and exist for backwards compatibility. Prefer the core tokens in new code:

| Legacy                | Maps to                                          |
| --------------------- | ------------------------------------------------ |
| `--color-maple`       | `--color-primary` (original maple red `#d94e3b`) |
| `--color-maple-light` | `--color-primary-light`                          |
| `--color-maple-hover` | `--color-primary-hover`                          |
| `--color-charcoal`    | `--color-text-main`                              |
| `--color-warm-gray`   | `--color-text-muted`                             |
| `--color-mist`        | lighter muted text                               |
| `--color-pearl`       | `--color-border`                                 |
| `--color-cream`       | `--color-bg`                                     |
| `--color-snow`        | `--color-surface`                                |

---

## Available Themes

| Theme ID    | CSS Class                     | Primary Color          | Description            |
| ----------- | ----------------------------- | ---------------------- | ---------------------- |
| `light`     | _(default, no class)_         | Maple Red `#993629`    | Default light theme    |
| `dark`      | `.dark`                       | Maple Red `#993629`    | Dark mode              |
| `solarized` | `.theme-solarized`            | Gold `#b58900`         | Warm, low-contrast     |
| `warm`      | `.theme-warm`                 | Burnt Orange `#c2410c` | Cozy earth tones       |
| `cool`      | `.theme-cool`                 | Blue `#2563eb`         | Calm blue-grey         |
| `rose`      | `.theme-rose`                 | Pink `#db2777`         | Soft pink aesthetic    |
| `forest`    | `.theme-forest`               | Green `#16a34a`        | Nature-inspired greens |
| `system`    | _(resolves to light or dark)_ | --                     | Follows OS preference  |

### Dark Mode Token Values

Dark mode inherits `--color-primary` from the default theme and overrides surfaces, text, and borders:

| Token                         | Dark Value               | Notes                               |
| ----------------------------- | ------------------------ | ----------------------------------- |
| `--color-bg`                  | `#1c1917`                | Stone 950                           |
| `--color-surface`             | `#262524`                | Slightly lighter than bg            |
| `--color-surface-alt`         | `#2e2c2a`                | Cards, code blocks                  |
| `--color-surface-hover`       | `#3a3836`                | Hover state on surfaces             |
| `--color-sidebar`             | `#292524`                | Matches stone 900                   |
| `--color-input-bg`            | `#1c1917`                | Same as bg                          |
| `--color-text-main`           | `#e7e5e4`                | Stone 200 (inverted from light)     |
| `--color-text-muted`          | `#a8a29e`                | Stone 400                           |
| `--color-border`              | `#44403c`                | Stone 700                           |
| `--color-primary-light`       | `#422016`                | Dark tinted red                     |
| `--color-bg-hover`            | `rgba(255,255,255,0.1)`  | White overlay (inverted from light) |
| `--color-bg-active`           | `rgba(255,255,255,0.15)` | White overlay                       |
| `--color-bg-secondary`        | `#292524`                | Headers, footers                    |
| `--color-status-success-bg`   | `rgba(34,197,94,0.2)`    | Transparent green                   |
| `--color-status-success-text` | `#4ade80`                | Bright green                        |
| `--color-status-error-bg`     | `rgba(239,68,68,0.2)`    | Transparent red                     |
| `--color-status-error-text`   | `#f87171`                | Bright red                          |

Scrollbar thumbs also adapt in dark mode:

```scss
.dark ::-webkit-scrollbar-thumb {
    background-color: rgba(168, 162, 158, 0.2);
}

.dark ::-webkit-scrollbar-thumb:hover {
    background-color: rgba(168, 162, 158, 0.4);
}
```

---

## ThemeService

Located at `services/theme.service.ts`. Manages theme selection, persistence, and DOM application.

### Key signals

| Signal              | Type                     | Purpose                                          |
| ------------------- | ------------------------ | ------------------------------------------------ |
| `currentThemeId`    | `Signal<ThemeId>`        | User's selected theme (may be `'system'`)        |
| `effectiveThemeId`  | `Signal<AppliedThemeId>` | Resolved theme applied to DOM (never `'system'`) |
| `systemPrefersDark` | `Signal<boolean>`        | OS dark mode preference                          |
| `isDarkTheme`       | `Signal<boolean>`        | Whether dark mode is active                      |
| `themes`            | `Theme[]`                | All available theme definitions                  |

### Methods

```typescript
// Set a theme (persists to localStorage)
themeService.setTheme('dark');
themeService.setTheme('system');

// Toggle between light and dark
themeService.toggleDarkMode();
```

### How it works

1. User calls `setTheme(id)` which updates `currentThemeId` signal
2. `effectiveThemeId` computed resolves `'system'` to `'light'` or `'dark'` based on OS preference
3. An `effect()` calls `applyTheme()` which:
    - Removes all theme classes from `<html>`
    - Adds the new class (`.dark`, `.theme-warm`, etc.)
    - Sets `data-theme` attribute
    - Updates `<meta name="theme-color">` for mobile browsers
4. Another `effect()` persists `currentThemeId` to `localStorage` (key: `maple-theme`)

### System theme

When `'system'` is selected, the service listens to `matchMedia('(prefers-color-scheme: dark)')` for OS changes and reactively updates `systemPrefersDark`.

---

## Using Tokens in Components

### Tailwind (preferred)

Use CSS variables in Tailwind utility classes:

```html
<!-- Background -->
<div class="bg-[var(--color-bg)]">
    <div class="bg-[var(--color-surface)]">
        <!-- Text -->
        <span class="text-[var(--color-text-main)]">Primary text</span>
        <span class="text-[var(--color-text-muted)]">Secondary text</span>

        <!-- Borders -->
        <div class="border border-[var(--color-border)]">
            <!-- Primary button -->
            <button
                class="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white"
            >
                <!-- Hover states -->
                <div class="hover:bg-[var(--color-bg-hover)]"></div>
            </button>
        </div>
    </div>
</div>
```

### SCSS (when Tailwind can't express it)

Use `var()` in SCSS for pseudo-elements, animations, or complex selectors:

```scss
.my-element {
    &::before {
        background: var(--color-primary);
    }

    &:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
    }
}
```

### Conditional dark mode styles

For styles that can't be expressed with tokens alone (e.g., different images, inverted filters):

```scss
// In component SCSS
:host-context(.dark) {
    .icon {
        filter: invert(1);
    }
}
```

Or in templates:

```html
@if (themeService.isDarkTheme()) {
<img src="logo-dark.svg" />
} @else {
<img src="logo-light.svg" />
}
```

---

## Adding a New Theme

1. **Define the theme metadata** in `theme.service.ts`:

```typescript
const THEMES: Theme[] = [
    // ...existing themes...
    {
        id: 'ocean',
        name: 'Ocean',
        description: 'Deep sea blues',
        icon: 'water',
        preview: { bg: '#0f172a', surface: '#1e293b', primary: '#0ea5e9', text: '#e2e8f0' },
    },
];
```

2. **Add the `ThemeId`** union type:

```typescript
export type ThemeId /* ... */ = 'ocean';
```

3. **Define CSS variables** in `styles.scss`:

```scss
.theme-ocean,
[data-theme='ocean'] {
    --color-primary: #0ea5e9;
    --color-primary-hover: #0284c7;
    --color-primary-light: #f0f9ff;
    --color-bg: #0f172a;
    --color-surface: #1e293b;
    --color-surface-alt: #334155;
    --color-surface-hover: #334155;
    --color-sidebar: #1e293b;
    --color-input-bg: #0f172a;
    --color-text-main: #e2e8f0;
    --color-text-muted: #94a3b8;
    --color-border: #334155;
    --color-bg-hover: rgba(255, 255, 255, 0.1);
    --color-bg-active: rgba(255, 255, 255, 0.15);
    --color-bg-secondary: #1e293b;

    /* Legacy */
    --color-maple: #0ea5e9;
    --color-maple-light: #f0f9ff;
    --color-maple-hover: #0284c7;
    --color-charcoal: #e2e8f0;
    --color-warm-gray: #94a3b8;
    --color-cream: #0f172a;
    --color-snow: #1e293b;
    --color-pearl: #334155;
}
```

4. **Add the class to `applyTheme()`** in `theme.service.ts`:

```typescript
html.classList.remove(
    'dark',
    'theme-solarized',
    'theme-warm',
    'theme-cool',
    'theme-rose',
    'theme-forest',
    'theme-ocean', // add here
);
```

5. The settings page automatically shows all themes from `ThemeService.themes`.

---

## Do / Don't

| Do                                             | Don't                                     |
| ---------------------------------------------- | ----------------------------------------- |
| Use `var(--color-*)` tokens for all colors     | Hardcode hex colors like `#292524`        |
| Use `--color-text-main` for primary text       | Use Tailwind's built-in `text-gray-800`   |
| Use `--color-bg` for page backgrounds          | Use `bg-white` (breaks in dark mode)      |
| Use `--color-surface` for cards/panels         | Use `bg-gray-50`                          |
| Use `--color-border` for all borders           | Use `border-gray-200`                     |
| Use `--color-bg-hover` for hover overlays      | Use `hover:bg-gray-100`                   |
| Use `--color-primary` for brand elements       | Use `--color-maple` (legacy)              |
| Use `:host-context(.dark)` for dark-only SCSS  | Use `@media (prefers-color-scheme: dark)` |
| Override only the tokens that change per theme | Duplicate all styles per theme            |
| Let `ThemeService` manage DOM classes          | Manually toggle `.dark` on `<html>`       |

---

## Token Quick Reference

For quick copy-paste in Tailwind templates:

```
Background:      bg-[var(--color-bg)]
Surface:         bg-[var(--color-surface)]
Surface alt:     bg-[var(--color-surface-alt)]
Surface hover:   bg-[var(--color-surface-hover)]  or  hover:bg-[var(--color-bg-hover)]
Sidebar:         bg-[var(--color-sidebar)]
Input:           bg-[var(--color-input-bg)]

Text primary:    text-[var(--color-text-main)]
Text secondary:  text-[var(--color-text-muted)]

Border:          border-[var(--color-border)]

Primary:         bg-[var(--color-primary)]
Primary hover:   hover:bg-[var(--color-primary-hover)]
Primary tint:    bg-[var(--color-primary-light)]

Error:           text-[var(--color-error)]
Success:         text-[var(--color-success)]
Info:            text-[var(--color-info)]
```
