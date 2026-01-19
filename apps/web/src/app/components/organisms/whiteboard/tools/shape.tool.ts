import { customAlphabet } from 'nanoid';
import * as Y from 'yjs';
import type { ShapeType } from '@maple/shared';
import type { Tool, ToolContext, ToolResult } from './tool.interface';
import type { CanvasPointerEvent, CanvasPoint } from '../models/types';

// Generate element IDs
const nanoidBase58 = customAlphabet(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  16,
);

/**
 * Shape Tool for drawing shapes (rectangle, ellipse, line, arrow)
 */
export class ShapeTool implements Tool {
  readonly cursor = 'crosshair';

  private _shapeType: ShapeType = 'rectangle';
  private context: ToolContext | null = null;
  private isDrawing = false;
  private startPoint: CanvasPoint | null = null;

  get name() {
    return this._shapeType as
      | 'rectangle'
      | 'ellipse'
      | 'line'
      | 'arrow'
      | 'select'
      | 'pen'
      | 'text'
      | 'eraser';
  }

  constructor(shapeType: ShapeType = 'rectangle') {
    this._shapeType = shapeType;
  }

  setShapeType(type: ShapeType): void {
    this._shapeType = type;
  }

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
    this.startPoint = event.canvas;

    // Clear selection
    this.context?.selectedIds.set([]);

    return { cursor: this.cursor, render: true };
  }

  onPointerMove(event: CanvasPointerEvent): ToolResult {
    if (!this.isDrawing || !this.startPoint || !this.context) {
      return {};
    }

    // Update pending shape
    this.context.toolState.update((state) => ({
      ...state,
      pendingShape: {
        type: this._shapeType,
        startPoint: this.startPoint!,
        endPoint: event.canvas,
        style: {
          strokeColor: this.context!.strokeColor(),
          strokeWidth: this.context!.strokeSize(),
        },
      },
    }));

    return { render: true };
  }

  onPointerUp(event: CanvasPointerEvent): ToolResult {
    if (!this.isDrawing || !this.startPoint || !this.context) {
      return {};
    }

    // Commit shape if it has sufficient size
    const width = Math.abs(event.canvas.x - this.startPoint.x);
    const height = Math.abs(event.canvas.y - this.startPoint.y);

    if (width > 5 || height > 5) {
      this.commitShape(this.startPoint, event.canvas);
    }

    this.reset();

    return { cursor: this.cursor, render: true };
  }

  onPointerLeave(): void {
    this.reset();
  }

  /**
   * Commit the shape to Y.Doc
   */
  private commitShape(startPoint: CanvasPoint, endPoint: CanvasPoint): void {
    if (!this.context) return;

    const { whiteboard, strokeColor, strokeSize } = this.context;

    const x = Math.min(startPoint.x, endPoint.x);
    const y = Math.min(startPoint.y, endPoint.y);
    const width = Math.abs(endPoint.x - startPoint.x);
    const height = Math.abs(endPoint.y - startPoint.y);

    const elementId = nanoidBase58();
    const now = Date.now();

    whiteboard.ydoc.transact(() => {
      // Create element Y.Map
      const yElement = new Y.Map<unknown>();
      yElement.set('id', elementId);
      yElement.set('type', 'shape');
      yElement.set('shapeType', this._shapeType);
      yElement.set('createdBy', '');
      yElement.set('createdAt', now);
      yElement.set('updatedAt', now);
      yElement.set('width', width);
      yElement.set('height', height);

      // Transform
      const yTransform = new Y.Map<unknown>();
      yTransform.set('x', x);
      yTransform.set('y', y);
      yTransform.set('rotation', 0);
      yTransform.set('scaleX', 1);
      yTransform.set('scaleY', 1);
      yElement.set('transform', yTransform);

      // Style
      const yStyle = new Y.Map<unknown>();
      yStyle.set('strokeColor', strokeColor());
      yStyle.set('strokeWidth', strokeSize());
      yStyle.set('opacity', 1);
      yElement.set('style', yStyle);

      // For line and arrow, store original start/end points
      if (this._shapeType === 'line' || this._shapeType === 'arrow') {
        // Store relative to bounding box
        yElement.set('startPoint', {
          x: startPoint.x < endPoint.x ? 0 : width,
          y: startPoint.y < endPoint.y ? 0 : height,
        });
        yElement.set('endPoint', {
          x: startPoint.x < endPoint.x ? width : 0,
          y: startPoint.y < endPoint.y ? height : 0,
        });
      }

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
   * Reset state
   */
  private reset(): void {
    this.isDrawing = false;
    this.startPoint = null;

    if (this.context) {
      this.context.toolState.update((state) => ({
        ...state,
        pendingShape: undefined,
      }));
    }
  }
}
