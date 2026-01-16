import { Injectable, inject } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';
import type { Note, Tag, Paper } from '@maple/shared';
import { environment } from '../../environments/environment';

// Event types that can be received via SSE
export type AppEvent =
  | { type: 'connected'; userId: string }
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
 * Event Stream Service
 * Manages SSE connection for real-time app updates
 */
@Injectable({ providedIn: 'root' })
export class EventStreamService {
  private authService = inject(AuthService);

  // SSE connection
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 2000; // 2 seconds

  // Event stream
  private events$ = new Subject<AppEvent>();

  // Connection state
  private _isConnected = false;

  // API configuration
  private readonly API_BASE = `${environment.apiUrl || ''}/sse/events`;

  /**
   * Connect to the SSE event stream
   */
  connect(): void {
    if (this.eventSource) {
      console.log('[Event Stream] Already connected');
      return;
    }

    const token = this.authService.accessToken();
    if (!token) {
      console.warn('[Event Stream] Cannot connect - no access token');
      return;
    }

    // EventSource doesn't support custom headers, so pass token in query param
    const url = `${this.API_BASE}/stream?token=${token}`;

    this.eventSource = new EventSource(url);

    // Handle incoming messages
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          this.reconnectAttempts = 0;
          this._isConnected = true;
          return;
        }

        // Emit event to subscribers
        this.events$.next(data);
      } catch (error) {
        console.error('[Event Stream] Failed to parse SSE message:', error);
      }
    };

    // Handle connection open
    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      this._isConnected = true;
    };

    // Handle errors and reconnection
    this.eventSource.onerror = (error) => {
      // Check if this is a real error or just a normal close
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        console.warn('[Event Stream] Connection closed by server');
      } else if (this.eventSource?.readyState === EventSource.CONNECTING) {
        console.warn('[Event Stream] Connection failed, retrying...');
        // Don't manually reconnect when readyState is CONNECTING - EventSource handles this
        return;
      } else {
        console.error('[Event Stream] SSE error:', error);
      }

      this._isConnected = false;

      // Close the failed connection
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      // Attempt reconnection with exponential backoff
      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        const delay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);

        console.log(
          `[Event Stream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`,
        );

        setTimeout(() => {
          // Only reconnect if still have token
          if (this.authService.accessToken()) {
            this.connect();
          }
        }, delay);
      } else {
        console.error('[Event Stream] Max reconnection attempts reached');
      }
    };
  }

  /**
   * Disconnect from the SSE event stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this._isConnected = false;
      console.log('[Event Stream] Disconnected');
    }
  }

  /**
   * Subscribe to events of a specific type
   */
  on<T extends AppEvent['type']>(type: T): Observable<Extract<AppEvent, { type: T }>> {
    return this.events$.pipe(filter((event) => event.type === type)) as Observable<
      Extract<AppEvent, { type: T }>
    >;
  }

  /**
   * Subscribe to all events
   */
  get events(): Observable<AppEvent> {
    return this.events$.asObservable();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this._isConnected;
  }
}
