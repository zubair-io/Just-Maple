## Context

You are implementing "Tap & Canvas" for Just Maple — a natural language command surface that lets users create dynamic widget dashboards. The system has four layers:

1. **Atoms** — Universal UI primitives (text, stat, icon, badge, etc.) that Claude composes into layouts.
2. **Canvas** — A new page type (Notebook → Canvas → Widgets) where widgets live.
3. **Connectors** — Typed data sources (weather, Maple todos, Maple notes) toggled per-canvas.
4. **Tap Bar** — A Spotlight-style command bar (triggered by keyboard shortcut) that sends natural language to Claude, which returns layout templates built from atoms.

There are NO connector-specific UI components. Claude assembles atoms into layouts to answer any query. Adding a new connector requires zero new UI.

## Read `docs/tap-canvas-spec.md` for the full engineering spec and `CLAUDE.md` for project conventions.

## Phase 1: Shared Schemas

Create TypeBox schemas in `packages/shared/src/schemas/`. Follow existing patterns (see `notebook.ts`, `whiteboard.ts` for reference).

### Files to create:

**`packages/shared/src/schemas/tap-atoms.ts`**

- `AtomNode` — Schema for atom instances with: `atom` (type name), `value` (static), `bind` (field reference), `format` (string interpolation like `"{value}°"`), `map` (value lookup like `{ "sunny": "wb_sunny" }`), plus display props (`size`, `color`, `weight`, `label`).
- `LayoutNode` — Recursive schema: `layout` (card/stack/row/grid), `children` (array of LayoutNode | AtomNode), plus `gap`, `align`, `columns`, `header`, `padding`, `wrap`.
- `WidgetTemplate` — Alias for the root LayoutNode.

**`packages/shared/src/schemas/canvas.ts`**

- `CanvasConnectorScope` — `notebookIds?: string[]`, `tagIds?: string[]`
- `CanvasConnector` — `connectorId`, `connectorType`, `enabled`, `name`, `description`, `scope?`, `authRef?`, `config?`, `fields` (Record of field definitions with type, description, enum).
- `CanvasWidget` — `id`, `connectorId`, `createdAt`, `pollInterval?`, `template` (WidgetTemplate), `position?` (x, y, w, h).
- `Canvas` — `id`, `notebookId`, `userId`, `connectors[]`, `widgets[]`, timestamps.

**`packages/shared/src/schemas/connector-manifest.ts`**

- `ConnectorFieldDef` — `type` (string/number/boolean/array/object), `description?`, `enum?`, `items?`
- `ConnectorParam` — `type`, `description?`, `required?`, `default?`
- `ConnectorManifest` — `type`, `name`, `description`, `icon` (Material Symbol name), `authRequired`, `configSchema?`, `fields`

Export all new types from `packages/shared/src/index.ts`.

---

## Phase 2: Atom Components

Create atom components in `apps/web/src/app/components/atoms/`. Each atom gets its own directory with separate `.component.ts`, `.component.html`, `.component.scss` files. All atoms are standalone Angular components.

Use the `tap-` prefix for selectors: `app-tap-text`, `app-tap-stat`, etc.

### Atoms to build:

| Component       | Selector            | Key inputs                                         | Notes                                                                                              |
| --------------- | ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tap-text`      | `app-tap-text`      | `value: string`, `size`, `color`, `weight`         | Use `--font-sans` (Lato). Colors map to CSS vars.                                                  |
| `tap-stat`      | `app-tap-stat`      | `value: string`, `label?: string`, `size`          | Large number display. Label is small muted text below.                                             |
| `tap-icon`      | `app-tap-icon`      | `name: string`, `size`, `color`                    | Renders a `<span class="material-symbols-rounded">`. The `name` input is the Material Symbol name. |
| `tap-badge`     | `app-tap-badge`     | `value: string`, `color`                           | Colored pill. Colors: red, amber, blue, green, gray. Use Tailwind bg classes with opacity.         |
| `tap-image`     | `app-tap-image`     | `src: string`, `alt?: string`, `fit`, `rounded`    | Basic `<img>` with object-fit and optional rounded corners.                                        |
| `tap-progress`  | `app-tap-progress`  | `value: number`, `max: number`, `variant`, `color` | Bar variant: horizontal bar. Ring variant: SVG circle.                                             |
| `tap-timestamp` | `app-tap-timestamp` | `value: string`, `format`                          | Parse ISO 8601. `relative` = "2 hours ago". `date` = "Mar 1, 2026". `time` = "3:45 PM".            |
| `tap-divider`   | `app-tap-divider`   | `spacing`                                          | `<hr>` with `border-[var(--color-border)]` and margin variants.                                    |
| `tap-link`      | `app-tap-link`      | `href: string`, `label?: string`, `external`       | Anchor tag. External opens in new tab. Internal navigates via Angular router.                      |
| `tap-list`      | `app-tap-list`      | `items: string[]`, `ordered: boolean`, `size`      | Renders `<ul>` or `<ol>` with styled list items.                                                   |
| `tap-checkbox`  | `app-tap-checkbox`  | `checked: boolean`, `label?: string`, `disabled`   | Styled checkbox with optional label.                                                               |

### Styling rules:

- Use Tailwind utility classes for all styling.
- Use CSS variables from `styles.scss` for colors (`--color-text-main`, `--color-text-muted`, `--color-primary`, `--color-border`, etc.).
- Font: `font-[var(--font-sans)]` (Lato) for all atoms.
- Use Angular signals for inputs: `readonly value = input<string>('')`.
- Use `input()` and `output()` functions, NOT `@Input()` / `@Output()` decorators.

### Atoms Elements Page

Create a page at `apps/web/src/app/pages/atoms-showcase/` that displays every atom in all its variants. This serves as a living style guide and testing surface.

Route: `/atoms` (dev only, guard behind dev mode flag if desired).

The page should show each atom with:

- All size variants
- All color variants
- Example with bound data
- Example with static data

---

## Phase 3: Widget Renderer

Create the recursive rendering component:

**`apps/web/src/app/components/organisms/widget-renderer/`**

This is ONE component that handles the entire rendering tree:

- If the node has `layout` → render a `<div>` with Tailwind classes, recurse into `children`.
- If the node has `atom` → render the matching `app-tap-*` component.
- Pass `data` (connector response) down to all children for binding resolution.

### Value resolution function:

```typescript
resolve(node: AtomNode, data: Record<string, unknown>): unknown {
    // 1. GET raw value
    const raw = node.bind ? this.getNestedValue(data, node.bind) : node.value;
    // 2. MAP (lookup transform)
    const mapped = node.map ? (node.map[String(raw)] ?? node.map['_default'] ?? raw) : raw;
    // 3. FORMAT (string interpolation)
    const formatted = node.format ? node.format.replace('{value}', String(mapped)) : mapped;
    return formatted;
}
```

Support nested field access with dot notation: `"bind": "tasks.0.title"` should resolve `data.tasks[0].title`.

### Layout class mapping:

```typescript
card  → 'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4'
stack → 'flex flex-col'
row   → 'flex flex-row'
grid  → 'grid'
gap: xs→'gap-1' sm→'gap-2' md→'gap-3' lg→'gap-4'
align: start→'items-start' center→'items-center' end→'items-end'
columns: N → `grid-cols-${N}`
```

---

## Phase 4: Weather Connector (API)

Create the connector infrastructure and weather connector:

**`apps/api/src/connectors/connector.interface.ts`**

```typescript
export interface ConnectorExecutor {
    execute(
        config: Record<string, unknown>,
        scope?: { notebookIds?: string[]; tagIds?: string[] },
        params?: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
}
```

**`apps/api/src/connectors/weather.connector.ts`**

- Use a free weather API (e.g., Open-Meteo — no API key needed, or wttr.in as fallback).
- Accept `location` from connector config.
- Return `{ temp, feelsLike, conditions, humidity, windSpeed, high, low }`.
- Map API response to the field schema defined in the manifest.

**`apps/api/src/connectors/registry.ts`**

- Map connector type strings to executor instances.
- Export a `getExecutor(type: string): ConnectorExecutor` function.

---

## Phase 5: Canvas API

**`apps/api/src/routes/canvas.ts`**

Create Elysia routes following existing patterns (see `whiteboard.ts`, `pages.ts`):

| Route                                        | Method | Handler                               |
| -------------------------------------------- | ------ | ------------------------------------- |
| `/api/canvas/:pageId`                        | GET    | Load canvas with connectors + widgets |
| `/api/canvas/:pageId`                        | PUT    | Update canvas                         |
| `/api/canvas/:pageId/connectors`             | POST   | Add connector                         |
| `/api/canvas/:pageId/connectors/:id`         | PUT    | Update connector                      |
| `/api/canvas/:pageId/connectors/:id`         | DELETE | Remove connector                      |
| `/api/canvas/:pageId/connectors/:id/execute` | POST   | Execute connector, return data        |
| `/api/canvas/:pageId/widgets`                | POST   | Add widget                            |
| `/api/canvas/:pageId/widgets/:id`            | PUT    | Update widget                         |
| `/api/canvas/:pageId/widgets/:id`            | DELETE | Remove widget                         |
| `/api/canvas/:pageId/tap`                    | POST   | Claude orchestration endpoint         |

**`apps/api/src/repositories/canvas.repo.ts`**

MongoDB collection: `canvases`. Follow existing repo patterns.

**`apps/api/src/services/tap.service.ts`**

The Tap service orchestrates the Claude API call:

1. Load canvas → get enabled connectors.
2. For each enabled connector, build a Claude tool definition from the manifest:
    - Tool name: `connector_{connectorId}`
    - Description: connector name + description + field descriptions with types
    - Input schema: from connector's configSchema (filter params, etc.)
3. Add the `render_ui` tool definition.
4. Send to Claude API with system prompt (see spec) + user query.
5. Handle Claude's response:
    - If tool_use calls for connectors → execute them → send results back → continue.
    - If tool_use calls `render_ui` → validate template → return to client.
    - If text response → return as chat fallback.
6. Multi-turn: support up to 3 turns of tool calls before forcing a render or fallback.

---

## Phase 6: Canvas Page + Connector Panel (Web)

**`apps/web/src/app/pages/canvas-view/`**

The canvas view component with three regions:

1. **Connector panel** — Sidebar/drawer showing available connector types, toggle switches, scope config.
2. **Widget grid** — Rendered widgets using `WidgetRendererComponent`. Each widget is a card that can be repositioned.
3. **Tap bar overlay** — Floating centered input, appears on keyboard shortcut.

**`apps/web/src/app/components/organisms/connector-panel/`**

Lists all available connector types with Material Symbol icons. For each:

- Toggle switch to enable/disable.
- Config form (e.g., location input for weather).
- Scope picker for Maple connectors (notebook/tag multiselect).
- Status indicator (connected, needs auth, error).

**`apps/web/src/app/components/organisms/tap-bar/`**

Floating overlay component:

- Triggered by `Cmd+K` / `Ctrl+K` (only on Canvas pages with bot enabled).
- Text input with placeholder "Ask anything..."
- Shows loading state during Claude call.
- Renders result inline using `WidgetRendererComponent`.
- "Pin to canvas" button for widget mode.
- Dismiss on Escape or click outside.

**`apps/web/src/app/guards/canvas-page.guard.ts`**

`canMatch` guard that checks if the page type is `'canvas'`.

Add as a **child route** under the existing `:notebookId` parent in `app.routes.ts`:

```typescript
// Inside the existing :notebookId children array:
{ path: ':id', canMatch: [CanvasPageGuard], loadComponent: () => import('./pages/canvas-view/canvas-view.component') },
```

Also add `Type.Literal('canvas')` to `PageTypeSchema` in `packages/shared/src/schemas/page.ts`.

---

## Phase 7: Maple Connectors

**`apps/api/src/connectors/maple-todos.connector.ts`**

- Query the existing `pages` collection for pages with `todoMeta.hasTodos: true`.
- Parse Y.js memo content to extract task items with their attributes (title, checked, priority, dueDate, color).
- Respect scope: filter by `notebookIds` and `tagIds` from the connector scope config.
- Return `{ tasks: Task[] }` matching the manifest field schema.

**`apps/api/src/connectors/maple-notes.connector.ts`**

- Query the `pages` collection for memo-type pages.
- Extract title, first ~200 chars of content as excerpt, updatedAt, tags.
- Respect scope filtering.
- Return `{ notes: Note[] }` matching the manifest field schema.

Both connectors reuse existing repository functions where possible (`page.repo.ts`, `memo.repo.ts`).

---

## Phase 8: Widget Polling

**`apps/web/src/app/services/widget-poll.service.ts`**

Manages polling lifecycle for pinned widgets:

- `startPolling(widget, connector)` — Sets up interval, calls connector execute endpoint, updates widget data signal.
- `stopPolling(widgetId)` — Clears interval.
- `stopAll()` — Cleanup on canvas navigation away.

Use the existing WebSocket infrastructure (`realtime-ws.service.ts`) if appropriate for future push support, but start with HTTP polling for MVP.

---

## Key Conventions (from CLAUDE.md)

- **Separate component files** — `.component.ts`, `.component.html`, `.component.scss` (never inline).
- **Angular signals** — Use `signal()`, `computed()`, `input()`, `output()`. No BehaviorSubject in components.
- **HttpClient** — Always use Angular HttpClient, never raw fetch.
- **Tailwind** — Primary styling. Use CSS variables for design tokens. No inline styles.
- **TypeBox** — All shared types defined as TypeBox schemas with `Static<typeof Schema>` exports.
- **Elysia** — API routes use Elysia with JWT plugin. Follow existing route patterns.
- **Cosmos DB** — No `$text` indexes, no `$or` with `.sort()`. Use `$regex` for search, sort in app code.
- **Prettier** — 4-space indent, single quotes, trailing commas, 100 char width. Run `bun run format`.
- **kebab-case** files with appropriate suffixes (`.component.ts`, `.service.ts`, `.repo.ts`, `.guard.ts`).
- **Material Symbols Rounded** — Icon font already loaded. Use icon names from the Material Symbols catalog.

---

## Testing Approach

**User stories with acceptance criteria are defined in `docs/tap-canvas-user-stories.md`.** Every implementation phase below must have tests that map to the acceptance criteria in that file. Use the story IDs (US-1 through US-30) as reference when writing test descriptions.

### Test mapping by phase:

| Phase                 | Stories to cover                   | Test type                                                                                                 |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Shared schemas        | —                                  | TypeBox compile-time validation                                                                           |
| Atom components       | US-22, US-25                       | Unit tests + atoms showcase page (`/atoms`)                                                               |
| Widget renderer       | US-22, US-23, US-24                | Unit tests with hardcoded template JSON → verify DOM output                                               |
| Weather connector     | US-28                              | Unit test with mocked weather API responses                                                               |
| Canvas API            | US-1, US-2, US-3, US-4, US-7, US-8 | Integration tests against API endpoints                                                                   |
| Canvas page + Tap bar | US-9, US-10, US-11                 | Component tests for keyboard shortcut + guard logic                                                       |
| Tap service           | US-20, US-21, US-29, US-30         | Integration test with mocked Claude API → verify tool call handling + fallbacks                           |
| E2E weather           | US-12, US-13, US-14, US-15         | E2E: open canvas → enable weather → Tap "what's the weather" → verify rendered widget → pin → verify poll |
| Maple Todos           | US-5, US-16, US-17                 | Integration: scope filtering + E2E Tap query                                                              |
| Maple Notes           | US-6, US-18, US-19                 | Integration: scope filtering + E2E Tap query                                                              |
| Widget lifecycle      | US-26, US-27                       | E2E: pin widget → reload → verify persistence → delete → verify removal                                   |

---

## Implementation Order

Follow this exact order. Each phase builds on the previous and is independently verifiable:

1. Shared schemas (types only, no runtime code)
2. Atom components + atoms showcase page
3. Widget renderer with hardcoded test templates
4. Weather connector (API-side)
5. Canvas API endpoints + repo
6. Canvas page + connector panel + Tap bar UI
7. Tap service (Claude orchestration)
8. E2E weather flow
9. Maple Todos connector
10. Maple Notes connector
11. Widget pinning + polling
12. Polish: Tap bar animations, widget drag/resize, error states
