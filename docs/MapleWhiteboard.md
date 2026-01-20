# Maple Whiteboard

## Product Specification & Technical Design

---

## Overview

Maple Whiteboard is a collaborative drawing feature within the Maple app, enabling users to sketch ideas, annotate content, and brainstorm visually with others in real-time. Built for simplicity and fluidity, it prioritizes a natural drawing experience with smooth freehand strokes and intuitive shape tools.

---

## Goals

- **Buttery smooth drawing**: Natural ink-like freehand strokes using perfect-freehand
- **Real-time collaboration**: See others draw, select, and manipulate objects live
- **Cross-platform**: Works seamlessly on desktop and mobile (touch + stylus support)
- **Simple and focused**: Essential tools only, no feature bloat

## Non-Goals

- Advanced vector editing (bezier handles, point manipulation)
- Image import/annotation (future consideration)
- Presentation mode
- Version history

---

## User Experience

### Canvas Interaction

| Action | Desktop                          | Mobile             |
| ------ | -------------------------------- | ------------------ |
| Pan    | Middle-mouse drag / Space + drag | Two-finger drag    |
| Zoom   | Scroll wheel / Ctrl + scroll     | Pinch              |
| Draw   | Left-click drag                  | Single finger drag |
| Select | Click / Drag marquee             | Tap / Drag marquee |

### Floating Toolbar

Centered at bottom of canvas, minimal footprint, auto-hides on mobile during drawing.

```
┌─────────────────────────────────────────────────────────┐
│  [↖] [✏] [—] [□] [○] [→] [T] [🧽]  |  [↩] [↪]  |  [⚙]  │
└─────────────────────────────────────────────────────────┘
     │   │   │   │   │   │   │   │       │    │       │
     │   │   │   │   │   │   │   │       │    │       └─ Settings/Export
     │   │   │   │   │   │   │   │       │    └─ Redo
     │   │   │   │   │   │   │   │       └─ Undo
     │   │   │   │   │   │   │   └─ Eraser
     │   │   │   │   │   │   └─ Text
     │   │   │   │   │   └─ Arrow
     │   │   │   │   └─ Ellipse
     │   │   │   └─ Rectangle
     │   │   └─ Line
     │   └─ Pen (freehand)
     └─ Select
```

### Secondary Controls

Appear contextually above toolbar when relevant tool is active:

- **Pen/Shapes**: Color picker, stroke width slider
- **Selection**: Delete button, bring forward/send back
- **Text**: Font size, alignment

### Presence Indicators

- Avatars of active collaborators in top-right corner
- Colored cursors with name labels on canvas
- Subtle highlight on elements others have selected

---

## Information Architecture

### Data Model

```typescript
interface Whiteboard {
    id: string;
    mapleItemId: string; // Parent Maple item reference
    createdAt: Date;
    updatedAt: Date;
    layers: Layer[];
}

interface Layer {
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    elements: Element[];
}

type Element = Stroke | Shape | Text;

interface BaseElement {
    id: string;
    createdBy: string; // User ID
    createdAt: number; // Timestamp for ordering
    transform: Transform;
}

interface Transform {
    x: number;
    y: number;
    rotation: number; // Radians
    scaleX: number;
    scaleY: number;
}

interface Stroke extends BaseElement {
    type: 'stroke';
    points: StrokePoint[];
    color: string; // Hex
    size: number; // Base stroke width
    complete: boolean; // False while actively drawing
}

interface StrokePoint {
    x: number;
    y: number;
    pressure: number; // 0-1, defaults to 0.5 for mouse
}

interface Shape extends BaseElement {
    type: 'rectangle' | 'ellipse' | 'line' | 'arrow';
    width: number;
    height: number;
    fill: string | null; // Null for no fill
    stroke: string;
    strokeWidth: number;
}

interface Text extends BaseElement {
    type: 'text';
    content: string;
    fontSize: number;
    color: string;
    width: number; // Text box width
}
```

### Yjs Document Structure

```typescript
const doc = new Y.Doc()

// Persistent state
const layers = doc.getArray<Y.Map>('layers')
const metadata = doc.getMap('metadata')

// Each layer contains elements array
// layer.get('elements') → Y.Array<Y.Map>

// Awareness (ephemeral)
awareness.setLocalState({
  user: { id, name, color },
  cursor: { x, y } | null,
  selectedIds: string[],
  activeTool: ToolType
})
```

---

## Technical Architecture

### Stack

| Layer            | Technology                                     |
| ---------------- | ---------------------------------------------- |
| UI Framework     | Angular                                        |
| Canvas Rendering | HTML Canvas 2D                                 |
| Freehand Strokes | perfect-freehand                               |
| Real-time Sync   | Yjs + y-websocket                              |
| State Management | Yjs as source of truth, Angular signals for UI |
| Backend          | Existing Maple backend + y-websocket server    |

### Component Structure

```
whiteboard/
├── whiteboard.component.ts        # Main container
├── canvas/
│   ├── canvas.component.ts        # Canvas element + render loop
│   ├── renderer.service.ts        # All drawing operations
│   └── hit-test.service.ts        # Click/touch detection
├── toolbar/
│   ├── toolbar.component.ts       # Floating toolbar
│   └── color-picker.component.ts
├── collaboration/
│   ├── sync.service.ts            # Yjs document management
│   ├── awareness.service.ts       # Cursors + presence
│   └── cursors.component.ts       # Render remote cursors
├── tools/
│   ├── tool.interface.ts
│   ├── select.tool.ts
│   ├── pen.tool.ts
│   ├── shape.tool.ts
│   ├── text.tool.ts
│   └── eraser.tool.ts
├── history/
│   └── undo-manager.service.ts    # Wraps Yjs UndoManager
└── models/
    └── types.ts                   # All interfaces
```

### Rendering Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                     Render Loop                         │
│                  (requestAnimationFrame)                │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Clear canvas                                         │
│ 2. Apply camera transform (pan + zoom)                  │
│ 3. For each visible layer:                              │
│    a. For each element:                                 │
│       - Apply element transform                         │
│       - Render based on type                            │
│       - Stroke: perfect-freehand → fill polygon         │
│       - Shape: Canvas shape APIs                        │
│       - Text: fillText with wrapping                    │
│ 4. Render remote user selections (subtle highlight)     │
│ 5. Render local selection + transform handles           │
│ 6. Render remote cursors                                │
│ 7. Render in-progress drawing (current stroke/shape)    │
└─────────────────────────────────────────────────────────┘
```

### Tool State Machine

```
                    ┌─────────┐
                    │  Idle   │
                    └────┬────┘
                         │ pointerdown
                         ▼
              ┌─────────────────────┐
              │   Determine Action  │
              └─────────┬───────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌──────────┐    ┌──────────┐
   │ Drawing │    │ Selecting│    │Transform │
   │ Stroke  │    │ (marquee)│    │ (handle) │
   └────┬────┘    └────┬─────┘    └────┬─────┘
        │              │               │
        │ pointerup    │ pointerup     │ pointerup
        ▼              ▼               ▼
   ┌─────────┐    ┌──────────┐    ┌──────────┐
   │ Simplify│    │  Update  │    │  Commit  │
   │ + Commit│    │ Selection│    │ Transform│
   └────┬────┘    └────┬─────┘    └────┬─────┘
        │              │               │
        └──────────────┴───────────────┘
                       │
                       ▼
                  ┌─────────┐
                  │  Idle   │
                  └─────────┘
```

### Sync Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Client A  │         │  y-websocket│         │   Client B  │
│             │         │   Server    │         │             │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │   Connect + Auth      │                       │
       │──────────────────────>│                       │
       │                       │   Connect + Auth      │
       │                       │<──────────────────────│
       │                       │                       │
       │   Sync document       │   Sync document       │
       │<─────────────────────>│<─────────────────────>│
       │                       │                       │
       │   Draw stroke         │                       │
       │──────────────────────>│   Broadcast update    │
       │                       │──────────────────────>│
       │                       │                       │
       │   Awareness update    │   Awareness update    │
       │<─────────────────────>│<─────────────────────>│
       │   (cursor, selection) │   (cursor, selection) │
```

### Stroke Processing Pipeline

```typescript
// 1. Capture points during drawing
onPointerMove(e: PointerEvent) {
  this.currentPoints.push({
    x: e.clientX,
    y: e.clientY,
    pressure: e.pressure || 0.5
  })
  this.renderCurrentStroke()  // Immediate feedback
}

// 2. Render with perfect-freehand
renderCurrentStroke() {
  const outlinePoints = getStroke(this.currentPoints, {
    size: this.strokeSize,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !this.hasPressure
  })

  // Draw as filled polygon
  this.ctx.beginPath()
  this.ctx.moveTo(outlinePoints[0][0], outlinePoints[0][1])
  for (const [x, y] of outlinePoints.slice(1)) {
    this.ctx.lineTo(x, y)
  }
  this.ctx.fill()
}

// 3. On stroke complete: simplify + commit
onPointerUp() {
  const simplified = simplifyPoints(this.currentPoints, tolerance)

  // Commit to Yjs
  const stroke: Stroke = {
    id: generateId(),
    type: 'stroke',
    points: simplified,
    color: this.currentColor,
    size: this.strokeSize,
    // ...
  }

  this.syncService.addElement(stroke)
}
```

---

## Mobile Considerations

### Touch Handling

- **Single finger**: Draw (when pen tool active) or pan (when select tool)
- **Two finger**: Always pan + pinch zoom
- **Palm rejection**: Ignore touches with large contact radius when stylus detected

### Toolbar Adaptations

- Slightly larger touch targets (44px minimum)
- Auto-collapse to icon-only mode on small screens
- Swipe up on toolbar to reveal secondary options
- Hide toolbar during active drawing, fade in after 1s idle

### Performance

- Throttle awareness updates to 30fps on mobile
- Reduce point capture frequency if needed (60fps target)
- Use `will-change: transform` for smooth zoom/pan

---

## Keyboard Shortcuts

| Action          | Shortcut             |
| --------------- | -------------------- |
| Select tool     | V                    |
| Pen tool        | P                    |
| Rectangle       | R                    |
| Ellipse         | O                    |
| Line            | L                    |
| Arrow           | Shift + L            |
| Text            | T                    |
| Eraser          | E                    |
| Delete selected | Backspace / Delete   |
| Undo            | Ctrl/Cmd + Z         |
| Redo            | Ctrl/Cmd + Shift + Z |
| Select all      | Ctrl/Cmd + A         |
| Zoom in         | Ctrl/Cmd + =         |
| Zoom out        | Ctrl/Cmd + -         |
| Fit to content  | Ctrl/Cmd + 1         |
| Pan (hold)      | Space                |

---

## Persistence & Storage

### Save Strategy

- **Auto-save**: Yjs document syncs continuously to server
- **Server persistence**: y-websocket server persists to Maple's existing database
- **Offline**: Yjs IndexedDB provider caches locally, syncs on reconnect

### Data Storage

```typescript
// Stored in Maple's database
interface WhiteboardRecord {
    id: string;
    mapleItemId: string;
    yjsState: Uint8Array; // Encoded Yjs document
    thumbnail: string; // Base64 PNG for preview
    createdAt: Date;
    updatedAt: Date;
}
```

### Export Options

- **PNG**: Rasterize canvas at 2x resolution
- **SVG**: Convert elements to SVG nodes
- **JSON**: Raw Yjs document for backup/transfer

---

## Implementation Phases

### Phase 1: Core Drawing (Week 1-2)

- [ ] Canvas setup with pan/zoom
- [ ] Pen tool with perfect-freehand
- [ ] Basic shapes (rectangle, ellipse, line)
- [ ] Select tool with move/delete
- [ ] Floating toolbar (desktop)
- [ ] Local undo/redo

### Phase 2: Collaboration (Week 3)

- [ ] Yjs integration
- [ ] y-websocket server setup
- [ ] Remote cursor display
- [ ] Selection awareness
- [ ] Presence indicators

### Phase 3: Polish (Week 4)

- [ ] Mobile touch handling
- [ ] Responsive toolbar
- [ ] Transform handles (rotate/scale)
- [ ] Arrow tool
- [ ] Text tool
- [ ] Color picker + stroke width

### Phase 4: Integration (Week 5)

- [ ] Maple backend integration
- [ ] Persistence layer
- [ ] Thumbnail generation
- [ ] Export functionality
- [ ] Keyboard shortcuts

---

## Open Questions

1. **Layers UI**: Full layer panel or simplified single-layer for V1?
2. **Background**: Solid color, grid, dots, or user choice?
3. **Max canvas size**: Infinite or bounded?
4. **Element limit**: Cap elements per board for performance?
5. **Offline indicator**: How to show sync status?

---

## Success Metrics

- Drawing latency < 16ms (60fps)
- Time to first collaborative stroke < 2s after joining
- Sync latency < 100ms between clients
- Mobile touch accuracy matches desktop mouse

---

## Appendix: Library References

- [perfect-freehand](https://github.com/steveruizok/perfect-freehand) - Freehand stroke rendering
- [Yjs](https://github.com/yjs/yjs) - CRDT implementation
- [y-websocket](https://github.com/yjs/y-websocket) - WebSocket sync provider
- [simplify-js](https://github.com/mourner/simplify-js) - Point simplification (Ramer-Douglas-Peucker)
