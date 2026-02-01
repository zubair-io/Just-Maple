import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { KanbanBoardComponent } from '../kanban-board.component';
import {
  KanbanDocumentService,
  type KanbanYDoc,
} from '../../../../services/kanban-document.service';
import { MemoDocumentService } from '../../../../services/memo-document.service';
import { PageService } from '../../../../services/page.service';
import { of } from 'rxjs';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { KanbanLane, KanbanCard, KanbanSettings } from '@maple/shared';
import { DEFAULT_LANE_IDS, DEFAULT_KANBAN_SETTINGS } from '@maple/shared';

describe('KanbanBoardComponent', () => {
  let component: KanbanBoardComponent;
  let fixture: ComponentFixture<KanbanBoardComponent>;
  let mockKanbanDocService: Partial<KanbanDocumentService>;
  let mockMemoDocService: Partial<MemoDocumentService>;
  let mockPageService: Partial<PageService>;
  let mockRouter: Partial<Router>;

  // Mock Y.Doc for the openDocument response
  let mockYDoc: Y.Doc;
  let mockAwareness: Awareness;
  let mockKanbanYDoc: KanbanYDoc;

  const mockLanes: KanbanLane[] = [
    {
      id: DEFAULT_LANE_IDS.TODO,
      title: 'To Do',
      position: 0,
      isDefault: true,
      cardIds: ['card-1'],
    },
    { id: DEFAULT_LANE_IDS.IN_PROGRESS, title: 'In Progress', position: 1, cardIds: [] },
    { id: DEFAULT_LANE_IDS.DONE, title: 'Done', position: 2, isDoneLane: true, cardIds: [] },
  ];

  const mockCard: KanbanCard = {
    id: 'card-1',
    title: 'Test Card',
    memoPageId: 'memo-1',
  };

  const mockSettings: KanbanSettings = DEFAULT_KANBAN_SETTINGS;

  beforeEach(async () => {
    // Create mock Y.Doc
    mockYDoc = new Y.Doc();
    mockAwareness = new Awareness(mockYDoc);

    mockKanbanYDoc = {
      ydoc: mockYDoc,
      awareness: mockAwareness,
      lanes: mockYDoc.getArray('lanes'),
      cards: mockYDoc.getMap('cards'),
      archived: mockYDoc.getArray('archived'),
      settings: mockYDoc.getMap('settings'),
    };

    mockKanbanDocService = {
      openDocument: vi.fn().mockResolvedValue(mockKanbanYDoc),
      closeDocument: vi.fn(),
      getLanes: vi.fn().mockReturnValue(mockLanes),
      getCards: vi.fn().mockReturnValue([mockCard]),
      getSettings: vi.fn().mockReturnValue(mockSettings),
      getArchivedCards: vi.fn().mockReturnValue([]),
      createCard: vi.fn().mockReturnValue('new-card-id'),
      moveCard: vi.fn(),
      reorderCard: vi.fn(),
      archiveCard: vi.fn(),
      addLane: vi.fn().mockReturnValue('new-lane-id'),
      updateLane: vi.fn(),
      deleteLane: vi.fn(),
      reorderLane: vi.fn(),
    };

    mockMemoDocService = {
      createMemo: vi.fn().mockResolvedValue({
        page: { id: 'new-memo-1', title: 'Untitled' },
      }),
    };

    mockPageService = {
      updatePage: vi.fn().mockReturnValue(of({})),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [KanbanBoardComponent],
      providers: [
        { provide: KanbanDocumentService, useValue: mockKanbanDocService },
        { provide: MemoDocumentService, useValue: mockMemoDocService },
        { provide: PageService, useValue: mockPageService },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KanbanBoardComponent);
    component = fixture.componentInstance;

    // Set required input
    fixture.componentRef.setInput('pageId', 'test-page-1');
  });

  describe('Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should show loading state initially', () => {
      expect(component.isLoading()).toBe(true);
    });

    it('should load document on init', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(mockKanbanDocService.openDocument).toHaveBeenCalledWith('test-page-1');
    });

    it('should set loading to false after document loads', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.isLoading()).toBe(false);
    });
  });

  describe('Lane display', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      // Manually trigger refresh since we're mocking
      (component as any).refreshState();
    });

    it('should compute lanes from service', () => {
      expect(component.lanes()).toEqual(mockLanes);
    });

    it('should get card count for lane', () => {
      const count = component.getCardCount(DEFAULT_LANE_IDS.TODO);
      expect(count).toBe(1);
    });

    it('should identify default lanes', () => {
      const todoLane = mockLanes[0];
      const doneLane = mockLanes[2];
      const customLane = { ...mockLanes[1], isDefault: undefined, isDoneLane: undefined };

      expect(component.isDefaultLane(todoLane)).toBe(true);
      expect(component.isDefaultLane(doneLane)).toBe(true);
      expect(component.isDefaultLane(customLane as any)).toBe(false);
    });
  });

  describe('Lane editing', () => {
    it('should start editing lane', () => {
      component.startEditingLane('lane-1');
      expect(component.editingLaneId()).toBe('lane-1');
    });

    it('should cancel editing lane', () => {
      component.startEditingLane('lane-1');
      component.cancelEditingLane();
      expect(component.editingLaneId()).toBeNull();
    });

    it('should save lane title', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      component.saveLaneTitle('lane-1', 'New Title');

      expect(mockKanbanDocService.updateLane).toHaveBeenCalledWith('test-page-1', 'lane-1', {
        title: 'New Title',
      });
      expect(component.editingLaneId()).toBeNull();
    });

    it('should not save empty lane title', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      component.saveLaneTitle('lane-1', '   ');

      expect(mockKanbanDocService.updateLane).not.toHaveBeenCalled();
    });
  });

  describe('Lane management', () => {
    it('should start adding lane', () => {
      component.startAddingLane();
      expect(component.isAddingLane()).toBe(true);
      expect(component.newLaneTitle()).toBe('');
    });

    it('should cancel adding lane', () => {
      component.startAddingLane();
      component.newLaneTitle.set('Test');
      component.cancelAddLane();

      expect(component.isAddingLane()).toBe(false);
      expect(component.newLaneTitle()).toBe('');
    });

    it('should save new lane', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      component.startAddingLane();
      component.newLaneTitle.set('New Lane');
      component.saveLane();

      expect(mockKanbanDocService.addLane).toHaveBeenCalledWith('test-page-1', 'New Lane');
      expect(component.isAddingLane()).toBe(false);
    });

    it('should delete lane', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      (component as any).refreshState();

      // Can only delete non-default lanes
      const customLane = {
        id: 'custom-lane',
        title: 'Custom',
        position: 3,
        cardIds: [],
      };
      (mockKanbanDocService.getLanes as any).mockReturnValue([...mockLanes, customLane]);
      (component as any).refreshState();

      component.deleteLane('custom-lane');

      expect(mockKanbanDocService.deleteLane).toHaveBeenCalledWith('test-page-1', 'custom-lane');
    });
  });

  describe('Card operations', () => {
    it('should start adding card to lane', () => {
      component.startAddingCard('lane-1');
      expect(component.newCardLaneId()).toBe('lane-1');
      expect(component.newCardTitle()).toBe('');
    });

    it('should cancel adding card', () => {
      component.startAddingCard('lane-1');
      component.newCardTitle.set('Test');
      component.cancelAddCard();

      expect(component.newCardLaneId()).toBeNull();
      expect(component.newCardTitle()).toBe('');
    });

    it('should save new card', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.componentRef.setInput('notebookId', 'notebook-1');

      component.startAddingCard(DEFAULT_LANE_IDS.TODO);
      component.newCardTitle.set('New Card');
      await component.saveCard();

      expect(mockMemoDocService.createMemo).toHaveBeenCalledWith('notebook-1');
      expect(mockPageService.updatePage).toHaveBeenCalled();
      expect(mockKanbanDocService.createCard).toHaveBeenCalledWith(
        'test-page-1',
        DEFAULT_LANE_IDS.TODO,
        'New Card',
        'new-memo-1',
      );
    });

    it('should archive card', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      component.archiveCard(mockCard, DEFAULT_LANE_IDS.TODO);

      expect(mockKanbanDocService.archiveCard).toHaveBeenCalledWith(
        'test-page-1',
        'card-1',
        DEFAULT_LANE_IDS.TODO,
      );
    });

    it('should open card and navigate to memo', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.componentRef.setInput('notebookId', 'notebook-1');

      component.openCard(mockCard);

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/n', 'notebook-1', 'memo-1']);
    });

    it('should navigate to page directly when no notebook', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.componentRef.setInput('notebookId', null);

      component.openCard(mockCard);

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/page', 'memo-1']);
    });
  });

  describe('Due date formatting', () => {
    it('should format overdue date', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(component.formatDueDate(yesterday.toISOString())).toBe('Overdue');
    });

    it('should format today', () => {
      const today = new Date();
      today.setHours(23, 59, 59);
      expect(component.formatDueDate(today.toISOString())).toBe('Today');
    });

    it('should format tomorrow', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59);
      expect(component.formatDueDate(tomorrow.toISOString())).toBe('Tomorrow');
    });

    it('should format days within a week', () => {
      const inFiveDays = new Date();
      inFiveDays.setDate(inFiveDays.getDate() + 5);
      expect(component.formatDueDate(inFiveDays.toISOString())).toBe('5 days');
    });

    it('should return empty string for undefined due date', () => {
      expect(component.formatDueDate(undefined)).toBe('');
    });

    it('should check if date is overdue', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(component.isDueDateOverdue(yesterday.toISOString())).toBe(true);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(component.isDueDateOverdue(tomorrow.toISOString())).toBe(false);
    });

    it('should return false for undefined due date', () => {
      expect(component.isDueDateOverdue(undefined)).toBe(false);
    });
  });

  describe('Priority colors', () => {
    it('should return correct colors for priorities', () => {
      expect(component.getPriorityColor('high')).toBe('#dc2626');
      expect(component.getPriorityColor('medium')).toBe('#f59e0b');
      expect(component.getPriorityColor('low')).toBe('#3b82f6');
      expect(component.getPriorityColor(undefined)).toBe('transparent');
    });
  });

  describe('Drag and drop', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
    });

    it('should handle card reorder within same lane', () => {
      const mockEvent = {
        previousContainer: { id: DEFAULT_LANE_IDS.TODO },
        container: { id: DEFAULT_LANE_IDS.TODO },
        previousIndex: 0,
        currentIndex: 1,
        item: { data: { id: 'card-1' } },
      };

      component.dropCard(mockEvent as any, DEFAULT_LANE_IDS.TODO);

      expect(mockKanbanDocService.reorderCard).toHaveBeenCalledWith(
        'test-page-1',
        DEFAULT_LANE_IDS.TODO,
        'card-1',
        1,
      );
    });

    it('should handle card move between lanes', () => {
      const mockEvent = {
        previousContainer: { id: DEFAULT_LANE_IDS.TODO },
        container: { id: DEFAULT_LANE_IDS.IN_PROGRESS },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: { id: 'card-1' } },
      };

      component.dropCard(mockEvent as any, DEFAULT_LANE_IDS.IN_PROGRESS);

      expect(mockKanbanDocService.moveCard).toHaveBeenCalledWith(
        'test-page-1',
        'card-1',
        DEFAULT_LANE_IDS.TODO,
        DEFAULT_LANE_IDS.IN_PROGRESS,
        0,
      );
    });
  });

  describe('Done lane filtering', () => {
    beforeEach(async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      (component as any).refreshState();
    });

    it('should filter done cards based on settings', () => {
      const doneLane = mockLanes.find((l) => l.isDoneLane);
      expect(doneLane).toBeDefined();

      // getCardsForLane should return visibleDoneCards for done lane
      const cards = component.getCardsForLane(doneLane!);
      expect(Array.isArray(cards)).toBe(true);
    });

    it('should get hidden done count', () => {
      const doneLane = mockLanes.find((l) => l.isDoneLane);
      const count = component.getHiddenDoneCount(doneLane!);
      expect(typeof count).toBe('number');
    });

    it('should return 0 hidden count for non-done lanes', () => {
      const todoLane = mockLanes[0];
      expect(component.getHiddenDoneCount(todoLane)).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should close document on destroy', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      component.ngOnDestroy();

      expect(mockKanbanDocService.closeDocument).toHaveBeenCalledWith('test-page-1');
    });
  });

  describe('Track by functions', () => {
    it('should track lanes by id', () => {
      const lane: KanbanLane = { id: 'lane-1', title: 'Test', position: 0, cardIds: [] };
      expect(component.trackByLaneId(0, lane)).toBe('lane-1');
    });

    it('should track cards by id', () => {
      const card: KanbanCard = { id: 'card-1', title: 'Test', memoPageId: 'memo-1' };
      expect(component.trackByCardId(0, card)).toBe('card-1');
    });
  });
});
