# Whiteboard

The whiteboard is Just Maple's infinite canvas for visual thinking, diagramming, and freeform drawing. Perfect for brainstorming, sketching ideas, and collaborative visual work.

## Getting Started

### Creating a Whiteboard

1. Open a notebook from the sidebar
2. Click the **+** button and select "Whiteboard"
3. Or use the command palette: `Cmd/Ctrl + K` then type "new whiteboard"

### Interface Overview

- **Canvas** - Infinite drawing area (pan and zoom)
- **Tool palette** - Drawing tools on the left
- **Properties panel** - Selected element settings on the right
- **Zoom controls** - Bottom right corner

## Drawing Tools

### Pen Tool

Freehand drawing with pressure sensitivity (on supported devices):

- **Stroke width** - Adjust thickness
- **Color** - Choose from palette or custom
- **Opacity** - Semi-transparent strokes

### Pencil Tool

Textured pencil strokes for a more organic feel.

### Shapes

Click and drag to create:

- **Rectangle** - Boxes and frames
- **Ellipse** - Circles and ovals
- **Line** - Straight lines
- **Arrow** - Lines with directional arrows

### Text

Click anywhere to add text:

- Double-click to edit
- Resize the text box to reflow
- Style with bold, italic, and colors

### Eraser

Remove strokes and shapes:

- **Stroke eraser** - Removes entire strokes
- **Pixel eraser** - Erases parts of strokes

## Navigation

### Pan & Zoom

| Action        | Mouse             | Trackpad        | Keyboard     |
| ------------- | ----------------- | --------------- | ------------ |
| Pan           | Middle-click drag | Two-finger drag | Space + drag |
| Zoom          | Scroll wheel      | Pinch           | `Cmd +/-`    |
| Fit to screen | -                 | -               | `Cmd + 0`    |
| Zoom to 100%  | -                 | -               | `Cmd + 1`    |

### Selection

- **Click** - Select single element
- **Shift + Click** - Add to selection
- **Drag** - Selection rectangle
- **Cmd/Ctrl + A** - Select all

## Editing Elements

### Transform

Selected elements can be:

- **Moved** - Drag to reposition
- **Resized** - Drag corner handles
- **Rotated** - Drag rotation handle (outside corners)

### Arrange

Right-click for arrangement options:

- **Bring Forward / Send Backward** - Adjust z-order
- **Bring to Front / Send to Back** - Move to top/bottom
- **Align** - Align multiple elements
- **Distribute** - Even spacing

### Copy & Paste

- `Cmd/Ctrl + C` - Copy selected elements
- `Cmd/Ctrl + V` - Paste
- `Cmd/Ctrl + D` - Duplicate in place

## Layers

### Understanding Layers

Elements are organized in layers for complex compositions:

- Each layer can be locked, hidden, or renamed
- Drag elements between layers
- Toggle visibility to focus on specific parts

### Layer Panel

1. Click the layers icon in the sidebar
2. Create new layers with the **+** button
3. Drag to reorder layers
4. Click the eye icon to hide/show

## Collaboration

### Real-time Drawing

Multiple users can draw simultaneously:

- See each collaborator's cursor and name
- Pending strokes appear as they draw
- All changes sync automatically

### Cursor Colors

Each collaborator has a unique color for their cursor and selection highlights.

## Keyboard Shortcuts

| Action           | Shortcut                |
| ---------------- | ----------------------- |
| Select tool      | `V`                     |
| Pen tool         | `P`                     |
| Rectangle        | `R`                     |
| Ellipse          | `O`                     |
| Line             | `L`                     |
| Text             | `T`                     |
| Eraser           | `E`                     |
| Undo             | `Cmd/Ctrl + Z`          |
| Redo             | `Cmd/Ctrl + Shift + Z`  |
| Delete selection | `Delete` or `Backspace` |
| Duplicate        | `Cmd/Ctrl + D`          |
| Group            | `Cmd/Ctrl + G`          |
| Ungroup          | `Cmd/Ctrl + Shift + G`  |

## Export Options

### Export as Image

1. Select elements (or none for entire canvas)
2. Open the menu and choose "Export"
3. Select format: PNG, SVG, or PDF
4. Choose resolution and background options

### Copy to Clipboard

Select elements and use `Cmd/Ctrl + C` to copy as an image for pasting into other apps.

## Tips & Best Practices

### Diagramming

- Use shapes with arrows for flowcharts
- Group related elements together
- Use consistent colors for categories

### Sketching

- Start rough, refine later
- Use layers to separate sketch from final
- Try different pen widths for emphasis

### Collaborative Sessions

- Assign canvas areas to participants
- Use text labels to communicate
- Lock finished elements to prevent accidental edits

## Related Documentation

- [Notebooks](./feature-notebooks.md) - Where whiteboards live
- [Sharing & Collaboration](./feature-sharing.md) - Collaborative editing
- [Engineering: Whiteboard](./eng-whiteboard.md) - Technical implementation
