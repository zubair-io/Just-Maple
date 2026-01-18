import { Component, inject, signal, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { UiStateService } from '../../services/ui-state.service';
import { NotebookEditorComponent } from '../../components/organisms/notebook-editor/notebook-editor.component';
import { NoteHeaderComponent } from '../../components';

@Component({
  selector: 'app-notebook',
  standalone: true,
  imports: [CommonModule, NotebookEditorComponent, NoteHeaderComponent],
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss',
})
export class NotebookComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  private readonly uiStateService = inject(UiStateService);

  private routeSubscription?: Subscription;

  readonly documentId = signal<string | null>(null);
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
      const documentId = params['documentId'] || null;
      const notebookId = params['tagId'] || null;
      this.documentId.set(documentId);
      this.notebookId.set(notebookId);

      if (documentId) {
        this.pageService.setActivePageId(documentId);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  toggleFavorite(): void {
    const page = this.selectedPage();
    if (!page?._id) return;

    this.pageService.toggleFavorite(page._id).subscribe({
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
