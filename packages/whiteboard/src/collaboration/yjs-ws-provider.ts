import * as Y from 'yjs';
import { signal } from '@angular/core';
import { customAlphabet } from 'nanoid';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import type { MemoSSEEvent } from '@maple/shared';
import type { WhiteboardRealtimeTransport } from '../config/interfaces';

// Generate client IDs using nanoid
const generateClientId = customAlphabet(
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    21,
);

/**
 * Y.js WebSocket Provider
 * Syncs Y.Doc with server via unified WebSocket connection
 * Handles document updates and peer awareness
 */
export class YJSWSProvider {
    private readonly _clientId: string;
    private unsubscribeHandler: (() => void) | null = null;
    private awarenessUpdateHandler: ((changes: any) => void) | null = null;

    // Reactive state
    readonly connected = signal(false);
    readonly synced = signal(false);
    readonly error = signal<string | null>(null);
    readonly canWrite = signal(true);

    // Connection event handlers
    onConnected?: () => void;
    onSynced?: (synced: boolean) => void;

    // Peer event handlers
    onPeerJoin?: (peer: {
        clientId: string;
        userId: string;
        userName: string;
        userColor: string;
    }) => void;
    onPeerLeave?: (clientId: string) => void;

    // Access control callback
    onReadOnly?: () => void;

    constructor(
        private readonly pageId: string,
        private readonly ydoc: Y.Doc,
        private readonly realtimeWS: WhiteboardRealtimeTransport,
        private readonly awareness?: Awareness,
        private readonly pageType?: 'memo' | 'whiteboard' | 'kanban',
        private readonly parentPageId?: string, // For embedded whiteboards
    ) {
        this._clientId = generateClientId();

        // Listen for local Y.Doc changes
        this.ydoc.on('update', this.handleLocalUpdate.bind(this));

        // Listen for local awareness changes
        if (this.awareness) {
            this.awarenessUpdateHandler = ({ added, updated, removed }: any) => {
                const changedClients = added.concat(updated).concat(removed);
                this.handleLocalAwarenessUpdate(changedClients);
            };
            this.awareness.on('update', this.awarenessUpdateHandler);
        }
    }

    get clientId(): string {
        return this._clientId;
    }

    /**
     * Connect to memo room via WebSocket
     */
    connect(): void {
        // Register event handler for this memo
        this.realtimeWS.onMemoEvent(this.pageId, this.handleEvent.bind(this));

        // Join the memo room (pass parentPageId for embedded whiteboards)
        this.realtimeWS.joinMemo(this.pageId, this._clientId, this.parentPageId);

        this.connected.set(this.realtimeWS.isConnected());

        if (this.realtimeWS.isConnected()) {
            this.onConnected?.();
        }
    }

    /**
     * Disconnect from memo room
     */
    disconnect(): void {
        this.realtimeWS.leaveMemo(this.pageId);
        this.connected.set(false);
        this.synced.set(false);
        this.onSynced?.(false);
    }

    /**
     * Handle incoming memo event
     */
    private handleEvent(event: MemoSSEEvent): void {
        switch (event.type) {
            case 'ydoc-init':
                this.handleInit(event.data);
                break;
            case 'ydoc-update':
                this.handleRemoteUpdate(event.data);
                break;
            case 'awareness-update':
                this.handleRemoteAwarenessUpdate(event.data);
                break;
            case 'peer-join':
                this.onPeerJoin?.(event.data);
                break;
            case 'peer-leave':
                this.onPeerLeave?.(event.data.clientId);
                break;
            case 'ping':
                // Keepalive, no action needed
                break;
            case 'joined':
                if ((event as any).canWrite === false) {
                    this.canWrite.set(false);
                    this.onReadOnly?.();
                }
                break;
            default:
                break;
        }
    }

    /**
     * Handle initial document state from server
     */
    private handleInit(data: { state: string; version: number; peers: any[] }): void {
        try {
            const state = this.base64ToUint8Array(data.state);
            Y.applyUpdate(this.ydoc, state, 'remote');

            this.connected.set(true);
            this.synced.set(true);
            this.onConnected?.();
            this.onSynced?.(true);

            // Notify about existing peers
            for (const peer of data.peers || []) {
                this.onPeerJoin?.(peer);
            }

            // Send initial awareness state after sync
            this.sendInitialAwareness();

            // Send client's state diff to server (data the server doesn't have)
            const serverStateVector = Y.encodeStateVectorFromUpdate(state);
            const clientDiff = Y.encodeStateAsUpdate(this.ydoc, serverStateVector);
            if (clientDiff.length > 2) {
                this.realtimeWS.sendMemoUpdate(this.pageId, clientDiff, this.pageType);
            }
        } catch (err) {
            console.error('[YJS-WS] handleInit error:', err);
            this.error.set('Failed to load document');
        }
    }

    /**
     * Send initial awareness state to other peers
     */
    private sendInitialAwareness(): void {
        if (!this.awareness) return;

        const localClientId = this.awareness.clientID;
        const update = encodeAwarenessUpdate(this.awareness, [localClientId]);
        this.realtimeWS.sendAwarenessUpdate(this.pageId, update);
    }

    /**
     * Handle remote document update
     */
    private handleRemoteUpdate(data: { update: string; from: string }): void {
        try {
            const update = this.base64ToUint8Array(data.update);
            Y.applyUpdate(this.ydoc, update, 'remote');
        } catch {
            // Failed to apply remote update
        }
    }

    /**
     * Handle local Y.Doc update
     */
    private handleLocalUpdate(update: Uint8Array, origin: any): void {
        // Don't send back remote updates
        if (origin === 'remote') return;

        // Only send if connected and synced
        if (!this.connected() || !this.synced()) {
            return;
        }

        // Don't send updates if user has read-only access
        if (!this.canWrite()) return;

        // Send update via WebSocket with pageType for routing to correct backend service
        this.realtimeWS.sendMemoUpdate(this.pageId, update, this.pageType);
    }

    /**
     * Handle local awareness update (cursor moved, selection changed, etc.)
     */
    private handleLocalAwarenessUpdate(changedClients: number[]): void {
        if (!this.awareness || !this.connected() || !this.synced()) {
            return;
        }

        // Only send if local client changed
        const localClientId = this.awareness.clientID;
        if (!changedClients.includes(localClientId)) {
            return;
        }

        // Encode and send awareness update
        const update = encodeAwarenessUpdate(this.awareness, [localClientId]);
        this.realtimeWS.sendAwarenessUpdate(this.pageId, update);
    }

    /**
     * Handle remote awareness update from server
     */
    private handleRemoteAwarenessUpdate(data: { update: string; from: string }): void {
        if (!this.awareness) return;

        try {
            const update = this.base64ToUint8Array(data.update);
            applyAwarenessUpdate(this.awareness, update, 'remote');
        } catch {
            // Failed to apply awareness update
        }
    }

    /**
     * Convert base64 string to Uint8Array
     */
    private base64ToUint8Array(base64: string): Uint8Array {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    /**
     * Destroy provider
     */
    destroy(): void {
        this.disconnect();

        // Remove Y.Doc update listener
        this.ydoc.off('update', this.handleLocalUpdate.bind(this));

        // Remove awareness listener
        if (this.awareness && this.awarenessUpdateHandler) {
            this.awareness.off('update', this.awarenessUpdateHandler);
            this.awarenessUpdateHandler = null;
        }
    }
}
