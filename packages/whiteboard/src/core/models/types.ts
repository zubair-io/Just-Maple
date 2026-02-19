import type { StrokeElement, ShapeElement, TextElement, Camera } from '@maple/shared';

/**
 * Point in screen coordinates (before camera transform)
 */
export interface ScreenPoint {
    x: number;
    y: number;
}

/**
 * Point in canvas coordinates (after camera transform)
 */
export interface CanvasPoint {
    x: number;
    y: number;
    pressure?: number;
}

/**
 * Bounding box for hit testing and selection
 */
export interface BoundingBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/**
 * Pointer event with canvas coordinates
 */
export interface CanvasPointerEvent {
    screen: ScreenPoint;
    canvas: CanvasPoint;
    pressure: number;
    button: number;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    isPan: boolean; // Space held or middle-click
}

/**
 * In-progress stroke (not yet committed to Y.Doc)
 */
export interface PendingStroke {
    points: CanvasPoint[];
    color: string;
    size: number;
}

/**
 * Tool state for rendering previews
 */
export interface ToolState {
    pendingStroke?: PendingStroke;
    pendingShape?: {
        type: 'rectangle' | 'ellipse' | 'line' | 'arrow';
        startPoint: CanvasPoint;
        endPoint: CanvasPoint;
        style: {
            strokeColor: string;
            fillColor?: string;
            strokeWidth: number;
        };
    };
    selectionBox?: BoundingBox;
}

/**
 * Whiteboard element union type
 */
export type WhiteboardElement = StrokeElement | ShapeElement | TextElement;

/**
 * Stroke rendering options for perfect-freehand
 */
export interface StrokeOptions {
    size: number;
    thinning: number;
    smoothing: number;
    streamline: number;
    simulatePressure: boolean;
    start: {
        taper: number;
        cap: boolean;
    };
    end: {
        taper: number;
        cap: boolean;
    };
}

/**
 * Default stroke options
 */
export const DEFAULT_STROKE_OPTIONS: StrokeOptions = {
    size: 4,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
    start: {
        taper: 0,
        cap: true,
    },
    end: {
        taper: 0,
        cap: true,
    },
};

/**
 * Color palette for drawing
 */
export const COLOR_PALETTE = [
    '#000000', // Black
    '#374151', // Gray
    '#DC2626', // Red
    '#D97706', // Orange
    '#059669', // Green
    '#2563EB', // Blue
    '#7C3AED', // Purple
    '#DB2777', // Pink
];

/**
 * Stroke sizes
 */
export const STROKE_SIZES = [2, 4, 8, 16];

/**
 * Camera constraints
 */
export const CAMERA_CONSTRAINTS = {
    minZoom: 0.1,
    maxZoom: 4,
    zoomStep: 0.1,
};
