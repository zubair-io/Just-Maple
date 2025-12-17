import { Injectable, signal, inject, PLATFORM_ID, DestroyRef, NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, Observable, filter } from 'rxjs';
import * as signalR from '@microsoft/signalr';
import { AuthService } from './auth.service';
import type { ChatEvent, TypingEvent } from '@maple/shared';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// SignalR negotiate URL for justmaple.app domain
const SIGNALR_NEGOTIATE_URL = 'https://autumn-blaze.justmaple.app/api/signalr';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
    private readonly authService = inject(AuthService);
    private readonly platformId = inject(PLATFORM_ID);
    private readonly destroyRef = inject(DestroyRef);
    private readonly ngZone = inject(NgZone);

    // WebSocket (dev/self-hosted)
    private ws: WebSocket | null = null;
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 5;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private pingInterval: ReturnType<typeof setInterval> | null = null;

    // SignalR (production on justmaple.app)
    private signalrConnection: signalR.HubConnection | null = null;

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
     * Check if we should use SignalR (only on justmaple.app domain)
     */
    private shouldUseSignalR(): boolean {
        if (!isPlatformBrowser(this.platformId)) {
            return false;
        }
        return window.location.hostname.endsWith('justmaple.app');
    }

    /**
     * Connect to realtime server (WebSocket or SignalR based on domain)
     */
    async connect(): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) {
            return;
        }

        if (this.shouldUseSignalR()) {
            await this.connectSignalR();
        } else {
            await this.connectWebSocket();
        }
    }

    /**
     * Disconnect from realtime server
     */
    disconnect(): void {
        if (this.shouldUseSignalR()) {
            this.disconnectSignalR();
        } else {
            this.disconnectWebSocket();
        }
    }

    /**
     * Send typing indicator
     */
    sendTyping(tagId: string, isTyping: boolean = true): void {
        if (this.shouldUseSignalR()) {
            // SignalR: invoke method on hub
            this.signalrConnection?.invoke('SendTyping', tagId, isTyping).catch(console.error);
        } else {
            this.sendWs({
                type: 'typing',
                tagId,
                isTyping,
            });
        }
    }

    /**
     * Subscribe to a tag's chat
     */
    subscribe(tagId: string): void {
        if (!this._subscribedTags().includes(tagId)) {
            if (this.shouldUseSignalR()) {
                this.signalrConnection?.invoke('Subscribe', tagId).catch(console.error);
            } else {
                this.sendWs({ type: 'subscribe', tagId });
            }
        }
    }

    /**
     * Unsubscribe from a tag's chat
     */
    unsubscribe(tagId: string): void {
        if (this.shouldUseSignalR()) {
            this.signalrConnection?.invoke('Unsubscribe', tagId).catch(console.error);
        } else {
            this.sendWs({ type: 'unsubscribe', tagId });
        }
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

    // ============ SignalR Implementation ============

    private async connectSignalR(): Promise<void> {
        if (
            this.signalrConnection?.state === signalR.HubConnectionState.Connected ||
            this.signalrConnection?.state === signalR.HubConnectionState.Connecting
        ) {
            return;
        }

        const token = this.authService.accessToken();
        if (!token) {
            return;
        }

        this._status.set('connecting');

        try {
            // Step 1: Get connection info from negotiate endpoint
            const userId = this.authService.user()?._id;
            const negotiateUrl = `${SIGNALR_NEGOTIATE_URL}?userId=${encodeURIComponent(userId || '')}`;

            const response = await fetch(negotiateUrl, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Negotiate failed: ${response.status}`);
            }

            const connectionInfo = (await response.json()) as { url: string; accessToken: string };

            // Step 2: Connect to SignalR using the returned URL and token
            this.signalrConnection = new signalR.HubConnectionBuilder()
                .withUrl(connectionInfo.url, {
                    accessTokenFactory: () => connectionInfo.accessToken,
                })
                .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
                .configureLogging(signalR.LogLevel.Information)
                .build();

            // Handle incoming messages
            this.signalrConnection.on('newMessage', (event: ChatEvent) => {
                this.ngZone.run(() => {
                    if (event.action === 'typing' && event.data) {
                        this._typing$.next(event.data as TypingEvent);
                    } else {
                        this._events$.next(event);
                    }
                });
            });

            // Handle connection state changes
            this.signalrConnection.onreconnecting(() => {
                this.ngZone.run(() => this._status.set('reconnecting'));
            });

            this.signalrConnection.onreconnected(() => {
                this.ngZone.run(() => this._status.set('connected'));
            });

            this.signalrConnection.onclose(() => {
                this.ngZone.run(() => {
                    this._status.set('disconnected');
                    this._subscribedTags.set([]);
                });
            });

            await this.signalrConnection.start();
            this._status.set('connected');
            console.log('SignalR connected successfully');
        } catch (error) {
            console.error('SignalR connection failed:', error);
            this._status.set('disconnected');
            this.scheduleSignalRReconnect();
        }
    }

    private signalrReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private signalrReconnectAttempts = 0;

    private scheduleSignalRReconnect(): void {
        if (this.signalrReconnectTimeout) return;

        this.signalrReconnectAttempts++;
        if (this.signalrReconnectAttempts > this.maxReconnectAttempts) {
            console.error('Max SignalR reconnect attempts reached');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.signalrReconnectAttempts - 1), 30000);
        this._status.set('reconnecting');

        this.signalrReconnectTimeout = setTimeout(() => {
            this.signalrReconnectTimeout = null;
            this.connectSignalR();
        }, delay);
    }

    private disconnectSignalR(): void {
        if (this.signalrReconnectTimeout) {
            clearTimeout(this.signalrReconnectTimeout);
            this.signalrReconnectTimeout = null;
        }
        if (this.signalrConnection) {
            this.signalrConnection.stop();
            this.signalrConnection = null;
        }
        this._status.set('disconnected');
        this._subscribedTags.set([]);
        this.signalrReconnectAttempts = 0;
    }

    // ============ WebSocket Implementation ============

    private async connectWebSocket(): Promise<void> {
        if (this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        const token = this.authService.accessToken();
        if (!token) {
            return;
        }

        this._status.set('connecting');

        try {
            const wsUrl = this.getWebSocketUrl(token);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.ngZone.run(() => {
                    this._status.set('connected');
                    this.reconnectAttempts = 0;
                    this.startPingInterval();
                });
            };

            this.ws.onmessage = (event) => {
                this.ngZone.run(() => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleWsMessage(data);
                    } catch {
                        // Ignore malformed messages
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

            this.ws.onerror = () => {
                // Error handled by onclose
            };
        } catch {
            this._status.set('disconnected');
            this.scheduleReconnect();
        }
    }

    private disconnectWebSocket(): void {
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

    private getWebSocketUrl(token: string): string {
        // Always use relative URL - WebSocket connects to same origin
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        return `${protocol}//${host}/ws/chat?token=${encodeURIComponent(token)}`;
    }

    private handleWsMessage(data: unknown): void {
        if (!data || typeof data !== 'object') return;

        const msg = data as Record<string, unknown>;

        // Handle connection confirmation
        if (msg['type'] === 'connected') {
            const subscribedTags = (msg['subscribedTags'] as string[]) || [];
            this._subscribedTags.set(subscribedTags);
            return;
        }

        // Handle pong
        if (msg['type'] === 'pong') {
            return;
        }

        // Handle chat events
        if (msg['action']) {
            const event = msg as unknown as ChatEvent;

            // Handle typing events separately
            if (event.action === 'typing' && event.data) {
                this._typing$.next(event.data as TypingEvent);
                return;
            }

            this._events$.next(event);
        }
    }

    private sendWs(data: Record<string, unknown>): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout) return;

        this.reconnectAttempts++;
        this._status.set('reconnecting');

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, delay);
    }

    private startPingInterval(): void {
        this.pingInterval = setInterval(() => {
            this.sendWs({ type: 'ping' });
        }, 30000);
    }

    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}
