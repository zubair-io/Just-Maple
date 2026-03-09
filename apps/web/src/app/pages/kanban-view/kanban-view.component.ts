import { Component, computed, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { UiStateService } from '../../services/ui-state.service';
import { NativeBridgeService } from '../../services/native-bridge.service';
import { KanbanDocumentService } from '../../services/kanban-document.service';
import { KanbanBoardComponent } from '../../components/organisms/kanban-board/kanban-board.component';
import { KanbanCardModalComponent } from '../../components/organisms/kanban-card-modal/kanban-card-modal.component';
import { NoteHeaderComponent } from '../../components';

@Component({
  selector: 'app-kanban-view',
  standalone: true,
  imports: [CommonModule, KanbanBoardComponent, KanbanCardModalComponent, NoteHeaderComponent],
  templateUrl: './kanban-view.component.html',
  styleUrl: './kanban-view.component.scss',
})
export class KanbanViewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  private readonly uiStateService = inject(UiStateService);
  private readonly nativeBridge = inject(NativeBridgeService);
  private readonly kanbanDocService = inject(KanbanDocumentService);

  private routeSubscription?: Subscription;
  private aggregateTagsTimeout?: ReturnType<typeof setTimeout>;

  readonly pageId = signal<string | null>(null);
  readonly notebookId = signal<string | null>(null);
  readonly activeMemoId = signal<string | null>(null);

  // Look up the card title from the kanban Y.Doc
  readonly activeCardTitle = computed(() => {
    const memoId = this.activeMemoId();
    const kanbanPageId = this.pageId();
    if (!memoId || !kanbanPageId) return '';

    const cards = this.kanbanDocService.getCards(kanbanPageId);
    const card = cards.find((c) => c.memoPageId === memoId);
    return card?.title ?? '';
  });

  // Get the page from the store
  readonly selectedPage = toSignal(this.pageService.activePage$, { initialValue: null });

  // Get the notebook for the selected page
  readonly selectedNotebook = toSignal(this.notebookService.activeNotebook$, {
    initialValue: null,
  });

  constructor() {
    // Subscribe to route params
    this.routeSubscription = this.route.params.subscribe((params) => {
      const id = params['id'] || null;
      const notebookId = params['notebookId'] || null;
      const memoId = params['memoId'] || null;
      this.pageId.set(id);
      this.notebookId.set(notebookId);
      this.activeMemoId.set(memoId);

      if (id) {
        this.pageService.setActivePageId(id);
      }
      if (notebookId) {
        this.notebookService.setActiveNotebook(notebookId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    if (this.aggregateTagsTimeout) {
      clearTimeout(this.aggregateTagsTimeout);
    }
  }

  onCardOpened(card: { memoPageId: string; title: string }): void {
    const notebookId = this.notebookId();
    const boardId = this.pageId();
    if (notebookId && boardId) {
      this.router.navigate(['/', notebookId, boardId, card.memoPageId]);
    }
  }

  closeCardModal(): void {
    const notebookId = this.notebookId();
    const boardId = this.pageId();
    if (notebookId && boardId) {
      this.router.navigate(['/', notebookId, boardId]);
    }
  }

  onCardTitleChanged(newTitle: string): void {
    const memoId = this.activeMemoId();
    const kanbanPageId = this.pageId();
    if (!memoId || !kanbanPageId) return;

    this.kanbanDocService.updateCardTitleByMemoPageId(kanbanPageId, memoId, newTitle);
  }

  onCardMentionsChanged(mentions: { userId: string; displayName: string }[]): void {
    const memoId = this.activeMemoId();
    const kanbanPageId = this.pageId();
    if (!memoId || !kanbanPageId) return;

    this.kanbanDocService.updateCardMentionsByMemoPageId(kanbanPageId, memoId, mentions);
  }

  onCardTagsChanged(tags: string[]): void {
    const memoId = this.activeMemoId();
    const kanbanPageId = this.pageId();
    if (!memoId || !kanbanPageId) return;

    this.kanbanDocService.updateCardTagsByMemoPageId(kanbanPageId, memoId, tags);
    this.syncAggregatedTags();
  }

  /**
   * Collect all card tags and update the kanban page's tags field
   * so the connection graph picks them up. Debounced to avoid excessive API calls.
   */
  private syncAggregatedTags(): void {
    if (this.aggregateTagsTimeout) {
      clearTimeout(this.aggregateTagsTimeout);
    }

    this.aggregateTagsTimeout = setTimeout(() => {
      const kanbanPageId = this.pageId();
      if (!kanbanPageId) return;

      const allCards = this.kanbanDocService.getCards(kanbanPageId);
      const allTags = new Set<string>();
      for (const card of allCards) {
        if (card.tags) {
          for (const tag of card.tags) {
            allTags.add(tag);
          }
        }
      }

      this.pageService.updatePage(kanbanPageId, { tags: [...allTags] }).subscribe();
    }, 1000);
  }

  handlePublishToggle(isPublished: boolean): void {
    const id = this.pageId();
    if (!id) return;
    this.pageService.publishPage(id, isPublished).subscribe({
      error: (err) => console.error('Failed to toggle publish:', err),
    });
  }

  onTitleChanged(newTitle: string): void {
    const page = this.selectedPage();
    if (!page?.id) return;

    this.pageService.updatePage(page.id, { title: newTitle }).subscribe({
      error: (error) => {
        console.error('Failed to update title:', error);
      },
    });
  }

  toggleFavorite(): void {
    const page = this.selectedPage();
    if (!page?.id) return;

    this.pageService.toggleFavorite(page.id).subscribe({
      error: (error) => {
        console.error('Failed to toggle favorite:', error);
      },
    });
  }

  openSidebarOnMobile(): void {
    if (
      this.nativeBridge.hasNativeSidebar() ||
      (typeof window !== 'undefined' && window.innerWidth < 768)
    ) {
      this.uiStateService.openSidebar();
    }
  }
}
