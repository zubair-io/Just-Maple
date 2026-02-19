import type { Signal } from '@angular/core';
import type { Observable } from 'rxjs';
import type { MemoSSEEvent, Page } from '@maple/shared';

/**
 * Provides the current user identity for awareness and authorization.
 */
export interface WhiteboardUserProvider {
    user: Signal<{ _id: string; displayName?: string; email?: string } | null>;
    accessToken: Signal<string | null>;
    initReady$: Observable<boolean>;
}

/**
 * Reports whether the client can sync with the server.
 */
export interface WhiteboardConnectivity {
    canSync: Signal<boolean>;
}

/**
 * Transport layer for real-time Y.js document sync via WebSocket.
 */
export interface WhiteboardRealtimeTransport {
    isConnected(): boolean;
    connect(): void;
    joinMemo(pageId: string, clientId: string, parentPageId?: string): void;
    leaveMemo(pageId: string): void;
    sendMemoUpdate(
        pageId: string,
        update: Uint8Array,
        pageType?: 'memo' | 'whiteboard' | 'kanban',
    ): void;
    sendAwarenessUpdate(pageId: string, update: Uint8Array): void;
    onMemoEvent(pageId: string, handler: (event: MemoSSEEvent) => void): void;
}

/**
 * Queues actions for offline-first sync.
 */
export interface WhiteboardOfflineQueue {
    enqueue(action: string, noteId: string, documentId: string, payload?: unknown): Promise<string>;
    waitForAction(documentId: string, action: string, timeoutMs?: number): Promise<boolean>;
}

/**
 * Emits when the browser tab becomes visible (for re-sync).
 */
export interface WhiteboardVisibility {
    becameVisible$: Observable<boolean>;
}

/**
 * Provides local page storage for offline-first whiteboard creation.
 */
export interface WhiteboardPageStore {
    addLocalPage(page: Page): void;
    persistToIndexedDB(pages: Page[]): Promise<void>;
}

/**
 * Configuration for the whiteboard toolbar and defaults.
 */
export interface WhiteboardConfig {
    /** Override which tools appear in the toolbar. */
    tools?: Array<{
        type: string;
        icon: string;
        label: string;
        shortcut: string;
    }>;
    /** Default stroke color. */
    defaultColor?: string;
    /** Color palette for the color picker. */
    colorPalette?: string[];
    /** Stroke size options. */
    strokeSizes?: number[];
    /** Whether to show zoom controls. */
    showZoomControls?: boolean;
}
