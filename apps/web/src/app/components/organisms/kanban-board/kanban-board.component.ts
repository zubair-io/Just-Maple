import {
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  computed,
  OnInit,
  OnDestroy,
  effect,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDragDrop,
  CdkDragStart,
  CdkDrag,
  CdkDropList,
  CdkDropListGroup,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import * as Y from 'yjs';
import { KanbanDocumentService, type KanbanYDoc } from '../../../services/kanban-document.service';
import { MemoDocumentService } from '../../../services/memo-document.service';
import type { KanbanLane, KanbanCard, KanbanSettings, KanbanPriority } from '@maple/shared';
import { DEFAULT_LANE_IDS } from '@maple/shared';

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [CommonModule, FormsModule, CdkDropListGroup, CdkDropList, CdkDrag],
  templateUrl: './kanban-board.component.html',
  styleUrl: './kanban-board.component.scss',
})
export class KanbanBoardComponent implements OnInit, OnDestroy {
  private readonly kanbanDocService = inject(KanbanDocumentService);
  private readonly memoDocService = inject(MemoDocumentService);

  readonly pageId = input.required<string>();
  readonly notebookId = input<string | null>(null);

  readonly cardOpened = output<{ memoPageId: string; title: string }>();

  // Document state
  private kanbanDoc: KanbanYDoc | null = null;

  // Reactive state
  readonly lanes = signal<KanbanLane[]>([]);
  readonly cards = signal<Map<string, KanbanCard>>(new Map());
  readonly settings = signal<KanbanSettings | null>(null);
  readonly archivedCount = signal(0);
  readonly isLoading = signal(true);

  // UI state
  readonly editingLaneId = signal<string | null>(null);
  readonly editingCardId = signal<string | null>(null);
  readonly newCardLaneId = signal<string | null>(null);
  readonly newCardTitle = signal('');
  readonly newLaneTitle = signal('');
  readonly isAddingLane = signal(false);
  readonly deletingLaneId = signal<string | null>(null);

  // Drag auto-scroll
  private readonly lanesContainer = viewChild<ElementRef>('lanesContainer');

  // Computed: cards organized by lane
  readonly cardsByLane = computed(() => {
    const cardsMap = this.cards();
    const result = new Map<string, KanbanCard[]>();

    for (const lane of this.lanes()) {
      const laneCards: KanbanCard[] = [];
      for (const cardId of lane.cardIds) {
        const card = cardsMap.get(cardId);
        if (card) {
          laneCards.push(card);
        }
      }
      result.set(lane.id, laneCards);
    }

    return result;
  });

  // Computed: done lane card visibility based on settings
  readonly visibleDoneCards = computed(() => {
    const currentSettings = this.settings();
    if (!currentSettings) return [];

    const doneLane = this.lanes().find((l) => l.isDoneLane);
    if (!doneLane) return [];

    const allCards = this.cardsByLane().get(doneLane.id) || [];

    // If period is 'never', show all cards
    if (currentSettings.doneReset.period === 'never') {
      return allCards;
    }

    const now = new Date();
    const filterDate = this.getFilterDate(currentSettings.doneReset.period, now);

    return allCards.filter((card) => {
      if (!card.completedAt) return true;
      return new Date(card.completedAt) >= filterDate;
    });
  });

  constructor() {
    // Watch for pageId changes
    effect(() => {
      const id = this.pageId();
      if (id) {
        this.loadDocument(id);
      }
    });
  }

  ngOnInit(): void {
    // Document will be loaded via effect
  }

  ngOnDestroy(): void {
    this.onDragEnded();
    const id = this.pageId();
    if (id) {
      this.kanbanDocService.closeDocument(id);
    }
  }

  private async loadDocument(pageId: string): Promise<void> {
    this.isLoading.set(true);

    try {
      this.kanbanDoc = await this.kanbanDocService.openDocument(pageId);

      // Setup Y.js observers
      this.setupObservers();

      // Initial load
      this.refreshState();
    } catch (error) {
      console.error('Failed to load kanban document:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private setupObservers(): void {
    if (!this.kanbanDoc) return;

    // Observe lanes
    this.kanbanDoc.lanes.observe(() => {
      this.refreshLanes();
    });

    // Observe cards (deep to catch nested property changes like title updates)
    this.kanbanDoc.cards.observeDeep(() => {
      this.refreshCards();
    });

    // Observe archived
    this.kanbanDoc.archived.observe(() => {
      this.refreshArchivedCount();
    });

    // Observe settings
    this.kanbanDoc.settings.observe(() => {
      this.refreshSettings();
    });

    // Deep observe for lane card changes
    this.kanbanDoc.lanes.observeDeep(() => {
      this.refreshLanes();
    });
  }

  private refreshState(): void {
    this.refreshLanes();
    this.refreshCards();
    this.refreshSettings();
    this.refreshArchivedCount();
  }

  private refreshLanes(): void {
    const pageId = this.pageId();
    const newLanes = this.kanbanDocService.getLanes(pageId);
    this.lanes.set(newLanes);
  }

  private refreshCards(): void {
    const pageId = this.pageId();
    const allCards = this.kanbanDocService.getCards(pageId);
    const cardsMap = new Map<string, KanbanCard>();
    for (const card of allCards) {
      cardsMap.set(card.id, card);
    }
    this.cards.set(cardsMap);
  }

  private refreshSettings(): void {
    const pageId = this.pageId();
    const newSettings = this.kanbanDocService.getSettings(pageId);
    this.settings.set(newSettings);
  }

  private refreshArchivedCount(): void {
    const pageId = this.pageId();
    const archived = this.kanbanDocService.getArchivedCards(pageId);
    this.archivedCount.set(archived.length);
  }

  private getFilterDate(period: string, now: Date): Date {
    const date = new Date(now);

    switch (period) {
      case 'daily':
        date.setHours(0, 0, 0, 0);
        break;
      case 'weekly': {
        const dayOfWeek = this.settings()?.doneReset.dayOfWeek ?? 1; // Monday
        const diff = (now.getDay() - dayOfWeek + 7) % 7;
        date.setDate(now.getDate() - diff);
        date.setHours(0, 0, 0, 0);
        break;
      }
      case 'biweekly':
        date.setDate(now.getDate() - 14);
        date.setHours(0, 0, 0, 0);
        break;
      case 'monthly': {
        const dayOfMonth = this.settings()?.doneReset.dayOfMonth ?? 1;
        date.setDate(dayOfMonth);
        if (date > now) {
          date.setMonth(date.getMonth() - 1);
        }
        date.setHours(0, 0, 0, 0);
        break;
      }
    }

    return date;
  }

  // Lane operations
  startAddingLane(): void {
    this.isAddingLane.set(true);
    this.newLaneTitle.set('');
  }

  cancelAddLane(): void {
    this.isAddingLane.set(false);
    this.newLaneTitle.set('');
  }

  saveLane(): void {
    const title = this.newLaneTitle().trim();
    if (!title) {
      this.cancelAddLane();
      return;
    }

    const pageId = this.pageId();
    this.kanbanDocService.addLane(pageId, title);
    this.cancelAddLane();
  }

  startEditingLane(laneId: string): void {
    this.editingLaneId.set(laneId);
  }

  cancelEditingLane(): void {
    this.editingLaneId.set(null);
  }

  saveLaneTitle(laneId: string, title: string): void {
    if (!title.trim()) {
      this.cancelEditingLane();
      return;
    }

    const pageId = this.pageId();
    this.kanbanDocService.updateLane(pageId, laneId, { title: title.trim() });
    this.cancelEditingLane();
  }

  /**
   * Initiate lane deletion - shows confirmation if lane has cards
   */
  deleteLane(laneId: string): void {
    const lane = this.lanes().find((l) => l.id === laneId);
    if (!lane) return;

    // Cannot delete default lanes
    if (lane.isDefault || lane.isDoneLane) {
      return;
    }

    const cardCount = lane.cardIds.length;
    if (cardCount > 0) {
      // Show inline confirmation
      this.deletingLaneId.set(laneId);
    } else {
      // No cards, delete immediately
      this.confirmDeleteLane(laneId);
    }
  }

  /**
   * Confirm and execute lane deletion
   */
  confirmDeleteLane(laneId: string): void {
    const pageId = this.pageId();
    this.kanbanDocService.deleteLane(pageId, laneId);
    this.deletingLaneId.set(null);
  }

  /**
   * Cancel lane deletion
   */
  cancelDeleteLane(): void {
    this.deletingLaneId.set(null);
  }

  // Card operations
  startAddingCard(laneId: string): void {
    this.newCardLaneId.set(laneId);
    this.newCardTitle.set('');
  }

  cancelAddCard(): void {
    this.newCardLaneId.set(null);
    this.newCardTitle.set('');
  }

  saveCardAndContinue(): void {
    const laneId = this.newCardLaneId();
    const title = this.newCardTitle().trim();

    if (!laneId || !title) {
      this.cancelAddCard();
      return;
    }

    this.createCardInLane(laneId, title);
    this.newCardTitle.set('');
  }

  saveCardFromBlur(): void {
    const laneId = this.newCardLaneId();
    const title = this.newCardTitle().trim();

    if (!laneId || !title) {
      this.cancelAddCard();
      return;
    }

    this.createCardInLane(laneId, title);
    this.cancelAddCard();
  }

  /**
   * Optimistically creates a card: the card is added to the kanban Y.Doc in memory
   * immediately so it appears in the UI without waiting for the async memo creation.
   * The memo (Y.js document backing the card) is created in the background using
   * a pre-generated memoId shared between both operations.
   */
  private createCardInLane(laneId: string, title: string): void {
    const pageId = this.pageId();
    const notebookId = this.notebookId();
    const memoId = crypto.randomUUID();

    // Optimistic: add card to kanban Y.Doc in memory immediately
    this.kanbanDocService.createCard(pageId, laneId, title, memoId);

    // Async: create the backing memo document in the background
    // Pass laneId so the memo gets kanban metadata for reconciliation
    this.memoDocService
      .createMemo(notebookId ?? undefined, pageId, title, memoId, laneId)
      .catch((error) => {
        console.error('Failed to create card memo:', error);
      });
  }

  openCard(card: KanbanCard): void {
    this.cardOpened.emit({ memoPageId: card.memoPageId, title: card.title });
  }

  archiveCard(card: KanbanCard, laneId: string): void {
    const pageId = this.pageId();
    this.kanbanDocService.archiveCard(pageId, card.id, laneId);
  }

  updateCardPriority(card: KanbanCard, priority: KanbanPriority | null): void {
    const pageId = this.pageId();
    this.kanbanDocService.updateCard(pageId, card.id, { priority });
  }

  // Drag and drop
  dropCard(event: CdkDragDrop<KanbanCard[]>, toLaneId: string): void {
    const pageId = this.pageId();

    if (event.previousContainer === event.container) {
      // Reorder within same lane
      const cardId = event.item.data.id;
      this.kanbanDocService.reorderCard(pageId, toLaneId, cardId, event.currentIndex);
    } else {
      // Move to different lane
      const cardId = event.item.data.id;
      const fromLaneId = event.previousContainer.id;
      this.kanbanDocService.moveCard(pageId, cardId, fromLaneId, toLaneId, event.currentIndex);
    }
  }

  dropLane(event: CdkDragDrop<KanbanLane[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    const pageId = this.pageId();
    const lane = this.lanes()[event.previousIndex];
    this.kanbanDocService.reorderLane(pageId, lane.id, event.currentIndex);
  }

  onDragStarted(): void {
    const container = this.lanesContainer()?.nativeElement as HTMLElement | undefined;
    if (!container) return;

    // Disable scroll snap during drag so scrollTo works smoothly
    container.style.scrollSnapType = 'none';
    this._dragScrolledToLane = this.getCurrentLaneIndex(container);

    // Track pointer and scroll to next/prev lane when near edge
    this._dragScrollCooldown = false;

    this._pointerMoveHandler = (e: PointerEvent) => {
      if (this._dragScrollCooldown) return;

      const rect = container.getBoundingClientRect();
      const edgeZone = 60;
      const laneEls = container.querySelectorAll<HTMLElement>('.lane');

      let targetIdx: number | null = null;

      if (e.clientX > rect.right - edgeZone) {
        targetIdx = Math.min(this._dragScrolledToLane + 1, laneEls.length - 1);
      } else if (e.clientX < rect.left + edgeZone) {
        targetIdx = Math.max(this._dragScrolledToLane - 1, 0);
      }

      if (targetIdx != null && targetIdx !== this._dragScrolledToLane) {
        this._dragScrolledToLane = targetIdx;
        this._dragScrollCooldown = true;
        laneEls[targetIdx].scrollIntoView({
          behavior: 'smooth',
          inline: 'start',
          block: 'nearest',
        });
        // Wait for scroll animation to finish before allowing another scroll
        setTimeout(() => {
          this._dragScrollCooldown = false;
        }, 400);
      }
    };
    document.addEventListener('pointermove', this._pointerMoveHandler);
  }

  onDragEnded(): void {
    if (this._pointerMoveHandler) {
      document.removeEventListener('pointermove', this._pointerMoveHandler);
      this._pointerMoveHandler = null;
    }

    // Re-enable scroll snap
    const container = this.lanesContainer()?.nativeElement as HTMLElement | undefined;
    if (container) {
      container.style.scrollSnapType = 'x mandatory';
    }
  }

  private _pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private _dragScrolledToLane = 0;
  private _dragScrollCooldown = false;

  private getCurrentLaneIndex(container: HTMLElement): number {
    const laneEls = container.querySelectorAll<HTMLElement>('.lane');
    const scrollLeft = container.scrollLeft;
    let closest = 0;
    let closestDist = Infinity;
    laneEls.forEach((el, i) => {
      const dist = Math.abs(el.offsetLeft - container.offsetLeft - scrollLeft);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    return closest;
  }

  // Helpers
  trackByLaneId(index: number, lane: KanbanLane): string {
    return lane.id;
  }

  trackByCardId(index: number, card: KanbanCard): string {
    return card.id;
  }

  getCardCount(laneId: string): number {
    return this.cardsByLane().get(laneId)?.length || 0;
  }

  isDefaultLane(lane: KanbanLane): boolean {
    return lane.isDefault || lane.isDoneLane || false;
  }

  getPriorityColor(priority: KanbanPriority | undefined): string {
    switch (priority) {
      case 'high':
        return '#dc2626';
      case 'medium':
        return '#f59e0b';
      case 'low':
        return '#3b82f6';
      default:
        return 'transparent';
    }
  }

  formatDueDate(dueDate: string | undefined): string {
    if (!dueDate) return '';

    const date = new Date(dueDate);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Overdue';
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays <= 7) return `${diffDays} days`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  isDueDateOverdue(dueDate: string | undefined): boolean {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  }

  getCardsForLane(lane: KanbanLane): KanbanCard[] {
    if (lane.isDoneLane) {
      return this.visibleDoneCards();
    }
    return this.cardsByLane().get(lane.id) || [];
  }

  getHiddenDoneCount(lane: KanbanLane): number {
    if (!lane.isDoneLane) return 0;
    const allDoneCards = this.cardsByLane().get(lane.id) || [];
    const visibleCards = this.visibleDoneCards();
    return allDoneCards.length - visibleCards.length;
  }
}
