import { Component, inject, signal, effect, OnDestroy, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { UiStateService } from '../../services/ui-state.service';
import { NotebookEditorComponent } from '../../components/organisms/notebook-editor/notebook-editor.component';
import { NoteHeaderComponent, type ExportFormat } from '../../components';

@Component({
  selector: 'app-notebook',
  standalone: true,
  imports: [CommonModule, NotebookEditorComponent, NoteHeaderComponent],
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss',
})
export class NotebookComponent implements OnDestroy {
  @ViewChild(NotebookEditorComponent) private editorComponent?: NotebookEditorComponent;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  private readonly uiStateService = inject(UiStateService);
  private readonly ngZone = inject(NgZone);

  private routeSubscription?: Subscription;
  private editorUpdateInterval?: ReturnType<typeof setInterval>;

  readonly pageId = signal<string | null>(null);
  readonly notebookId = signal<string | null>(null);

  // Editor state signals for header
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly isFullWidth = signal(false);

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

    // Poll editor state for undo/redo capability
    this.editorUpdateInterval = setInterval(() => {
      this.updateEditorState();
    }, 200);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    if (this.editorUpdateInterval) {
      clearInterval(this.editorUpdateInterval);
    }
  }

  private updateEditorState(): void {
    const editor = this.editorComponent?.getEditor();
    if (editor) {
      this.ngZone.run(() => {
        this.canUndo.set(editor.can().undo());
        this.canRedo.set(editor.can().redo());
        this.isFullWidth.set(this.editorComponent?.isFullWidth() ?? false);
      });
    }
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

  handleExport(format: ExportFormat): void {
    const page = this.selectedPage();
    const title = page?.title;

    if (format === 'markdown') {
      this.editorComponent?.exportAsMarkdown(title);
    } else if (format === 'html') {
      this.editorComponent?.exportAsHtml(title);
    }
  }

  handleUndo(): void {
    this.editorComponent?.getEditor()?.commands.undo();
  }

  handleRedo(): void {
    this.editorComponent?.getEditor()?.commands.redo();
  }

  handleToggleWidth(): void {
    this.editorComponent?.toggleFullWidth();
    this.isFullWidth.set(this.editorComponent?.isFullWidth() ?? false);
  }

  handleVersionRestored(): void {
    // Reload the page to get the restored version
    // This ensures all Y.js state is properly reset
    window.location.reload();
  }
}
