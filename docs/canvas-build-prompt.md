# Canvas Feature — Claude Code Build Prompt

Use this prompt with Claude Code to implement the Canvas feature with full test coverage. Run it from the repo root (`just-maple/`).

---

## Prompt

````
You are building the Canvas feature for Just Maple — a new page type where users type natural-language prompts and an AI generates reactive widgets that render structured data using existing atom components.

Read these docs first:
- docs/canvas-prd.md (product requirements)
- docs/canvas-tech-spec.md (technical specification)
- packages/shared/src/schemas/canvas.ts (Canvas/Widget schemas — already done)
- packages/shared/src/schemas/atoms.ts (Widget DSL node types — already done)
- packages/shared/src/schemas/page.ts (PageType includes 'canvas' — already done)
- apps/web/src/app/guards/page-type.guard.ts (CanvasPageGuard — already done)
- apps/web/src/app/app.routes.ts (canvas route wired — already done)
- CLAUDE.md (engineering style guide — follow strictly)

Also read these for existing patterns to follow:
- apps/api/src/routes/json-documents.ts (route pattern)
- apps/api/src/repositories/json-document.repo.ts (repository pattern)
- apps/web/src/app/services/json-document.service.ts (frontend service pattern)
- apps/web/src/app/pages/json-view/json-view.component.ts (page component pattern)
- apps/web/src/app/services/notification.service.ts (Elf store + IndexedDB pattern)
- apps/web/src/app/services/db-stores.ts (DB_STORES constants)

Then read these for test patterns:
- apps/api/src/__tests__/helpers/fixtures.ts (API test fixtures)
- apps/api/src/__tests__/helpers/app.ts (test app helper)
- apps/api/src/__tests__/helpers/db.ts (test db helper)
- apps/api/src/routes/__tests__/auth.test.ts (API route test pattern)
- apps/web/src/app/services/__tests__/notification.service.spec.ts (web service test pattern)
- e2e/fixtures.ts (Playwright fixtures — auth helpers)
- e2e/kanban.spec.ts (E2E test pattern)
- playwright.config.ts (Playwright config)

## What's already done

- `packages/shared/src/schemas/canvas.ts` — CanvasSchema, CanvasWidgetSchema, CanvasConnectorSchema
- `packages/shared/src/schemas/atoms.ts` — WidgetNodeSchema (atom, layout, each, when), AtomNodeSchema, LayoutNodeSchema, WidgetTemplateSchema
- `packages/shared/src/schemas/page.ts` — PageType includes 'canvas'
- `packages/shared/src/schemas/json-document.ts` — JsonDocument now has `description` field + UpdateJsonDescriptionSchema
- `apps/web/src/app/guards/page-type.guard.ts` — CanvasPageGuard exported
- `apps/web/src/app/app.routes.ts` — canvas route points to canvas-view.component.ts
- `apps/web/src/app/pages/json-view/` — description input added to template, onDescriptionChange handler in component
- `apps/web/src/app/services/json-document.service.ts` — updateDescription() method added

## What to build (in order)

Build using TDD — write tests first, then implement until tests pass.

### Phase 1: Backend — Canvas Repository + API

**1a. Canvas repository** (`apps/api/src/repositories/canvas.repo.ts`)

Functions to implement:
- `findCanvasById(id: string): Promise<Canvas | null>`
- `findOrCreateCanvas(pageId: string, notebookId: string, userId: string): Promise<Canvas>`
- `updateCanvas(id: string, update: Partial<Canvas>): Promise<Canvas | null>`
- `addWidget(canvasId: string, widget: CanvasWidget): Promise<Canvas | null>`
- `updateWidget(canvasId: string, widgetId: string, widget: Partial<CanvasWidget>): Promise<Canvas | null>`
- `removeWidget(canvasId: string, widgetId: string): Promise<Canvas | null>`
- `addConnector(canvasId: string, connector: CanvasConnector): Promise<Canvas | null>`

Tests: `apps/api/src/repositories/__tests__/canvas.repo.test.ts`
- Use the existing mongodb-memory-server setup
- Create fixtures: `createCanvasFixture()`, `createCanvasWidgetFixture()`, `createCanvasConnectorFixture()`
- Add fixtures to `apps/api/src/__tests__/helpers/fixtures.ts`
- Test CRUD operations, widget add/update/remove, connector management
- Test `findOrCreateCanvas` auto-creates when missing

**1b. JSON document description endpoint** (`apps/api/src/routes/json-documents.ts`)

Add: `PUT /api/json-documents/:id/description`
- Accepts `{ description: string }` (max 500 chars)
- Updates the description field on the JSON document
- Returns `{ document: JsonDocument }`

Tests: `apps/api/src/routes/__tests__/json-documents.test.ts`
- Test setting description
- Test max length validation
- Test 404 for nonexistent document

**1c. Canvas API routes** (`apps/api/src/routes/canvases.ts`)

Endpoints:
- `GET /api/canvases/:id` — fetch or auto-create canvas
- `PUT /api/canvases/:id` — replace full canvas
- `POST /api/canvases/:id/widgets/generate` — AI generates widget from prompt
- `PUT /api/canvases/:id/widgets/:widgetId` — update widget
- `PUT /api/canvases/:id/widgets/:widgetId/regenerate` — regenerate from new prompt
- `DELETE /api/canvases/:id/widgets/:widgetId` — remove widget

Follow the Elysia route pattern from json-documents.ts. Use jwtPlugin + auth derive.

For the `/widgets/generate` endpoint:
1. Find all JSON pages in the notebook
2. For each, load its JsonDocument (title, description, data shape)
3. Build a system prompt with the atom catalog, layout catalog, control flow docs, and data sources
4. Invoke Mercury Bot (use the existing bot invocation infrastructure from the chat/message system)
5. Parse the AI response as JSON, validate it matches WidgetNodeSchema
6. Create a connector for the selected data source if one doesn't exist
7. Save the widget to the canvas and return it

If Mercury is unavailable, fall back to the user's Claude API key.

Tests: `apps/api/src/routes/__tests__/canvases.test.ts`
- Test GET auto-creates canvas
- Test GET returns existing canvas
- Test PUT replaces canvas
- Test DELETE removes widget
- Test widget update
- For the generate endpoint: mock the bot invocation, provide a canned AI response, verify the widget is saved correctly and the connector is created

### Phase 2: Frontend — Services

**2a. Add DB_STORES** (`apps/web/src/app/services/db-stores.ts`)

Add `CANVAS: 'canvas'` and `CANVAS_DATA: 'canvas_data'` to the DB_STORES constant.

**2b. Canvas service** (`apps/web/src/app/services/canvas.service.ts`)

Manages the canvas document lifecycle with Elf store + IndexedDB hydration.

Signals:
- `canvas: Signal<Canvas | null>`
- `widgets: Signal<CanvasWidget[]>` (computed from canvas)
- `isLoading: Signal<boolean>`
- `isGenerating: Signal<boolean>`

Methods:
- `loadCanvas(pageId: string): Promise<void>`
- `addWidget(prompt: string): Promise<CanvasWidget>`
- `removeWidget(widgetId: string): Promise<void>`
- `regenerateWidget(widgetId: string, prompt: string): Promise<CanvasWidget>`
- `updateWidget(widgetId: string, update: Partial<CanvasWidget>): Promise<void>`

Use HttpClient (not fetch). Use Elf store with `withEntities`. Hydrate from IndexedDB on init. Follow the notification.service.ts pattern.

Tests: `apps/web/src/app/services/__tests__/canvas.service.spec.ts`
- Use TestBed + HttpClientTestingModule
- Mock IndexedDB service
- Test loadCanvas fetches from API and updates store
- Test addWidget POSTs to generate endpoint and adds to store
- Test removeWidget DELETEs and removes from store
- Test regenerateWidget PUTs and replaces widget in store
- Test signals update correctly after each operation
- Test IndexedDB hydration on init

**2c. Canvas data service** (`apps/web/src/app/services/canvas-data.service.ts`)

Manages per-widget data in an Elf store.

Signals:
- `getWidgetData(widgetId: string): Signal<unknown>` — reactive data for a widget

Methods:
- `loadWidgetData(widget: CanvasWidget, connector: CanvasConnector): Promise<void>`
- `subscribeToUpdates(widget: CanvasWidget, connector: CanvasConnector): void`
- `clear(): void`

Data flow: connector config has pageId → fetch JsonDocument → extract data at widget.dataPath → upsert into Elf store. Subscribe to json.updated SSE events for live updates.

Tests: `apps/web/src/app/services/__tests__/canvas-data.service.spec.ts`
- Test loadWidgetData fetches JSON document and resolves dataPath
- Test getWidgetData returns reactive signal that updates
- Test subscribeToUpdates reacts to SSE events
- Test clear empties the store
- Test with different dataPath values: `"$.books"`, `"$.data"`, null (use root)

### Phase 3: Frontend — Components

**3a. Widget renderer** (`apps/web/src/app/components/organisms/widget-renderer/`)

Recursive component that walks a WidgetNode tree and renders atoms.

Inputs:
- `node: WidgetNode` — the DSL tree to render
- `context: DataContext` — the current data context (`{ $: rootData, ...scopedVars }`)

The component dispatches on node type:
- `atom` → render the matching atom component with resolved props
- `layout` → render children in a div with Tailwind layout classes
- `each` → iterate array, extend context with `as` variable, recurse
- `when` → evaluate condition, render `then` or `else` branch

Expression resolver utility (put in a separate file `widget-expression.util.ts`):
- `resolvePath(path: string, context: DataContext): unknown` — dot-path resolution
- `resolveInterpolation(template: string, context: DataContext): string` — `{{expr}}` replacement
- `resolveAtomProp(node: AtomNode, context: DataContext): unknown` — bind vs value
- `resolveArray(source: string, context: DataContext): unknown[]` — for each nodes
- `resolveTruthy(expr: string, context: DataContext): boolean` — for when nodes

Tests: `apps/web/src/app/components/organisms/widget-renderer/__tests__/widget-expression.util.spec.ts`
- Test resolvePath with simple paths: `"title"` → `"Dune"`
- Test resolvePath with nested: `"book.author"` → `"Frank Herbert"`
- Test resolvePath with `$.` prefix: `"$.books"` → array
- Test resolvePath with missing fields → undefined
- Test resolveInterpolation: `"by {{author}}"` → `"by Frank Herbert"`
- Test resolveInterpolation with multiple: `"{{title}} ({{year}})"` → `"Dune (1965)"`
- Test resolveAtomProp with bind vs value
- Test resolveArray returns array from path
- Test resolveTruthy: truthy values (true, 1, "hello"), falsy (false, 0, "", null, undefined)

Tests: `apps/web/src/app/components/organisms/widget-renderer/__tests__/widget-renderer.component.spec.ts`
- Use TestBed with all atom component imports
- Test atom node renders correct component (e.g. `{ atom: "text", value: "hello" }` → `<app-text>`)
- Test layout node renders children in correct container
- Test each node iterates and renders template for each item
- Test when node renders then/else correctly
- Test nested: each inside layout, when inside each
- Test data binding flows through context correctly

**3b. Canvas prompt bar** (`apps/web/src/app/components/organisms/canvas-prompt-bar/`)

Simple input component. Text input + submit button.

Inputs: `isGenerating: boolean`
Outputs: `promptSubmit: string`

Tests: `apps/web/src/app/components/organisms/canvas-prompt-bar/__tests__/canvas-prompt-bar.component.spec.ts`
- Test emits prompt on submit
- Test disables input while generating
- Test clears input after submit
- Test Enter key submits

**3c. Canvas view component** (`apps/web/src/app/pages/canvas-view/`)

Page component that loads canvas, shows prompt bar, renders widget list.

Follow the json-view.component.ts pattern with separate .ts/.html/.scss files.

Tests: `apps/web/src/app/pages/canvas-view/__tests__/canvas-view.component.spec.ts`
- Mock CanvasService and CanvasDataService
- Test loads canvas on route param change
- Test prompt bar calls addWidget
- Test widgets render WidgetRendererComponent for each widget
- Test delete widget removes it
- Test loading state shows while fetching

### Phase 4: E2E Tests (Playwright)

**4a. Canvas E2E test** (`e2e/canvas.spec.ts`)

Use the existing Playwright fixtures from `e2e/fixtures.ts` (authenticatedPage, testUser).

Test flow:

```typescript
import { test, expect } from './fixtures';

test.describe('Canvas', () => {
    test.describe('setup', () => {
        // Create a notebook and a JSON page with test data
        // via API calls using testUser.token
    });

    test('create canvas page from sidebar', async ({ authenticatedPage: page }) => {
        // Navigate to notebook
        // Click "New" → select "Canvas"
        // Verify canvas page loads with prompt bar
        // Verify empty state (no widgets)
    });

    test('generate widget from prompt', async ({ authenticatedPage: page }) => {
        // Navigate to canvas page
        // Type "Show my books" in prompt bar
        // Submit
        // Wait for widget to appear
        // Verify widget contains book data (title, author visible)
    });

    test('widget updates when JSON data changes', async ({ authenticatedPage: page }) => {
        // Navigate to canvas with existing widget
        // Update JSON page data via API (add a new book)
        // Verify the new book appears in the widget
    });

    test('delete widget', async ({ authenticatedPage: page }) => {
        // Navigate to canvas with widget
        // Click delete on widget
        // Verify widget is removed
    });

    test('regenerate widget with new prompt', async ({ authenticatedPage: page }) => {
        // Navigate to canvas with widget
        // Click edit/regenerate
        // Enter new prompt
        // Verify widget updates
    });
});
````

**Setup helpers** — add to the test or create a canvas-specific helper:

```typescript
async function createNotebookViaAPI(token: string, baseURL: string): Promise<string> {
    const res = await fetch(`${baseURL}/api/notebooks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: `Test Notebook ${Date.now()}` }),
    });
    const data = await res.json();
    return data.notebook._id;
}

async function createJsonPageViaAPI(
    token: string,
    baseURL: string,
    notebookId: string,
    title: string,
    data: unknown,
    description?: string,
): Promise<string> {
    // 1. Create page with type: 'json'
    // 2. PUT data to /api/json-documents/:id/data
    // 3. PUT description to /api/json-documents/:id/description
    // Return page ID
}

async function createCanvasPageViaAPI(
    token: string,
    baseURL: string,
    notebookId: string,
): Promise<string> {
    // Create page with type: 'canvas'
    // Return page ID
}
```

**Test data:**

```typescript
const BOOK_DATA = {
    books: [
        { id: '1', title: 'Dune', year: '1965', author: 'Frank Herbert' },
        { id: '2', title: 'Neuromancer', year: '1984', author: 'William Gibson' },
        { id: '3', title: 'Foundation', year: '1951', author: 'Isaac Asimov' },
    ],
};
```

### Phase 5: Playwright MCP Server Integration

Set up the Playwright MCP server so Claude Code can run and debug E2E tests interactively.

**5a. Install @anthropic/playwright-mcp** (if not already present):

```bash
bun add -d @anthropic/playwright-mcp
```

**5b. Configure in `.mcp.json`** (repo root or user config):

```json
{
    "mcpServers": {
        "playwright": {
            "command": "npx",
            "args": ["@anthropic/playwright-mcp", "--vision"]
        }
    }
}
```

This gives Claude Code browser automation tools to:

- Launch the app and navigate pages
- Take screenshots to verify visual rendering
- Interact with the canvas (type prompts, click widgets)
- Debug E2E test failures by visually inspecting the page

**5c. Add a test runner script** (`scripts/test-canvas.sh`):

```bash
#!/bin/bash
set -e

echo "Running Canvas unit tests..."
bun run test:api -- --testPathPattern="canvas"
bun run test:web -- --testPathPattern="canvas|widget-renderer|widget-expression"

echo "Running Canvas E2E tests..."
bunx playwright test e2e/canvas.spec.ts --reporter=list

echo "All canvas tests passed!"
```

## Important conventions

- API test files use `.test.ts`, web test files use `.spec.ts`
- Tests go in `__tests__/` subdirectories
- Use `vitest` (describe, it, expect, vi) — not Jasmine or Jest
- Use `describe.runIf(mongoAvailable)` for API tests that need DB
- Use `HttpClientTestingModule` + `HttpTestingController` for web HTTP tests
- Use Angular `TestBed.configureTestingModule()` for component/service tests
- Use `signal()` for state, `computed()` for derived, `toSignal()` for observables
- Use `HttpClient` for API calls (never raw fetch)
- Use Tailwind classes for styling (design tokens from CLAUDE.md)
- Separate .ts/.html/.scss files for components
- Run `bun run format` after writing code (Prettier enforced)
- Run `bun run typecheck` to verify no type errors

## Success criteria

All of these must pass:

1. `bun run test:api` — canvas repo and route tests green
2. `bun run test:web` — canvas service, data service, renderer, and component tests green
3. `bunx playwright test e2e/canvas.spec.ts` — full E2E flow passes
4. `bun run typecheck` — no type errors
5. `bun run format` — no formatting issues

```

```
