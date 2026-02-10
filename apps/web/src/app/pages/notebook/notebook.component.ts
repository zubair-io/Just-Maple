import {
  Component,
  inject,
  signal,
  OnDestroy,
  ViewChild,
  NgZone,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { isLocalNotebook } from '../../providers/data-provider.interface';
import { UiStateService } from '../../services/ui-state.service';
import { MemoVersionService } from '../../services/memo-version.service';
import { NotificationService } from '../../services/notification.service';
import { NotebookEditorComponent } from '../../components/organisms/notebook-editor/notebook-editor.component';
import { NoteHeaderComponent, type ExportFormat, DialogService } from '../../components';

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
  private readonly memoVersionService = inject(MemoVersionService);
  private readonly notificationService = inject(NotificationService);
  private readonly ngZone = inject(NgZone);
  private readonly dialogService = inject(DialogService);

  private isSavingCheckpoint = false;

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

      // For local notebooks, load pages into store (needed on reload)
      if (notebookId && isLocalNotebook(notebookId)) {
        this.pageService.loadLocalPages(notebookId).subscribe();
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

  /**
   * Handle Cmd/Ctrl+S to save a manual checkpoint
   */
  @HostListener('document:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    // Check for Cmd+S (Mac) or Ctrl+S (Windows/Linux)
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      this.saveCheckpoint();
    }
  }

  /**
   * Save a manual checkpoint (version snapshot)
   */
  private saveCheckpoint(): void {
    const id = this.pageId();
    if (!id || this.isSavingCheckpoint) return;

    this.isSavingCheckpoint = true;

    this.memoVersionService.createCheckpoint(id).subscribe({
      next: () => {
        this.notificationService.showToast({
          title: 'Checkpoint saved',
          message: 'You can restore this version from the history panel',
          type: 'success',
          duration: 3000,
        });
        this.isSavingCheckpoint = false;
      },
      error: (err) => {
        console.error('Failed to save checkpoint:', err);
        this.notificationService.showToast({
          title: 'Failed to save checkpoint',
          message: 'Please try again',
          type: 'error',
          duration: 3000,
        });
        this.isSavingCheckpoint = false;
      },
    });
  }
}
