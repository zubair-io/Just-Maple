import { Injectable, inject, signal, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, forkJoin, of } from 'rxjs';
import { switchMap, catchError, tap, map } from 'rxjs/operators';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { AuthService } from './auth.service';
import { ConnectivityService } from './connectivity.service';
import { OfflineQueueService } from './offline-queue.service';
import { PageService } from './page.service';
import { RealtimeWSService } from './realtime-ws.service';
import { VisibilityService } from './visibility.service';
import { YJSWSProvider } from './yjs-ws-provider';
import { getUserColor } from '../utils/user-colors';
import type {
  Page,
  SyncStatus,
  KanbanLane,
  KanbanCard,
  KanbanSettings,
  KanbanPriority,
} from '@maple/shared';
import { DEFAULT_KANBAN_LANES, DEFAULT_KANBAN_SETTINGS, DEFAULT_LANE_IDS } from '@maple/shared';

// Generate UUID v4 for IDs
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Open kanban board document state
 */
interface OpenKanban {
  ydoc: Y.Doc;
  awareness: Awareness;
  persistence: IndexeddbPersistence;
  wsProvider: YJSWSProvider | null;
}

/**
 * Kanban Y.Doc structure helpers
 */
export interface KanbanYDoc {
  ydoc: Y.Doc;
  awareness: Awareness;
  lanes: Y.Array<Y.Map<unknown>>;
  cards: Y.Map<Y.Map<unknown>>;
  archived: Y.Array<Y.Map<unknown>>;
  settings: Y.Map<unknown>;
}

/**
 * Kanban Document Service
 * Manages Y.Doc lifecycle for kanban-type pages
 */
@Injectable({ providedIn: 'root' })
export class KanbanDocumentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly pageService = inject(PageService);
  private readonly realtimeWS = inject(RealtimeWSService);
  private readonly visibilityService = inject(VisibilityService);

  private openDocs = new Map<string, OpenKanban>();

  // Document sync status
  private readonly _syncStatuses = signal<Map<string, SyncStatus>>(new Map());

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.setupConnectivityListener();
      this.setupVisibilityListener();
    }
  }

  /**
   * Setup visibility listener to sync documents when tab becomes visible
   */
  private setupVisibilityListener(): void {
    this.visibilityService.becameVisible$
      .pipe(switchMap(() => this.syncOpenDocuments$()))
      .subscribe();
  }

  /**
   * Sync all open documents with server
   */
  private syncOpenDocuments$(): Observable<void> {
    if (!this.connectivity.canSync() || this.openDocs.size === 0) {
      return of(undefined);
    }

    const syncs = Array.from(this.openDocs.entries()).map(([pageId, doc]) =>
      this.fetchInitialState$(pageId, doc.ydoc).pipe(catchError(() => of(undefined))),
    );

    return forkJoin(syncs).pipe(map(() => undefined));
  }

  private setupConnectivityListener(): void {
    effect(() => {
      const canSync = this.connectivity.canSync();

      for (const [pageId, doc] of this.openDocs) {
        if (canSync) {
          if (!doc.wsProvider || !doc.wsProvider.connected()) {
            this.connectProviders(pageId, doc);
          }
        } else {
          doc.wsProvider?.disconnect();
          doc.wsProvider = null;
        }
      }
    });
  }

  /**
   * Open a kanban board document
   * Returns typed helpers for kanban-specific Y.Doc structures
   */
  async openDocument(pageId: string): Promise<KanbanYDoc> {
    // Check if already open
    if (this.openDocs.has(pageId)) {
      const doc = this.openDocs.get(pageId)!;
      return this.getKanbanHelpers(doc);
    }

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Create awareness for cursor/drag sync
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence FIRST (offline-first)
    const persistence = new IndexeddbPersistence(`ydoc-kanban-${pageId}`, ydoc);
    await persistence.whenSynced;

    // Store reference
    const doc: OpenKanban = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(pageId, doc);

    // Check if document is empty (no lanes from IndexedDB)
    const lanes = ydoc.getArray<Y.Map<unknown>>('lanes');
    const isDocEmpty = lanes.length === 0;

    // Initialize default structure if empty
    if (isDocEmpty) {
      this.initializeEmptyKanban(ydoc);
    }

    // Connect to server if online
    if (this.connectivity.canSync()) {
      this.syncDocument(pageId, doc, ydoc, isDocEmpty);
    }

    return this.getKanbanHelpers(doc);
  }

  /**
   * Initialize empty kanban board with default structure
   * Creates default lanes (To Do, In Progress, Done)
   */
  private initializeEmptyKanban(ydoc: Y.Doc): void {
    const lanes = ydoc.getArray<Y.Map<unknown>>('lanes');
    const cards = ydoc.getMap<Y.Map<unknown>>('cards');
    const archived = ydoc.getArray<Y.Map<unknown>>('archived');
    const settings = ydoc.getMap<unknown>('settings');

    // Create default lanes if empty
    if (lanes.length === 0) {
      for (const lane of DEFAULT_KANBAN_LANES) {
        const yLane = new Y.Map<unknown>();
        yLane.set('id', lane.id);
        yLane.set('title', lane.title);
        yLane.set('position', lane.position);
        yLane.set('isDefault', lane.isDefault ?? false);
        yLane.set('isDoneLane', lane.isDoneLane ?? false);
        const cardIds = new Y.Array<string>();
        yLane.set('cardIds', cardIds);
        lanes.push([yLane]);
      }
    }

    // Set default settings if not set
    if (!settings.has('defaultLaneId')) {
      settings.set('defaultLaneId', DEFAULT_LANE_IDS.TODO);
    }
    if (!settings.has('cardDisplay')) {
      settings.set('cardDisplay', DEFAULT_KANBAN_SETTINGS.cardDisplay);
    }
    if (!settings.has('doneReset')) {
      settings.set('doneReset', DEFAULT_KANBAN_SETTINGS.doneReset);
    }
  }

  /**
   * Get typed kanban helpers
   */
  private getKanbanHelpers(doc: OpenKanban): KanbanYDoc {
    return {
      ydoc: doc.ydoc,
      awareness: doc.awareness,
      lanes: doc.ydoc.getArray<Y.Map<unknown>>('lanes'),
      cards: doc.ydoc.getMap<Y.Map<unknown>>('cards'),
      archived: doc.ydoc.getArray<Y.Map<unknown>>('archived'),
      settings: doc.ydoc.getMap<unknown>('settings'),
    };
  }

  /**
   * Create a new card in a lane
   */
  createCard(
    pageId: string,
    laneId: string,
    title: string,
    memoPageId: string,
    memoId?: string,
  ): string {
    const doc = this.openDocs.get(pageId);
    if (!doc) throw new Error('Document not open');

    const cardId = generateId();
    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');

    // Create card
    const card = new Y.Map<unknown>();
    card.set('id', cardId);
    card.set('memoPageId', memoPageId);
    if (memoId) {
      card.set('memoId', memoId);
    }
    card.set('title', title);
    cards.set(cardId, card);

    // Add card to lane
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes.get(i);
      if (lane.get('id') === laneId) {
        const cardIds = lane.get('cardIds') as Y.Array<string>;
        cardIds.push([cardId]);
        break;
      }
    }

    return cardId;
  }

  /**
   * Update a card's properties
   */
  updateCard(
    pageId: string,
    cardId: string,
    updates: Partial<{
      title: string;
      priority: KanbanPriority | null;
      dueDate: string | null;
      coverColor: string | null;
      completedAt: string | null;
    }>,
  ): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const card = cards.get(cardId);
    if (!card) return;

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        card.delete(key);
      } else {
        card.set(key, value);
      }
    }
  }

  /**
   * Move a card to a different lane
   */
  moveCard(
    pageId: string,
    cardId: string,
    fromLaneId: string,
    toLaneId: string,
    toIndex: number,
  ): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');
    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const card = cards.get(cardId);
    if (!card) return;

    doc.ydoc.transact(() => {
      // Remove from source lane
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes.get(i);
        if (lane.get('id') === fromLaneId) {
          const cardIds = lane.get('cardIds') as Y.Array<string>;
          const idx = cardIds.toArray().indexOf(cardId);
          if (idx !== -1) {
            cardIds.delete(idx, 1);
          }
          break;
        }
      }

      // Add to destination lane
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes.get(i);
        if (lane.get('id') === toLaneId) {
          const cardIds = lane.get('cardIds') as Y.Array<string>;
          cardIds.insert(toIndex, [cardId]);

          // If moving to done lane, set completedAt
          if (lane.get('isDoneLane')) {
            card.set('completedAt', new Date().toISOString());
          } else if (card.get('completedAt')) {
            // Remove completedAt if moving out of done lane
            card.delete('completedAt');
          }
          break;
        }
      }
    });
  }

  /**
   * Reorder a card within the same lane
   */
  reorderCard(pageId: string, laneId: string, cardId: string, newIndex: number): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');

    doc.ydoc.transact(() => {
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes.get(i);
        if (lane.get('id') === laneId) {
          const cardIds = lane.get('cardIds') as Y.Array<string>;
          const currentIdx = cardIds.toArray().indexOf(cardId);
          if (currentIdx !== -1) {
            cardIds.delete(currentIdx, 1);
            cardIds.insert(newIndex, [cardId]);
          }
          break;
        }
      }
    });
  }

  /**
   * Archive a card
   */
  archiveCard(pageId: string, cardId: string, fromLaneId: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');
    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const archived = doc.ydoc.getArray<Y.Map<unknown>>('archived');

    const card = cards.get(cardId);
    if (!card) return;

    doc.ydoc.transact(() => {
      // Set archive metadata
      card.set('archivedAt', new Date().toISOString());
      card.set('archivedFrom', fromLaneId);

      // Remove from lane
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes.get(i);
        if (lane.get('id') === fromLaneId) {
          const cardIds = lane.get('cardIds') as Y.Array<string>;
          const idx = cardIds.toArray().indexOf(cardId);
          if (idx !== -1) {
            cardIds.delete(idx, 1);
          }
          break;
        }
      }

      // Move to archived array
      archived.push([card]);

      // Remove from cards map
      cards.delete(cardId);
    });
  }

  /**
   * Restore a card from archive
   */
  restoreCard(pageId: string, cardId: string, toLaneId?: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');
    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const archived = doc.ydoc.getArray<Y.Map<unknown>>('archived');

    // Find card in archived
    let cardIndex = -1;
    let archivedCard: Y.Map<unknown> | null = null;
    for (let i = 0; i < archived.length; i++) {
      const c = archived.get(i);
      if (c.get('id') === cardId) {
        cardIndex = i;
        archivedCard = c;
        break;
      }
    }

    if (!archivedCard || cardIndex === -1) return;

    const restoreLaneId =
      toLaneId || (archivedCard.get('archivedFrom') as string) || DEFAULT_LANE_IDS.TODO;

    doc.ydoc.transact(() => {
      // Clear archive metadata
      archivedCard!.delete('archivedAt');
      archivedCard!.delete('archivedFrom');

      // Add back to cards map
      cards.set(cardId, archivedCard!);

      // Add to lane
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes.get(i);
        if (lane.get('id') === restoreLaneId) {
          const cardIds = lane.get('cardIds') as Y.Array<string>;
          cardIds.push([cardId]);
          break;
        }
      }

      // Remove from archived
      archived.delete(cardIndex, 1);
    });
  }

  /**
   * Delete a card permanently
   */
  deleteCard(pageId: string, cardId: string, fromLaneId?: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');
    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const archived = doc.ydoc.getArray<Y.Map<unknown>>('archived');

    doc.ydoc.transact(() => {
      // Remove from cards map
      cards.delete(cardId);

      // Remove from lane if specified
      if (fromLaneId) {
        for (let i = 0; i < lanes.length; i++) {
          const lane = lanes.get(i);
          if (lane.get('id') === fromLaneId) {
            const cardIds = lane.get('cardIds') as Y.Array<string>;
            const idx = cardIds.toArray().indexOf(cardId);
            if (idx !== -1) {
              cardIds.delete(idx, 1);
            }
            break;
          }
        }
      }

      // Also check archived
      for (let i = 0; i < archived.length; i++) {
        const c = archived.get(i);
        if (c.get('id') === cardId) {
          archived.delete(i, 1);
          break;
        }
      }
    });
  }

  /**
   * Add a new lane
   */
  addLane(pageId: string, title: string, position?: number): string {
    const doc = this.openDocs.get(pageId);
    if (!doc) throw new Error('Document not open');

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');
    const laneId = generateId();
    const actualPosition = position ?? lanes.length;

    const yLane = new Y.Map<unknown>();
    yLane.set('id', laneId);
    yLane.set('title', title);
    yLane.set('position', actualPosition);
    yLane.set('cardIds', new Y.Array<string>());

    lanes.insert(actualPosition, [yLane]);

    // Update positions of subsequent lanes
    for (let i = actualPosition + 1; i < lanes.length; i++) {
      const lane = lanes.get(i);
      lane.set('position', i);
    }

    return laneId;
  }

  /**
   * Update lane properties
   */
  updateLane(
    pageId: string,
    laneId: string,
    updates: Partial<{
      title: string;
      color: string | null;
      wipLimit: number | null;
    }>,
  ): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');

    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes.get(i);
      if (lane.get('id') === laneId) {
        for (const [key, value] of Object.entries(updates)) {
          if (value === null) {
            lane.delete(key);
          } else {
            lane.set(key, value);
          }
        }
        break;
      }
    }
  }

  /**
   * Delete a lane (moves cards to archive)
   */
  deleteLane(pageId: string, laneId: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');
    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const archived = doc.ydoc.getArray<Y.Map<unknown>>('archived');

    doc.ydoc.transact(() => {
      // Find the lane
      let laneIndex = -1;
      let lane: Y.Map<unknown> | null = null;
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes.get(i);
        if (l.get('id') === laneId) {
          laneIndex = i;
          lane = l;
          break;
        }
      }

      if (!lane || laneIndex === -1) return;

      // Check if it's a default lane (cannot delete)
      if (lane.get('isDefault') || lane.get('isDoneLane')) {
        return; // Cannot delete default lanes
      }

      // Move all cards to archive
      const cardIds = lane.get('cardIds') as Y.Array<string>;
      const cardIdsArray = cardIds.toArray();
      for (const cardId of cardIdsArray) {
        const card = cards.get(cardId);
        if (card) {
          card.set('archivedAt', new Date().toISOString());
          card.set('archivedFrom', laneId);
          archived.push([card]);
          cards.delete(cardId);
        }
      }

      // Delete lane
      lanes.delete(laneIndex, 1);

      // Update positions
      for (let i = laneIndex; i < lanes.length; i++) {
        const l = lanes.get(i);
        l.set('position', i);
      }
    });
  }

  /**
   * Reorder lanes
   */
  reorderLane(pageId: string, laneId: string, newIndex: number): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');

    doc.ydoc.transact(() => {
      // Find current index
      let currentIndex = -1;
      let lane: Y.Map<unknown> | null = null;
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes.get(i);
        if (l.get('id') === laneId) {
          currentIndex = i;
          lane = l;
          break;
        }
      }

      if (currentIndex === -1 || !lane) return;

      // Remove and reinsert
      lanes.delete(currentIndex, 1);
      lanes.insert(newIndex, [lane]);

      // Update all positions
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes.get(i);
        l.set('position', i);
      }
    });
  }

  /**
   * Get all lanes as plain objects
   */
  getLanes(pageId: string): KanbanLane[] {
    const doc = this.openDocs.get(pageId);
    if (!doc) return [];

    const lanes = doc.ydoc.getArray<Y.Map<unknown>>('lanes');
    return lanes.toArray().map((lane) => this.yMapToLane(lane));
  }

  /**
   * Get all cards as plain objects
   */
  getCards(pageId: string): KanbanCard[] {
    const doc = this.openDocs.get(pageId);
    if (!doc) return [];

    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const result: KanbanCard[] = [];
    cards.forEach((card) => {
      result.push(this.yMapToCard(card));
    });
    return result;
  }

  /**
   * Get a specific card
   */
  getCard(pageId: string, cardId: string): KanbanCard | null {
    const doc = this.openDocs.get(pageId);
    if (!doc) return null;

    const cards = doc.ydoc.getMap<Y.Map<unknown>>('cards');
    const card = cards.get(cardId);
    return card ? this.yMapToCard(card) : null;
  }

  /**
   * Get archived cards
   */
  getArchivedCards(pageId: string): KanbanCard[] {
    const doc = this.openDocs.get(pageId);
    if (!doc) return [];

    const archived = doc.ydoc.getArray<Y.Map<unknown>>('archived');
    return archived.toArray().map((card) => this.yMapToCard(card));
  }

  /**
   * Get settings
   */
  getSettings(pageId: string): KanbanSettings | null {
    const doc = this.openDocs.get(pageId);
    if (!doc) return null;

    const settings = doc.ydoc.getMap<unknown>('settings');
    return {
      defaultLaneId: settings.get('defaultLaneId') as string | undefined,
      cardDisplay:
        (settings.get('cardDisplay') as KanbanSettings['cardDisplay']) ||
        DEFAULT_KANBAN_SETTINGS.cardDisplay,
      doneReset:
        (settings.get('doneReset') as KanbanSettings['doneReset']) ||
        DEFAULT_KANBAN_SETTINGS.doneReset,
    };
  }

  /**
   * Update settings
   */
  updateSettings(pageId: string, updates: Partial<KanbanSettings>): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    const settings = doc.ydoc.getMap<unknown>('settings');

    for (const [key, value] of Object.entries(updates)) {
      settings.set(key, value);
    }
  }

  /**
   * Convert Y.Map to KanbanLane
   */
  private yMapToLane(yMap: Y.Map<unknown>): KanbanLane {
    const cardIds = yMap.get('cardIds') as Y.Array<string> | undefined;
    return {
      id: yMap.get('id') as string,
      title: yMap.get('title') as string,
      position: yMap.get('position') as number,
      color: yMap.get('color') as string | undefined,
      wipLimit: yMap.get('wipLimit') as number | undefined,
      isDefault: yMap.get('isDefault') as boolean | undefined,
      isDoneLane: yMap.get('isDoneLane') as boolean | undefined,
      cardIds: cardIds?.toArray() || [],
    };
  }

  /**
   * Convert Y.Map to KanbanCard
   */
  private yMapToCard(yMap: Y.Map<unknown>): KanbanCard {
    return {
      id: yMap.get('id') as string,
      memoPageId: yMap.get('memoPageId') as string,
      memoId: yMap.get('memoId') as string | undefined,
      title: yMap.get('title') as string,
      priority: yMap.get('priority') as KanbanPriority | undefined,
      dueDate: yMap.get('dueDate') as string | undefined,
      coverColor: yMap.get('coverColor') as string | undefined,
      completedAt: yMap.get('completedAt') as string | undefined,
      archivedAt: yMap.get('archivedAt') as string | undefined,
      archivedFrom: yMap.get('archivedFrom') as string | undefined,
    };
  }

  /**
   * Sync document with server
   */
  private async syncDocument(
    pageId: string,
    doc: OpenKanban,
    ydoc: Y.Doc,
    isDocEmpty: boolean,
  ): Promise<void> {
    await this.waitForAuth();

    let hasSynced = false;

    // Try REST API for empty docs
    if (isDocEmpty) {
      this.fetchInitialState(pageId, ydoc)
        .then(() => {
          if (!hasSynced) {
            hasSynced = true;
          }
        })
        .catch(() => {
          // REST sync failed, will rely on WebSocket
        });
    }

    // Connect WebSocket provider
    try {
      await this.connectProviders(pageId, doc);

      if (doc.wsProvider?.synced()) {
        if (!hasSynced) {
          hasSynced = true;
        }
      }
    } catch {
      if (isDocEmpty && !hasSynced) {
        try {
          await this.fetchInitialState(pageId, ydoc);
          hasSynced = true;
        } catch {
          // All sync methods failed
        }
      }
    }
  }

  /**
   * Fetch document state from REST API (Observable)
   */
  private fetchInitialState$(pageId: string, ydoc: Y.Doc): Observable<void> {
    return this.http.get<{ state: string }>(`/api/kanban-boards/${pageId}/state`).pipe(
      tap((data) => {
        if (data.state) {
          const state = this.base64ToUint8Array(data.state);
          Y.applyUpdate(ydoc, state, 'remote');
        }
      }),
      map(() => undefined),
    );
  }

  /**
   * Fetch document state from REST API (Promise)
   */
  private fetchInitialState(pageId: string, ydoc: Y.Doc): Promise<void> {
    return firstValueFrom(this.fetchInitialState$(pageId, ydoc));
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
   * Setup awareness with user info
   */
  private setupAwareness(awareness: Awareness): void {
    const user = this.authService.user();
    if (user) {
      awareness.setLocalStateField('user', {
        id: user._id,
        name: user.displayName?.split(' ')[0] || user.email || 'Anonymous',
        color: getUserColor(user._id),
      });
    }
  }

  /**
   * Update awareness dragging state
   */
  updateDraggingCard(
    pageId: string,
    cardId: string | null,
    fromLaneId?: string,
    position?: { x: number; y: number },
  ): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    if (cardId && fromLaneId && position) {
      doc.awareness.setLocalStateField('draggingCard', {
        cardId,
        fromLaneId,
        position,
      });
    } else {
      doc.awareness.setLocalStateField('draggingCard', null);
    }
  }

  /**
   * Connect WebSocket provider
   */
  private async connectProviders(pageId: string, doc: OpenKanban): Promise<void> {
    if (!this.realtimeWS.isConnected()) {
      this.realtimeWS.connect();

      const connected = await this.waitForConnection(10000);
      if (!connected) {
        return;
      }
    }

    doc.wsProvider = new YJSWSProvider(pageId, doc.ydoc, this.realtimeWS, doc.awareness, 'kanban');

    doc.wsProvider.onSynced = (synced: boolean) => {
      this.updateSyncStatus(pageId, synced ? 'synced' : 'syncing');
    };

    doc.wsProvider.connect();
  }

  /**
   * Wait for WebSocket connection with timeout
   */
  private waitForConnection(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.realtimeWS.isConnected()) {
        resolve(true);
        return;
      }

      this.realtimeWS.connect();
      this.pollForConnection(timeoutMs, resolve);
    });
  }

  /**
   * Poll for WebSocket connection
   */
  private pollForConnection(timeoutMs: number, resolve: (connected: boolean) => void): void {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (this.realtimeWS.isConnected()) {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  }

  /**
   * Wait for auth to be ready
   */
  private waitForAuth(): Promise<void> {
    return new Promise((resolve) => {
      if (this.authService.accessToken()) {
        resolve();
        return;
      }

      firstValueFrom(this.authService.initReady$).then(() => {
        resolve();
      });
    });
  }

  /**
   * Close a kanban document
   */
  closeDocument(pageId: string): void {
    const doc = this.openDocs.get(pageId);
    if (!doc) return;

    doc.wsProvider?.destroy();
    doc.persistence.destroy();
    doc.ydoc.destroy();

    this.openDocs.delete(pageId);
  }

  /**
   * Create a new kanban board (offline-capable)
   */
  async createKanban(notebookId?: string): Promise<{
    page: Page;
    kanban: KanbanYDoc;
  }> {
    const pageId = generateId();
    const now = new Date().toISOString();

    // Create Y.Doc
    const ydoc = new Y.Doc();

    // Initialize kanban structure
    this.initializeEmptyKanban(ydoc);

    // Create awareness
    const awareness = new Awareness(ydoc);
    this.setupAwareness(awareness);

    // Setup local persistence
    const persistence = new IndexeddbPersistence(`ydoc-kanban-${pageId}`, ydoc);
    await persistence.whenSynced;

    // Create page metadata
    const page: Page = {
      _id: pageId,
      id: pageId,
      userId: this.authService.user()?._id || '',
      type: 'kanban',
      title: 'Untitled Board',
      content: { type: 'doc', content: [] },
      notebookId: notebookId,
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      createdAt: now,
      updatedAt: now,
    };

    // Save page metadata locally
    this.pageService.addLocalPage(page);
    await this.pageService.persistToIndexedDB([page]);

    // Queue for server sync
    await this.offlineQueue.enqueue('create-note', pageId, pageId, {
      type: 'kanban',
      title: page.title,
      notebookId: notebookId,
      id: pageId,
    });

    // Queue Y.Doc sync
    const state = Y.encodeStateAsUpdate(ydoc);
    await this.offlineQueue.enqueue('sync-notebook', pageId, pageId, {
      state: Array.from(state),
      pageType: 'kanban',
    });

    // Store open document
    const doc: OpenKanban = {
      ydoc,
      awareness,
      persistence,
      wsProvider: null,
    };
    this.openDocs.set(pageId, doc);

    // Update sync status
    this.updateSyncStatus(pageId, 'pending');

    // Connect if online
    if (this.connectivity.canSync()) {
      const created = await this.offlineQueue.waitForAction(pageId, 'create-note', 10000);
      if (created) {
        await this.connectProviders(pageId, doc);
      }
    }

    return { page, kanban: this.getKanbanHelpers(doc) };
  }

  /**
   * Get sync status for a document
   */
  getSyncStatus(pageId: string): SyncStatus {
    return this._syncStatuses().get(pageId) || 'synced';
  }

  /**
   * Update sync status
   */
  private updateSyncStatus(pageId: string, status: SyncStatus): void {
    this._syncStatuses.update((map) => {
      const newMap = new Map(map);
      newMap.set(pageId, status);
      return newMap;
    });
  }

  /**
   * Check if document is open
   */
  isDocumentOpen(pageId: string): boolean {
    return this.openDocs.has(pageId);
  }

  /**
   * Close all open documents
   */
  closeAll(): void {
    for (const pageId of this.openDocs.keys()) {
      this.closeDocument(pageId);
    }
  }
}
