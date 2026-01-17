import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import type { Note, Tag, Paper, NotebookSSEEvent } from '@maple/shared';

/**
 * App Events - CRUD operations on notes, tags, papers
 */
export type AppEvent =
  | { type: 'connected'; userId: string; subscribedTags: string[] }
  | { type: 'note.created'; note: Note; tagId?: string }
  | { type: 'note.updated'; noteId: string; title?: string; updatedAt: string; tagId?: string }
  | { type: 'note.deleted'; noteId: string; tagId?: string }
  | { type: 'note.trashed'; noteId: string; tagId?: string }
  | { type: 'note.restored'; note: Note; tagId?: string }
  | { type: 'tag.created'; tag: Tag }
  | { type: 'tag.updated'; tagId: string; label?: string }
  | { type: 'tag.deleted'; tagId: string }
  | { type: 'paper.created'; paper: Paper; tagId: string }
  | { type: 'paper.updated'; paper: Paper; tagId: string }
  | { type: 'paper.deleted'; paperId: string; tagId: string };

/**
 * Message from server
 */
interface ServerMessage {
  channel: 'system' | 'app' | 'notebook' | 'chat';
  event: any;
  noteId?: string; // Present for notebook channel messages
}

/**
 * Realtime WebSocket Service
 * Single WebSocket connection for all real-time communication:
 * - App events (notes/tags/papers CRUD)
 * - Chat/typing indicators
 * - Notebook Y.Doc sync
 */
@Injectable({ providedIn: 'root' })
export class RealtimeWSService {
  private platformId = inject(PLATFORM_ID);
  private authService = inject(AuthService);

  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Connection state
  readonly connected = signal(false);
  readonly error = signal<string | null>(null);

  // Event streams
  private appEvents$ = new Subject<AppEvent>();
  private notebookEvents$ = new Subject<{ noteId: string; event: NotebookSSEEvent }>();
  private systemEvents$ = new Subject<any>();

  // Notebook handlers map: noteId -> handler function
  private notebookHandlers = new Map<string, (event: NotebookSSEEvent) => void>();

  // Pending messages queue (sent when connected)
  private pendingMessages: string[] = [];

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

        // Send pending messages using the local ws reference
        for (const msg of this.pendingMessages) {
          ws.send(msg);
        }
        this.pendingMessages = [];
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
          this.appEvents$.next(data.event);
        }
        break;

      case 'app':
        this.appEvents$.next(data.event);
        break;

      case 'notebook': {
        // Route to specific notebook handler
        const event = data.event as NotebookSSEEvent;
        const noteId = data.noteId;

        if (noteId) {
          const handler = this.notebookHandlers.get(noteId);
          if (handler) {
            handler(event);
          }
          this.notebookEvents$.next({ noteId, event });
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

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      // Queue message for when connected
      this.pendingMessages.push(msg);
    }
  }

  // ==================== Notebook Methods ====================

  /**
   * Join a notebook room for Y.Doc sync
   */
  joinNotebook(noteId: string, clientId?: string): void {
    this.send({
      channel: 'notebook',
      action: 'join',
      noteId,
      clientId,
    });
  }

  /**
   * Leave a notebook room
   */
  leaveNotebook(noteId: string): void {
    this.send({
      channel: 'notebook',
      action: 'leave',
      noteId,
    });
    this.notebookHandlers.delete(noteId);
  }

  /**
   * Send Y.Doc update
   */
  sendNotebookUpdate(noteId: string, update: Uint8Array): void {
    const base64 = uint8ArrayToBase64(update);
    this.send({
      channel: 'notebook',
      action: 'update',
      noteId,
      update: base64,
    });
  }

  /**
   * Send awareness update (cursor position, selection, etc.)
   */
  sendAwarenessUpdate(noteId: string, update: Uint8Array): void {
    const base64 = uint8ArrayToBase64(update);
    this.send({
      channel: 'notebook',
      action: 'awareness',
      noteId,
      update: base64,
    });
  }

  /**
   * Register handler for notebook events
   */
  onNotebookEvent(noteId: string, handler: (event: NotebookSSEEvent) => void): void {
    this.notebookHandlers.set(noteId, handler);
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
   * Subscribe to all notebook events
   */
  get notebookEvents(): Observable<{ noteId: string; event: NotebookSSEEvent }> {
    return this.notebookEvents$.asObservable();
  }

  // ==================== Chat Methods ====================

  /**
   * Send a chat message via WebSocket
   */
  sendChatMessage(tagId: string, content: any): void {
    this.send({
      channel: 'chat',
      action: 'message',
      tagId,
      content,
    });
  }

  /**
   * Send typing indicator
   */
  sendTyping(tagId: string, isTyping: boolean): void {
    this.send({
      channel: 'chat',
      action: 'typing',
      tagId,
      isTyping,
    });
  }

  /**
   * Subscribe to a tag for chat
   */
  subscribeTag(tagId: string): void {
    this.send({
      channel: 'chat',
      action: 'subscribe',
      tagId,
    });
  }

  /**
   * Unsubscribe from a tag
   */
  unsubscribeTag(tagId: string): void {
    this.send({
      channel: 'chat',
      action: 'unsubscribe',
      tagId,
    });
  }

  // ==================== Paper Methods ====================

  /**
   * Create a paper via WebSocket
   */
  createPaper(tags: string[], data: any): void {
    this.send({
      channel: 'app',
      action: 'paper.create',
      tags,
      data,
    });
  }

  /**
   * Update a paper via WebSocket
   */
  updatePaper(paperId: string, data?: any, tags?: string[]): void {
    this.send({
      channel: 'app',
      action: 'paper.update',
      paperId,
      data,
      tags,
    });
  }

  /**
   * Delete a paper via WebSocket
   */
  deletePaper(paperId: string): void {
    this.send({
      channel: 'app',
      action: 'paper.delete',
      paperId,
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
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected();
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
