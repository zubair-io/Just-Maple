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
import { Subscription, take } from 'rxjs';
import { PageService } from '../../services/page.service';
import { FolderService } from '../../services/folder.service';
import { isLocalFolder } from '../../providers/data-provider.interface';
import { UiStateService } from '../../services/ui-state.service';
import { EditorComponent } from '../../components/organisms/editor/editor.component';
import {
  NoteHeaderComponent,
  type ExportFormat,
} from '../../components/molecules/note-header/note-header.component';
import { DialogService } from '../../components/molecules/dialog/dialog.service';

@Component({
  selector: 'app-notebook',
  standalone: true,
  imports: [CommonModule, EditorComponent, NoteHeaderComponent],
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.scss',
})
export class NotebookComponent implements OnDestroy {
  @ViewChild(EditorComponent) private editorComponent?: EditorComponent;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly folderService = inject(FolderService);
  private readonly uiStateService = inject(UiStateService);
  private readonly ngZone = inject(NgZone);
  private readonly dialogService = inject(DialogService);

  private publishedDocRef: unknown = null;

  private routeSubscription?: Subscription;
  private editorUpdateInterval?: ReturnType<typeof setInterval>;

  readonly pageId = signal<string | null>(null);
  readonly folderId = signal<string | null>(null);

  // Editor state signals for header
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly isFullWidth = signal(false);
  readonly contentDirty = signal(false);

  // Get the page from the store
  readonly selectedPage = toSignal(this.pageService.activePage$, { initialValue: null });

  // Get the folder for the selected page
  readonly selectedFolder = toSignal(this.folderService.activeFolder$, {
    initialValue: null,
  });

  constructor() {
    // Subscribe to route params
    this.routeSubscription = this.route.params.subscribe((params) => {
      const id = params['id'] || null;
      const folderId = params['folderId'] || null;
      this.pageId.set(id);
      this.folderId.set(folderId);
      this.publishedDocRef = null;
      this.contentDirty.set(false);

      if (id) {
        this.pageService.setActivePageId(id);
      }
      if (folderId) {
        this.folderService.setActiveFolder(folderId);
      }

      // For local folders, load pages into store (needed on reload)
      if (folderId && isLocalFolder(folderId)) {
        this.pageService
          .loadLocalPages(folderId)
          .pipe(take(1))
          .subscribe({
            error: (err) => console.error('[FileEditor] Failed to load local pages:', err),
          });
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

        // Track content changes
        if (this.publishedDocRef) {
          this.contentDirty.set(!editor.state.doc.eq(this.publishedDocRef as any));
        }
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
      // Markdown export not available; fall through to HTML
      this.editorComponent?.exportAsHtml(title);
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

  handlePublishToggle(_isPublished: boolean): void {
    // Publishing is not supported in local-only mode
  }

  async handleDelete(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Delete Page',
      message: 'Are you sure you want to delete this page?',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    const id = this.pageId();
    const folderId = this.folderId();
    if (!id) return;
    this.pageService.deletePage(id).subscribe({
      next: () => {
        if (folderId) {
          this.router.navigate(['/', folderId]);
        }
      },
    });
  }

  /**
   * Handle Cmd/Ctrl+S to save
   */
  @HostListener('document:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    // Check for Cmd+S (Mac) or Ctrl+S (Windows/Linux)
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      // Save is handled automatically by the editor
      console.log('[FileEditor] Manual save triggered');
    }
  }
}
