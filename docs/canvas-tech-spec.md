# Canvas — Technical Specification

**Feature**: AI-Generated Reactive Widget Canvas
**Status**: Draft
**Date**: 2026-03-04

---

## Architecture Overview

The canvas feature adds a new page type that renders AI-generated widget trees using existing atom components. It follows the same patterns as the JSON page type: a page record in `pages` with `type: 'canvas'`, a companion document in a `canvases` collection, a dedicated service, guard, route, and view component.

```
┌─────────────────────────────────────────────────────────┐
│  Canvas View Component                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Prompt Bar (natural language input)             │   │
│  └──────────────────────┬──────────────────────────┘   │
│                         │ prompt                        │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Canvas AI Service → LLM → CanvasWidget JSON    │   │
│  └──────────────────────┬──────────────────────────┘   │
│                         │ widget saved                  │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Canvas Data Service (Elf Store)                 │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐   │   │
│  │  │ widget:w1 │  │ widget:w2 │  │ widget:w3 │   │   │
│  │  │ data: {...}│  │ data: {...}│  │ data: {...}│   │   │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘   │   │
│  └────────┼───────────────┼───────────────┼────────┘   │
│           ▼               ▼               ▼             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ Widget       │ │ Widget       │ │ Widget       │   │
│  │ Renderer     │ │ Renderer     │ │ Renderer     │   │
│  │ (recursive)  │ │ (recursive)  │ │ (recursive)  │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│       ↓                ↓                ↓               │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Atom Components (text, badge, image, stat, ...) │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

Data flows in one direction: JSON page → Elf store → renderer → atoms. When JSON data changes (via API, code editor, or real-time SSE event), the Elf store updates, Angular signals propagate, and atoms re-render.

---

## Schemas (already implemented)

All schemas live in `packages/shared/src/schemas/`. The following were added or updated:

### `page.ts` — PageType

Added `'canvas'` to the `PageTypeSchema` union.

### `atoms.ts` — Widget DSL

The `WidgetNodeSchema` is a recursive TypeBox union discriminated by field presence:

```
WidgetNode =
  | { atom, bind?, value?, size?, color?, ... }     ← Atom (leaf)
  | { layout, children, gap?, columns?, ... }       ← Layout (container)
  | { each, as, template }                          ← Loop
  | { when, then, else? }                           ← Conditional
```

`WidgetTemplateSchema` is an alias for `WidgetNodeSchema` — the root of any widget can be any node type.

### `canvas.ts` — Canvas & Widget Documents

`CanvasSchema`: top-level document with `connectors[]` and `widgets[]`.
`CanvasWidgetSchema`: individual widget with `template` (WidgetNode tree), `dataPath`, `prompt`, `connectorId`, `position`.
`CanvasConnectorSchema`: data source reference with `connectorType`, `config`, `fields`.

---

## Widget DSL Reference

This is the format the AI writes. The renderer on the frontend walks this tree recursively.

### Atom Node

Maps directly to an atom component. The `atom` field selects the component; remaining fields map to its inputs.

```json
{
    "atom": "text",
    "bind": "$.title",
    "size": "lg",
    "weight": "bold"
}
```

`bind` resolves a value from the data context using dot-path notation. For string interpolation, use `{{expression}}` inside `value`:

```json
{
    "atom": "text",
    "value": "by {{author}} ({{year}})"
}
```

Atom-to-component mapping:

| `atom` value | Component          | Key props                               |
| ------------ | ------------------ | --------------------------------------- |
| `text`       | TextComponent      | `value/bind`, `size`, `color`, `weight` |
| `stat`       | StatComponent      | `value/bind`, `label`, `size`           |
| `badge`      | BadgeComponent     | `value/bind`, `color`                   |
| `image`      | ImageComponent     | `src`, `alt`, `fit`, `rounded`          |
| `icon`       | IconComponent      | `name`, `size`, `color`                 |
| `link`       | LinkComponent      | `href`, `label`, `external`             |
| `progress`   | ProgressComponent  | `value/bind`, `max`, `variant`, `color` |
| `timestamp`  | TimestampComponent | `value/bind`, `format`                  |
| `divider`    | DividerComponent   | `spacing`                               |
| `checkbox`   | CheckboxComponent  | `checked`, `label`, `disabled`          |
| `list`       | ListComponent      | `items`, `ordered`, `size`              |

### Layout Node

Containers that arrange children. The `layout` field selects the arrangement.

```json
{
    "layout": "grid",
    "columns": 3,
    "gap": "4",
    "children": [ ... ]
}
```

| `layout` value | Behavior                 | Extra props               |
| -------------- | ------------------------ | ------------------------- |
| `stack`        | Vertical stack (default) | `gap`, `align`, `padding` |
| `row`          | Horizontal row           | `gap`, `align`, `wrap`    |
| `grid`         | CSS grid                 | `columns`, `gap`          |
| `card`         | Bordered card container  | `header`, `padding`       |

### Each Node (Loop)

Iterates over an array in the data context. The `as` variable is scoped to the `template`.

```json
{
    "each": "$.books",
    "as": "book",
    "template": {
        "layout": "card",
        "children": [
            { "atom": "text", "bind": "{{book.title}}", "weight": "bold" },
            { "atom": "badge", "bind": "{{book.year}}", "color": "blue" }
        ]
    }
}
```

`each` is a JSONPath-lite expression starting with `$` (root data) or a scoped variable.
Inside the template, `{{book.fieldName}}` accesses each item's fields.

### When Node (Conditional)

Renders `then` if the expression is truthy, otherwise `else` (optional).

```json
{
    "when": "{{book.is_public_domain}}",
    "then": { "atom": "badge", "value": "Public Domain", "color": "green" },
    "else": { "atom": "badge", "value": "Copyrighted", "color": "red" }
}
```

Truthy = not null, not undefined, not false, not 0, not empty string.

---

## Frontend Implementation

### New Files

```
apps/web/src/app/
├── pages/canvas-view/
│   ├── canvas-view.component.ts
│   ├── canvas-view.component.html
│   └── canvas-view.component.scss
├── components/organisms/
│   ├── canvas-prompt-bar/
│   │   ├── canvas-prompt-bar.component.ts
│   │   ├── canvas-prompt-bar.component.html
│   │   └── canvas-prompt-bar.component.scss
│   └── widget-renderer/
│       ├── widget-renderer.component.ts
│       ├── widget-renderer.component.html
│       └── widget-renderer.component.scss
├── services/
│   ├── canvas.service.ts
│   └── canvas-data.service.ts
```

### Guard & Route (already implemented)

`CanvasPageGuard` in `page-type.guard.ts` matches pages with `type: 'canvas'`.
Route in `app.routes.ts` lazy-loads `CanvasViewComponent`.

### CanvasViewComponent

Top-level page component. Responsibilities: load canvas document, render prompt bar and widget list.

```typescript
@Component({
    selector: 'app-canvas-view',
    standalone: true,
    imports: [CommonModule, CanvasPromptBarComponent, WidgetRendererComponent],
    templateUrl: './canvas-view.component.html',
    styleUrl: './canvas-view.component.scss',
})
export class CanvasViewComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly canvasService = inject(CanvasService);
    private readonly canvasDataService = inject(CanvasDataService);

    readonly pageId = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')));
    readonly canvas = this.canvasService.canvas;
    readonly widgets = computed(() => this.canvas()?.widgets ?? []);
    readonly isLoading = this.canvasService.isLoading;

    constructor() {
        // Load canvas document when pageId changes
        effect(() => {
            const id = this.pageId();
            if (id) this.canvasService.loadCanvas(id);
        });
    }

    onPromptSubmit(prompt: string): void {
        this.canvasService.addWidget(prompt);
    }

    onWidgetDelete(widgetId: string): void {
        this.canvasService.removeWidget(widgetId);
    }

    onWidgetRegenerate(widgetId: string, newPrompt: string): void {
        this.canvasService.regenerateWidget(widgetId, newPrompt);
    }
}
```

Template:

```html
<div class="canvas-view">
    <app-canvas-prompt-bar
        (promptSubmit)="onPromptSubmit($event)"
        [isGenerating]="canvasService.isGenerating()"
    />

    @if (isLoading()) {
    <div class="canvas-loading">Loading canvas...</div>
    } @else {
    <div class="canvas-widgets">
        @for (widget of widgets(); track widget.id) {
        <app-widget-renderer
            [widget]="widget"
            [data]="canvasDataService.getWidgetData(widget.id)"
            (delete)="onWidgetDelete(widget.id)"
            (regenerate)="onWidgetRegenerate(widget.id, $event)"
        />
        }
    </div>
    }
</div>
```

### WidgetRendererComponent

Recursive component that walks the WidgetNode tree and renders atoms.

```typescript
@Component({
    selector: 'app-widget-renderer',
    standalone: true,
    imports: [
        CommonModule,
        // All atom components
        TextComponent,
        BadgeComponent,
        ImageComponent,
        IconComponent,
        StatComponent,
        ProgressComponent,
        TimestampComponent,
        DividerComponent,
        LinkComponent,
        ListComponent,
        CheckboxComponent,
    ],
    templateUrl: './widget-renderer.component.html',
    styleUrl: './widget-renderer.component.scss',
})
export class WidgetRendererComponent {
    readonly widget = input.required<CanvasWidget>();
    readonly data = input<unknown>(null);
    readonly delete = output<void>();
    readonly regenerate = output<string>();
}
```

The template uses recursive rendering. The core logic:

```html
<!-- Dispatch on node type -->
<ng-template #renderNode let-node let-context="context">
    @if (isAtomNode(node)) {
    <!-- Resolve bind/value against context, render atom -->
    @switch (node.atom) { @case ('text') {
    <app-text
        [value]="resolve(node, 'value', context)"
        [size]="node.size ?? 'md'"
        [color]="node.color ?? 'main'"
        [weight]="node.weight ?? 'normal'"
    />
    } @case ('badge') {
    <app-badge [value]="resolve(node, 'value', context)" [color]="node.color ?? 'gray'" />
    }
    <!-- ... other atoms -->
    } } @else if (isLayoutNode(node)) {
    <div [class]="layoutClass(node)">
        @for (child of node.children; track $index) {
        <ng-container *ngTemplateOutlet="renderNode; context: { $implicit: child, context }" />
        }
    </div>
    } @else if (isEachNode(node)) { @for (item of resolveArray(node.each, context); track $index) {
    <ng-container
        *ngTemplateOutlet="renderNode; context: {
                    $implicit: node.template,
                    context: extendContext(context, node.as, item)
                }"
    />
    } } @else if (isWhenNode(node)) { @if (resolveTruthy(node.when, context)) {
    <ng-container *ngTemplateOutlet="renderNode; context: { $implicit: node.then, context }" />
    } @else if (node.else) {
    <ng-container *ngTemplateOutlet="renderNode; context: { $implicit: node.else, context }" />
    } }
</ng-template>
```

**Node type guards** — discriminated by field presence:

```typescript
function isAtomNode(node: WidgetNode): boolean {
    return 'atom' in node;
}
function isLayoutNode(node: WidgetNode): boolean {
    return 'layout' in node;
}
function isEachNode(node: WidgetNode): boolean {
    return 'each' in node;
}
function isWhenNode(node: WidgetNode): boolean {
    return 'when' in node;
}
```

**Expression resolution** — resolves `bind` paths and `{{interpolation}}` against the data context:

```typescript
function resolve(node: AtomNode, prop: string, context: DataContext): unknown {
    // 1. Check bind (direct path resolution)
    if (node.bind) {
        return resolvePath(node.bind, context);
    }
    // 2. Check value (may contain {{interpolation}})
    const raw = node[prop];
    if (typeof raw === 'string' && raw.includes('{{')) {
        return raw.replace(/\{\{(.+?)\}\}/g, (_, path) => {
            return String(resolvePath(path.trim(), context) ?? '');
        });
    }
    return raw;
}

function resolvePath(path: string, context: DataContext): unknown {
    // Strip leading $. for root access
    const clean = path.replace(/^\$\./, '');
    return clean.split('.').reduce((obj, key) => obj?.[key], context as any);
}
```

**Data context** — the `each` node extends the context with a scoped variable:

```typescript
interface DataContext {
    $: unknown; // root data
    [key: string]: unknown; // scoped loop variables
}

function extendContext(parent: DataContext, key: string, value: unknown): DataContext {
    return { ...parent, [key]: value };
}
```

### CanvasService

Manages the canvas document lifecycle. Follows the same pattern as `JsonDocumentService`.

```typescript
@Injectable({ providedIn: 'root' })
export class CanvasService {
    private readonly http = inject(HttpClient);
    private readonly pageService = inject(PageService);

    // State
    private readonly _canvas = signal<Canvas | null>(null);
    private readonly _isLoading = signal(false);
    private readonly _isGenerating = signal(false);

    readonly canvas = this._canvas.asReadonly();
    readonly isLoading = this._isLoading.asReadonly();
    readonly isGenerating = this._isGenerating.asReadonly();

    async loadCanvas(pageId: string): Promise<void> {
        this._isLoading.set(true);
        const res = await firstValueFrom(
            this.http.get<{ document: Canvas }>(`/api/canvases/${pageId}`),
        );
        this._canvas.set(res.document);
        this._isLoading.set(false);
    }

    async addWidget(prompt: string): Promise<void> {
        this._isGenerating.set(true);
        const canvas = this._canvas();
        // POST to AI endpoint — returns generated CanvasWidget
        const res = await firstValueFrom(
            this.http.post<{ widget: CanvasWidget }>(
                `/api/canvases/${canvas!.id}/widgets/generate`,
                { prompt },
            ),
        );
        // Widget is already saved server-side; update local state
        this._canvas.update((c) => (c ? { ...c, widgets: [...c.widgets, res.widget] } : c));
        this._isGenerating.set(false);
    }

    async removeWidget(widgetId: string): Promise<void> {
        const canvas = this._canvas();
        await firstValueFrom(this.http.delete(`/api/canvases/${canvas!.id}/widgets/${widgetId}`));
        this._canvas.update((c) =>
            c ? { ...c, widgets: c.widgets.filter((w) => w.id !== widgetId) } : c,
        );
    }

    async regenerateWidget(widgetId: string, prompt: string): Promise<void> {
        this._isGenerating.set(true);
        const canvas = this._canvas();
        const res = await firstValueFrom(
            this.http.put<{ widget: CanvasWidget }>(
                `/api/canvases/${canvas!.id}/widgets/${widgetId}/regenerate`,
                { prompt },
            ),
        );
        this._canvas.update((c) =>
            c
                ? {
                      ...c,
                      widgets: c.widgets.map((w) => (w.id === widgetId ? res.widget : w)),
                  }
                : c,
        );
        this._isGenerating.set(false);
    }
}
```

### CanvasDataService

Manages the Elf store for widget data. Each widget's live data is an entity in the store.

```typescript
@Injectable({ providedIn: 'root' })
export class CanvasDataService {
    private readonly http = inject(HttpClient);
    private readonly jsonDocService = inject(JsonDocumentService);

    private readonly store = createStore(
        { name: 'canvas-data' },
        withEntities<{ id: string; data: unknown }>({ idKey: 'id' }),
    );

    private readonly _entities = toSignal(this.store.pipe(selectAllEntities()), {
        initialValue: [],
    });

    /** Get reactive data signal for a specific widget */
    getWidgetData(widgetId: string): Signal<unknown> {
        return computed(() => {
            const entity = this._entities().find((e) => e.id === widgetId);
            return entity?.data ?? null;
        });
    }

    /** Load data for a widget from its connector */
    async loadWidgetData(widget: CanvasWidget, connector: CanvasConnector): Promise<void> {
        if (connector.connectorType === 'json-page') {
            const pageId = (connector.config as any)?.pageId;
            if (!pageId) return;

            const doc = await this.jsonDocService.getDocument(pageId);
            const data = widget.dataPath ? resolvePath(widget.dataPath, doc.data) : doc.data;

            this.store.update(upsertEntities({ id: widget.id, data }));
        }
    }

    /** Subscribe to real-time updates for a connector's data source */
    subscribeToUpdates(widget: CanvasWidget, connector: CanvasConnector): void {
        if (connector.connectorType === 'json-page') {
            const pageId = (connector.config as any)?.pageId;
            // Listen for json.updated SSE events
            this.jsonDocService.onDataUpdate(pageId, (newData) => {
                const data = widget.dataPath ? resolvePath(widget.dataPath, newData) : newData;
                this.store.update(upsertEntities({ id: widget.id, data }));
            });
        }
    }

    /** Clear store when leaving canvas */
    clear(): void {
        this.store.update(deleteAllEntities());
    }
}
```

**Reactive flow:**

1. `CanvasViewComponent` loads, calls `canvasDataService.loadWidgetData()` for each widget.
2. Data lands in Elf store as `{ id: widgetId, data: resolvedData }`.
3. `WidgetRendererComponent` receives `data` as an input signal from `getWidgetData(widgetId)`.
4. Renderer builds a `DataContext` from the data and walks the template tree.
5. When JSON data changes (SSE `json.updated`), `subscribeToUpdates` pushes new data to the store.
6. Angular signals propagate → atoms re-render.

---

## Backend Implementation

### New Files

```
apps/api/src/
├── routes/canvases.ts
├── repositories/canvas.repo.ts
```

### Collection

`canvases` — one document per canvas page, indexed on `{ id: 1 }` and `{ userId: 1, notebookId: 1 }`.

### API Endpoints

All endpoints require authentication and notebook membership.

| Method | Path                                             | Description                                    |
| ------ | ------------------------------------------------ | ---------------------------------------------- |
| GET    | `/api/canvases/:id`                              | Fetch canvas document (auto-create if missing) |
| PUT    | `/api/canvases/:id`                              | Replace full canvas document                   |
| POST   | `/api/canvases/:id/widgets/generate`             | AI generates a widget from prompt              |
| PUT    | `/api/canvases/:id/widgets/:widgetId`            | Update a specific widget                       |
| PUT    | `/api/canvases/:id/widgets/:widgetId/regenerate` | Regenerate widget from new prompt              |
| DELETE | `/api/canvases/:id/widgets/:widgetId`            | Remove a widget                                |

### GET `/api/canvases/:id`

Returns the canvas document. If it doesn't exist yet (first load after page creation), auto-creates an empty canvas:

```typescript
export async function findOrCreateCanvas(
    pageId: string,
    notebookId: string,
    userId: string,
): Promise<Canvas> {
    const existing = await db.collection('canvases').findOne({ id: pageId });
    if (existing) return mapCanvas(existing);

    const canvas = {
        id: pageId,
        notebookId,
        userId,
        connectors: [],
        widgets: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    await db.collection('canvases').insertOne(canvas);
    return canvas;
}
```

### POST `/api/canvases/:id/widgets/generate`

The core AI endpoint. Receives a prompt, gathers context, calls Mercury Bot, validates the output, saves the widget.

```typescript
.post('/:id/widgets/generate', async ({ params, body, auth }) => {
    const { prompt } = body;
    const canvas = await findCanvas(params.id);
    const notebook = await findNotebook(canvas.notebookId);

    // 1. Gather data sources — find JSON pages in this notebook
    const jsonPages = await findPagesByNotebookAndType(canvas.notebookId, 'json');
    const dataSources = await Promise.all(
        jsonPages.map(async (page) => {
            const doc = await findJsonDocument(page.id);
            return {
                pageId: page.id,
                title: page.title,
                description: doc?.description, // user-written description
                shape: inferShape(doc?.data), // top-level keys + types
                sampleData: truncate(doc?.data, 3), // first 3 items of arrays
            };
        }),
    );

    // 2. Build AI prompt with atom catalog + data context
    const aiPrompt = buildCanvasAIPrompt({
        userPrompt: prompt,
        dataSources,
        atomCatalog: ATOM_CATALOG,
    });

    // 3. Call Mercury Bot (fallback: Claude API key)
    const aiResponse = await invokeMercuryBot(auth.user, aiPrompt);
    const widget = parseAndValidateWidget(aiResponse);

    // 4. Ensure connector exists for the selected data source
    const connectorId = ensureConnector(canvas, widget.connectorId);

    // 5. Save widget to canvas
    widget.id = crypto.randomUUID();
    widget.prompt = prompt;
    widget.createdAt = new Date().toISOString();

    await db.collection('canvases').updateOne(
        { id: params.id },
        { $push: { widgets: widget }, $set: { updatedAt: new Date().toISOString() } },
    );

    return { widget };
})
```

### AI Prompt Structure (Mercury Bot)

The system prompt sent to Mercury (or Claude fallback) includes:

1. **Role**: "You generate widget templates for a dashboard canvas."
2. **Atom catalog**: Every atom with its valid props and types (auto-generated from `AtomTypeSchema` and component metadata).
3. **Layout catalog**: `stack`, `row`, `grid`, `card` with valid props.
4. **Control flow**: `each` and `when` syntax with examples.
5. **Data sources**: Available JSON pages with their titles, descriptions, shapes, and sample data.
6. **Output format**: "Return a single JSON object matching the CanvasWidget schema."
7. **Constraints**: "Only use atoms from the catalog. Only reference fields that exist in the data. Always wrap repeating data in an `each` node."

The user prompt is passed as the user message.

Example system prompt excerpt:

```
Available atoms:
- text: { atom: "text", value/bind, size: "xs"|"sm"|"md"|"lg"|"xl", color: "main"|"muted"|"primary"|"error"|"success", weight: "normal"|"medium"|"bold" }
- badge: { atom: "badge", value/bind, color: "red"|"amber"|"blue"|"green"|"gray" }
- image: { atom: "image", src (supports {{binding}}), alt, fit: "cover"|"contain", rounded: boolean }
- stat: { atom: "stat", value/bind, label, size: "sm"|"md"|"lg" }
...

Available data sources:
- "Book Library" (pageId: "abc-123")
  Description: "My personal reading list — fiction and non-fiction books"
  Shape: { books: [{ id, title, year, author, wiki_url }] } (2 items)
- "Art Collection" (pageId: "def-456")
  Description: "Artwork collection from the Art Institute of Chicago API"
  Shape: { pagination: {...}, data: [{ id, title, artist_display, date_display, image_id, ... }] } (12 items)

Return JSON matching:
{ connectorId, dataPath, template: WidgetNode }
```

### Widget Validation

After parsing the AI response, validate:

1. JSON parses correctly.
2. All `atom` values are in `AtomTypeSchema`.
3. All `layout` values are in `LayoutTypeSchema`.
4. `each` nodes have `as` and `template`.
5. `when` nodes have `then`.
6. `bind` paths reference fields that exist in the data source.
7. Tree depth does not exceed 10 levels.

If validation fails, retry once with the error message appended to the prompt.

---

## Data Flow Diagram

```
JSON Page (data source)
    │
    │  PUT /api/json-documents/:id/data
    │  ─── or ─── SSE json.updated event
    ▼
JsonDocumentService (existing)
    │
    │  onDataUpdate callback
    ▼
CanvasDataService (Elf store)
    │
    │  upsertEntities({ id: widgetId, data })
    ▼
Elf Store entity: { id: "w1", data: { books: [...] } }
    │
    │  Angular signal propagation
    ▼
WidgetRendererComponent
    │  DataContext = { $: data, ...scopedVars }
    │
    │  walks WidgetNode tree recursively
    ▼
Atom Components render with resolved values
```

---

## Implementation Phases

### Phase 1: Core (MVP)

| #   | Task                                                          | Files                                | Estimate |
| --- | ------------------------------------------------------------- | ------------------------------------ | -------- |
| 1   | Canvas repository + API routes (CRUD)                         | `canvas.repo.ts`, `canvases.ts`      | 1 day    |
| 2   | Canvas service (frontend)                                     | `canvas.service.ts`                  | 0.5 day  |
| 3   | Canvas data service (Elf store + JSON page subscription)      | `canvas-data.service.ts`             | 1 day    |
| 4   | Widget renderer component (recursive, all atoms)              | `widget-renderer/`                   | 2 days   |
| 5   | Expression resolver (bind, interpolation, path resolution)    | Utility in renderer                  | 0.5 day  |
| 6   | Canvas view component + prompt bar                            | `canvas-view/`, `canvas-prompt-bar/` | 1 day    |
| 7   | AI widget generation endpoint + prompt engineering            | `canvases.ts` (generate route)       | 2 days   |
| 8   | Sidebar integration (create canvas page)                      | `new-note.component.ts`, sidebar     | 0.5 day  |
| 9   | Testing (renderer, expression resolver, AI output validation) | `*.spec.ts`                          | 2 days   |

**Total Phase 1: ~10.5 days**

### Phase 2: Layout & Polish

| #   | Task                                                            | Estimate |
| --- | --------------------------------------------------------------- | -------- |
| 1   | Grid-based drag-and-drop widget positioning                     | 3 days   |
| 2   | Widget resize handles                                           | 1 day    |
| 3   | Widget loading/error states                                     | 0.5 day  |
| 4   | Prompt refinement (edit existing widget with follow-up prompts) | 1 day    |
| 5   | Poll interval for auto-refresh                                  | 0.5 day  |

### Phase 3: Advanced

| #   | Task                                            | Estimate |
| --- | ----------------------------------------------- | -------- |
| 1   | External API connectors                         | 3 days   |
| 2   | Canvas-level shared filters/variables           | 2 days   |
| 3   | Widget-to-widget interaction                    | 2 days   |
| 4   | Real-time collaborative canvas (SSE broadcasts) | 2 days   |

---

## Testing Strategy

### Unit Tests

**Expression resolver**: test `resolvePath`, `resolve` (interpolation), `resolveArray`, `resolveTruthy` with nested objects, missing fields, edge cases.

**Widget renderer**: render each node type in isolation — atom, layout, each, when. Verify atoms receive correct inputs. Test nested each loops (each inside each).

**Canvas service**: mock HTTP, verify state transitions (loading, generating, idle). Verify widget add/remove/regenerate update the signal.

**Canvas data service**: verify Elf store updates propagate to `getWidgetData()` signals. Test `loadWidgetData` with different data shapes and dataPath values.

### Integration Tests

**AI generation**: send known prompts with known data shapes, validate the returned widget template renders without errors. Test error recovery (invalid AI output → retry).

**Reactive updates**: create canvas with widget → update JSON page data → verify widget re-renders with new data.

### E2E Tests

Full flow: create notebook → create JSON page with books → create canvas → prompt "show my books" → verify book cards appear → add a book to JSON → verify card appears on canvas.

---

## Resolved Decisions

1. **AI model**: Use the user's **Mercury Bot** via the existing bot infrastructure. Fall back to the user's Claude API key if Mercury is unavailable. The `/widgets/generate` endpoint invokes Mercury through the same bot invocation pattern used by the chat view — no new AI integration needed.

2. **Data source inference**: The AI **infers** which JSON page to use. The generate endpoint sends all JSON pages in the notebook (title, description, data shape, sample) to the LLM. The AI picks the best match and returns the `connectorId` in its response.

3. **Widget sizing**: The AI **picks** position and size based on the data shape and widget type. A stat widget gets a small card (`w: 4, h: 2`), an image grid gets full-width (`w: 12, h: 6`), etc. Defaults are applied from the template.

4. **Offline / caching**: Canvas documents use an **Elf store with IndexedDB hydration**, following the notification and page service patterns. Add `CANVAS` and `CANVAS_DATA` to `DB_STORES`. Canvas loads from cache first, then syncs with server.

5. **JSON page descriptions**: JSON documents gain a `description` field so the AI has semantic context about each data source. The JSON view page gets a description editor (text input below the title). The description is sent to the AI alongside the data shape.

## Remaining Technical Questions

1. **Template caching**: Should generated templates be cached per data-shape hash so identical prompts on similar data don't re-call the LLM? (Defer to Phase 2.)

2. **Expression language scope**: Phase 1 supports dot-path access only. Should we add basic operators (`>`, `==`, `+`) in Phase 2 for computed values in `when` conditions?

3. **Widget isolation**: If a widget's template is malformed (e.g. infinite loop in `each`), how do we prevent it from crashing the entire canvas? Apply a `maxIterations: 1000` guard on `each` and a 500ms rendering timeout per widget.

---

## JSON Document Description (new)

### Schema Change

Add `description` to `JsonDocumentSchema` in `packages/shared/src/schemas/json-document.ts`:

```typescript
description: Type.Optional(Type.String({ maxLength: 500 })),
```

Also add to `CreateJsonDocumentSchema` and a new update input, plus add to the `PATCH /api/json-documents/:id` or a dedicated `PUT /api/json-documents/:id/description` endpoint.

### Frontend Change

In `json-view.component.html`, add a description text input below the page title:

```html
<input
    type="text"
    class="w-full text-sm text-[var(--color-text-muted)] bg-transparent
           border-none outline-none placeholder:text-[var(--color-text-muted)]/50"
    placeholder="Add a description to help AI understand this data..."
    [value]="description()"
    (blur)="onDescriptionChange($event)"
/>
```

This is a lightweight inline editor — no modal, no rich text. It saves on blur with a debounce, same as the title editor.

### AI Context

The description is included in the data source context sent to Mercury:

```
Available data sources:
- "Book Library" (pageId: "abc-123")
  Description: "My personal reading list — fiction and non-fiction books"
  Shape: { books: [{ id, title, year, author, wiki_url }] } (2 items)
```

This helps Mercury distinguish between similarly-structured JSON pages and pick the right one based on the user's prompt.
