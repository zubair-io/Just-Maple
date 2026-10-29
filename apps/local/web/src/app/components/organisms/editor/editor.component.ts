import {
  Component,
  input,
  output,
  signal,
  effect,
  inject,
  ElementRef,
  ViewChild,
  OnDestroy,
  afterNextRender,
  DestroyRef,
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Editor } from '@tiptap/core';
import { firstValueFrom } from 'rxjs';
import { NativeBridgeService } from '../../../services/native-bridge.service';
import { PageService } from '../../../services/page.service';
import { MarkdownSerializerService } from '../../../services/markdown-serializer.service';
import { MemoImageService } from '../../../services/memo-image.service';
import { EditorToolbarComponent } from '../../molecules/editor-toolbar/editor-toolbar.component';
import { PageLinkSearchComponent } from '../../molecules/page-link-search/page-link-search.component';
import type { SuggestionItem } from '../../molecules/suggestion-menu/suggestion-menu.component';
import type { PageLinkSuggestion, HashTagSuggestion } from './extensions';
import { buildEditorExtensions } from './editor-extensions.config';
import { LocalNoteSavesService } from '../../../services/local-note-saves.service';
import { generateUUID } from '../../../utils/uuid';
import { createSlashMenuRenderer, createSuggestionRenderer } from './editor-popup.helpers';
import { downloadFile, sanitizeFilename } from './editor-export.helpers';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, EditorToolbarComponent, PageLinkSearchComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  @ViewChild('editorWrapper', { static: false })
  private editorWrapperRef?: ElementRef<HTMLElement>;

  private readonly pageService = inject(PageService);
  private readonly markdownSerializer = inject(MarkdownSerializerService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly memoImageService = inject(MemoImageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly router = inject(Router);
  private readonly nativeBridge = inject(NativeBridgeService);

  readonly pageId = input.required<string>();
  readonly folderId = input.required<string>();
  readonly editable = input<boolean>(true);
  readonly skipPageSync = input<boolean>(false);
  readonly tagsChanged = output<string[]>();

  readonly isReady = signal(false);
  readonly isFocused = signal(false);
  readonly error = signal<string | null>(null);
  readonly isFullWidth = signal(false);

  // Page link search state
  readonly pageLinkSearchOpen = signal(false);
  readonly pageLinkSearchMode = signal<'inline' | 'block'>('inline');

  private _editor: Editor | null = null;
  private readonly viewReady = signal(false);
  private lastPageId: string | null = null;
  readonly noteSaves = inject(LocalNoteSavesService);
  readonly recoveredDraft = signal<string | null>(null);
  private editingPageId: string | null = null;
  private loadRevision = 0;
  private tagUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedTags: string[] = [];
  private isInitialSync = true;

  // Event listener cleanup
  private pageLinkListeners: { event: string; handler: EventListener }[] = [];

  constructor() {
    afterNextRender(() => {
      this.viewReady.set(true);
    });

    effect(() => {
      const currentPageId = this.pageId();
      if (!this.viewReady() || !currentPageId) return;

      if (currentPageId !== this.lastPageId) {
        this.lastPageId = currentPageId;
        this.initializeEditor(currentPageId);
      }
    });

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  // ==========================================
  // Editor Lifecycle
  // ==========================================

  private async initializeEditor(pageId: string): Promise<void> {
    this.cleanup();
    const revision = ++this.loadRevision;
    this.editingPageId = pageId;
    this.isReady.set(false);
    this.error.set(null);

    try {
      await this.noteSaves.queue.flush(pageId).catch(() => {});
      const markdownContent = await firstValueFrom(this.pageService.getLocalPageMarkdown(pageId));

      if (revision !== this.loadRevision || !this.editorRef?.nativeElement) return;

      const extensions = buildEditorExtensions({
        searchPages: (query) => this.searchPagesForLink(query),
        onLinkClick: (linkPageId) => this.navigateToPage(linkPageId),
        getPageTitle$: (linkPageId) => this.pageService.getPageTitle$(linkPageId),
        createSlashMenuRenderer: () => createSlashMenuRenderer(this.appRef, this.injector),
        createPageLinkSuggestionRenderer: () => this.createPageLinkSuggestionRenderer(),
        createHashTagSuggestionRenderer: () => this.createHashTagSuggestionRenderer(),
      });

      this._editor = new Editor({
        element: this.editorRef.nativeElement,
        extensions,
        editable: this.editable(),
        onFocus: () => this.isFocused.set(true),
        onBlur: () => this.isFocused.set(false),
        onUpdate: ({ editor }) => this.handleContentUpdate(editor),
      });

      if (markdownContent) {
        const doc = this.markdownSerializer.deserialize(markdownContent, this._editor.schema);
        this._editor.commands.setContent(doc.toJSON(), { emitUpdate: false });
      }

      const draft = this.noteSaves.queue.draft(pageId);
      if (draft !== null && draft !== markdownContent) this.noteSaves.queue.suspend(pageId);
      this.recoveredDraft.set(draft !== null && draft !== markdownContent ? draft : null);
      this.isInitialSync = false;

      this.setupPageLinkListeners();
      this.setupImageUploadListener();

      this.isReady.set(true);
      this.handleTodoDeepLink();
    } catch {
      if (revision !== this.loadRevision) return;
      this.error.set('Failed to load note');
    }
  }

  private cleanup(): void {
    ++this.loadRevision;
    if (this.editingPageId) this.noteSaves.flush(this.editingPageId);
    this.editingPageId = null;
    if (this.tagUpdateTimeout) {
      clearTimeout(this.tagUpdateTimeout);
      this.tagUpdateTimeout = null;
    }

    this.cleanupPageLinkListeners();

    if (this._editor) {
      this._editor.destroy();
      this._editor = null;
    }

    this.isReady.set(false);
    this.isInitialSync = true;
  }

  // ==========================================
  // Content Updates
  // ==========================================

  private handleContentUpdate(editor: Editor): void {
    this.syncHashtags(editor);

    // Don't save during initial content load
    if (this.isInitialSync) return;

    if (this.editingPageId) {
      this.noteSaves.queue.stage(
        this.editingPageId,
        this.markdownSerializer.serializeToMarkdown(editor.state.doc),
      );
    }
  }

  restoreDraft(): void {
    const draft = this.recoveredDraft();
    if (!this._editor || draft === null || !this.editingPageId) return;
    const doc = this.markdownSerializer.deserialize(draft, this._editor.schema);
    this._editor.commands.setContent(doc.toJSON(), { emitUpdate: false });
    this.recoveredDraft.set(null);
    this.noteSaves.queue.stage(this.editingPageId, draft);
  }

  private syncHashtags(editor: Editor): void {
    const tags = this.extractHashtags(editor);
    const tagsStr = tags.sort().join(',');
    if (tagsStr === this.lastSyncedTags.sort().join(',')) return;

    if (this.tagUpdateTimeout) clearTimeout(this.tagUpdateTimeout);
    this.tagUpdateTimeout = setTimeout(() => {
      this.lastSyncedTags = [...tags];
      this.tagsChanged.emit(tags);
    }, 500);
  }

  private extractHashtags(editor: Editor): string[] {
    const tags: Set<string> = new Set();
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'hashTag') {
        const tag = node.attrs['tag'];
        if (tag && typeof tag === 'string') tags.add(tag.toLowerCase());
      }
      return true;
    });
    return Array.from(tags);
  }

  // ==========================================
  // Image Upload
  // ==========================================

  private setupImageUploadListener(): void {
    const el = this.editorRef?.nativeElement;
    if (!el) return;
    el.addEventListener('upload-image', ((event: CustomEvent) => {
      this.handleImageUpload(event.detail?.range);
    }) as EventListener);
  }

  private async handleImageUpload(range?: { from: number; to: number }): Promise<void> {
    const pageId = this.pageId();
    if (!pageId) return;

    if (range) this._editor?.chain().focus().deleteRange(range).run();

    const file = await this.memoImageService.selectImageFile();
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    const placeholderUrl = `placeholder://${generateUUID()}`;
    const placeholderUrls = {
      original: placeholderUrl,
      small: placeholderUrl,
      medium: placeholderUrl,
      large: placeholderUrl,
      cover: placeholderUrl,
    };

    (this._editor?.chain().focus() as any)
      .insertMemoImage({ urls: placeholderUrls, size: 'medium', loading: true, previewUrl })
      .run();

    this.memoImageService.uploadImage(pageId, file).subscribe({
      next: (result) => {
        (this._editor?.chain() as any)
          .updateMemoImage(placeholderUrl, { urls: result.urls, loading: false })
          .run();
        URL.revokeObjectURL(previewUrl);
      },
      error: (err: any) => {
        console.error('[Editor] Failed to upload image:', err);
        (this._editor?.chain() as any).deleteMemoImage(placeholderUrl).run();
        URL.revokeObjectURL(previewUrl);
      },
    });
  }

  // ==========================================
  // Page Links
  // ==========================================

  private setupPageLinkListeners(): void {
    const el = this.editorRef?.nativeElement;
    if (!el) return;
    this.cleanupPageLinkListeners();

    const add = (event: string, handler: EventListener) => {
      el.addEventListener(event, handler);
      this.pageLinkListeners.push({ event, handler });
    };

    add('open-page-link-search', ((e: CustomEvent) => {
      e.stopPropagation();
      this.pageLinkSearchMode.set(e.detail?.mode || 'inline');
      this.pageLinkSearchOpen.set(true);
    }) as EventListener);

    add('page-link-click', ((e: CustomEvent) => {
      e.stopPropagation();
      this.navigateToPage(e.detail?.pageId);
    }) as EventListener);

    add('page-link-block-click', ((e: CustomEvent) => {
      e.stopPropagation();
      this.navigateToPage(e.detail?.pageId);
    }) as EventListener);
  }

  private cleanupPageLinkListeners(): void {
    const el = this.editorRef?.nativeElement;
    if (!el) return;
    for (const { event, handler } of this.pageLinkListeners) {
      el.removeEventListener(event, handler);
    }
    this.pageLinkListeners = [];
  }

  async searchPagesForLink(query: string): Promise<PageLinkSuggestion[]> {
    if (!query || query.length < 1) return [];
    const lowerQuery = query.toLowerCase();
    return this.pageService
      .pages()
      .filter((p: any) => p.title?.toLowerCase().includes(lowerQuery))
      .slice(0, 10)
      .map((p: any) => ({
        id: p.id,
        title: p.title || 'Untitled',
        type: p.type || 'memo',
        folderName: '',
      }));
  }

  navigateToPage(pageId: string): void {
    this.router.navigate(['/', this.folderId(), pageId]);
  }

  onPageLinkSelected(event: { pageId: string; title: string; mode: 'inline' | 'block' }): void {
    if (!this._editor) return;
    if (event.mode === 'inline') {
      this._editor
        .chain()
        .focus()
        .insertPageLink({ pageId: event.pageId, title: event.title })
        .run();
    } else {
      this._editor
        .chain()
        .focus()
        .insertPageLinkBlock({ pageId: event.pageId, title: event.title })
        .run();
    }
  }

  async onPageLinkCreateNew(event: { title: string; mode: 'inline' | 'block' }): Promise<void> {
    const folderId = this.folderId();
    if (!folderId) return;
    try {
      const page = await firstValueFrom(
        this.pageService.createPage({ title: event.title, folderId, type: 'memo' }),
      );
      if (page && this._editor) {
        if (event.mode === 'inline') {
          this._editor
            .chain()
            .focus()
            .insertPageLink({ pageId: page.id, title: event.title })
            .run();
        } else {
          this._editor
            .chain()
            .focus()
            .insertPageLinkBlock({ pageId: page.id, title: event.title })
            .run();
        }
      }
    } catch (err) {
      console.error('[Editor] Failed to create new page:', err);
    }
  }

  closePageLinkSearch(): void {
    this.pageLinkSearchOpen.set(false);
  }

  // ==========================================
  // Suggestion Renderers
  // ==========================================

  private createPageLinkSuggestionRenderer() {
    return createSuggestionRenderer<PageLinkSuggestion>(this.appRef, this.injector, (items) =>
      items.map((item) => ({
        id: item.id,
        icon: item.type === 'memo' ? '📝' : '📄',
        title: item.title,
        description: item.folderName,
        data: item,
      })),
    );
  }

  private createHashTagSuggestionRenderer() {
    return createSuggestionRenderer<HashTagSuggestion>(this.appRef, this.injector, (items) =>
      items.map((item) => ({
        id: item.name,
        icon: '#',
        title: item.name,
        description:
          item.count && item.count > 0
            ? `${item.count} page${item.count === 1 ? '' : 's'}`
            : undefined,
        data: item,
      })),
    );
  }

  // ==========================================
  // Deep Links & Public API
  // ==========================================

  private handleTodoDeepLink(): void {
    this.activatedRoute.fragment.subscribe((fragment) => {
      if (!fragment || !this._editor) return;
      setTimeout(() => {
        if (fragment.startsWith('todo-')) {
          const todoId = fragment.replace('todo-', '');
          (this._editor?.commands as any).scrollToTodo(todoId);
        }
      }, 300);
    });
  }

  focus(): void {
    this._editor?.commands.focus();
  }
  getEditor(): Editor | null {
    return this._editor;
  }
  toggleFullWidth(): void {
    this.isFullWidth.update((v) => !v);
  }

  onEditorWrapperClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('editor-wrapper')) {
      this._editor?.commands.focus('end');
    }
  }

  exportAsHtml(title?: string): void {
    if (!this._editor) return;
    const html = this._editor.getHTML();
    downloadFile(html, sanitizeFilename(title || 'note') + '.html', 'text/html', this.nativeBridge);
  }
}
