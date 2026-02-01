import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { VisibilityService } from './visibility.service';
import { environment } from '../../environments/environment';
import type { Page, Notebook, Collectable, MemoSSEEvent, Recording } from '@maple/shared';

/**
 * App Events - CRUD operations on pages, notebooks, collectables
 */
export type AppEvent =
  | { type: 'connected'; userId: string; subscribedNotebooks: string[] }
  | { type: 'page.created'; page: Page; notebookId?: string }
  | { type: 'page.updated'; pageId: string; title?: string; updatedAt: string; notebookId?: string }
  | { type: 'page.deleted'; pageId: string; notebookId?: string }
  | { type: 'page.trashed'; pageId: string; notebookId?: string }
  | { type: 'page.restored'; page: Page; notebookId?: string }
  | { type: 'notebook.created'; notebook: Notebook }
  | { type: 'notebook.updated'; notebookId: string; label?: string }
  | { type: 'notebook.deleted'; notebookId: string }
  | { type: 'collectable.created'; collectable: Collectable; notebookId: string }
  | { type: 'collectable.updated'; collectable: Collectable; notebookId: string }
  | { type: 'collectable.deleted'; collectableId: string; notebookId: string }
  | { type: 'recording.started'; id: string; notebookId?: string }
  | { type: 'recording.completed'; recording: Recording; notebookId?: string }
  | { type: 'recording.failed'; id: string; error?: string; notebookId?: string };

/**
 * Message from server
 */
interface ServerMessage {
  channel: 'system' | 'app' | 'memo' | 'chat';
  event: any;
  pageId?: string; // Present for memo channel messages
}

/**
 * Realtime WebSocket Service
 * Single WebSocket connection for all real-time communication:
 * - App events (pages/notebooks/collectables CRUD)
 * - Chat/typing indicators
 * - Memo Y.Doc sync
 */
@Injectable({ providedIn: 'root' })
export class RealtimeWSService {
  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);
  private visibilityService = inject(VisibilityService);

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Connection state
  readonly connected = signal(false);
  readonly ready = signal(false); // Server has confirmed connection is ready
  readonly error = signal<string | null>(null);

  // Event streams
  private appEvents$ = new Subject<AppEvent>();
  private memoEvents$ = new Subject<{ pageId: string; event: MemoSSEEvent }>();
  private systemEvents$ = new Subject<any>();

  // Memo handlers map: pageId -> handler function
  private memoHandlers = new Map<string, (event: MemoSSEEvent) => void>();

  // Pending messages queue (sent when server confirms connection)
  private pendingMessages: string[] = [];

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Reconnect when document becomes visible if not connected
      this.visibilityService.becameVisible$
        .pipe(filter(() => !this.connected()))
        .subscribe(() => this.connect());
    }
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Guard against multiple connect calls - check both OPEN and CONNECTING states
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const token = this.authService.accessToken();
    if (!token) {
      return;
    }

    // Build WebSocket URL
    let wsUrl = environment.wsUrl || '';
    if (!wsUrl) {
      // Use relative URL with same host
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}`;
    }

    const url = `${wsUrl}/ws/realtime`;

    try {
      // Pass token via Sec-WebSocket-Protocol header (more secure than query param)
      const ws = new WebSocket(url, [token]);
      this.ws = ws;

      ws.onopen = () => {
        this.connected.set(true);
        this.error.set(null);
        this.reconnectAttempts = 0;
        // Don't send pending messages yet - wait for server 'connected' event
        // which confirms the server has set up the connection context
      };

      this.ws.onmessage = (event) => {
        try {
          const data: ServerMessage = JSON.parse(event.data);
          this.handleMessage(data);
        } catch {
          // Parse error
        }
      };

      this.ws.onerror = () => {
        this.error.set('Connection error');
      };

      this.ws.onclose = (event) => {
        this.connected.set(false);
        this.ready.set(false);
        this.ws = null;

        // Don't reconnect if closed intentionally or auth error
        if (event.code === 1000 || event.code === 4001 || event.code === 1008) {
          return;
        }

        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.connected.set(false);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: ServerMessage): void {
    switch (data.channel) {
      case 'system':
        this.systemEvents$.next(data.event);
        if (data.event.type === 'connected') {
          console.log('[WS] Server confirmed connection ready');
          this.ready.set(true);
          this.appEvents$.next(data.event);
          // Now send any pending messages
          for (const msg of this.pendingMessages) {
            this.ws?.send(msg);
          }
          this.pendingMessages = [];
        }
        break;

      case 'app':
        this.appEvents$.next(data.event);
        break;

      case 'memo': {
        // Route to specific memo handler
        const event = data.event as MemoSSEEvent;
        const pageId = data.pageId;

        console.log(`[WS] Received memo event: ${event.type}, pageId: ${pageId}`);

        if (pageId) {
          const handler = this.memoHandlers.get(pageId);
          if (handler) {
            console.log(`[WS] Found handler for pageId ${pageId}, invoking...`);
            handler(event);
          } else {
            console.log(
              `[WS] No handler found for pageId ${pageId}. Registered handlers:`,
              Array.from(this.memoHandlers.keys()),
            );
          }
          this.memoEvents$.next({ pageId, event });
        } else {
          console.log(`[WS] Memo event received without pageId:`, data);
        }
        break;
      }

      case 'chat':
        // Chat events can be handled through appEvents for simplicity
        this.appEvents$.next(data.event);
        break;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.error.set('Connection failed. Please refresh the page.');
      return;
    }

    const delay = this.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.error.set('Connection lost. Reconnecting...');

    this.reconnectTimer = setTimeout(() => {
      if (this.authService.accessToken()) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Send message to server
   */
  send(message: object): void {
    const msg = JSON.stringify(message);

    // Only send if WebSocket is open AND server has confirmed connection ready
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.ready()) {
      this.ws.send(msg);
    } else {
      // Queue message for when server confirms connection
      this.pendingMessages.push(msg);
    }
  }

  // ==================== Memo Methods ====================

  /**
   * Join a memo room for Y.Doc sync
   * @param pageId The document ID to join
   * @param clientId Optional client ID for this session
   * @param parentPageId Optional parent memo's pageId for embedded whiteboards (used for authorization)
   */
  joinMemo(pageId: string, clientId?: string, parentPageId?: string): void {
    this.send({
      channel: 'memo',
      action: 'join',
      pageId,
      clientId,
      parentPageId,
    });
  }

  /**
   * Leave a memo room
   */
  leaveMemo(pageId: string): void {
    this.send({
      channel: 'memo',
      action: 'leave',
      pageId,
    });
    this.memoHandlers.delete(pageId);
  }

  /**
   * Send Y.Doc update
   */
  sendMemoUpdate(
    pageId: string,
    update: Uint8Array,
    pageType?: 'memo' | 'whiteboard' | 'kanban',
  ): void {
    const base64 = uint8ArrayToBase64(update);
    this.send({
      channel: 'memo',
      action: 'update',
      pageId,
      update: base64,
      pageType,
    });
  }

  /**
   * Send awareness update (cursor position, selection, etc.)
   */
  sendAwarenessUpdate(pageId: string, update: Uint8Array): void {
    const base64 = uint8ArrayToBase64(update);
    this.send({
      channel: 'memo',
      action: 'awareness',
      pageId,
      update: base64,
    });
  }

  /**
   * Register handler for memo events
   */
  onMemoEvent(pageId: string, handler: (event: MemoSSEEvent) => void): void {
    this.memoHandlers.set(pageId, handler);
  }

  // ==================== App Event Subscriptions ====================

  /**
   * Subscribe to events of a specific type
   */
  on<T extends AppEvent['type']>(type: T): Observable<Extract<AppEvent, { type: T }>> {
    return this.appEvents$.pipe(filter((event) => event.type === type)) as Observable<
      Extract<AppEvent, { type: T }>
    >;
  }

  /**
   * Subscribe to all app events
   */
  get events(): Observable<AppEvent> {
    return this.appEvents$.asObservable();
  }

  /**
   * Subscribe to all memo events
   */
  get memoEvents(): Observable<{ pageId: string; event: MemoSSEEvent }> {
    return this.memoEvents$.asObservable();
  }

  // ==================== Chat Methods ====================

  /**
   * Send a chat message via WebSocket
   */
  sendChatMessage(notebookId: string, content: any): void {
    this.send({
      channel: 'chat',
      action: 'message',
      notebookId,
      content,
    });
  }

  /**
   * Send typing indicator
   */
  sendTyping(notebookId: string, isTyping: boolean): void {
    this.send({
      channel: 'chat',
      action: 'typing',
      notebookId,
      isTyping,
    });
  }

  /**
   * Subscribe to a notebook for chat
   */
  subscribeNotebook(notebookId: string): void {
    this.send({
      channel: 'chat',
      action: 'subscribe',
      notebookId,
    });
  }

  /**
   * Unsubscribe from a notebook
   */
  unsubscribeNotebook(notebookId: string): void {
    this.send({
      channel: 'chat',
      action: 'unsubscribe',
      notebookId,
    });
  }

  // ==================== Collectable Methods ====================

  /**
   * Create a collectable via WebSocket
   */
  createCollectable(notebookIds: string[], data: any): void {
    this.send({
      channel: 'app',
      action: 'collectable.create',
      notebookIds,
      data,
    });
  }

  /**
   * Update a collectable via WebSocket
   */
  updateCollectable(collectableId: string, data?: any, notebookIds?: string[]): void {
    this.send({
      channel: 'app',
      action: 'collectable.update',
      collectableId,
      data,
      notebookIds,
    });
  }

  /**
   * Delete a collectable via WebSocket
   */
  deleteCollectable(collectableId: string): void {
    this.send({
      channel: 'app',
      action: 'collectable.delete',
      collectableId,
    });
  }

  // ==================== System Methods ====================

  /**
   * Send ping
   */
  ping(): void {
    this.send({
      channel: 'system',
      action: 'ping',
    });
  }

  /**
   * Check if connected and ready to send messages
   */
  isConnected(): boolean {
    return this.ready();
  }
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
