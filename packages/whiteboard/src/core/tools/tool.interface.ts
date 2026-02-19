import type { Signal, WritableSignal } from '@angular/core';
import type { WhiteboardToolType, Camera } from '@maple/shared';
import type { WhiteboardYDoc } from '../../collaboration/whiteboard-document.service';
import type { CanvasPointerEvent, ToolState } from '../models/types';

/**
 * Tool context provided to all tools
 */
export interface ToolContext {
    pageId: string;
    whiteboard: WhiteboardYDoc;
    camera: Signal<Camera>;
    selectedIds: WritableSignal<string[]>;
    toolState: WritableSignal<ToolState>;
    strokeColor: Signal<string>;
    strokeSize: Signal<number>;
    requestRender: () => void;
}

/**
 * Result from tool pointer events
 */
export interface ToolResult {
    cursor?: string; // CSS cursor style
    render?: boolean; // Request re-render
}

/**
 * Base interface for all whiteboard tools
 */
export interface Tool {
    readonly name: WhiteboardToolType;
    readonly cursor: string;

    /**
     * Called when tool is activated
     */
    activate(context: ToolContext): void;

    /**
     * Called when tool is deactivated
     */
    deactivate(): void;

    /**
     * Handle pointer down event
     */
    onPointerDown(event: CanvasPointerEvent): ToolResult;

    /**
     * Handle pointer move event
     */
    onPointerMove(event: CanvasPointerEvent): ToolResult;

    /**
     * Handle pointer up event
     */
    onPointerUp(event: CanvasPointerEvent): ToolResult;

    /**
     * Handle pointer leave (cancel in-progress action)
     */
    onPointerLeave?(): void;

    /**
     * Handle keyboard shortcuts specific to this tool
     * Return true if handled
     */
    onKeyDown?(event: KeyboardEvent): boolean;
}
