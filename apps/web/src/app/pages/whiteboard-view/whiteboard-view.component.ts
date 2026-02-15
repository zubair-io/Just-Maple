import { Component, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { UiStateService } from '../../services/ui-state.service';
import { WhiteboardComponent } from '../../components/organisms/whiteboard/whiteboard.component';
import { NoteHeaderComponent, DialogService } from '../../components';

@Component({
  selector: 'app-whiteboard-view',
  standalone: true,
  imports: [CommonModule, WhiteboardComponent, NoteHeaderComponent],
  templateUrl: './whiteboard-view.component.html',
  styleUrl: './whiteboard-view.component.scss',
})
export class WhiteboardViewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  private readonly uiStateService = inject(UiStateService);
  private readonly dialogService = inject(DialogService);

  private routeSubscription?: Subscription;

  readonly pageId = signal<string | null>(null);
  readonly notebookId = signal<string | null>(null);

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
      if (notebookId) {
        this.notebookService.setActiveNotebook(notebookId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
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

  handlePublishToggle(isPublished: boolean): void {
    const id = this.pageId();
    if (!id) return;
    this.pageService.publishPage(id, isPublished).subscribe({
      error: (err) => console.error('Failed to toggle publish:', err),
    });
  }

  async handleDelete(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Delete Page',
      message: 'Are you sure you want to delete this page?',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    const id = this.pageId();
    const notebookId = this.notebookId();
    if (!id) return;
    this.pageService.deletePage(id).subscribe({
      next: () => {
        if (notebookId) {
          this.router.navigate(['/', notebookId]);
        }
      },
    });
  }
}
