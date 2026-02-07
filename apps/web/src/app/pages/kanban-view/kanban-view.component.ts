import { Component, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { UiStateService } from '../../services/ui-state.service';
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
  private readonly kanbanDocService = inject(KanbanDocumentService);

  private routeSubscription?: Subscription;

  readonly pageId = signal<string | null>(null);
  readonly notebookId = signal<string | null>(null);
  readonly openCardModal = signal<{ memoPageId: string; title: string } | null>(null);

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
      this.pageId.set(id);
      this.notebookId.set(notebookId);

      if (id) {
        this.pageService.setActivePageId(id);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  onCardOpened(card: { memoPageId: string; title: string }): void {
    this.openCardModal.set(card);
  }

  closeCardModal(): void {
    this.openCardModal.set(null);
  }

  onCardTitleChanged(newTitle: string): void {
    const card = this.openCardModal();
    const kanbanPageId = this.pageId();
    if (!card || !kanbanPageId) return;

    this.kanbanDocService.updateCardTitleByMemoPageId(kanbanPageId, card.memoPageId, newTitle);
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
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      this.uiStateService.openSidebar();
    }
  }
}
