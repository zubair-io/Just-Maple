import { Injectable, signal, inject, PLATFORM_ID, DestroyRef, NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, Observable, filter, map } from 'rxjs';
import { AuthService } from './auth.service';
import type { ChatEvent, TypingEvent } from '@maple/shared';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
    private readonly authService = inject(AuthService);
    private readonly platformId = inject(PLATFORM_ID);
    private readonly destroyRef = inject(DestroyRef);
    private readonly ngZone = inject(NgZone);

    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 5;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private pingInterval: ReturnType<typeof setInterval> | null = null;

    // State signals
    private readonly _status = signal<ConnectionStatus>('disconnected');
    private readonly _subscribedTags = signal<string[]>([]);

    readonly status = this._status.asReadonly();
    readonly subscribedTags = this._subscribedTags.asReadonly();

    // Event subjects
    private readonly _events$ = new Subject<ChatEvent>();
    private readonly _typing$ = new Subject<TypingEvent>();

    // Observable streams
    readonly events$ = this._events$.asObservable();
    readonly typing$ = this._typing$.asObservable();

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.disconnect();
        });
    }

    /**
     * Connect to WebSocket server
     */
    async connect(): Promise<void> {
        console.log('[Realtime] connect() called');
        if (!isPlatformBrowser(this.platformId)) {
            console.log('[Realtime] Not in browser, skipping');
            return;
        }
        if (this.ws?.readyState === WebSocket.OPEN) {
            console.log('[Realtime] Already connected');
            return;
        }

        const token = this.authService.accessToken();
        console.log('[Realtime] Auth token:', token ? 'present' : 'missing');
        if (!token) {
            console.warn('[Realtime] No auth token available');
            return;
        }

        this._status.set('connecting');

        try {
            // Build WebSocket URL
            const wsUrl = this.getWebSocketUrl(token);
            console.log('[Realtime] Connecting to:', wsUrl);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.ngZone.run(() => {
                    this._status.set('connected');
                    this.reconnectAttempts = 0;
                    console.log('[Realtime] Connected');
                    this.startPingInterval();
                });
            };

            this.ws.onmessage = (event) => {
                this.ngZone.run(() => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleMessage(data);
                    } catch {
                        console.error('[Realtime] Failed to parse message:', event.data);
                    }
                });
            };

            this.ws.onclose = (event) => {
                this.ngZone.run(() => {
                    this.stopPingInterval();
                    this._status.set('disconnected');

                    if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }
                });
            };

            this.ws.onerror = (error) => {
                this.ngZone.run(() => {
                    console.error('[Realtime] WebSocket error:', error);
                });
            };
        } catch (error) {
            console.error('[Realtime] Connection failed:', error);
            this._status.set('disconnected');
            this.scheduleReconnect();
        }
    }

    /**
     * Disconnect from WebSocket server
     */
    disconnect(): void {
        this.stopPingInterval();
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }

        this._status.set('disconnected');
        this._subscribedTags.set([]);
    }

    /**
     * Send typing indicator
     */
    sendTyping(tagId: string, isTyping: boolean = true): void {
        this.send({
            type: 'typing',
            tagId,
            isTyping,
        });
    }

    /**
     * Subscribe to a tag's chat
     */
    subscribe(tagId: string): void {
        if (!this._subscribedTags().includes(tagId)) {
            this.send({ type: 'subscribe', tagId });
        }
    }

    /**
     * Unsubscribe from a tag's chat
     */
    unsubscribe(tagId: string): void {
        this.send({ type: 'unsubscribe', tagId });
    }

    /**
     * Get observable for messages in a specific tag
     */
    messagesForTag(tagId: string): Observable<ChatEvent> {
        return this.events$.pipe(filter((event) => event.tagId === tagId));
    }

    /**
     * Get observable for typing events in a specific tag
     */
    typingForTag(tagId: string): Observable<TypingEvent> {
        return this.typing$.pipe(filter((event) => event.tagId === tagId));
    }

    private getWebSocketUrl(token: string): string {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        // Use same host - Angular proxy handles /ws routing to API server
        return `${protocol}//${host}/ws/chat?token=${encodeURIComponent(token)}`;
    }

    private handleMessage(data: unknown): void {
        if (!data || typeof data !== 'object') return;

        const msg = data as Record<string, unknown>;
        console.log('[Realtime] Received message:', msg);

        // Handle connection confirmation
        if (msg['type'] === 'connected') {
            const subscribedTags = (msg['subscribedTags'] as string[]) || [];
            this._subscribedTags.set(subscribedTags);
            console.log('[Realtime] Connected, subscribed to tags:', subscribedTags);
            return;
        }

        // Handle pong
        if (msg['type'] === 'pong') {
            return;
        }

        // Handle chat events
        if (msg['action']) {
            const event = msg as unknown as ChatEvent;
            console.log('[Realtime] Chat event:', event.action, event);

            // Handle typing events separately
            if (event.action === 'typing' && event.data) {
                this._typing$.next(event.data as TypingEvent);
                return;
            }

            this._events$.next(event);
        }
    }

    private send(data: Record<string, unknown>): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout) return;

        this.reconnectAttempts++;
        this._status.set('reconnecting');

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        console.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, delay);
    }

    private startPingInterval(): void {
        this.pingInterval = setInterval(() => {
            this.send({ type: 'ping' });
        }, 30000);
    }

    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}
