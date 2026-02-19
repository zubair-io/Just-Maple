import { Injectable } from '@angular/core';
import getStroke from 'perfect-freehand';
import type { Camera, StrokeElement, ShapeElement, TextElement } from '@maple/shared';
import type * as Y from 'yjs';
import type { ToolState, CanvasPoint, WhiteboardElement } from '../../models/types';

/**
 * Canvas Renderer Service
 * Handles all drawing operations on the canvas
 */
@Injectable()
export class RendererService {
    private ctx: CanvasRenderingContext2D | null = null;
    private width = 0;
    private height = 0;
    private dpr = 1;

    /**
     * Initialize the renderer with a canvas context
     */
    init(canvas: HTMLCanvasElement): void {
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.resize(canvas.clientWidth, canvas.clientHeight);
    }

    /**
     * Resize canvas to match container
     */
    resize(width: number, height: number): void {
        if (!this.ctx) return;

        this.width = width;
        this.height = height;

        const canvas = this.ctx.canvas;
        canvas.width = width * this.dpr;
        canvas.height = height * this.dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        this.ctx.scale(this.dpr, this.dpr);
    }

    /**
     * Clear the canvas
     */
    clear(): void {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    /**
     * Render the entire whiteboard
     */
    render(
        layers: Y.Array<Y.Map<unknown>>,
        elements: Y.Map<Y.Map<unknown>>,
        camera: Camera,
        toolState: ToolState,
        selectedIds: string[],
        remoteSelections?: Map<string, { ids: string[]; color: string }>,
        remotePendingStrokes?: Map<
            string,
            {
                points: { x: number; y: number; pressure?: number }[];
                color: string;
                size: number;
            }
        >,
        remotePendingShapes?: Map<
            string,
            {
                type: 'rectangle' | 'ellipse' | 'line' | 'arrow';
                startPoint: { x: number; y: number };
                endPoint: { x: number; y: number };
                style: { strokeColor: string; strokeWidth: number };
            }
        >,
    ): void {
        if (!this.ctx) return;

        // Clear canvas
        this.clear();

        // Save context state
        this.ctx.save();

        // Apply camera transform
        this.ctx.translate(this.width / 2, this.height / 2);
        this.ctx.scale(camera.zoom, camera.zoom);
        this.ctx.translate(-camera.x - this.width / 2, -camera.y - this.height / 2);

        // Render layers bottom to top
        for (let i = 0; i < layers.length; i++) {
            const layer = layers.get(i);
            if (!layer.get('visible')) continue;

            const layerOpacity = (layer.get('opacity') as number) || 1;
            this.ctx.globalAlpha = layerOpacity;

            const elementIds = layer.get('elements') as string[];
            for (const elementId of elementIds) {
                const yElement = elements.get(elementId);
                if (!yElement) continue;

                const element = this.yMapToElement(yElement);
                if (element) {
                    this.renderElement(element);
                }
            }

            this.ctx.globalAlpha = 1;
        }

        // Render remote selections
        if (remoteSelections) {
            for (const [_userId, selection] of remoteSelections) {
                for (const elementId of selection.ids) {
                    const yElement = elements.get(elementId);
                    if (!yElement) continue;
                    const element = this.yMapToElement(yElement);
                    if (element) {
                        this.renderSelectionHighlight(element, selection.color, 0.3);
                    }
                }
            }
        }

        // Render local selection
        for (const elementId of selectedIds) {
            const yElement = elements.get(elementId);
            if (!yElement) continue;
            const element = this.yMapToElement(yElement);
            if (element) {
                this.renderSelectionHighlight(element, '#2563EB', 1);
            }
        }

        // Render remote pending strokes (from awareness)
        if (remotePendingStrokes) {
            for (const [_userId, stroke] of remotePendingStrokes) {
                if (stroke.points.length >= 2) {
                    this.renderPendingStrokeWithColor(stroke.points, stroke.color, stroke.size);
                }
            }
        }

        // Render remote pending shapes (from awareness)
        if (remotePendingShapes) {
            for (const [_userId, shape] of remotePendingShapes) {
                this.renderPendingShapePreview(shape);
            }
        }

        // Render local tool state (pending stroke, shape preview, etc.)
        this.renderToolState(toolState);

        // Restore context state
        this.ctx.restore();
    }

    /**
     * Render a pending stroke with specified color
     */
    private renderPendingStrokeWithColor(
        points: { x: number; y: number; pressure?: number }[],
        color: string,
        size: number,
    ): void {
        if (!this.ctx || points.length < 2) return;

        const inputPoints = points.map((p) => [p.x, p.y, p.pressure || 0.5]);

        const strokeOutline = getStroke(inputPoints, {
            size,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
            simulatePressure: points[0].pressure === undefined,
        });

        if (strokeOutline.length > 0) {
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            const [first, ...rest] = strokeOutline;
            this.ctx.moveTo(first[0], first[1]);
            for (const [x, y] of rest) {
                this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();
            this.ctx.fill();
        }
    }

    /**
     * Render a pending shape preview (from remote awareness)
     */
    private renderPendingShapePreview(shape: {
        type: 'rectangle' | 'ellipse' | 'line' | 'arrow';
        startPoint: { x: number; y: number };
        endPoint: { x: number; y: number };
        style: { strokeColor: string; strokeWidth: number };
    }): void {
        if (!this.ctx) return;

        const { type, startPoint, endPoint, style } = shape;

        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const width = Math.abs(endPoint.x - startPoint.x);
        const height = Math.abs(endPoint.y - startPoint.y);

        this.ctx.strokeStyle = style.strokeColor;
        this.ctx.lineWidth = style.strokeWidth;

        switch (type) {
            case 'rectangle':
                this.ctx.strokeRect(x, y, width, height);
                break;

            case 'ellipse':
                this.ctx.beginPath();
                this.ctx.ellipse(
                    x + width / 2,
                    y + height / 2,
                    width / 2,
                    height / 2,
                    0,
                    0,
                    Math.PI * 2,
                );
                this.ctx.stroke();
                break;

            case 'line':
                this.ctx.beginPath();
                this.ctx.moveTo(startPoint.x, startPoint.y);
                this.ctx.lineTo(endPoint.x, endPoint.y);
                this.ctx.stroke();
                break;

            case 'arrow':
                this.renderArrow(
                    startPoint.x,
                    startPoint.y,
                    endPoint.x,
                    endPoint.y,
                    style.strokeWidth,
                );
                break;
        }
    }

    /**
     * Convert Y.Map to element object
     */
    private yMapToElement(yMap: Y.Map<unknown>): WhiteboardElement | null {
        const type = yMap.get('type') as string;

        if (type === 'stroke') {
            return this.yMapToStroke(yMap);
        } else if (type === 'shape') {
            return this.yMapToShape(yMap);
        } else if (type === 'text') {
            return this.yMapToText(yMap);
        }

        return null;
    }

    /**
     * Convert Y.Map to StrokeElement
     */
    private yMapToStroke(yMap: Y.Map<unknown>): StrokeElement {
        const transform = yMap.get('transform') as Y.Map<unknown>;
        const style = yMap.get('style') as Y.Map<unknown>;
        const points = yMap.get('points') as Y.Array<unknown>;

        return {
            id: yMap.get('id') as string,
            type: 'stroke',
            createdBy: yMap.get('createdBy') as string,
            createdAt: yMap.get('createdAt') as number,
            updatedAt: yMap.get('updatedAt') as number,
            transform: {
                x: (transform?.get('x') as number) || 0,
                y: (transform?.get('y') as number) || 0,
                rotation: (transform?.get('rotation') as number) || 0,
                scaleX: (transform?.get('scaleX') as number) || 1,
                scaleY: (transform?.get('scaleY') as number) || 1,
            },
            points: points
                ? points.toArray().map((p: any) => ({
                      x: p.x,
                      y: p.y,
                      pressure: p.pressure || 0.5,
                  }))
                : [],
            style: {
                color: (style?.get('color') as string) || '#000000',
                size: (style?.get('size') as number) || 4,
                opacity: (style?.get('opacity') as number) || 1,
            },
        };
    }

    /**
     * Convert Y.Map to ShapeElement
     */
    private yMapToShape(yMap: Y.Map<unknown>): ShapeElement {
        const transform = yMap.get('transform') as Y.Map<unknown>;
        const style = yMap.get('style') as Y.Map<unknown>;

        return {
            id: yMap.get('id') as string,
            type: 'shape',
            shapeType: yMap.get('shapeType') as 'rectangle' | 'ellipse' | 'line' | 'arrow',
            createdBy: yMap.get('createdBy') as string,
            createdAt: yMap.get('createdAt') as number,
            updatedAt: yMap.get('updatedAt') as number,
            transform: {
                x: (transform?.get('x') as number) || 0,
                y: (transform?.get('y') as number) || 0,
                rotation: (transform?.get('rotation') as number) || 0,
                scaleX: (transform?.get('scaleX') as number) || 1,
                scaleY: (transform?.get('scaleY') as number) || 1,
            },
            width: yMap.get('width') as number,
            height: yMap.get('height') as number,
            style: {
                strokeColor: (style?.get('strokeColor') as string) || '#000000',
                fillColor: style?.get('fillColor') as string | undefined,
                strokeWidth: (style?.get('strokeWidth') as number) || 2,
                opacity: (style?.get('opacity') as number) || 1,
            },
        };
    }

    /**
     * Convert Y.Map to TextElement
     */
    private yMapToText(yMap: Y.Map<unknown>): TextElement {
        const transform = yMap.get('transform') as Y.Map<unknown>;

        return {
            id: yMap.get('id') as string,
            type: 'text',
            createdBy: yMap.get('createdBy') as string,
            createdAt: yMap.get('createdAt') as number,
            updatedAt: yMap.get('updatedAt') as number,
            transform: {
                x: (transform?.get('x') as number) || 0,
                y: (transform?.get('y') as number) || 0,
                rotation: (transform?.get('rotation') as number) || 0,
                scaleX: (transform?.get('scaleX') as number) || 1,
                scaleY: (transform?.get('scaleY') as number) || 1,
            },
            content: yMap.get('content') as string,
            fontSize: (yMap.get('fontSize') as number) || 16,
            fontFamily: (yMap.get('fontFamily') as string) || 'Inter, sans-serif',
            color: (yMap.get('color') as string) || '#000000',
        };
    }

    /**
     * Render a single element
     */
    private renderElement(element: WhiteboardElement): void {
        if (!this.ctx) return;

        this.ctx.save();

        // Apply element transform
        this.ctx.translate(element.transform.x, element.transform.y);
        if (element.transform.rotation) {
            this.ctx.rotate(element.transform.rotation);
        }
        if (element.transform.scaleX !== 1 || element.transform.scaleY !== 1) {
            this.ctx.scale(element.transform.scaleX || 1, element.transform.scaleY || 1);
        }

        switch (element.type) {
            case 'stroke':
                this.renderStroke(element);
                break;
            case 'shape':
                this.renderShape(element);
                break;
            case 'text':
                this.renderText(element);
                break;
        }

        this.ctx.restore();
    }

    /**
     * Render a stroke element using perfect-freehand
     */
    private renderStroke(element: StrokeElement): void {
        if (!this.ctx || element.points.length < 2) return;

        // Convert points to format expected by perfect-freehand
        const inputPoints = element.points.map((p) => [p.x, p.y, p.pressure || 0.5]);

        // Get stroke outline
        const strokeOutline = getStroke(inputPoints, {
            size: element.style.size,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
            simulatePressure: element.points[0].pressure === undefined,
        });

        // Draw filled path
        this.ctx.fillStyle = element.style.color;
        this.ctx.globalAlpha = element.style.opacity || 1;

        this.ctx.beginPath();
        const [first, ...rest] = strokeOutline;
        this.ctx.moveTo(first[0], first[1]);
        for (const [x, y] of rest) {
            this.ctx.lineTo(x, y);
        }
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.globalAlpha = 1;
    }

    /**
     * Render a shape element
     */
    private renderShape(element: ShapeElement): void {
        if (!this.ctx) return;

        const { width, height, style } = element;

        this.ctx.strokeStyle = style.strokeColor;
        this.ctx.lineWidth = style.strokeWidth;
        this.ctx.globalAlpha = style.opacity || 1;

        if (style.fillColor) {
            this.ctx.fillStyle = style.fillColor;
        }

        switch (element.shapeType) {
            case 'rectangle':
                if (style.fillColor) {
                    this.ctx.fillRect(0, 0, width, height);
                }
                this.ctx.strokeRect(0, 0, width, height);
                break;

            case 'ellipse':
                this.ctx.beginPath();
                this.ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
                if (style.fillColor) {
                    this.ctx.fill();
                }
                this.ctx.stroke();
                break;

            case 'line':
                this.ctx.beginPath();
                this.ctx.moveTo(0, 0);
                this.ctx.lineTo(width, height);
                this.ctx.stroke();
                break;

            case 'arrow':
                this.renderArrow(0, 0, width, height, style.strokeWidth);
                break;
        }

        this.ctx.globalAlpha = 1;
    }

    /**
     * Render an arrow
     */
    private renderArrow(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): void {
        if (!this.ctx) return;

        const headLength = Math.max(strokeWidth * 3, 10);
        const angle = Math.atan2(y2 - y1, x2 - x1);

        // Draw line
        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();

        // Draw arrowhead
        this.ctx.beginPath();
        this.ctx.moveTo(x2, y2);
        this.ctx.lineTo(
            x2 - headLength * Math.cos(angle - Math.PI / 6),
            y2 - headLength * Math.sin(angle - Math.PI / 6),
        );
        this.ctx.moveTo(x2, y2);
        this.ctx.lineTo(
            x2 - headLength * Math.cos(angle + Math.PI / 6),
            y2 - headLength * Math.sin(angle + Math.PI / 6),
        );
        this.ctx.stroke();
    }

    /**
     * Render text element
     */
    private renderText(element: TextElement): void {
        if (!this.ctx) return;

        this.ctx.font = `${element.fontSize}px ${element.fontFamily}`;
        this.ctx.fillStyle = element.color;
        this.ctx.textBaseline = 'top';

        if (element.textAlign) {
            this.ctx.textAlign = element.textAlign;
        }

        this.ctx.fillText(element.content, 0, 0);
    }

    /**
     * Render selection highlight around an element
     */
    private renderSelectionHighlight(
        element: WhiteboardElement,
        color: string,
        alpha: number,
    ): void {
        if (!this.ctx) return;

        const bounds = this.getElementBounds(element);
        const padding = 4;

        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = alpha;
        this.ctx.setLineDash([4, 4]);

        this.ctx.strokeRect(
            bounds.minX - padding,
            bounds.minY - padding,
            bounds.maxX - bounds.minX + padding * 2,
            bounds.maxY - bounds.minY + padding * 2,
        );

        this.ctx.restore();
    }

    /**
     * Get bounding box of an element
     */
    private getElementBounds(element: WhiteboardElement): {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    } {
        const { x, y } = element.transform;

        if (element.type === 'stroke') {
            const points = element.points;
            if (points.length === 0) {
                return { minX: x, minY: y, maxX: x, maxY: y };
            }

            let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;

            for (const p of points) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }

            return { minX: x + minX, minY: y + minY, maxX: x + maxX, maxY: y + maxY };
        } else if (element.type === 'shape') {
            return {
                minX: x,
                minY: y,
                maxX: x + element.width,
                maxY: y + element.height,
            };
        } else if (element.type === 'text') {
            // Approximate text bounds
            const width = element.content.length * element.fontSize * 0.6;
            return {
                minX: x,
                minY: y,
                maxX: x + width,
                maxY: y + element.fontSize,
            };
        }

        return { minX: x, minY: y, maxX: x, maxY: y };
    }

    /**
     * Render tool state (pending stroke, shape preview, etc.)
     */
    private renderToolState(toolState: ToolState): void {
        if (!this.ctx) return;

        // Render pending stroke
        if (toolState.pendingStroke && toolState.pendingStroke.points.length >= 2) {
            const { points, color, size } = toolState.pendingStroke;

            const inputPoints = points.map((p) => [p.x, p.y, p.pressure || 0.5]);

            const strokeOutline = getStroke(inputPoints, {
                size,
                thinning: 0.5,
                smoothing: 0.5,
                streamline: 0.5,
                simulatePressure: points[0].pressure === undefined,
            });

            if (strokeOutline.length > 0) {
                this.ctx.fillStyle = color;
                this.ctx.beginPath();
                const [first, ...rest] = strokeOutline;
                this.ctx.moveTo(first[0], first[1]);
                for (const [x, y] of rest) {
                    this.ctx.lineTo(x, y);
                }
                this.ctx.closePath();
                this.ctx.fill();
            }
        }

        // Render pending shape
        if (toolState.pendingShape) {
            const { type, startPoint, endPoint, style } = toolState.pendingShape;

            const x = Math.min(startPoint.x, endPoint.x);
            const y = Math.min(startPoint.y, endPoint.y);
            const width = Math.abs(endPoint.x - startPoint.x);
            const height = Math.abs(endPoint.y - startPoint.y);

            this.ctx.strokeStyle = style.strokeColor;
            this.ctx.lineWidth = style.strokeWidth;

            if (style.fillColor) {
                this.ctx.fillStyle = style.fillColor;
            }

            switch (type) {
                case 'rectangle':
                    if (style.fillColor) {
                        this.ctx.fillRect(x, y, width, height);
                    }
                    this.ctx.strokeRect(x, y, width, height);
                    break;

                case 'ellipse':
                    this.ctx.beginPath();
                    this.ctx.ellipse(
                        x + width / 2,
                        y + height / 2,
                        width / 2,
                        height / 2,
                        0,
                        0,
                        Math.PI * 2,
                    );
                    if (style.fillColor) {
                        this.ctx.fill();
                    }
                    this.ctx.stroke();
                    break;

                case 'line':
                    this.ctx.beginPath();
                    this.ctx.moveTo(startPoint.x, startPoint.y);
                    this.ctx.lineTo(endPoint.x, endPoint.y);
                    this.ctx.stroke();
                    break;

                case 'arrow':
                    this.renderArrow(
                        startPoint.x,
                        startPoint.y,
                        endPoint.x,
                        endPoint.y,
                        style.strokeWidth,
                    );
                    break;
            }
        }

        // Render selection box
        if (toolState.selectionBox) {
            const { minX, minY, maxX, maxY } = toolState.selectionBox;

            this.ctx.strokeStyle = '#2563EB';
            this.ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([4, 4]);

            this.ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
            this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

            this.ctx.setLineDash([]);
        }
    }

    /**
     * Render in-progress stroke points (for immediate feedback)
     */
    renderPendingPoints(points: CanvasPoint[], color: string, size: number): void {
        if (!this.ctx || points.length < 2) return;

        const inputPoints = points.map((p) => [p.x, p.y, p.pressure || 0.5]);

        const strokeOutline = getStroke(inputPoints, {
            size,
            thinning: 0.5,
            smoothing: 0.5,
            streamline: 0.5,
            simulatePressure: true,
        });

        if (strokeOutline.length > 0) {
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            const [first, ...rest] = strokeOutline;
            this.ctx.moveTo(first[0], first[1]);
            for (const [x, y] of rest) {
                this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();
            this.ctx.fill();
        }
    }

    /**
     * Screen to canvas coordinate transform
     */
    screenToCanvas(
        screenX: number,
        screenY: number,
        camera: Camera,
        canvasRect: DOMRect,
    ): CanvasPoint {
        const x =
            (screenX - canvasRect.left - this.width / 2) / camera.zoom + camera.x + this.width / 2;
        const y =
            (screenY - canvasRect.top - this.height / 2) / camera.zoom + camera.y + this.height / 2;
        return { x, y };
    }

    /**
     * Canvas to screen coordinate transform
     */
    canvasToScreen(
        canvasX: number,
        canvasY: number,
        camera: Camera,
        canvasRect: DOMRect,
    ): { x: number; y: number } {
        const x =
            (canvasX - camera.x - this.width / 2) * camera.zoom + canvasRect.left + this.width / 2;
        const y =
            (canvasY - camera.y - this.height / 2) * camera.zoom + canvasRect.top + this.height / 2;
        return { x, y };
    }

    /**
     * Get canvas dimensions
     */
    getDimensions(): { width: number; height: number } {
        return { width: this.width, height: this.height };
    }

    /**
     * Destroy renderer
     */
    destroy(): void {
        this.ctx = null;
    }
}
