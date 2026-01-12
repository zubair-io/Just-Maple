import { Injectable, inject, signal, computed } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from './auth.service';
import type { Note, Tag } from '@maple/shared';
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
  | { type: 'tag.deleted'; tagId: string };

// Connection state for UI feedback
export type ConnectionState =
  | 'disconnected'
  | 'checking'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

// Error types for better diagnostics
export type ConnectionError =
  | { type: 'server_unavailable'; message: string; statusCode?: number }
  | { type: 'auth_failed'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'unknown'; message: string };

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

  // Connection state signals for UI feedback
  private readonly _connectionState = signal<ConnectionState>('disconnected');
  private readonly _lastError = signal<ConnectionError | null>(null);

  /** Current connection state */
  readonly connectionState = this._connectionState.asReadonly();

  /** Last connection error (null if no error) */
  readonly lastError = this._lastError.asReadonly();

  /** Whether currently connected */
  readonly isConnectedSignal = computed(() => this._connectionState() === 'connected');

  /** User-friendly status message */
  readonly statusMessage = computed(() => {
    const state = this._connectionState();
    const error = this._lastError();

    switch (state) {
      case 'disconnected':
        return 'Disconnected from server';
      case 'checking':
        return 'Checking server availability...';
      case 'connecting':
        return 'Connecting to real-time updates...';
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return `Reconnecting (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`;
      case 'error':
        return error?.message || 'Connection error';
    }
  });

  // API configuration
  private readonly API_BASE = `${environment.apiUrl || ''}/api`;

  /**
   * Check if the API server is available before attempting SSE connection
   */
  private async checkServerHealth(): Promise<{ healthy: boolean; error?: ConnectionError }> {
    try {
      const response = await fetch(`${this.API_BASE}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'healthy') {
          return { healthy: true };
        }
        return {
          healthy: false,
          error: {
            type: 'server_unavailable',
            message: `Server unhealthy: ${data.database || 'unknown issue'}`,
            statusCode: response.status,
          },
        };
      }

      // Handle specific HTTP error codes
      if (response.status === 503) {
        return {
          healthy: false,
          error: {
            type: 'server_unavailable',
            message:
              'API server is unavailable (503). The server may be starting up or experiencing issues.',
            statusCode: 503,
          },
        };
      }

      if (response.status === 502) {
        return {
          healthy: false,
          error: {
            type: 'server_unavailable',
            message: 'Bad gateway (502). The API server is not responding to the load balancer.',
            statusCode: 502,
          },
        };
      }

      if (response.status === 504) {
        return {
          healthy: false,
          error: {
            type: 'server_unavailable',
            message: 'Gateway timeout (504). The API server took too long to respond.',
            statusCode: 504,
          },
        };
      }

      return {
        healthy: false,
        error: {
          type: 'server_unavailable',
          message: `Server returned status ${response.status}`,
          statusCode: response.status,
        },
      };
    } catch (error) {
      // Network-level errors (DNS, connection refused, etc.)
      const message =
        error instanceof TypeError
          ? 'Network error: Unable to reach the API server. Check your internet connection.'
          : `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      return {
        healthy: false,
        error: { type: 'network_error', message },
      };
    }
  }

  /**
   * Connect to the SSE event stream
   */
  async connect(): Promise<void> {
    if (this.eventSource) {
      console.log('[Event Stream] Already connected');
      return;
    }

    const token = this.authService.accessToken();
    if (!token) {
      console.warn('[Event Stream] Cannot connect - no access token');
      this._lastError.set({ type: 'auth_failed', message: 'No access token available' });
      this._connectionState.set('error');
      return;
    }

    // Check server health first
    this._connectionState.set('checking');
    const health = await this.checkServerHealth();

    if (!health.healthy) {
      console.error('[Event Stream] Server health check failed:', health.error?.message);
      this._lastError.set(health.error || { type: 'unknown', message: 'Health check failed' });
      this._connectionState.set('error');
      this.scheduleReconnect();
      return;
    }

    // Server is healthy, proceed with SSE connection
    this._connectionState.set('connecting');
    this._lastError.set(null);

    const url = `${this.API_BASE}/events/stream?token=${token}`;
    this.eventSource = new EventSource(url);

    // Handle incoming messages
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          this.reconnectAttempts = 0;
          this._connectionState.set('connected');
          this._lastError.set(null);
          console.log('[Event Stream] Connected successfully');
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
      this._connectionState.set('connected');
      this._lastError.set(null);
    };

    // Handle errors and reconnection
    this.eventSource.onerror = () => {
      const wasConnected = this._connectionState() === 'connected';

      // Check if this is a real error or just a normal close
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        console.warn('[Event Stream] Connection closed by server');
        this._lastError.set({
          type: 'server_unavailable',
          message: 'Connection closed by server',
        });
      } else if (this.eventSource?.readyState === EventSource.CONNECTING) {
        // EventSource is handling reconnection automatically
        if (wasConnected) {
          this._connectionState.set('reconnecting');
        }
        console.warn('[Event Stream] Connection interrupted, EventSource reconnecting...');
        return;
      } else {
        this._lastError.set({
          type: 'unknown',
          message: 'SSE connection error',
        });
      }

      // Close the failed connection
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      this._connectionState.set('error');
      this.scheduleReconnect();
    };
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[Event Stream] Max reconnection attempts reached');
      this._lastError.set({
        type: 'server_unavailable',
        message: `Failed to connect after ${this.MAX_RECONNECT_ATTEMPTS} attempts. Please refresh the page or try again later.`,
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[Event Stream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`,
    );

    this._connectionState.set('reconnecting');

    setTimeout(() => {
      // Only reconnect if still have token
      if (this.authService.accessToken()) {
        this.connect();
      } else {
        this._connectionState.set('disconnected');
        this._lastError.set({
          type: 'auth_failed',
          message: 'Session expired. Please log in again.',
        });
      }
    }, delay);
  }

  /**
   * Disconnect from the SSE event stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      console.log('[Event Stream] Disconnected');
    }
    this._connectionState.set('disconnected');
    this._lastError.set(null);
    this.reconnectAttempts = 0;
  }

  /**
   * Force a reconnection attempt (resets attempt counter)
   */
  reconnect(): void {
    this.disconnect();
    this.connect();
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
   * Check if connected (legacy method, prefer isConnectedSignal)
   */
  isConnected(): boolean {
    return this._connectionState() === 'connected';
  }
}
