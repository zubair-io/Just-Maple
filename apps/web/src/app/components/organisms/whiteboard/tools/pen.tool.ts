import { customAlphabet } from 'nanoid';
import simplify from 'simplify-js';
import * as Y from 'yjs';
import type { Tool, ToolContext, ToolResult } from './tool.interface';
import type { CanvasPointerEvent, CanvasPoint, PendingStroke } from '../models/types';

// Generate element IDs
const nanoidBase58 = customAlphabet(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  16,
);

/**
 * Pen Tool for freehand drawing
 * Uses perfect-freehand for smooth stroke rendering
 */
export class PenTool implements Tool {
  readonly name = 'pen' as const;
  readonly cursor = 'crosshair';

  private context: ToolContext | null = null;
  private isDrawing = false;
  private points: CanvasPoint[] = [];

  activate(context: ToolContext): void {
    this.context = context;
    this.reset();
  }

  deactivate(): void {
    this.reset();
    this.context = null;
  }

  onPointerDown(event: CanvasPointerEvent): ToolResult {
    if (event.isPan || event.button !== 0) {
      return {};
    }

    this.isDrawing = true;
    this.points = [
      {
        x: event.canvas.x,
        y: event.canvas.y,
        pressure: event.pressure,
      },
    ];

    // Update tool state with pending stroke
    this.updatePendingStroke();

    return { cursor: this.cursor, render: true };
  }

  onPointerMove(event: CanvasPointerEvent): ToolResult {
    if (!this.isDrawing) {
      return {};
    }

    // Add point
    this.points.push({
      x: event.canvas.x,
      y: event.canvas.y,
      pressure: event.pressure,
    });

    // Update tool state with pending stroke
    this.updatePendingStroke();

    return { render: true };
  }

  onPointerUp(event: CanvasPointerEvent): ToolResult {
    if (!this.isDrawing) {
      return {};
    }

    // Add final point
    this.points.push({
      x: event.canvas.x,
      y: event.canvas.y,
      pressure: event.pressure,
    });

    // Commit stroke if we have enough points
    if (this.points.length >= 2) {
      this.commitStroke();
    }

    this.reset();

    return { cursor: this.cursor, render: true };
  }

  onPointerLeave(): void {
    // If drawing, commit what we have
    if (this.isDrawing && this.points.length >= 2) {
      this.commitStroke();
    }
    this.reset();
  }

  /**
   * Update the pending stroke in tool state and share via awareness
   */
  private updatePendingStroke(): void {
    if (!this.context) return;

    const pendingStroke: PendingStroke = {
      points: this.points,
      color: this.context.strokeColor(),
      size: this.context.strokeSize(),
    };

    // Update local tool state for rendering
    this.context.toolState.update((state) => ({
      ...state,
      pendingStroke,
    }));

    // Share via awareness for remote users to see (throttled - only send every 3rd point)
    if (this.points.length % 3 === 0 || this.points.length < 5) {
      // Simplify points for network efficiency while keeping full stroke
      const pointsToSend =
        this.points.length > 100
          ? simplify(
              this.points.map((p) => ({ x: p.x, y: p.y })),
              0.5, // tolerance - higher = fewer points
              false,
            ).map((p, i) => ({
              ...p,
              pressure: this.points[Math.min(i * 2, this.points.length - 1)]?.pressure,
            }))
          : this.points;

      this.context.whiteboard.awareness.setLocalStateField('pendingStroke', {
        points: pointsToSend,
        color: pendingStroke.color,
        size: pendingStroke.size,
      });
    }
  }

  /**
   * Commit the stroke to the Y.Doc
   */
  private commitStroke(): void {
    if (!this.context || this.points.length < 2) return;

    const { whiteboard, strokeColor, strokeSize, pageId } = this.context;

    // Simplify points to reduce storage
    const simplifiedPoints = simplify(
      this.points.map((p) => ({ x: p.x, y: p.y })),
      0.5, // tolerance
      true, // high quality
    );

    // Create pressure array (use original pressure values where available)
    const pointsWithPressure = simplifiedPoints.map((p, i) => {
      // Find the closest original point to get pressure
      const originalIdx = Math.min(
        Math.round((i / simplifiedPoints.length) * this.points.length),
        this.points.length - 1,
      );
      return {
        x: p.x,
        y: p.y,
        pressure: this.points[originalIdx]?.pressure || 0.5,
      };
    });

    // Calculate bounding box for transform
    let minX = Infinity,
      minY = Infinity;
    for (const p of pointsWithPressure) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }

    // Normalize points relative to bounding box
    const normalizedPoints = pointsWithPressure.map((p) => ({
      x: p.x - minX,
      y: p.y - minY,
      pressure: p.pressure,
    }));

    const elementId = nanoidBase58();
    const now = Date.now();

    // Create stroke element in Y.Doc
    whiteboard.ydoc.transact(() => {
      // Create element Y.Map
      const yElement = new Y.Map<unknown>();
      yElement.set('id', elementId);
      yElement.set('type', 'stroke');
      yElement.set('createdBy', ''); // TODO: Get from auth
      yElement.set('createdAt', now);
      yElement.set('updatedAt', now);

      // Transform
      const yTransform = new Y.Map<unknown>();
      yTransform.set('x', minX);
      yTransform.set('y', minY);
      yTransform.set('rotation', 0);
      yTransform.set('scaleX', 1);
      yTransform.set('scaleY', 1);
      yElement.set('transform', yTransform);

      // Points as Y.Array
      const yPoints = new Y.Array<unknown>();
      yPoints.push(normalizedPoints);
      yElement.set('points', yPoints);

      // Style
      const yStyle = new Y.Map<unknown>();
      yStyle.set('color', strokeColor());
      yStyle.set('size', strokeSize());
      yStyle.set('opacity', 1);
      yElement.set('style', yStyle);

      // Add to elements
      whiteboard.elements.set(elementId, yElement);

      // Add to active layer
      const metadata = whiteboard.metadata;
      const activeLayerId = metadata.get('activeLayerId') as string;

      for (let i = 0; i < whiteboard.layers.length; i++) {
        const layer = whiteboard.layers.get(i);
        if (layer.get('id') === activeLayerId) {
          const layerElements = layer.get('elements') as string[];
          layer.set('elements', [...layerElements, elementId]);
          break;
        }
      }
    });
  }

  /**
   * Reset drawing state
   */
  private reset(): void {
    this.isDrawing = false;
    this.points = [];

    if (this.context) {
      this.context.toolState.update((state) => ({
        ...state,
        pendingStroke: undefined,
      }));

      // Clear from awareness
      this.context.whiteboard.awareness.setLocalStateField('pendingStroke', null);
    }
  }
}
