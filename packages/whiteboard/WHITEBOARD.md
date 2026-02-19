# @maple/whiteboard Technical Documentation

`@maple/whiteboard` is a standalone, reusable Angular whiteboard package that provides a real-time collaborative infinite canvas with freehand drawing, shapes, selection, and multi-user awareness. It is fully decoupled from the host application through dependency injection.

---

## Architecture

The package is organized into two layers:

```
packages/whiteboard/src/
├── index.ts                        # Public API barrel
├── config/
│   ├── interfaces.ts               # Abstract DI interfaces
│   └── whiteboard.config.ts        # provideWhiteboard() helper
├── collaboration/                  # Layer 2: Y.js sync + awareness
│   ├── tokens.ts                   # Angular InjectionTokens
│   ├── whiteboard-document.service.ts
│   └── yjs-ws-provider.ts
└── core/                           # Layer 1: Canvas + tools + rendering
    ├── models/
    │   ├── types.ts                # Coordinate types, constants
    │   └── user-colors.ts          # Deterministic user color assignment
    ├── tools/
    │   ├── tool.interface.ts       # Tool / ToolContext / ToolResult
    │   ├── pen.tool.ts             # Freehand drawing
    │   ├── select.tool.ts          # Selection + drag
    │   └── shape.tool.ts           # Rectangle, ellipse, line, arrow
    └── components/
        ├── whiteboard/             # Root component (orchestrator)
        ├── canvas/                 # HTML Canvas + pointer handling
        │   └── renderer.service.ts # Canvas 2D draw calls
        ├── toolbar/                # Tool/color/size picker + zoom
        └── cursors/                # Remote cursor overlay
```

**Layer 1 (Core)** handles all canvas rendering, pointer events, tool state, and coordinate transforms. It has zero dependency on networking or collaboration.

**Layer 2 (Collaboration)** adds Y.js document management, WebSocket synchronization, IndexedDB persistence, and awareness (cursors, selections, in-progress strokes shared between peers). It depends on Layer 1 models and on abstract interfaces provided via injection tokens.

A consumer can use Layer 1 alone for local-only drawing, or include Layer 2 for real-time collaboration.

---

## Dependency Injection

The package declares no concrete dependencies on host application services. Instead, it defines abstract interfaces and Angular `InjectionToken`s that the consuming app must provide.

### Interfaces (`config/interfaces.ts`)

| Interface                     | Purpose                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `WhiteboardUserProvider`      | Current user identity (`user` signal, `accessToken` signal, `initReady$` observable)                                |
| `WhiteboardConnectivity`      | Network availability (`canSync` signal)                                                                             |
| `WhiteboardRealtimeTransport` | WebSocket transport for Y.js sync (`joinMemo`, `leaveMemo`, `sendMemoUpdate`, `sendAwarenessUpdate`, `onMemoEvent`) |
| `WhiteboardOfflineQueue`      | Queue create/sync actions for offline-first flow (`enqueue`, `waitForAction`)                                       |
| `WhiteboardVisibility`        | Browser tab visibility for re-sync on focus (`becameVisible$` observable)                                           |
| `WhiteboardPageStore`         | Local page storage for offline-first whiteboard creation (`addLocalPage`, `persistToIndexedDB`)                     |
| `WhiteboardConfig`            | Toolbar customization (tools, colors, sizes, zoom controls)                                                         |

### Tokens (`collaboration/tokens.ts`)

| Token                           | Interface                     | Required |
| ------------------------------- | ----------------------------- | -------- |
| `WHITEBOARD_USER_PROVIDER`      | `WhiteboardUserProvider`      | Yes      |
| `WHITEBOARD_CONNECTIVITY`       | `WhiteboardConnectivity`      | Yes      |
| `WHITEBOARD_REALTIME_TRANSPORT` | `WhiteboardRealtimeTransport` | Yes      |
| `WHITEBOARD_OFFLINE_QUEUE`      | `WhiteboardOfflineQueue`      | No       |
| `WHITEBOARD_VISIBILITY`         | `WhiteboardVisibility`        | No       |
| `WHITEBOARD_PAGE_STORE`         | `WhiteboardPageStore`         | No       |
| `WHITEBOARD_CONFIG`             | `WhiteboardConfig`            | No       |

Optional tokens are injected with `inject(TOKEN, { optional: true })` and guarded with null checks throughout the service.

### Providing Tokens

The package exports a `provideWhiteboard()` helper:

```ts
import { provideWhiteboard, WHITEBOARD_USER_PROVIDER, ... } from '@maple/whiteboard';

provideWhiteboard({
    userProvider:       { provide: WHITEBOARD_USER_PROVIDER, useExisting: AuthService },
    connectivity:       { provide: WHITEBOARD_CONNECTIVITY, useExisting: ConnectivityService },
    realtimeTransport:  { provide: WHITEBOARD_REALTIME_TRANSPORT, useExisting: RealtimeWSService },
    offlineQueue:       { provide: WHITEBOARD_OFFLINE_QUEUE, useExisting: OfflineQueueService },   // optional
    visibility:         { provide: WHITEBOARD_VISIBILITY, useExisting: VisibilityService },         // optional
    pageStore:          { provide: WHITEBOARD_PAGE_STORE, useExisting: PageService },               // optional
    config:             { defaultColor: '#000000', showZoomControls: true },                        // optional
});
```

Or provide tokens manually (as `apps/web` does in `whiteboard-providers.ts`):

```ts
export const whiteboardProviders: Provider[] = [
    { provide: WHITEBOARD_USER_PROVIDER, useExisting: AuthService },
    { provide: WHITEBOARD_CONNECTIVITY, useExisting: ConnectivityService },
    { provide: WHITEBOARD_REALTIME_TRANSPORT, useExisting: RealtimeWSService },
    { provide: WHITEBOARD_OFFLINE_QUEUE, useExisting: OfflineQueueService },
    { provide: WHITEBOARD_VISIBILITY, useExisting: VisibilityService },
    { provide: WHITEBOARD_PAGE_STORE, useExisting: PageService },
];
```

---

## Components

### `WhiteboardComponent` (root)

**Selector:** `app-whiteboard`

The top-level orchestrator. Manages document lifecycle, tool switching, and wires child components together.

| Input          | Type                | Description                                                  |
| -------------- | ------------------- | ------------------------------------------------------------ |
| `pageId`       | `string` (required) | Whiteboard document ID                                       |
| `parentPageId` | `string \| null`    | Parent memo page ID for embedded whiteboards (authorization) |

**Behavior:**

- On `pageId` change: calls `WhiteboardDocumentService.openDocument()` to load the Y.Doc
- Initializes tools: `SelectTool`, `PenTool`, `ShapeTool` (rectangle, ellipse, line, arrow)
- Delegates camera, cursor position, and canvas size updates to `WhiteboardDocumentService`
- Handles keyboard shortcuts for tool switching and zoom

**Keyboard shortcuts:**

| Key            | Action         |
| -------------- | -------------- |
| `V`            | Select tool    |
| `P`            | Pen tool       |
| `L`            | Line tool      |
| `R`            | Rectangle tool |
| `O`            | Ellipse tool   |
| `A`            | Arrow tool     |
| `Ctrl/Cmd + =` | Zoom in        |
| `Ctrl/Cmd + -` | Zoom out       |
| `Ctrl/Cmd + 0` | Reset zoom     |

### `CanvasComponent`

**Selector:** `app-whiteboard-canvas`

The HTML Canvas element with pointer event handling, camera transforms, and frame-based rendering.

| Input         | Type                        |
| ------------- | --------------------------- |
| `whiteboard`  | `WhiteboardYDoc` (required) |
| `pageId`      | `string` (required)         |
| `activeTool`  | `Tool \| null` (required)   |
| `strokeColor` | `string`                    |
| `strokeSize`  | `number`                    |

| Output                 | Type                |
| ---------------------- | ------------------- |
| `cameraChange`         | `Camera`            |
| `cursorPositionChange` | `CanvasPoint`       |
| `sizeChange`           | `{ width, height }` |

**Rendering pipeline:**

1. `requestRender()` batches via `requestAnimationFrame`
2. `RendererService.render()` clears canvas, applies camera transform, renders layers/elements, remote state, tool previews
3. Y.Doc `observeDeep` on elements/layers/metadata triggers re-renders automatically

**Pointer handling:**

- Pointer events are translated from screen to canvas coordinates via `RendererService.screenToCanvas()`
- Space+drag or middle-click enables panning
- Scroll wheel zooms centered on cursor position
- Two-finger pinch zoom on touch devices
- `pointercancel` commits in-progress strokes (handles system interrupts)

**Camera:**

- Zoom range: 0.1x to 4x (`CAMERA_CONSTRAINTS`)
- Transform: translate to center, scale by zoom, translate by camera offset

### `ToolbarComponent`

**Selector:** `app-whiteboard-toolbar`

Floating toolbar with tool buttons, color picker, stroke size picker, and zoom controls.

**Default tools:** Select, Pen, Line, Rectangle, Ellipse, Arrow

**Default colors:** Black, Gray, Red, Orange, Green, Blue, Purple, Pink (`COLOR_PALETTE`)

**Default sizes:** 2, 4, 8, 16 px (`STROKE_SIZES`)

### `CursorsComponent`

**Selector:** `app-whiteboard-cursors`

Renders colored cursor overlays for remote collaborators. Reads Y.js Awareness state, filters out the local user, and transforms canvas coordinates to screen position.

Each cursor shows:

- SVG icon based on the remote user's active tool
- User name label
- User color (deterministic from user ID)

---

## Tools

All tools implement the `Tool` interface:

```ts
interface Tool {
    readonly name: WhiteboardToolType;
    readonly cursor: string;
    activate(context: ToolContext): void;
    deactivate(): void;
    onPointerDown(event: CanvasPointerEvent): ToolResult;
    onPointerMove(event: CanvasPointerEvent): ToolResult;
    onPointerUp(event: CanvasPointerEvent): ToolResult;
    onPointerLeave?(): void;
    onKeyDown?(event: KeyboardEvent): boolean;
}
```

`ToolContext` provides access to the document, camera, selection, tool state signals, current color/size, and a render callback. Tools update `toolState` for in-progress previews (pending strokes, shapes, selection boxes) and commit to the Y.Doc on completion.

### PenTool

Freehand drawing with pressure sensitivity. Uses `perfect-freehand` for smooth filled stroke outlines and `simplify-js` to reduce point counts before storage.

**Flow:**

1. `onPointerDown` → start collecting points
2. `onPointerMove` → accumulate points, update `toolState.pendingStroke`, broadcast via awareness (every 3rd point, simplified for network efficiency)
3. `onPointerUp` → simplify points, normalize relative to bounding box, commit stroke element to Y.Doc

**Y.Doc structure for a stroke:**

```
Y.Map {
    id: string (nanoid base58, 16 chars)
    type: 'stroke'
    createdBy: string
    createdAt: number
    updatedAt: number
    transform: Y.Map { x, y, rotation, scaleX, scaleY }
    points: Y.Array<{ x, y, pressure }>  (normalized to bounding box origin)
    style: Y.Map { color, size, opacity }
}
```

### SelectTool

Selection and drag-to-move. Supports single click, shift-click multi-select, box selection, and Ctrl/Cmd+A select-all.

**Hit testing:** Iterates layers in reverse order (top-first). For strokes, checks point proximity with padding. For shapes, checks bounding box. For text, approximates width from content length and font size.

**Drag:** Stores initial positions of selected elements, applies delta on each `pointerMove` inside a Y.Doc transaction.

### ShapeTool

Draws rectangles, ellipses, lines, and arrows. Constructed with a `shapeType` parameter. During drag, updates `toolState.pendingShape` and broadcasts via awareness. On release, commits to Y.Doc if the shape exceeds a 5px minimum dimension.

**Y.Doc structure for a shape:**

```
Y.Map {
    id, type: 'shape', shapeType: 'rectangle' | 'ellipse' | 'line' | 'arrow'
    transform: Y.Map { x, y, rotation, scaleX, scaleY }
    width, height
    style: Y.Map { strokeColor, fillColor?, strokeWidth, opacity }
    startPoint?, endPoint?  (for line/arrow, relative to bounding box)
}
```

---

## Rendering (`RendererService`)

Canvas 2D rendering service. Handles DPR-aware sizing, camera transforms, and draws committed elements, remote state, and tool previews.

**Render order:**

1. Clear canvas
2. Apply camera transform (translate center → scale → translate offset)
3. Render layers bottom-to-top, respecting visibility and opacity
4. Render remote selections (dashed box, remote user color, 30% alpha)
5. Render local selections (dashed box, blue, 100% alpha)
6. Render remote pending strokes (from awareness)
7. Render remote pending shapes (from awareness)
8. Render local tool state (pending stroke, pending shape, selection box)

**Element types:**

- **Stroke:** `perfect-freehand` generates filled polygon from pressure-sensitive points
- **Shape:** Canvas primitives (`strokeRect`, `ellipse`, `moveTo/lineTo`, arrowhead math)
- **Text:** `fillText` with configurable font size, family, color, alignment

**Coordinate transforms:**

- `screenToCanvas(screenX, screenY, camera, canvasRect) → CanvasPoint`
- `canvasToScreen(canvasX, canvasY, camera, canvasRect) → { x, y }`

---

## Collaboration

### `WhiteboardDocumentService`

**Provided in:** `root`

Manages the full Y.Doc lifecycle: create, open, sync, and close whiteboard documents.

**Document open flow:**

1. Create `Y.Doc` and `Awareness`
2. Setup IndexedDB persistence (`y-indexeddb`) and await sync (offline-first)
3. If document is empty, initialize default structure (metadata, one layer, empty elements map)
4. If online, fetch initial state from REST API and connect WebSocket provider

**Default Y.Doc structure:**

```
Y.Doc
├── metadata (Y.Map)
│   ├── camera: { x, y, zoom }
│   └── activeLayerId: string
├── layers (Y.Array<Y.Map>)
│   └── [0] Y.Map { id, name, visible, locked, opacity, elements: string[] }
└── elements (Y.Map<Y.Map>)
    └── [elementId] → Y.Map { id, type, transform, style, ... }
```

**`WhiteboardYDoc` (return type of `openDocument`):**

```ts
interface WhiteboardYDoc {
    ydoc: Y.Doc;
    awareness: Awareness;
    metadata: Y.Map<unknown>;
    layers: Y.Array<Y.Map<unknown>>;
    elements: Y.Map<Y.Map<unknown>>;
}
```

**Key methods:**

| Method                                      | Description                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `openDocument(pageId, parentPageId?)`       | Open/load a whiteboard document. Returns `WhiteboardYDoc`.                 |
| `closeDocument(pageId)`                     | Destroy Y.Doc, persistence, and WebSocket provider.                        |
| `createWhiteboard(notebookId?)`             | Create a new whiteboard (offline-capable). Returns `{ page, whiteboard }`. |
| `addElement(pageId, element)`               | Programmatically add an element to the active layer.                       |
| `updateElement(pageId, elementId, updates)` | Partially update element properties.                                       |
| `deleteElement(pageId, elementId)`          | Remove element from elements map and all layers.                           |
| `updateCamera(pageId, camera)`              | Persist camera state to Y.Doc metadata.                                    |
| `updateCursor(pageId, x, y)`                | Update cursor position in awareness.                                       |
| `updateActiveTool(pageId, tool)`            | Update active tool in awareness.                                           |
| `getSyncStatus(pageId)`                     | Returns `'synced' \| 'syncing' \| 'pending'`.                              |

**Offline-first creation** (when `WhiteboardOfflineQueue` and `WhiteboardPageStore` are provided):

1. Create Y.Doc and initialize structure
2. Create page metadata and persist to IndexedDB via `WhiteboardPageStore`
3. Enqueue `create-note` and `sync-notebook` actions via `WhiteboardOfflineQueue`
4. When online, wait for creation to complete, then connect WebSocket

### `YJSWSProvider`

Bridges the Y.Doc with the host app's WebSocket connection via the `WhiteboardRealtimeTransport` interface.

**Responsibilities:**

- Joins a "memo room" on connect, leaves on disconnect
- Sends local Y.Doc updates to server (skips remote-origin updates to prevent loops)
- Receives and applies remote Y.Doc updates
- Sends/receives Awareness updates (cursor, selection, pending strokes)
- Handles initial document state from server (`ydoc-init` event)
- After initial sync, sends client-side diff back to server
- Supports read-only mode (suppresses outgoing updates when `canWrite` is false)

**Event types handled:**

| Event              | Action                                             |
| ------------------ | -------------------------------------------------- |
| `ydoc-init`        | Apply initial state, mark synced, send client diff |
| `ydoc-update`      | Apply remote update to Y.Doc                       |
| `awareness-update` | Apply remote awareness state                       |
| `peer-join`        | Notify via callback                                |
| `peer-leave`       | Notify via callback                                |
| `joined`           | Check `canWrite` flag for read-only mode           |

---

## Coordinate System

The whiteboard uses two coordinate spaces:

- **Screen coordinates** (`ScreenPoint`): Pixel position relative to the viewport. Used for pointer events.
- **Canvas coordinates** (`CanvasPoint`): Position in the infinite canvas, independent of camera. Used for element positions and hit testing. Optionally includes `pressure` (0-1) from stylus/touch.

**Camera transform** maps between them:

```
canvasX = (screenX - centerX) / zoom + cameraX + centerX
canvasY = (screenY - centerY) / zoom + cameraY + centerY
```

---

## Y.js Awareness State

Each connected client broadcasts awareness state used for real-time collaboration features:

```ts
interface WhiteboardAwarenessState {
    user?: { id: string; name: string; color: string };
    cursor?: { x: number; y: number };
    activeTool?: WhiteboardToolType;
    selectedIds?: string[];
    pendingStroke?: { points: CanvasPoint[]; color: string; size: number };
    pendingShape?: { type: ShapeType; startPoint: CanvasPoint; endPoint: CanvasPoint; style: {...} };
}
```

This enables:

- Remote cursor rendering with user name and tool icon
- Remote selection highlighting with user color
- Live preview of strokes and shapes being drawn by other users

---

## User Colors

Deterministic color assignment for collaboration features:

- `getUserColor(userId: string)` — Hash-based color from a 9-color palette, consistent across sessions
- `getColorForClientId(clientId: number)` — Modulo-based color for Y.js client IDs

Palette: red, orange, amber, lime, emerald, cyan, blue, violet, pink.

---

## Integration in `apps/web`

The Just Maple web app integrates the package with:

1. **`whiteboard-providers.ts`** — Maps tokens to existing app services via `useExisting` (no adapter classes)
2. **`app.config.ts`** — Registers `...whiteboardProviders` at app level
3. **`WhiteboardViewComponent`** — Full-page whiteboard view, imports `WhiteboardComponent` from `@maple/whiteboard`
4. **`WhiteboardEmbedComponent`** — Inline whiteboard embed in memos, wraps `WhiteboardComponent` with delete button
5. **`NewNoteComponent`** — Imports `WhiteboardDocumentService` from `@maple/whiteboard` for creation

---

## Peer Dependencies

| Package            | Version   | Purpose                                                |
| ------------------ | --------- | ------------------------------------------------------ |
| `@angular/core`    | >=19      | Component framework                                    |
| `@angular/common`  | >=19      | `CommonModule`, `isPlatformBrowser`                    |
| `@maple/shared`    | workspace | Shared types (`Camera`, `Page`, `StrokeElement`, etc.) |
| `yjs`              | >=13      | CRDT document                                          |
| `y-indexeddb`      | >=9       | Offline persistence                                    |
| `y-protocols`      | >=1       | Awareness protocol                                     |
| `rxjs`             | >=7       | Observables for connectivity/visibility                |
| `perfect-freehand` | >=1       | Pressure-sensitive stroke rendering                    |
| `simplify-js`      | >=1       | Point reduction for storage efficiency                 |
| `nanoid`           | >=5       | Element ID generation (base58, 16 chars)               |
| `tslib`            | >=2       | TypeScript runtime helpers                             |

---

## Key Files Reference

| File                                                 | Purpose                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `config/interfaces.ts`                               | 7 abstract interfaces for DI                                 |
| `collaboration/tokens.ts`                            | 7 `InjectionToken` definitions                               |
| `config/whiteboard.config.ts`                        | `provideWhiteboard()` helper and `WhiteboardProviderOptions` |
| `collaboration/whiteboard-document.service.ts`       | Y.Doc lifecycle, sync, offline creation                      |
| `collaboration/yjs-ws-provider.ts`                   | WebSocket bridge for Y.js updates and awareness              |
| `core/components/whiteboard/whiteboard.component.ts` | Root orchestrator component                                  |
| `core/components/canvas/canvas.component.ts`         | Canvas element, pointer events, camera                       |
| `core/components/canvas/renderer.service.ts`         | Canvas 2D rendering pipeline                                 |
| `core/components/toolbar/toolbar.component.ts`       | Tool/color/size/zoom UI                                      |
| `core/components/cursors/cursors.component.ts`       | Remote cursor overlay                                        |
| `core/tools/tool.interface.ts`                       | `Tool`, `ToolContext`, `ToolResult` interfaces               |
| `core/tools/pen.tool.ts`                             | Freehand drawing with `perfect-freehand`                     |
| `core/tools/select.tool.ts`                          | Selection, multi-select, drag-move                           |
| `core/tools/shape.tool.ts`                           | Rectangle, ellipse, line, arrow                              |
| `core/models/types.ts`                               | Coordinate types, constants, palettes                        |
| `core/models/user-colors.ts`                         | Deterministic user color utilities                           |
