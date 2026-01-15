import { Injectable, signal, inject, PLATFORM_ID, DestroyRef, NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, Observable, filter } from 'rxjs';
import { AuthService } from './auth.service';
import type { ChatEvent, TypingEvent } from '@maple/shared';
import { environment } from '../../environments/environment';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  // WebSocket connection
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
   * Connect to realtime server via WebSocket
   */
  async connect(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    await this.connectWebSocket();
  }

  /**
   * Disconnect from realtime server
   */
  disconnect(): void {
    this.disconnectWebSocket();
  }

  /**
   * Send typing indicator
   */
  sendTyping(tagId: string, isTyping: boolean = true): void {
    this.sendWs({
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
      this.sendWs({ type: 'subscribe', tagId });
    }
  }

  /**
   * Unsubscribe from a tag's chat
   */
  unsubscribe(tagId: string): void {
    this.sendWs({ type: 'unsubscribe', tagId });
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

  // ============ WebSocket Implementation ============

  private async connectWebSocket(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[RealtimeService] WebSocket already connected, skipping');
      return;
    }

    const token = this.authService.accessToken();
    if (!token) {
      console.warn('[RealtimeService] No auth token available, cannot connect WebSocket');
      return;
    }

    console.log('[RealtimeService] Connecting WebSocket with token...');
    this._status.set('connecting');

    try {
      const wsUrl = this.getWebSocketUrl();
      console.log('[RealtimeService] WebSocket URL:', wsUrl);
      // Pass token via Sec-WebSocket-Protocol header (secure, not in URL)
      this.ws = new WebSocket(wsUrl, [token]);

      this.ws.onopen = () => {
        this.ngZone.run(() => {
          console.log('[RealtimeService] WebSocket connected');
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
          console.log(
            '[RealtimeService] WebSocket closed:',
            event.code,
            event.reason,
            'wasClean:',
            event.wasClean,
          );
          this.stopPingInterval();
          this._status.set('disconnected');

          if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        });
      };

      this.ws.onerror = (err) => {
        console.error('[RealtimeService] WebSocket error:', err);
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

  private getWebSocketUrl(): string {
    // Use environment.wsUrl if configured, otherwise use relative URL (same origin)
    if (environment.wsUrl) {
      return `${environment.wsUrl}/ws/chat`;
    }

    // Fallback: construct from window.location (dev/self-hosted)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/chat`;
  }

  private handleWsMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;

    const msg = data as Record<string, unknown>;

    // Handle connection confirmation
    if (msg['type'] === 'connected') {
      const subscribedTags = (msg['subscribedTags'] as string[]) || [];
      console.log('[RealtimeService] Connected, subscribed to tags:', subscribedTags);
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
      console.log('[RealtimeService] Received event:', event.action, 'for tag:', event.tagId);

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
