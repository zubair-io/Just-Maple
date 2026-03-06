# Canvas — Product Requirements Document

**Feature**: AI-Generated Reactive Widget Canvas
**Status**: Draft
**Date**: 2026-03-04

---

## Problem

Just Maple stores structured data in JSON pages (book libraries, API responses, inventories, etc.) but there's no visual way to present that data. Users currently see raw JSON in a code editor or an auto-generated form. When a user has a JSON page full of books, artworks, or any collection, they can't say "show me my books as cards" and get a visual dashboard.

The gap: data exists in the system, but there's no bridge between structured data and visual presentation that a non-developer can use with natural language.

## Solution

A new page type called **Canvas** where users type natural-language prompts ("Display the books in my library", "Show me my artwork collection as a gallery") and an AI generates reactive widgets that render data using Just Maple's existing atom components. Widgets stay in sync — when the underlying JSON data changes, the widgets update automatically.

## User Stories

**Creating a canvas and first widget:**
As a user, I open a notebook, create a new Canvas page, and type "Show my books as cards with title, author, and year." The AI reads my JSON data, generates a widget, and I see book cards rendered on the canvas immediately.

**Reactive updates:**
As a user, I add a new book to my JSON page via the API or code editor. When I switch back to my canvas, the book list widget already includes the new entry — no refresh or manual action needed.

**Multiple widgets on one canvas:**
As a user, I have a canvas with a "Recent Books" widget and I add a second prompt: "Show total book count as a big number." A stat widget appears alongside the book list. I can rearrange them.

**Editing a widget:**
As a user, I don't like how the AI rendered my data. I click the widget's edit button, tweak my prompt ("Make the cards show the cover image too"), and the widget regenerates.

**Connecting to different data sources:**
As a user, I have two JSON pages — one for books and one for movies. On a single canvas, I create widgets that pull from both sources by specifying which data to use.

## Feature Scope

### Phase 1 — Core (MVP)

What ships first:

- New `canvas` page type in the sidebar "New" menu.
- Prompt bar at the top of the canvas for adding widgets via natural language.
- AI generates widget templates using the Widget DSL (atom, layout, each, when nodes).
- Widgets render reactively from an Elf store — data changes flow to the UI automatically.
- Each widget links to a JSON page as its data source via a connector.
- Widgets are persisted in a `canvases` collection (one canvas document per canvas page).
- Basic widget management: delete a widget, re-prompt to regenerate.
- Widget position stored (x, y, w, h) for future layout use; Phase 1 uses a simple vertical stack.

### Phase 2 — Layout & Interaction

- Drag-and-drop widget repositioning (grid-based layout).
- Widget resize handles.
- Prompt refinement: "make the cards bigger", "add a filter by year."
- Widget-level loading and error states.
- Poll interval: widgets can auto-refresh data on a timer.

### Phase 3 — Advanced Data Sources

- Connectors beyond JSON pages: external APIs, Google Sheets, etc.
- Canvas-level variables and filters that multiple widgets share.
- Widget-to-widget interaction (click a book → details widget updates).
- Collaborative editing: multiple users see the same canvas in real time.

## Data Model

### Canvas Document (new collection: `canvases`)

One canvas document per canvas page. Stores the full widget configuration.

| Field        | Type              | Description                             |
| ------------ | ----------------- | --------------------------------------- |
| `_id`        | string            | MongoDB ObjectId (serialized as string) |
| `id`         | string            | Same as `pages.id` — UUID v4            |
| `notebookId` | string            | Parent notebook                         |
| `userId`     | string            | Owner                                   |
| `connectors` | CanvasConnector[] | Data source definitions                 |
| `widgets`    | CanvasWidget[]    | All widgets on the canvas               |
| `createdAt`  | datetime          |                                         |
| `updatedAt`  | datetime          |                                         |

### Canvas Connector

Links a canvas to a data source (Phase 1: JSON pages only).

| Field           | Type    | Description                                     |
| --------------- | ------- | ----------------------------------------------- |
| `connectorId`   | string  | Unique ID within this canvas                    |
| `connectorType` | string  | `"json-page"` for Phase 1                       |
| `enabled`       | boolean | Active or paused                                |
| `name`          | string  | Display name (e.g. "Book Library")              |
| `description`   | string? | Human-readable description                      |
| `scope`         | object? | Optional notebook/tag filtering                 |
| `authRef`       | string? | Reference to stored auth credentials (Phase 3)  |
| `config`        | object? | Type-specific config (e.g. `{ pageId: "..." }`) |
| `fields`        | Record  | Field definitions from the data source          |

### Canvas Widget

A single visual block on the canvas.

| Field          | Type          | Description                                      |
| -------------- | ------------- | ------------------------------------------------ |
| `id`           | string        | Unique widget ID                                 |
| `title`        | string?       | Display title                                    |
| `connectorId`  | string?       | Which connector supplies data                    |
| `template`     | WidgetNode    | The DSL tree that renders the widget             |
| `dataPath`     | string?       | JSONPath to extract root data (e.g. `"$.books"`) |
| `prompt`       | string?       | The user's original natural-language prompt      |
| `initialData`  | object?       | Seed data for preview before live data loads     |
| `position`     | {x, y, w, h}? | Grid position and size                           |
| `pollInterval` | number?       | Auto-refresh interval in ms (Phase 2)            |
| `createdAt`    | datetime      |                                                  |
| `updatedAt`    | datetime?     |                                                  |

### Widget DSL Node Types

The AI writes a tree of these nodes. Discriminated by which field is present.

| Discriminator | Node        | Purpose                                                    |
| ------------- | ----------- | ---------------------------------------------------------- |
| `atom`        | Atom        | Renders a single UI component (text, badge, image, etc.)   |
| `layout`      | Layout      | Container — row, stack, grid, card — with `children`       |
| `each`        | Loop        | Iterates over an array, scoping a variable into `template` |
| `when`        | Conditional | Renders `then` or `else` based on a truthy expression      |

Data binding uses `bind: "$.field"` on atoms and `{{variable.field}}` interpolation in string values.

## User Flow

```
User creates "New Canvas" from sidebar
        ↓
Empty canvas page loads with prompt bar
        ↓
User types: "Display the books in my library"
        ↓
System identifies JSON pages in this notebook
  → Finds "Book Library" JSON page with { books: [...] }
        ↓
AI receives: atom catalog + data shape + user prompt
  → Generates: CanvasWidget with template + dataPath + connectorId
        ↓
Widget saved to canvas document
        ↓
Renderer walks the template tree:
  layout:stack → each($.books) → layout:card → [atom:text, atom:badge, ...]
        ↓
Atoms render with live data from Elf store
        ↓
JSON page data changes → Elf store updates → widgets re-render
```

## Success Criteria

- A user with zero coding knowledge can create a visual dashboard from their JSON data using only natural language.
- Widget rendering takes < 200ms after data arrives in the Elf store.
- Data changes in JSON pages are reflected in canvas widgets within 2 seconds (real-time via SSE).
- AI generates a valid widget template on the first attempt ≥ 90% of the time for common data shapes (flat arrays of objects).
- Canvas pages load and render existing widgets without re-calling the AI.

## Decisions

1. **AI provider**: Use the user's **Mercury Bot** first (existing bot infrastructure). Fall back to the user's Claude bot API key if Mercury is unavailable. No new dedicated AI route — reuse the bot invocation pattern.
2. **Data source picker**: The **AI infers** which JSON page to pull from based on the prompt and the available pages in the notebook. The AI receives page titles, descriptions, and data shapes to match against the user's intent.
3. **Widget size defaults**: The **AI picks** position and size based on the data shape and widget type (e.g. a stat gets a small card, a grid of images gets full-width). The renderer applies these defaults from the template.
4. **Offline**: Canvas documents are cached in an **Elf store with IndexedDB hydration**, following the same pattern as notifications and pages. Canvas loads from cache first, then syncs with server.

## Additional Requirement: JSON Page Descriptions

To help the AI understand what each JSON page contains, JSON documents gain a `description` field — a short human-written explanation like "My personal book library" or "Artwork collection from the Art Institute of Chicago API." The JSON view page gets a description editor (simple text input below the title). The AI uses these descriptions alongside data shapes to pick the right data source for a canvas widget.
