import { describe, it, expect, beforeEach, afterEach, vi, MockInstance } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { KanbanDocumentService, type KanbanYDoc } from '../kanban-document.service';
import { AuthService } from '../auth.service';
import { ConnectivityService } from '../connectivity.service';
import { OfflineQueueService } from '../offline-queue.service';
import { PageService } from '../page.service';
import { RealtimeWSService } from '../realtime-ws.service';
import { VisibilityService } from '../visibility.service';
import { Subject, of } from 'rxjs';
import * as Y from 'yjs';
import type { KanbanLane, KanbanCard } from '@maple/shared';
import { DEFAULT_LANE_IDS, DEFAULT_KANBAN_LANES } from '@maple/shared';

// Mock y-indexeddb
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: vi.fn().mockImplementation(() => ({
    whenSynced: Promise.resolve(),
    destroy: vi.fn(),
  })),
}));

describe('KanbanDocumentService', () => {
  let service: KanbanDocumentService;
  let httpMock: HttpTestingController;
  let mockAuthService: Partial<AuthService>;
  let mockConnectivity: Partial<ConnectivityService>;
  let mockOfflineQueue: Partial<OfflineQueueService>;
  let mockPageService: Partial<PageService>;
  let mockRealtimeWS: Partial<RealtimeWSService>;
  let mockVisibilityService: Partial<VisibilityService>;

  beforeEach(() => {
    mockAuthService = {
      user: vi.fn(() => ({
        _id: 'user-1',
        email: 'test@example.com',
        displayName: 'Test User',
      })),
      accessToken: vi.fn(() => 'test-token'),
      initReady$: of(undefined),
    };

    mockConnectivity = {
      canSync: vi.fn(() => false), // Disable network sync for tests
    };

    mockOfflineQueue = {
      enqueue: vi.fn(),
    };

    mockPageService = {
      createPage: vi.fn(() => of({ id: 'page-1' } as any)),
      updatePage: vi.fn(() => of({} as any)),
      addLocalPage: vi.fn(),
      persistToIndexedDB: vi.fn().mockResolvedValue(undefined),
    };

    mockRealtimeWS = {
      isConnected: vi.fn(() => false),
      connect: vi.fn(),
    };

    mockVisibilityService = {
      becameVisible$: new Subject<void>().asObservable(),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        KanbanDocumentService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConnectivityService, useValue: mockConnectivity },
        { provide: OfflineQueueService, useValue: mockOfflineQueue },
        { provide: PageService, useValue: mockPageService },
        { provide: RealtimeWSService, useValue: mockRealtimeWS },
        { provide: VisibilityService, useValue: mockVisibilityService },
      ],
    });

    service = TestBed.inject(KanbanDocumentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    service.closeAll();
  });

  describe('Y.Doc structure', () => {
    it('should create kanban Y.Doc with proper structure', async () => {
      const pageId = 'test-page-1';

      const doc = await service.openDocument(pageId);

      // Verify structure exists
      expect(doc.ydoc).toBeInstanceOf(Y.Doc);
      expect(doc.lanes).toBeDefined();
      expect(doc.cards).toBeDefined();
      expect(doc.archived).toBeDefined();
      expect(doc.settings).toBeDefined();

      service.closeDocument(pageId);
    });

    it('should initialize default lanes when document is empty', async () => {
      const pageId = 'test-page-2';

      await service.openDocument(pageId);
      const lanes = service.getLanes(pageId);

      expect(lanes).toHaveLength(3);
      expect(lanes[0].title).toBe('To Do');
      expect(lanes[1].title).toBe('In Progress');
      expect(lanes[2].title).toBe('Done');

      service.closeDocument(pageId);
    });
  });

  describe('Lane operations', () => {
    it('should get lanes from document', async () => {
      const pageId = 'test-page-3';

      await service.openDocument(pageId);
      const lanes = service.getLanes(pageId);

      expect(lanes).toHaveLength(3);
      expect(lanes[0].id).toBe(DEFAULT_LANE_IDS.TODO);
      expect(lanes[1].id).toBe(DEFAULT_LANE_IDS.IN_PROGRESS);
      expect(lanes[2].id).toBe(DEFAULT_LANE_IDS.DONE);

      service.closeDocument(pageId);
    });

    it('should add a new lane', async () => {
      const pageId = 'test-page-4';

      await service.openDocument(pageId);
      const initialCount = service.getLanes(pageId).length;

      service.addLane(pageId, 'New Lane');

      const lanes = service.getLanes(pageId);
      expect(lanes.length).toBe(initialCount + 1);
      expect(lanes[lanes.length - 1].title).toBe('New Lane');

      service.closeDocument(pageId);
    });

    it('should update lane title', async () => {
      const pageId = 'test-page-5';

      await service.openDocument(pageId);
      const lanes = service.getLanes(pageId);
      const firstLaneId = lanes[0].id;

      service.updateLane(pageId, firstLaneId, { title: 'Updated Title' });

      const updatedLanes = service.getLanes(pageId);
      expect(updatedLanes[0].title).toBe('Updated Title');

      service.closeDocument(pageId);
    });

    it('should not delete default lanes', async () => {
      const pageId = 'test-page-6';

      await service.openDocument(pageId);
      const initialCount = service.getLanes(pageId).length;

      // Try to delete default lane (should fail silently)
      service.deleteLane(pageId, DEFAULT_LANE_IDS.TODO);

      const lanes = service.getLanes(pageId);
      expect(lanes.length).toBe(initialCount);

      service.closeDocument(pageId);
    });

    it('should delete custom lanes', async () => {
      const pageId = 'test-page-7';

      await service.openDocument(pageId);
      const newLaneId = service.addLane(pageId, 'Custom Lane');
      const countWithNew = service.getLanes(pageId).length;

      service.deleteLane(pageId, newLaneId);

      const lanes = service.getLanes(pageId);
      expect(lanes.length).toBe(countWithNew - 1);

      service.closeDocument(pageId);
    });
  });

  describe('Card operations', () => {
    it('should create a card in a lane', async () => {
      const pageId = 'test-page-8';

      await service.openDocument(pageId);

      const cardId = service.createCard(pageId, DEFAULT_LANE_IDS.TODO, 'Test Card', 'memo-page-1');

      const cards = service.getCards(pageId);
      expect(cards.length).toBe(1);
      expect(cards[0].title).toBe('Test Card');
      expect(cards[0].memoPageId).toBe('memo-page-1');
      expect(cards[0].id).toBe(cardId);

      service.closeDocument(pageId);
    });

    it('should move card between lanes', async () => {
      const pageId = 'test-page-9';

      await service.openDocument(pageId);

      // Create a card
      const cardId = service.createCard(
        pageId,
        DEFAULT_LANE_IDS.TODO,
        'Card to Move',
        'memo-page-2',
      );

      // Move to In Progress
      service.moveCard(pageId, cardId, DEFAULT_LANE_IDS.TODO, DEFAULT_LANE_IDS.IN_PROGRESS, 0);

      // Verify card is in new lane
      const lanes = service.getLanes(pageId);
      const inProgressLane = lanes.find((l) => l.id === DEFAULT_LANE_IDS.IN_PROGRESS);
      expect(inProgressLane?.cardIds).toContain(cardId);

      const todoLane = lanes.find((l) => l.id === DEFAULT_LANE_IDS.TODO);
      expect(todoLane?.cardIds).not.toContain(cardId);

      service.closeDocument(pageId);
    });

    it('should set completedAt when moving to done lane', async () => {
      const pageId = 'test-page-10';

      await service.openDocument(pageId);

      const cardId = service.createCard(
        pageId,
        DEFAULT_LANE_IDS.TODO,
        'Card to Complete',
        'memo-page-3',
      );

      // Move to Done
      service.moveCard(pageId, cardId, DEFAULT_LANE_IDS.TODO, DEFAULT_LANE_IDS.DONE, 0);

      const card = service.getCard(pageId, cardId);
      expect(card?.completedAt).toBeDefined();

      service.closeDocument(pageId);
    });

    it('should archive a card', async () => {
      const pageId = 'test-page-11';

      await service.openDocument(pageId);

      // Create and archive a card
      const cardId = service.createCard(
        pageId,
        DEFAULT_LANE_IDS.TODO,
        'Card to Archive',
        'memo-page-4',
      );

      service.archiveCard(pageId, cardId, DEFAULT_LANE_IDS.TODO);

      // Verify card is archived
      const archived = service.getArchivedCards(pageId);
      expect(archived.length).toBe(1);
      expect(archived[0].id).toBe(cardId);

      // Verify card is removed from cards
      const remainingCards = service.getCards(pageId);
      expect(remainingCards.length).toBe(0);

      service.closeDocument(pageId);
    });

    it('should restore an archived card', async () => {
      const pageId = 'test-page-12';

      await service.openDocument(pageId);

      // Create, archive, then restore
      const cardId = service.createCard(
        pageId,
        DEFAULT_LANE_IDS.TODO,
        'Card to Restore',
        'memo-page-5',
      );

      service.archiveCard(pageId, cardId, DEFAULT_LANE_IDS.TODO);
      service.restoreCard(pageId, cardId, DEFAULT_LANE_IDS.TODO);

      // Verify card is restored
      const archived = service.getArchivedCards(pageId);
      expect(archived.length).toBe(0);

      const restoredCards = service.getCards(pageId);
      expect(restoredCards.length).toBe(1);

      service.closeDocument(pageId);
    });

    it('should update card properties', async () => {
      const pageId = 'test-page-13';

      await service.openDocument(pageId);

      const cardId = service.createCard(pageId, DEFAULT_LANE_IDS.TODO, 'Test Card', 'memo-page-6');

      service.updateCard(pageId, cardId, { priority: 'high', title: 'Updated Title' });

      const card = service.getCard(pageId, cardId);
      expect(card?.priority).toBe('high');
      expect(card?.title).toBe('Updated Title');

      service.closeDocument(pageId);
    });

    it('should reorder cards within a lane', async () => {
      const pageId = 'test-page-14';

      await service.openDocument(pageId);

      const cardId1 = service.createCard(pageId, DEFAULT_LANE_IDS.TODO, 'Card 1', 'memo-1');
      const cardId2 = service.createCard(pageId, DEFAULT_LANE_IDS.TODO, 'Card 2', 'memo-2');

      // Reorder card1 to position 1 (after card2)
      service.reorderCard(pageId, DEFAULT_LANE_IDS.TODO, cardId1, 1);

      const lanes = service.getLanes(pageId);
      const todoLane = lanes.find((l) => l.id === DEFAULT_LANE_IDS.TODO);
      expect(todoLane?.cardIds[0]).toBe(cardId2);
      expect(todoLane?.cardIds[1]).toBe(cardId1);

      service.closeDocument(pageId);
    });
  });

  describe('Settings', () => {
    it('should get default settings', async () => {
      const pageId = 'test-page-15';

      await service.openDocument(pageId);

      const settings = service.getSettings(pageId);
      expect(settings).toBeDefined();
      expect(settings?.defaultLaneId).toBe(DEFAULT_LANE_IDS.TODO);

      service.closeDocument(pageId);
    });

    it('should update settings', async () => {
      const pageId = 'test-page-16';

      await service.openDocument(pageId);

      service.updateSettings(pageId, { defaultLaneId: DEFAULT_LANE_IDS.IN_PROGRESS });

      const settings = service.getSettings(pageId);
      expect(settings?.defaultLaneId).toBe(DEFAULT_LANE_IDS.IN_PROGRESS);

      service.closeDocument(pageId);
    });
  });

  describe('Document lifecycle', () => {
    it('should reuse already open document', async () => {
      const pageId = 'test-page-17';

      const doc1 = await service.openDocument(pageId);
      const doc2 = await service.openDocument(pageId);

      expect(doc1.ydoc).toBe(doc2.ydoc);

      service.closeDocument(pageId);
    });

    it('should close document and cleanup', async () => {
      const pageId = 'test-page-18';

      await service.openDocument(pageId);
      expect(service.isDocumentOpen(pageId)).toBe(true);

      service.closeDocument(pageId);
      expect(service.isDocumentOpen(pageId)).toBe(false);
    });

    it('should close all documents', async () => {
      await service.openDocument('page-1');
      await service.openDocument('page-2');

      expect(service.isDocumentOpen('page-1')).toBe(true);
      expect(service.isDocumentOpen('page-2')).toBe(true);

      service.closeAll();

      expect(service.isDocumentOpen('page-1')).toBe(false);
      expect(service.isDocumentOpen('page-2')).toBe(false);
    });
  });
});
