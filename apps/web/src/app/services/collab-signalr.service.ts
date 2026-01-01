import { Injectable, inject, PLATFORM_ID, DestroyRef, NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, Observable, filter } from 'rxjs';
import * as signalR from '@microsoft/signalr';
import { AuthService } from './auth.service';
import type { CollabEvent } from '@maple/shared';
import { environment } from '../../environments/environment';

/**
 * SignalR-based collaboration service for production mode
 * Provides real-time collaboration events via Azure SignalR
 */
@Injectable({ providedIn: 'root' })
export class CollabSignalRService {
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  private signalrConnection: signalR.HubConnection | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Event stream
  private readonly _events$ = new Subject<CollabEvent>();
  readonly events$ = this._events$.asObservable();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.disconnect();
    });
  }

  /**
   * Connect to SignalR collaboration hub
   */
  async connect(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || !environment.useSignalR) {
      return;
    }

    if (
      this.signalrConnection?.state === signalR.HubConnectionState.Connected ||
      this.signalrConnection?.state === signalR.HubConnectionState.Connecting
    ) {
      return;
    }

    const token = this.authService.accessToken();
    if (!token) {
      console.error('[Collab SignalR] No access token available');
      return;
    }

    try {
      // Step 1: Negotiate with AutumnBlaze for collab hub
      const userId = this.authService.user()?._id;
      const negotiateUrl = `${environment.signalrNegotiateUrl}/collab?userId=${encodeURIComponent(userId || '')}`;

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

      // Step 2: Connect to SignalR collab hub
      this.signalrConnection = new signalR.HubConnectionBuilder()
        .withUrl(connectionInfo.url, {
          accessTokenFactory: () => connectionInfo.accessToken,
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.Information)
        .build();

      // Handle incoming collaboration events
      this.signalrConnection.on('collabUpdate', (event: CollabEvent) => {
        this.ngZone.run(() => {
          console.log('[Collab SignalR] Received event:', event.type, event);
          this._events$.next(event);
        });
      });

      // Handle reconnection
      this.signalrConnection.onreconnecting(() => {
        console.log('[Collab SignalR] Reconnecting...');
      });

      this.signalrConnection.onreconnected(() => {
        console.log('[Collab SignalR] Reconnected');
        this.reconnectAttempts = 0;
      });

      this.signalrConnection.onclose(() => {
        this.ngZone.run(() => {
          console.log('[Collab SignalR] Connection closed');
          this.scheduleReconnect();
        });
      });

      await this.signalrConnection.start();
      this.reconnectAttempts = 0;
      console.log('[Collab SignalR] Connected successfully');
    } catch (error) {
      console.error('[Collab SignalR] Connection failed:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from SignalR
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.signalrConnection) {
      this.signalrConnection.stop();
      this.signalrConnection = null;
    }

    this.reconnectAttempts = 0;
  }

  /**
   * Get observable for collaboration events for a specific note
   */
  eventsForNote(noteId: string): Observable<CollabEvent> {
    return this.events$.pipe(filter((event) => event.noteId === noteId));
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.error('[Collab SignalR] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[Collab SignalR] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }
}
