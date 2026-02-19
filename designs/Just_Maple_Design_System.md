# Just Maple

## UI/UX Design System

_A design language for documents and conversations that feel like home. Inspired by the warmth of Bear and the clarity of Notion._

**Version 2.0 — February 2025**

---

# Design Philosophy

Just Maple is built on the belief that the best tools disappear into your workflow. We draw inspiration from Bear's singular focus on writing and Notion's structural clarity, combining them into something that feels both personal and powerful.

## Core Principles

1. **Warmth Over Coldness** — Soft edges, warm colors, and organic shapes create a space that feels inviting rather than clinical. Technology should feel like a craftsman's tool, not a sterile interface.

2. **Quiet Confidence** — The UI recedes when you're focused on content. Controls appear when needed and gracefully fade when not. Every element earns its place.

3. **Progressive Disclosure** — Simple by default, powerful when needed. Advanced features reveal themselves naturally as users explore, never overwhelming newcomers.

4. **Spatial Consistency** — Every element has a predictable home. Drag, drop, and rearrange with confidence. The interface respects your mental model.

5. **Living Documents** — Documents aren't static. They breathe with widgets, respond to context, and evolve with your thinking. Content and computation interweave seamlessly.

---

# Visual Identity

## Color Palette

Our palette draws from autumn maple leaves — warm, inviting, and grounded. All colors are defined as CSS custom properties in `styles.scss` using Tailwind's `@theme` directive, enabling runtime theming across all components.

### Primary Colors

| Token                   | Value     | Usage                                            |
| ----------------------- | --------- | ------------------------------------------------ |
| `--color-primary`       | `#993629` | Primary actions, active states, accent borders   |
| `--color-primary-hover` | `#7a2b21` | Hover states on primary elements                 |
| `--color-primary-light` | `#f5e6e4` | Selection backgrounds, subtle primary highlights |

### Background Colors

| Token                   | Value                 | Usage                            |
| ----------------------- | --------------------- | -------------------------------- |
| `--color-bg`            | `#fdfbf7`             | Primary page background (Cream)  |
| `--color-surface`       | `#ffffff`             | Elevated surfaces, cards, inputs |
| `--color-surface-alt`   | `#f5f2eb`             | Secondary surfaces, inline code  |
| `--color-surface-hover` | `#f5f5f4`             | Hover state on surface elements  |
| `--color-sidebar`       | `#f5f2eb`             | Sidebar background               |
| `--color-input-bg`      | `#ffffff`             | Input field backgrounds          |
| `--color-bg-hover`      | `rgba(0, 0, 0, 0.06)` | Subtle hover overlay             |
| `--color-bg-active`     | `rgba(0, 0, 0, 0.1)`  | Active/pressed state overlay     |
| `--color-bg-secondary`  | `#f5f2eb`             | Secondary background areas       |

### Text Colors

| Token                | Value     | Usage                             |
| -------------------- | --------- | --------------------------------- |
| `--color-text-main`  | `#292524` | Primary text, headings (Charcoal) |
| `--color-text-muted` | `#78716c` | Secondary text, placeholders      |

### Border Colors

| Token            | Value     | Usage                         |
| ---------------- | --------- | ----------------------------- |
| `--color-border` | `#e7e5e4` | Borders, separators, dividers |

### Semantic Colors

| Token                | Value     | Usage                  |
| -------------------- | --------- | ---------------------- |
| `--color-error`      | `#dc3545` | Error states, alerts   |
| `--color-error-bg`   | `#f8d7da` | Error background       |
| `--color-success`    | `#28a745` | Success states         |
| `--color-success-bg` | `#d4edda` | Success background     |
| `--color-info`       | `#007bff` | Informational elements |
| `--color-info-bg`    | `#e7f3ff` | Info background        |

### Legacy Aliases

These map to the token system for backwards compatibility:

| Alias               | Maps To              |
| ------------------- | -------------------- |
| `--color-maple`     | `#d94e3b`            |
| `--color-charcoal`  | `--color-text-main`  |
| `--color-warm-gray` | `--color-text-muted` |
| `--color-mist`      | `#a8a29e`            |
| `--color-pearl`     | `--color-border`     |
| `--color-cream`     | `--color-bg`         |
| `--color-snow`      | `--color-surface`    |

### Color Usage Guidelines

- Use `--color-primary` sparingly — it should draw the eye to what matters most
- Reserve `--color-surface` for elevated elements; `--color-bg` adds warmth to large areas
- Never hardcode hex values in components — always reference CSS variables
- Text colors maintain a 4.5:1 contrast ratio minimum (WCAG AA)

---

## Typography

Typography balances readability with personality. We pair Lato (sans-serif) for UI and headings with Merriweather (serif) for editor content, and JetBrains Mono for code.

### Font Stacks

| Token          | Value                                                                       | Usage                  |
| -------------- | --------------------------------------------------------------------------- | ---------------------- |
| `--font-sans`  | `'Lato', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` | Headings, UI text      |
| `--font-serif` | `'Merriweather', Georgia, serif`                                            | Editor body content    |
| `--font-mono`  | `'JetBrains Mono', 'Fira Code', monospace`                                  | Code blocks, technical |

### Type Scale

#### Global Headings

| Element | Font          | Size    | Weight | Line Height |
| ------- | ------------- | ------- | ------ | ----------- |
| H1      | `--font-sans` | 2.5rem  | 600    | 1.2         |
| H2      | `--font-sans` | 2rem    | 600    | 1.2         |
| H3      | `--font-sans` | 1.5rem  | 600    | 1.3         |
| H4      | `--font-sans` | 1.25rem | 600    | 1.3         |

#### Editor Typography (ProseMirror)

| Element     | Font           | Size     | Weight | Line Height |
| ----------- | -------------- | -------- | ------ | ----------- |
| H1          | `--font-sans`  | 1.75rem  | 600    | 1.2         |
| H2          | `--font-sans`  | 1.375rem | 600    | 1.3         |
| H3          | `--font-sans`  | 1.125rem | 600    | 1.3         |
| Body (p)    | `--font-serif` | 0.9rem   | 400    | 1.65        |
| List items  | `--font-serif` | 0.9rem   | 400    | 1.65        |
| Blockquote  | `--font-serif` | 0.9rem   | 400    | 1.65        |
| Inline code | `--font-mono`  | 0.875em  | 400    | —           |
| Code block  | `--font-mono`  | 0.875rem | 400    | —           |

### Typography Guidelines

- Headings use Lato (sans-serif) for clarity at all sizes
- Editor body content uses Merriweather (serif) for comfortable long-form reading
- UI labels, buttons, and metadata use Lato
- Line height of 1.65 for body text ensures optimal readability
- Paragraph spacing (`margin-bottom: 0.75rem`) replaces indentation

---

## Spacing System

A consistent 4px base grid creates rhythmic harmony across all components. We use Tailwind's spacing scale.

| Tailwind Class    | Value | Usage                                         |
| ----------------- | ----- | --------------------------------------------- |
| `p-1` / `gap-1`   | 4px   | Icon padding, tight element grouping          |
| `p-2` / `gap-2`   | 8px   | Related element spacing, inline padding       |
| `p-3` / `gap-3`   | 12px  | Compact padding, small components             |
| `p-4` / `gap-4`   | 16px  | Standard padding, buttons, component internal |
| `p-6` / `gap-6`   | 24px  | Section spacing, card padding                 |
| `p-8` / `gap-8`   | 32px  | Major section breaks, large padding           |
| `p-12` / `gap-12` | 48px  | Page-level spacing                            |

### Spacing Guidelines

- Use Tailwind utility classes exclusively — never hardcode pixel values for spacing
- Prefer `gap-*` with flexbox/grid over individual margin utilities
- Editor content area uses `max-width: 720px` centered with side padding

---

## Shadows

| Token             | Value                                                              | Usage                      |
| ----------------- | ------------------------------------------------------------------ | -------------------------- |
| `--shadow-soft`   | `0 2px 8px -1px rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.02)` | Cards, subtle elevation    |
| `--shadow-lifted` | `0 10px 30px -5px rgba(0,0,0,0.08)`                                | Modals, popovers, tooltips |

---

# Theming

The application supports 7 themes via CSS custom properties, switched by applying a class or `data-theme` attribute to the root element.

## Available Themes

### Default (Light)

- **Class**: None (default)
- **Primary**: `#993629` (Maple Red)
- **Background**: `#fdfbf7` (Cream)
- **Character**: Warm, organic, earthy

### Dark

- **Class**: `.dark` or `[data-theme='dark']`
- **Background**: `#1c1917` (very dark warm brown)
- **Surface**: `#262524`
- **Text**: `#e7e5e4`
- **Character**: Warm dark tones, never pure black

### Solarized

- **Class**: `.theme-solarized` or `[data-theme='solarized']`
- **Primary**: `#b58900` (warm gold)
- **Background**: `#fdf6e3`
- **Character**: Low-contrast for extended reading

### Warm

- **Class**: `.theme-warm` or `[data-theme='warm']`
- **Primary**: `#c2410c` (burnt orange)
- **Background**: `#faf5f0`
- **Character**: Cozy earth tones

### Cool

- **Class**: `.theme-cool` or `[data-theme='cool']`
- **Primary**: `#2563eb` (blue)
- **Background**: `#f0f4f8`
- **Character**: Calm, professional blue-grey

### Rose

- **Class**: `.theme-rose` or `[data-theme='rose']`
- **Primary**: `#db2777` (rose pink)
- **Background**: `#fdf2f8`
- **Character**: Soft pink aesthetic

### Forest

- **Class**: `.theme-forest` or `[data-theme='forest']`
- **Primary**: `#16a34a` (green)
- **Background**: `#f0fdf4`
- **Character**: Nature-inspired greens

## Theme Guidelines

- Each theme overrides the same CSS variable set — components never need theme-specific logic
- Dark mode uses lighter backgrounds for elevation instead of shadows
- Never use pure black (`#000000`) in dark mode — it creates harsh contrast
- Accent colors shift slightly to maintain vibrancy on dark surfaces
- Text maintains 4.5:1+ contrast ratio across all themes

---

# Iconography

We use **Material Symbols Rounded** from Google Fonts, rendered via the `ui-icon` component.

## Icon Sizes

| Size | Tailwind Class | Usage                       |
| ---- | -------------- | --------------------------- |
| `xs` | `text-sm`      | Inline with small text      |
| `sm` | `text-base`    | Secondary actions, metadata |
| `md` | `text-lg`      | Default UI elements         |
| `lg` | `text-xl`      | Primary actions, emphasis   |
| `xl` | `text-2xl`     | Hero elements, empty states |

## Common Icons

| Category   | Icons                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Navigation | `home`, `folder`, `description`, `chevron_right`, `menu`                               |
| Actions    | `add`, `edit`, `delete`, `search`, `settings`, `more_horiz`                            |
| Formatting | `format_bold`, `format_italic`, `link`, `format_list_bulleted`, `format_quote`, `code` |
| Status     | `check`, `error`, `sync`, `wifi`, `wifi_off`, `cloud_done`                             |
| Media      | `mic`, `play_arrow`, `pause`, `volume_up`, `image`, `attach_file`                      |

## Usage

```html
<!-- Via component -->
<ui-icon name="settings" size="md" />

<!-- Direct HTML (when needed outside Angular) -->
<span class="material-symbols-rounded text-lg">settings</span>
```

---

# Component Library

All components are **standalone Angular components** following the atomic design methodology. They use Angular signals for state, `input()` / `output()` functions, and Tailwind + CSS variables for styling.

## Atoms

Foundational building blocks — single-purpose, highly reusable.

### `ui-button`

Versatile button with loading states and size variants.

| Input       | Type                                    | Default     |
| ----------- | --------------------------------------- | ----------- |
| `variant`   | `'primary' \| 'secondary' \| 'outline'` | `'primary'` |
| `size`      | `'sm' \| 'md' \| 'lg'`                  | `'md'`      |
| `type`      | `'button' \| 'submit' \| 'reset'`       | `'button'`  |
| `disabled`  | `boolean`                               | `false`     |
| `loading`   | `boolean`                               | `false`     |
| `fullWidth` | `boolean`                               | `false`     |

| Output    | Type         |
| --------- | ------------ |
| `clicked` | `MouseEvent` |

**Visual specs:**

- **Primary**: `--color-primary` bg, white text, lifts on hover (`-translate-y-0.5`)
- **Secondary**: `--color-surface` bg, bordered, subtle hover
- **Outline**: Transparent bg, `--color-primary` border, fills on hover
- **Sizes**: sm (`px-3 py-2`), md (`px-4 py-3`), lg (`px-6 py-4`)
- Built-in SVG loading spinner when `loading` is true
- Focus ring: 2px `--color-primary`, offset 2px

```html
<ui-button variant="primary" [loading]="isSaving()">Save Changes</ui-button>
<ui-button variant="outline" size="sm">Cancel</ui-button>
```

---

### `ui-input`

Text input with reactive forms support (ControlValueAccessor).

| Input          | Type                                                            | Default  |
| -------------- | --------------------------------------------------------------- | -------- |
| `type`         | `'text' \| 'email' \| 'password' \| 'number' \| 'tel' \| 'url'` | `'text'` |
| `id`           | `string`                                                        | `''`     |
| `name`         | `string`                                                        | `''`     |
| `placeholder`  | `string`                                                        | `''`     |
| `disabled`     | `boolean`                                                       | `false`  |
| `required`     | `boolean`                                                       | `false`  |
| `autocomplete` | `string`                                                        | `'off'`  |
| `error`        | `boolean`                                                       | `false`  |

**Visual specs:**

- Full width, `--color-input-bg` background, `--color-border` border
- Focus: `--color-primary` border with 20% opacity ring
- Error: `--color-error` border with matching focus ring
- Disabled: `--color-surface-alt` bg, 60% opacity
- Padding: `px-4 py-3`, `rounded-lg`, `text-sm`

```html
<ui-input type="email" placeholder="you@example.com" [error]="hasError()" [(ngModel)]="email" />
```

---

### `ui-icon`

Material Symbols Rounded icon wrapper.

| Input   | Type                                   | Default | Required |
| ------- | -------------------------------------- | ------- | -------- |
| `name`  | `string` (Material Symbols icon name)  | —       | Yes      |
| `size`  | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'`  | No       |
| `color` | `string` (Tailwind color class)        | `''`    | No       |

```html
<ui-icon name="search" size="sm" /> <ui-icon name="delete" color="text-red-500" />
```

---

### `app-profile-avatar`

Displays user avatar with image or computed initials fallback.

| Input               | Type                                   | Default | Required |
| ------------------- | -------------------------------------- | ------- | -------- |
| `email`             | `string`                               | —       | Yes      |
| `displayName`       | `string \| undefined`                  | —       | No       |
| `profilePictureUrl` | `string \| undefined`                  | —       | No       |
| `size`              | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'`  | No       |
| `showBorder`        | `boolean`                              | `true`  | No       |

**Visual specs:**

- Size mapping: xs (20px), sm (28px), md (40px), lg (48px), xl (64px)
- Fallback: Gradient background (orange-200 to red-300) with first 2 characters of name
- Circular with optional border

```html
<app-profile-avatar
    [email]="user.email"
    [displayName]="user.name"
    [profilePictureUrl]="user.avatar"
    size="lg"
/>
```

---

### `app-toast`

Notification toast with type-based styling.

| Input   | Type                                                 | Required |
| ------- | ---------------------------------------------------- | -------- |
| `toast` | `ToastData` (`id`, `title`, `message`, `type`, etc.) | Yes      |

| Output   | Type     |
| -------- | -------- |
| `closed` | `string` |

**Toast types**: `info`, `success`, `warning`, `error`

- Colored 4px left border per type
- Slide-in animation (0.3s ease-out)
- Min width: 300px, max width: 400px
- Optional avatar for message-style toasts

---

### `ui-divider`

Horizontal separator, optionally with centered text.

| Input  | Type     | Default |
| ------ | -------- | ------- |
| `text` | `string` | `''`    |

```html
<ui-divider /> <ui-divider text="or continue with" />
```

---

## Molecules

Composite components built from atoms for specific interaction patterns.

### `ui-form-field`

Wraps an input with label, error message, and hint text.

| Input      | Type      | Default |
| ---------- | --------- | ------- |
| `label`    | `string`  | `''`    |
| `for`      | `string`  | `''`    |
| `error`    | `string`  | `''`    |
| `hint`     | `string`  | `''`    |
| `required` | `boolean` | `false` |

```html
<ui-form-field label="Email" for="email" [error]="emailError()" required>
    <ui-input id="email" type="email" [(ngModel)]="email" />
</ui-form-field>
```

---

### `app-dialog`

Modal dialog with confirm, prompt, and alert types. Used via `DialogService`.

**DialogService API:**

| Method      | Returns                   | Description         |
| ----------- | ------------------------- | ------------------- |
| `confirm()` | `Promise<boolean>`        | Yes/No confirmation |
| `prompt()`  | `Promise<string \| null>` | Text input dialog   |
| `alert()`   | `Promise<void>`           | Acknowledgment only |

**Config options**: `title`, `message`, `placeholder`, `defaultValue`, `confirmLabel`, `cancelLabel`

**Keyboard**: Escape to cancel, Enter to confirm.

```typescript
const confirmed = await this.dialogService.confirm({
    title: 'Delete page?',
    message: 'This action cannot be undone.',
    confirmLabel: 'Delete',
});
```

---

### `app-member-avatar-group`

Overlapping avatar row with overflow counter.

| Input        | Type         | Default |
| ------------ | ------------ | ------- |
| `members`    | `Member[]`   | —       |
| `maxDisplay` | `number`     | `5`     |
| `size`       | `AvatarSize` | `'sm'`  |
| `clickable`  | `boolean`    | `false` |

---

### `app-todo-popover`

Floating editor for task item attributes.

| Output        | Type            |
| ------------- | --------------- |
| `attrsChange` | `TaskItemAttrs` |
| `close`       | `void`          |

**Features:**

- **Priority**: High (red `#dc2626`), Medium (amber `#f59e0b`), Low (blue `#3b82f6`)
- **Color picker**: Red, orange, yellow, green, blue
- **Due date**: Calendar picker with natural language ("today", "tomorrow", "next week")

---

### `app-editor-bubble-menu`

Floating toolbar for text formatting, appears on text selection.

**Actions**: Bold, Italic, Strikethrough, Link, Highlight, Block type selector

**Visual specs:**

- Positioned above selection
- Subtle shadow, 8px border radius
- `--color-surface` background

---

### `app-offline-indicator`

Fixed top banner showing offline status.

**Visual specs:**

- Fixed to top of viewport
- Yellow-500 background, white text
- Shows relative time since going offline

---

## Organisms

Complex, self-contained sections of the interface.

### `app-sidebar`

Primary navigation panel.

**Specs:**

- **Width**: 280px, collapsible to 0px
- **Background**: `--color-sidebar`
- **Item height**: 36px with 12px horizontal padding
- **Active state**: `--color-primary` at 10% opacity, left border accent
- **Hover state**: `--color-surface-hover`
- **Unread indicator**: Maple-colored dot (8px) right of tag name
- **Nesting**: 16px indent per level, max 4 levels

---

### `app-notebook-editor`

TipTap-based rich text editor with collaborative features.

**Specs:**

- **Max width**: 720px, centered
- **Selection color**: `--color-primary-light`
- **Block spacing**: 0.75rem between paragraphs
- **Features**: Drag handle, collaboration cursors, enhanced task items, slash commands, mentions, embeds

---

### `app-chat`

Real-time messaging interface.

| Property               | Specification                                                 |
| ---------------------- | ------------------------------------------------------------- |
| Message Bubble (Self)  | `--color-primary` at 10% opacity, right-aligned, 12px radius  |
| Message Bubble (Other) | `--color-surface` background, left-aligned, 12px radius       |
| Avatar                 | 32px circle via `app-profile-avatar`                          |
| Timestamp              | 12px, `--color-text-muted`, grouped by day                    |
| Input Area             | `--color-surface` bg, 1px border, 8px radius, 48px min height |
| Send Button            | `--color-primary` bg, white icon, 36px circle                 |

---

### `app-search-modal`

Global search overlay triggered by Cmd+K / Ctrl+K.

---

## Templates

### `app-main-layout`

Top-level layout shell.

**Structure**: Sidebar + main content area, full-screen flex layout. Includes search modal integration.

---

# Motion & Animation

Animation is purposeful and restrained. Motion guides attention and provides feedback, never distracts or delays.

## Timing Tokens

| Duration | Value | Usage                                |
| -------- | ----- | ------------------------------------ |
| Instant  | 0ms   | State changes with no transition     |
| Fast     | 100ms | Hover states, micro-interactions     |
| Normal   | 200ms | Most transitions, panel animations   |
| Slow     | 300ms | Complex animations, page transitions |

## Easing

| Curve         | Value                            | Usage                        |
| ------------- | -------------------------------- | ---------------------------- |
| `ease-out`    | `cubic-bezier(0.0, 0.0, 0.2, 1)` | Elements entering the screen |
| `ease-in-out` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | Elements moving on screen    |

## Defined Animations

| Name      | Keyframes                               | Duration             | Usage               |
| --------- | --------------------------------------- | -------------------- | ------------------- |
| `slideIn` | `translateX(100%) → 0`, `opacity 0 → 1` | 0.3s ease-out        | Toast notifications |
| `spin`    | `rotate(0deg → 360deg)`                 | 0.8s linear infinite | Loading spinners    |

## Animation Guidelines

- Sidebar collapse: 200ms ease-out
- Hover states: 100ms, immediate feedback
- Modal dialogs: Scale from 95% with 150ms ease-out
- Toast notifications: slideIn 0.3s ease-out
- Button primary hover: `-translate-y-0.5` lift effect, 200ms
- Drag handle: Opacity 0.1s (show), 0.2s with 0.3s delay (hide)
- Global transitions on body: `background-color 0.2s ease, color 0.2s ease`

---

# Responsive Design

Just Maple adapts from desktop to mobile, with native apps wrapping the shared web UI.

## Breakpoints

| Breakpoint | Tailwind | Range         | Layout                                     |
| ---------- | -------- | ------------- | ------------------------------------------ |
| Mobile     | default  | < 640px       | Single column, overlay sidebar, bottom nav |
| Tablet     | `sm:`    | 640 - 1024px  | Collapsible sidebar, full-width editor     |
| Desktop    | `lg:`    | 1024 - 1440px | Fixed sidebar, centered editor             |
| Wide       | `xl:`    | > 1440px      | Sidebar + editor + panel (split view)      |

## Mobile Adaptations

- Sidebar becomes full-screen overlay with gesture dismissal
- Editor expands to full width with reduced side padding (16px)
- Floating toolbar becomes fixed bottom bar during selection
- Touch targets: minimum 44x44px for all interactive elements

---

# Scrollbar Styling

Custom scrollbars maintain the warm aesthetic:

- **Width**: 8px
- **Track**: Transparent
- **Thumb**: `rgba(120, 113, 108, 0.2)`, 4px border radius
- **Thumb hover**: `rgba(120, 113, 108, 0.4)`
- **Dark mode thumb**: `rgba(168, 162, 158, 0.2)`, hover `0.4`

---

# Selection

Text selection uses the primary palette:

- **Background**: `--color-primary-light`
- **Text color**: `--color-primary`

---

# Accessibility

Just Maple follows WCAG 2.1 AA guidelines.

| Area                | Commitment                                                    |
| ------------------- | ------------------------------------------------------------- |
| Color Contrast      | 4.5:1 for body text, 3:1 for large text and UI components     |
| Keyboard Navigation | Full functionality via keyboard, visible 2px focus rings      |
| Screen Readers      | Semantic HTML, ARIA labels, live regions for dynamic content  |
| Touch Targets       | Minimum 44x44px for all interactive elements                  |
| Text Scaling        | Support up to 200% zoom without horizontal scrolling          |
| Focus Indicators    | 2px ring using `--color-primary`, offset 2px                  |
| Dialog Keyboard     | Escape to cancel, Enter to confirm, backdrop click to dismiss |

---

# Widget System

Widgets embed within the editor document flow, transforming documents into interactive spaces.

## Widget Design Principles

- **Contained**: Subtle rounded container (8px radius, 1px `--color-border` border)
- **Labeled**: Small type label in top-left corner indicates widget type
- **Interactive**: Hover reveals controls (minimize, configure, remove)
- **Responsive**: Widgets adapt to document width gracefully

## Widget Types

| Widget           | Component              | Visual Treatment                                                 |
| ---------------- | ---------------------- | ---------------------------------------------------------------- |
| Audio Recording  | `app-recording-embed`  | Waveform in `--color-primary`, recording time, transcript        |
| Audio Player     | `app-audio-player`     | Playback controls, waveform visualization                        |
| Memo Embed       | `app-memo-embed`       | Linked document preview with border                              |
| Whiteboard Embed | `app-whiteboard-embed` | Canvas preview with border                                       |
| Paper Embed      | `app-paper-embed`      | Reference/paper preview                                          |
| AI Bot Output    | `app-bot-output`       | Streaming output, loading shimmer, left `--color-primary` border |
| Google Calendar  | `app-gcal-event-popup` | Calendar event card with date/time fields                        |
| Connection Graph | `app-connection-graph` | Interactive node graph visualization                             |
| Kanban Board     | `app-kanban-board`     | Card-based board view                                            |

---

# Implementation Reference

## File Organization

```
components/
├── atoms/            # Button, Input, Icon, Avatar, Toast, SyncStatus
├── molecules/        # FormField, Divider, Dialog, TodoPopover, BubbleMenu, ...
├── organisms/        # Sidebar, NotebookEditor, Chat, SearchModal, ...
├── templates/        # MainLayout
└── index.ts          # Barrel exports
```

## Component Conventions

All components follow these patterns:

```typescript
@Component({
  selector: 'ui-button',         // 'ui-' prefix for design system, 'app-' for app-specific
  standalone: true,
  imports: [CommonModule],
  templateUrl: './button.component.html',  // Separate files
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');  // input() for props
  readonly clicked = output<MouseEvent>();              // output() for events
  readonly isOpen = signal(false);                      // signal() for local state
  readonly label = computed(() => /* ... */);            // computed() for derived state
}
```

## Styling Approach

```html
<!-- Tailwind utilities + CSS variables -->
<button
    class="px-4 py-3 rounded-lg bg-[var(--color-primary)] text-white
               hover:bg-[var(--color-primary-hover)] transition-all duration-200"
>
    Click me
</button>
```

- **Primary**: Tailwind utility classes
- **Variables**: CSS custom properties via `var(--color-*)` for theme-awareness
- **SCSS**: Only for pseudo-elements, complex animations, and things Tailwind can't express
- **Never**: Inline styles in templates, hardcoded colors

---

_Just Maple Design System v2.0 — Made with care by the Maple team_
