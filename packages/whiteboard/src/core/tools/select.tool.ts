import type { Tool, ToolContext, ToolResult } from './tool.interface';
import type { CanvasPointerEvent, CanvasPoint, BoundingBox } from '../models/types';
import type * as Y from 'yjs';

/**
 * Select Tool for selecting and moving elements
 */
export class SelectTool implements Tool {
    readonly name = 'select' as const;
    readonly cursor = 'default';

    private context: ToolContext | null = null;
    private isDragging = false;
    private isBoxSelecting = false;
    private dragStartPoint: CanvasPoint | null = null;
    private dragOffset = { x: 0, y: 0 };
    private initialElementPositions: Map<string, { x: number; y: number }> = new Map();

    activate(context: ToolContext): void {
        this.context = context;
        this.reset();
    }

    deactivate(): void {
        this.reset();
        this.context = null;
    }

    onPointerDown(event: CanvasPointerEvent): ToolResult {
        if (event.isPan || event.button !== 0 || !this.context) {
            return {};
        }

        const { whiteboard, selectedIds } = this.context;

        // Hit test for existing elements
        const hitElementId = this.hitTest(event.canvas, whiteboard.layers, whiteboard.elements);

        if (hitElementId) {
            // Check if element is already selected
            const currentSelection = selectedIds();
            const isAlreadySelected = currentSelection.includes(hitElementId);

            if (event.shiftKey) {
                // Toggle selection with shift
                if (isAlreadySelected) {
                    selectedIds.set(currentSelection.filter((id) => id !== hitElementId));
                } else {
                    selectedIds.set([...currentSelection, hitElementId]);
                }
            } else if (!isAlreadySelected) {
                // Replace selection
                selectedIds.set([hitElementId]);
            }

            // Start dragging
            this.isDragging = true;
            this.dragStartPoint = event.canvas;

            // Store initial positions of selected elements
            this.initialElementPositions.clear();
            for (const id of selectedIds()) {
                const yElement = whiteboard.elements.get(id);
                if (yElement) {
                    const transform = yElement.get('transform') as Y.Map<unknown>;
                    this.initialElementPositions.set(id, {
                        x: (transform?.get('x') as number) || 0,
                        y: (transform?.get('y') as number) || 0,
                    });
                }
            }

            return { cursor: 'move', render: true };
        } else {
            // Clear selection unless shift is held
            if (!event.shiftKey) {
                selectedIds.set([]);
            }

            // Start box selection
            this.isBoxSelecting = true;
            this.dragStartPoint = event.canvas;

            return { cursor: 'crosshair', render: true };
        }
    }

    onPointerMove(event: CanvasPointerEvent): ToolResult {
        if (!this.context || !this.dragStartPoint) {
            // Hover cursor
            const hitElementId = this.hitTest(
                event.canvas,
                this.context?.whiteboard.layers!,
                this.context?.whiteboard.elements!,
            );
            return { cursor: hitElementId ? 'move' : 'default' };
        }

        if (this.isDragging) {
            // Move selected elements
            const dx = event.canvas.x - this.dragStartPoint.x;
            const dy = event.canvas.y - this.dragStartPoint.y;

            const { whiteboard, selectedIds } = this.context;

            whiteboard.ydoc.transact(() => {
                for (const id of selectedIds()) {
                    const yElement = whiteboard.elements.get(id);
                    if (!yElement) continue;

                    const initialPos = this.initialElementPositions.get(id);
                    if (!initialPos) continue;

                    const transform = yElement.get('transform') as Y.Map<unknown>;
                    if (transform) {
                        transform.set('x', initialPos.x + dx);
                        transform.set('y', initialPos.y + dy);
                    }
                }
            });

            return { cursor: 'move', render: true };
        }

        if (this.isBoxSelecting) {
            // Update selection box
            const minX = Math.min(this.dragStartPoint.x, event.canvas.x);
            const minY = Math.min(this.dragStartPoint.y, event.canvas.y);
            const maxX = Math.max(this.dragStartPoint.x, event.canvas.x);
            const maxY = Math.max(this.dragStartPoint.y, event.canvas.y);

            this.context.toolState.update((state) => ({
                ...state,
                selectionBox: { minX, minY, maxX, maxY },
            }));

            return { cursor: 'crosshair', render: true };
        }

        return {};
    }

    onPointerUp(event: CanvasPointerEvent): ToolResult {
        if (!this.context) {
            return {};
        }

        if (this.isBoxSelecting && this.dragStartPoint) {
            // Finalize box selection
            const minX = Math.min(this.dragStartPoint.x, event.canvas.x);
            const minY = Math.min(this.dragStartPoint.y, event.canvas.y);
            const maxX = Math.max(this.dragStartPoint.x, event.canvas.x);
            const maxY = Math.max(this.dragStartPoint.y, event.canvas.y);

            const { whiteboard, selectedIds } = this.context;
            const selectedInBox = this.findElementsInBox(
                { minX, minY, maxX, maxY },
                whiteboard.layers,
                whiteboard.elements,
            );

            if (event.shiftKey) {
                // Add to existing selection
                const currentSelection = selectedIds();
                const combined = new Set([...currentSelection, ...selectedInBox]);
                selectedIds.set([...combined]);
            } else {
                selectedIds.set(selectedInBox);
            }
        }

        this.reset();

        return { cursor: this.cursor, render: true };
    }

    onPointerLeave(): void {
        this.reset();
    }

    onKeyDown(event: KeyboardEvent): boolean {
        if (!this.context) return false;

        // Escape to deselect
        if (event.key === 'Escape') {
            this.context.selectedIds.set([]);
            this.context.requestRender();
            return true;
        }

        // Ctrl/Cmd+A to select all
        if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
            event.preventDefault();
            this.selectAll();
            return true;
        }

        return false;
    }

    /**
     * Select all elements
     */
    private selectAll(): void {
        if (!this.context) return;

        const { whiteboard, selectedIds } = this.context;
        const allIds: string[] = [];

        for (let i = 0; i < whiteboard.layers.length; i++) {
            const layer = whiteboard.layers.get(i);
            const elements = layer.get('elements') as string[];
            allIds.push(...elements);
        }

        selectedIds.set(allIds);
        this.context.requestRender();
    }

    /**
     * Hit test for element at point
     */
    private hitTest(
        point: CanvasPoint,
        layers: Y.Array<Y.Map<unknown>>,
        elements: Y.Map<Y.Map<unknown>>,
    ): string | null {
        // Iterate in reverse order (top to bottom)
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers.get(i);
            if (!layer.get('visible')) continue;

            const elementIds = layer.get('elements') as string[];

            // Iterate in reverse order (top element first)
            for (let j = elementIds.length - 1; j >= 0; j--) {
                const elementId = elementIds[j];
                const yElement = elements.get(elementId);
                if (!yElement) continue;

                if (this.isPointInElement(point, yElement)) {
                    return elementId;
                }
            }
        }

        return null;
    }

    /**
     * Check if point is inside element bounds
     */
    private isPointInElement(point: CanvasPoint, yElement: Y.Map<unknown>): boolean {
        const transform = yElement.get('transform') as Y.Map<unknown>;
        const type = yElement.get('type') as string;

        const x = (transform?.get('x') as number) || 0;
        const y = (transform?.get('y') as number) || 0;

        const hitPadding = 8;

        if (type === 'stroke') {
            const points = yElement.get('points') as Y.Array<unknown>;
            if (!points || points.length === 0) return false;

            const strokePoints = points.toArray() as Array<{ x: number; y: number }>;

            // Check if point is close to any stroke point
            for (const p of strokePoints) {
                const dist = Math.sqrt(
                    Math.pow(point.x - (x + p.x), 2) + Math.pow(point.y - (y + p.y), 2),
                );
                if (dist < hitPadding + ((yElement.get('style') as any)?.get?.('size') || 4)) {
                    return true;
                }
            }

            return false;
        } else if (type === 'shape') {
            const width = yElement.get('width') as number;
            const height = yElement.get('height') as number;

            return (
                point.x >= x - hitPadding &&
                point.x <= x + width + hitPadding &&
                point.y >= y - hitPadding &&
                point.y <= y + height + hitPadding
            );
        } else if (type === 'text') {
            const content = yElement.get('content') as string;
            const fontSize = (yElement.get('fontSize') as number) || 16;
            const approxWidth = content.length * fontSize * 0.6;

            return (
                point.x >= x - hitPadding &&
                point.x <= x + approxWidth + hitPadding &&
                point.y >= y - hitPadding &&
                point.y <= y + fontSize + hitPadding
            );
        }

        return false;
    }

    /**
     * Find all elements within selection box
     */
    private findElementsInBox(
        box: BoundingBox,
        layers: Y.Array<Y.Map<unknown>>,
        elements: Y.Map<Y.Map<unknown>>,
    ): string[] {
        const result: string[] = [];

        for (let i = 0; i < layers.length; i++) {
            const layer = layers.get(i);
            if (!layer.get('visible')) continue;

            const elementIds = layer.get('elements') as string[];

            for (const elementId of elementIds) {
                const yElement = elements.get(elementId);
                if (!yElement) continue;

                if (this.isElementInBox(box, yElement)) {
                    result.push(elementId);
                }
            }
        }

        return result;
    }

    /**
     * Check if element bounds intersect selection box
     */
    private isElementInBox(box: BoundingBox, yElement: Y.Map<unknown>): boolean {
        const transform = yElement.get('transform') as Y.Map<unknown>;
        const type = yElement.get('type') as string;

        const x = (transform?.get('x') as number) || 0;
        const y = (transform?.get('y') as number) || 0;

        let elemMinX = x,
            elemMinY = y,
            elemMaxX = x,
            elemMaxY = y;

        if (type === 'stroke') {
            const points = yElement.get('points') as Y.Array<unknown>;
            if (points && points.length > 0) {
                const strokePoints = points.toArray() as Array<{ x: number; y: number }>;
                for (const p of strokePoints) {
                    elemMinX = Math.min(elemMinX, x + p.x);
                    elemMinY = Math.min(elemMinY, y + p.y);
                    elemMaxX = Math.max(elemMaxX, x + p.x);
                    elemMaxY = Math.max(elemMaxY, y + p.y);
                }
            }
        } else if (type === 'shape') {
            const width = yElement.get('width') as number;
            const height = yElement.get('height') as number;
            elemMaxX = x + width;
            elemMaxY = y + height;
        } else if (type === 'text') {
            const content = yElement.get('content') as string;
            const fontSize = (yElement.get('fontSize') as number) || 16;
            elemMaxX = x + content.length * fontSize * 0.6;
            elemMaxY = y + fontSize;
        }

        // Check intersection
        return !(
            elemMaxX < box.minX ||
            elemMinX > box.maxX ||
            elemMaxY < box.minY ||
            elemMinY > box.maxY
        );
    }

    /**
     * Reset state
     */
    private reset(): void {
        this.isDragging = false;
        this.isBoxSelecting = false;
        this.dragStartPoint = null;
        this.initialElementPositions.clear();

        if (this.context) {
            this.context.toolState.update((state) => ({
                ...state,
                selectionBox: undefined,
            }));
        }
    }
}
