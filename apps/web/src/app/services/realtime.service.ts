import { Injectable, signal, inject, PLATFORM_ID, DestroyRef, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, Observable, filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RealtimeWSService } from './realtime-ws.service';
import type { ChatEvent, TypingEvent } from '@maple/shared';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * RealtimeService - Chat-specific wrapper around RealtimeWSService
 * Provides chat events and typing indicators via the unified WebSocket
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly realtimeWS = inject(RealtimeWSService);

  // State signals
  private readonly _subscribedTags = signal<string[]>([]);

  readonly subscribedTags = this._subscribedTags.asReadonly();

  // Computed status from RealtimeWSService (as a signal for reactivity)
  readonly status = computed<ConnectionStatus>(() =>
    this.realtimeWS.connected() ? 'connected' : 'disconnected',
  );

  // Event subjects
  private readonly _events$ = new Subject<ChatEvent>();
  private readonly _typing$ = new Subject<TypingEvent>();

  // Observable streams
  readonly events$ = this._events$.asObservable();
  readonly typing$ = this._typing$.asObservable();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.setupEventListeners();
    }
  }

  /**
   * Setup listeners for chat events from the unified WebSocket
   */
  private setupEventListeners(): void {
    // Listen for 'connected' event to get subscribed notebooks
    this.realtimeWS
      .on('connected')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        this._subscribedTags.set(event.subscribedNotebooks || []);
      });

    // Listen for chat events from RealtimeWSService
    this.realtimeWS.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      // Chat events come through the unified stream with type matching chat event patterns
      if ('action' in event) {
        const chatEvent = event as unknown as ChatEvent;

        // Handle typing events separately
        if (chatEvent.action === 'typing' && chatEvent.data) {
          this._typing$.next(chatEvent.data as TypingEvent);
          return;
        }

        this._events$.next(chatEvent);
      }
    });
  }

  /**
   * Connect to realtime server via WebSocket
   * Delegates to RealtimeWSService
   */
  connect(): void {
    // Connection is managed by RealtimeWSService
    // This is called for compatibility but actual connection happens via HomeComponent
  }

  /**
   * Disconnect from realtime server
   * Delegates to RealtimeWSService
   */
  disconnect(): void {
    // Disconnection is managed by RealtimeWSService
  }

  /**
   * Send typing indicator
   */
  sendTyping(tagId: string, isTyping: boolean = true): void {
    this.realtimeWS.sendTyping(tagId, isTyping);
  }

  /**
   * Subscribe to a notebook's chat
   */
  subscribe(tagId: string): void {
    if (!this._subscribedTags().includes(tagId)) {
      this.realtimeWS.subscribeNotebook(tagId);
    }
  }

  /**
   * Unsubscribe from a notebook's chat
   */
  unsubscribe(tagId: string): void {
    this.realtimeWS.unsubscribeNotebook(tagId);
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
}
