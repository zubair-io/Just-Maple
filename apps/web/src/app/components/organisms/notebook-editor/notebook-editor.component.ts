import {
  Component,
  input,
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
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import { marked } from 'marked';
import { MemoDocumentService } from '../../../services/memo-document.service';
import { PageService } from '../../../services/page.service';
import { AuthService } from '../../../services/auth.service';
import { TodoSyncService } from '../../../services/todo-sync.service';
import { MemoImageService } from '../../../services/memo-image.service';
import { SlashCommandMenuComponent } from '../../molecules/slash-command-menu/slash-command-menu.component';
import DragHandle from '@tiptap/extension-drag-handle';
import { proseMirrorToMarkdown, proseMirrorToHtmlDocument, type PageContent } from '@maple/shared';

// Doc page prefix for virtual documentation pages
const DOC_PAGE_PREFIX = 'doc-';
import {
  CustomDocument,
  EmojiReplacer,
  SlashCommands,
  defaultSlashCommands,
  filterCommands,
  getTableExtensions,
  TableOfContents,
  RecordingNode,
  EmbedNode,
  EnhancedTaskItem,
  EnhancedTaskList,
  AiBotWidget,
  ImageNode,
  Agenda,
  InlineMention,
  CodeBlockWithLanguage,
  PageLink,
  PageLinkBlock,
  HashTag,
  formatTime,
  formatDate,
  type SlashCommandItem,
  type InlineMentionSuggestion,
  type MentionableUser,
  type PageLinkSuggestion,
  type HashTagSuggestion,
} from './extensions';
import { PageLinkSearchComponent } from '../../molecules/page-link-search/page-link-search.component';
import { Router } from '@angular/router';
import { BotService } from '../../../services/bot.service';
import { NotebookService } from '../../../services/notebook.service';
import { RecordingBlockComponent } from '../../molecules/recording-block/recording-block.component';
import { PaperEmbedComponent } from '../../molecules/paper-embed/paper-embed.component';
import { EditorToolbarComponent } from '../../molecules/editor-toolbar/editor-toolbar.component';
import { AiBotWidgetComponent } from '../../molecules/ai-bot-widget/ai-bot-widget.component';
import { AIPreviewPanelComponent } from '../../molecules/ai-preview-panel/ai-preview-panel.component';
import { AICommandMenuComponent } from '../../molecules/ai-command-menu/ai-command-menu.component';
import { AIWritingService } from '../../../services/ai-writing.service';
import { TagService } from '../../../services/tag.service';
import type { AIWritingType } from '@maple/shared';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

@Component({
  selector: 'app-notebook-editor',
  standalone: true,
  imports: [CommonModule, EditorToolbarComponent, PageLinkSearchComponent],
  templateUrl: './notebook-editor.component.html',
  styleUrl: './notebook-editor.component.scss',
  // encapsulation: ViewEncapsulation.None,
})
export class NotebookEditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  @ViewChild('editorWrapper', { static: false })
  private editorWrapperRef?: ElementRef<HTMLElement>;

  private readonly memoService = inject(MemoDocumentService);
  private readonly pageService = inject(PageService);
  private readonly authService = inject(AuthService);
  private readonly todoSyncService = inject(TodoSyncService);
  private readonly botService = inject(BotService);
  private readonly notebookService = inject(NotebookService);
  private readonly http = inject(HttpClient);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly memoImageService = inject(MemoImageService);
  private readonly aiWritingService = inject(AIWritingService);
  private readonly tagService = inject(TagService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly router = inject(Router);

  readonly pageId = input.required<string>();
  readonly notebookId = input.required<string>();
  readonly editable = input<boolean>(true);

  readonly isReady = signal(false);
  readonly isFocused = signal(false);
  readonly error = signal<string | null>(null);
  readonly isFullWidth = signal(false);
  readonly hasClaudeBot = signal(false);
  readonly mentionableUsers = signal<MentionableUser[]>([]);

  // Page link search state
  readonly pageLinkSearchOpen = signal(false);
  readonly pageLinkSearchMode = signal<'inline' | 'block'>('inline');

  private _editor: Editor | null = null;
  private ydoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private readonly viewReady = signal(false);
  private lastPageId: string | null = null;
  private titleUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedTitle: string = '';
  private isInitialSync = true;
  private slashMenuElement: HTMLElement | null = null;
  private slashMenuComponent: SlashCommandMenuComponent | null = null;
  private recordingComponents = new Map<string, { componentRef: any; element: HTMLElement }>();
  private embedComponents = new Map<string, { componentRef: any; element: HTMLElement }>();
  private aiBotWidgetComponents = new Map<
    string,
    { componentRef: any; element: HTMLElement; editor: Editor; getPos: () => number | undefined }
  >();

  // Event listener cleanup - store bound handlers for removal
  private pageLinkListeners: { event: string; handler: EventListener }[] = [];

  // AI Writing Assistant state
  private aiPreviewComponent: { componentRef: any; element: HTMLElement } | null = null;
  private aiCommandMenuComponent: { componentRef: any; element: HTMLElement } | null = null;
  private pendingAICommand: {
    type: AIWritingType;
    selection: string;
    context: string;
    instruction?: string;
    targetLanguage?: string;
    insertPosition: number;
  } | null = null;

  constructor() {
    // Initialize editor after view is ready
    afterNextRender(() => {
      this.viewReady.set(true);
    });

    // Initialize when pageId changes
    effect(() => {
      const currentPageId = this.pageId();
      if (!this.viewReady() || !currentPageId) {
        return;
      }

      if (currentPageId !== this.lastPageId) {
        this.lastPageId = currentPageId;
        this.initializeEditor(currentPageId);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private async initializeEditor(pageId: string): Promise<void> {
    this.cleanup();
    this.isReady.set(false);
    this.error.set(null);

    // Check if this is a doc page (virtual documentation page)
    const isDocPageView = pageId.startsWith(DOC_PAGE_PREFIX);

    try {
      // Open document via service (handles offline-first loading)
      const { ydoc, awareness, markdownContent, initialContent } =
        await this.memoService.openDocument(pageId);
      this.ydoc = ydoc;
      this.awareness = awareness;

      // Wait for editor element
      if (!this.editorRef?.nativeElement) {
        return;
      }

      // Get user info for collaboration cursor
      const userInfo = (awareness.getLocalState() as any)?.user || {
        name: 'Anonymous',
        color: '#888888',
      };

      // Create TipTap editor with YJS collaboration and Notion-like features
      this._editor = new Editor({
        element: this.editorRef.nativeElement,
        extensions: [
          // Custom document that enforces heading first
          CustomDocument,
          // StarterKit without document (we use CustomDocument), undoRedo (Collaboration has its own), and codeBlock (we use CodeBlockWithLanguage)
          StarterKit.configure({
            document: false,
            undoRedo: false,
            codeBlock: false,
          } as any),
          // Code block with syntax highlighting and language selector
          CodeBlockWithLanguage,
          // Placeholder with different text for headings
          // Placeholder.configure({
          //   placeholder: ({ node }) => {
          //     if (node.type.name === 'heading') {
          //       return 'Note title';
          //     }
          //     return "Type '/' for commands...";
          //   },
          // }) as any,
          // YJS Collaboration
          Collaboration.configure({
            document: ydoc,
            field: 'prosemirror',
          }) as any,
          // Collaboration cursors (show other users)
          // Provider wrapper that forwards awareness events to CollaborationCursor
          CollaborationCursor.configure({
            provider: {
              awareness,
              doc: ydoc,
              on: (event: string, callback: (...args: any[]) => void) => {
                if (event === 'awarenessUpdate') {
                  awareness.on('update', callback);
                }
              },
              off: (event: string, callback: (...args: any[]) => void) => {
                if (event === 'awarenessUpdate') {
                  awareness.off('update', callback);
                }
              },
            },
            user: userInfo,
          }),
          // Emoji replacer (e.g., :) -> emoji)
          EmojiReplacer,
          // Task lists with enhanced attributes (id, name, showCompleted, dueDate, priority, color)
          EnhancedTaskList,
          EnhancedTaskItem.configure({
            nested: true,
          }),
          // Table support
          ...getTableExtensions(),
          // Table of Contents
          TableOfContents,
          // Recording node (legacy - for backward compatibility)
          RecordingNode,
          // Generic embed node (new system)
          EmbedNode,
          // AI Bot Widget for inline AI assistance
          AiBotWidget,
          // Image node with size options
          ImageNode,
          // Agenda node for date-based content organization
          Agenda,
          // Inline mentions (@time, @date, @user)
          InlineMention.configure({
            getUsers: () => this.mentionableUsers(),
            suggestion: {
              render: () => this.createInlineMentionRenderer(),
            },
          }),
          // Page links ([[Page Name]] style)
          PageLink.configure({
            searchPages: (query: string) => this.searchPagesForLink(query),
            onLinkClick: (pageId: string) => this.navigateToPage(pageId),
            getPageTitle$: (pageId: string) => this.pageService.getPageTitle$(pageId),
            suggestion: {
              render: () => this.createPageLinkSuggestionRenderer(),
            },
          }),
          // Page link blocks (embed-style)
          PageLinkBlock.configure({
            onLinkClick: (pageId: string) => this.navigateToPage(pageId),
            getPageTitle$: (pageId: string) => this.pageService.getPageTitle$(pageId),
          }),
          // Hashtags for page organization
          HashTag.configure({
            getTags: () =>
              this.tagService.tags().map((t) => ({ name: t.name, count: t.count, color: t.color })),
            getTagColor: (tag: string) => this.tagService.getTagColor(tag),
            onTagClick: (tag: string) => this.navigateToTag(tag),
            suggestion: {
              render: () => this.createHashTagSuggestionRenderer(),
            },
          }),
          // Drag handles for blocks
          DragHandle.configure({
            render: () => {
              const handle = document.createElement('div');
              handle.classList.add('drag-handle');
              handle.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <circle cx="4" cy="3" r="1.5"/>
                  <circle cx="10" cy="3" r="1.5"/>
                  <circle cx="4" cy="7" r="1.5"/>
                  <circle cx="10" cy="7" r="1.5"/>
                  <circle cx="4" cy="11" r="1.5"/>
                  <circle cx="10" cy="11" r="1.5"/>
                </svg>
              `;
              return handle;
            },
          }),
          // Slash commands
          SlashCommands.configure({
            suggestion: {
              items: ({ query }: { query: string }) => filterCommands(defaultSlashCommands, query),
              render: () => this.createSlashMenuRenderer(),
              command: ({
                editor,
                range,
                props,
              }: {
                editor: Editor;
                range: any;
                props: SlashCommandItem;
              }) => {
                props.command({ editor, range });
              },
            },
          }),
        ],
        // Doc pages are always read-only
        editable: isDocPageView ? false : this.editable(),
        onFocus: () => this.isFocused.set(true),
        onBlur: () => this.isFocused.set(false),
        onUpdate: ({ editor }) => this.handleContentUpdate(editor),
      });

      // For doc pages, set the markdown content as HTML
      if (isDocPageView && markdownContent) {
        const htmlContent = await marked.parse(markdownContent);
        // Use setTimeout to ensure the editor is fully initialized
        setTimeout(() => {
          this._editor?.commands.setContent(htmlContent);
        }, 0);
      }

      // For new memos with initial content (e.g., from templates), set the content
      // Check if Y.js document is empty and we have initial content
      if (!isDocPageView && this._editor) {
        const prosemirror = ydoc.getXmlFragment('prosemirror');
        if (prosemirror.length === 0) {
          // Y.js doc is empty - check for initial content from server or page store
          const pageData = this.pageService.getPageById(pageId);
          const contentToUse = initialContent || pageData?.content;
          if (contentToUse && contentToUse.content && contentToUse.content.length > 0) {
            // Has meaningful content (not just empty paragraph)
            const hasContent = contentToUse.content.some(
              (node: any) => node.type !== 'paragraph' || (node.content && node.content.length > 0),
            );
            if (hasContent) {
              setTimeout(() => {
                this._editor?.commands.setContent(contentToUse);
              }, 0);
            }
          }
        }
      }

      // Initialize lastSyncedTitle with the current title from the document
      this.lastSyncedTitle = this.extractFirstHeadingText(this._editor)?.trim() || '';

      // Mark initial sync as complete after a brief delay to avoid catching sync updates
      setTimeout(() => {
        this.isInitialSync = false;
      }, 500);

      // Set up recording block event listeners (legacy) - skip for doc pages
      if (!isDocPageView) {
        this.setupRecordingBlockListeners();

        // Set up embed event listeners (new system)
        this.setupEmbedListeners();

        // Set up AI bot widget event listeners
        this.setupAiBotWidgetListeners();

        // Set up agenda event listeners
        this.setupAgendaListeners();

        // Set up inline mention listeners
        this.setupInlineMentionListeners();

        // Set up AI writing assistant listeners
        this.setupAIWritingListeners();

        // Set up page link listeners
        this.setupPageLinkListeners();

        // Check for Claude bot availability
        this.checkClaudeBotAvailability();

        // Fetch notebook members for @mentions
        this.fetchNotebookMembers();
      }

      this.isReady.set(true);

      // Handle deep linking to todos via URL fragment
      this.handleTodoDeepLink();
    } catch {
      this.error.set('Failed to load memo');
    }
  }

  /**
   * Handle deep linking to a specific todo or agenda via URL fragment
   * Expects fragment format: #todo-{todoId} or #agenda-{agendaId}
   */
  private handleTodoDeepLink(): void {
    // Subscribe to fragment changes
    this.activatedRoute.fragment.subscribe((fragment) => {
      if (!fragment || !this._editor) return;

      // Wait a bit for the editor content to fully render
      setTimeout(() => {
        if (fragment.startsWith('todo-')) {
          const todoId = fragment.replace('todo-', '');
          (this._editor?.commands as any).scrollToTodo(todoId);
        } else if (fragment.startsWith('agenda-')) {
          const agendaId = fragment.replace('agenda-', '');
          (this._editor?.commands as any).scrollToAgenda(agendaId);
        }
      }, 300);
    });
  }

  /**
   * Set up listeners for recording block mount/unmount events
   */
  private setupRecordingBlockListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    // Listen for recording node mount events
    editorElement.addEventListener('recording-node-mounted', ((event: CustomEvent) => {
      const { recordingId, element, editor } = event.detail;
      this.mountRecordingComponent(recordingId, element);
    }) as EventListener);

    // Listen for recording node unmount events
    editorElement.addEventListener('recording-node-unmounted', ((event: CustomEvent) => {
      const { recordingId } = event.detail;
      this.unmountRecordingComponent(recordingId);
    }) as EventListener);
  }

  /**
   * Mount an Angular recording block component
   */
  private mountRecordingComponent(recordingId: string, element: HTMLElement): void {
    // Check if already mounted
    if (this.recordingComponents.has(recordingId)) {
      return;
    }

    // Create Angular component
    const componentRef = createComponent(RecordingBlockComponent, {
      environmentInjector: this.injector,
      hostElement: element,
    });

    // Set inputs
    componentRef.setInput('recordingId', recordingId);

    // Handle delete requests
    componentRef.instance.deleteRequested.subscribe((id: string) => {
      (this._editor?.chain().focus() as any).deleteRecording(id).run();
    });

    // Attach to app
    this.appRef.attachView(componentRef.hostView);

    // Track the component
    this.recordingComponents.set(recordingId, { componentRef, element });
  }

  /**
   * Unmount an Angular recording block component
   */
  private unmountRecordingComponent(recordingId: string): void {
    const component = this.recordingComponents.get(recordingId);
    if (!component) return;

    this.appRef.detachView(component.componentRef.hostView);
    component.componentRef.destroy();
    this.recordingComponents.delete(recordingId);
  }

  /**
   * Set up listeners for generic embed mount/unmount events
   */
  private setupEmbedListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    // Listen for embed node mount events
    editorElement.addEventListener('embed-node-mounted', ((event: CustomEvent) => {
      const { id, type, createdBy, element } = event.detail;
      console.log('[NotebookEditor] embed-node-mounted event:', { id, type, createdBy });
      this.mountEmbedComponent(id, type, createdBy, element);
    }) as EventListener);

    // Listen for embed node unmount events
    editorElement.addEventListener('embed-node-unmounted', ((event: CustomEvent) => {
      const { id } = event.detail;
      this.unmountEmbedComponent(id);
    }) as EventListener);

    // Listen for create-recording-embed event from slash command
    editorElement.addEventListener('create-recording-embed', ((event: CustomEvent) => {
      const range = event.detail?.range;
      this.createRecordingEmbed(range);
    }) as EventListener);

    // Listen for create-whiteboard-embed event from slash command
    editorElement.addEventListener('create-whiteboard-embed', ((event: CustomEvent) => {
      const range = event.detail?.range;
      this.createWhiteboardEmbed(range);
    }) as EventListener);

    // Listen for upload-image event from slash command
    editorElement.addEventListener('upload-image', ((event: CustomEvent) => {
      const range = event.detail?.range;
      this.handleImageUpload(range);
    }) as EventListener);
  }

  /**
   * Mount a PaperEmbedComponent for an embed node
   */
  private mountEmbedComponent(
    id: string,
    type: 'recording' | 'whiteboard' | 'memo',
    createdBy: string | null,
    element: HTMLElement,
  ): void {
    // Check if already mounted
    if (this.embedComponents.has(id)) {
      return;
    }

    // Create Angular component
    const componentRef = createComponent(PaperEmbedComponent, {
      environmentInjector: this.injector,
      hostElement: element,
    });

    // Set inputs - pass the parent memo's pageId for WebSocket broadcasting
    componentRef.setInput('embedId', id);
    componentRef.setInput('embedType', type);
    componentRef.setInput('createdBy', createdBy);
    componentRef.setInput('parentPageId', this.pageId());

    // Handle delete requests
    componentRef.instance.deleteRequested.subscribe((embedId: string) => {
      (this._editor?.chain().focus() as any).deleteEmbed(embedId).run();
    });

    // Attach to app
    this.appRef.attachView(componentRef.hostView);

    // Track the component
    this.embedComponents.set(id, { componentRef, element });
  }

  /**
   * Unmount a PaperEmbedComponent
   */
  private unmountEmbedComponent(id: string): void {
    const component = this.embedComponents.get(id);
    if (!component) return;

    this.appRef.detachView(component.componentRef.hostView);
    component.componentRef.destroy();
    this.embedComponents.delete(id);
  }

  /**
   * Create a recording embed: generate ID and insert embed node
   * The recording entity will be created when the user starts recording
   * @param range Optional range to delete before inserting (from slash command)
   */
  private createRecordingEmbed(range?: { from: number; to: number }): void {
    // Generate a unique recording ID
    const recordingId = crypto.randomUUID();

    // Get current user ID for ownership tracking
    const currentUserId = this.authService.user()?._id;
    if (!currentUserId) {
      console.error('[NotebookEditor] Cannot create recording: no user logged in');
      return;
    }

    // Delete range and insert embed atomically to prevent schema auto-fixes
    if (range) {
      (this._editor?.chain().focus().deleteRange(range) as any)
        .insertEmbed(recordingId, 'recording', currentUserId)
        .run();
    } else {
      (this._editor?.chain().focus() as any)
        .insertEmbed(recordingId, 'recording', currentUserId)
        .run();
    }
  }

  /**
   * Create a whiteboard embed: generate ID and insert embed node
   * The whiteboard document will be created when the component loads
   * @param range Optional range to delete before inserting (from slash command)
   */
  private createWhiteboardEmbed(range?: { from: number; to: number }): void {
    // Generate a unique whiteboard ID
    const whiteboardId = crypto.randomUUID();

    // Get current user ID for ownership tracking
    const currentUserId = this.authService.user()?._id;
    if (!currentUserId) {
      console.error('[NotebookEditor] Cannot create whiteboard: no user logged in');
      return;
    }

    // Delete range and insert embed atomically to prevent schema auto-fixes
    if (range) {
      (this._editor?.chain().focus().deleteRange(range) as any)
        .insertEmbed(whiteboardId, 'whiteboard', currentUserId)
        .run();
    } else {
      (this._editor?.chain().focus() as any)
        .insertEmbed(whiteboardId, 'whiteboard', currentUserId)
        .run();
    }
  }

  /**
   * Handle image upload from slash command
   * Opens file picker, uploads the image, and inserts it into the editor
   * Shows image immediately with loading state, then updates when upload completes
   * @param range Optional range to delete before inserting (from slash command)
   */
  private async handleImageUpload(range?: { from: number; to: number }): Promise<void> {
    const pageId = this.pageId();
    if (!pageId) {
      console.error('[NotebookEditor] Cannot upload image: no page ID');
      return;
    }

    // Delete the slash command range first
    if (range) {
      this._editor?.chain().focus().deleteRange(range).run();
    }

    // Open file picker
    const file = await this.memoImageService.selectImageFile();
    if (!file) {
      return; // User cancelled
    }

    // Create a local blob URL for preview
    const previewUrl = URL.createObjectURL(file);

    // Generate a temporary placeholder URL that will be replaced
    const tempId = crypto.randomUUID();
    const placeholderUrl = `placeholder://${tempId}`;

    // Create placeholder URLs object - will be replaced when upload completes
    const placeholderUrls = {
      original: placeholderUrl,
      small: placeholderUrl,
      medium: placeholderUrl,
      large: placeholderUrl,
      cover: placeholderUrl,
    };

    // Insert image immediately with loading state and preview
    (this._editor?.chain().focus() as any)
      .insertMemoImage({
        urls: placeholderUrls,
        size: 'medium',
        loading: true,
        previewUrl: previewUrl,
      })
      .run();

    // Upload the image in background
    this.memoImageService.uploadImage(pageId, file).subscribe({
      next: (result) => {
        // Update the image with real URLs and remove loading state
        (this._editor?.chain() as any)
          .updateMemoImage(placeholderUrl, {
            urls: result.urls,
            loading: false,
          })
          .run();

        // Clean up blob URL
        URL.revokeObjectURL(previewUrl);
      },
      error: (err) => {
        console.error('[NotebookEditor] Failed to upload image:', err);
        // Remove the failed image from editor
        (this._editor?.chain() as any).deleteMemoImage(placeholderUrl).run();
        // Clean up blob URL
        URL.revokeObjectURL(previewUrl);
      },
    });
  }

  /**
   * Set up listeners for AI bot widget mount/unmount events
   */
  private setupAiBotWidgetListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    // Listen for AI bot widget mount events
    editorElement.addEventListener('ai-bot-widget-mounted', ((event: CustomEvent) => {
      const { id, prompt, status, errorMessage, history, element, editor, getPos } = event.detail;
      this.mountAiBotWidgetComponent(
        id,
        prompt,
        status,
        errorMessage,
        history,
        element,
        editor,
        getPos,
      );
    }) as EventListener);

    // Listen for AI bot widget unmount events
    editorElement.addEventListener('ai-bot-widget-unmounted', ((event: CustomEvent) => {
      const { id } = event.detail;
      this.unmountAiBotWidgetComponent(id);
    }) as EventListener);

    // Listen for create-ai-bot-widget event from slash command
    editorElement.addEventListener('create-ai-bot-widget', ((event: CustomEvent) => {
      this.createAiBotWidget();
    }) as EventListener);
  }

  /**
   * Mount an AI bot widget Angular component
   */
  private mountAiBotWidgetComponent(
    id: string,
    prompt: string,
    status: string,
    errorMessage: string | null,
    history: unknown[],
    element: HTMLElement,
    editor: Editor,
    getPos: () => number | undefined,
  ): void {
    // Check if already mounted
    if (this.aiBotWidgetComponents.has(id)) {
      return;
    }

    // Create Angular component
    const componentRef = createComponent(AiBotWidgetComponent, {
      environmentInjector: this.injector,
      hostElement: element,
    });

    // Set inputs
    componentRef.setInput('widgetId', id);
    componentRef.setInput('editor', editor);
    componentRef.setInput('getPos', getPos);
    componentRef.setInput('notebookId', this.notebookId());
    componentRef.setInput('pageId', this.pageId());
    componentRef.setInput('initialPrompt', prompt || '');
    componentRef.setInput('initialStatus', status || 'idle');
    componentRef.setInput('initialHistory', history || []);

    // Handle delete requests
    componentRef.instance.deleteRequested.subscribe((widgetId: string) => {
      (this._editor?.commands as any).removeAiBotWidget(widgetId);
    });

    // Attach to app
    this.appRef.attachView(componentRef.hostView);

    // Track the component
    this.aiBotWidgetComponents.set(id, { componentRef, element, editor, getPos });
  }

  /**
   * Unmount an AI bot widget component
   */
  private unmountAiBotWidgetComponent(id: string): void {
    const component = this.aiBotWidgetComponents.get(id);
    if (!component) return;

    this.appRef.detachView(component.componentRef.hostView);
    component.componentRef.destroy();
    this.aiBotWidgetComponents.delete(id);
  }

  /**
   * Create an AI bot widget
   */
  private createAiBotWidget(): void {
    if (!this._editor) {
      console.error('[NotebookEditor] Cannot create AI bot widget: no editor');
      return;
    }

    // Insert the AI bot widget at the current position
    (this._editor.commands as any).insertAiBotWidget();
  }

  /**
   * Set up listeners for agenda events
   */
  private setupAgendaListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    // Listen for agenda date click events - show date picker
    editorElement.addEventListener('agenda-date-click', ((event: CustomEvent) => {
      const { agendaId, currentDate, position } = event.detail;
      this.showAgendaDatePicker(agendaId, currentDate, position);
    }) as EventListener);

    // Listen for agenda AI click events - generate summary
    editorElement.addEventListener('agenda-ai-click', ((event: CustomEvent) => {
      const { agendaId } = event.detail;
      this.generateAgendaSummary(agendaId);
    }) as EventListener);
  }

  /**
   * Show date picker for agenda
   */
  private showAgendaDatePicker(agendaId: string, currentDate: string, position: DOMRect): void {
    // Create a temporary date input to use native date picker
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = currentDate;
    dateInput.style.position = 'absolute';
    dateInput.style.left = `${position.left}px`;
    dateInput.style.top = `${position.bottom + 4}px`;
    dateInput.style.zIndex = '1000';
    dateInput.style.opacity = '0';
    dateInput.style.pointerEvents = 'none';
    document.body.appendChild(dateInput);

    dateInput.addEventListener('change', () => {
      const newDate = dateInput.value;
      if (newDate && this._editor) {
        (this._editor.commands as any).setAgendaDate(agendaId, newDate);
      }
      dateInput.remove();
    });

    dateInput.addEventListener('blur', () => {
      setTimeout(() => dateInput.remove(), 100);
    });

    // Open the date picker
    dateInput.showPicker?.();
    dateInput.focus();
    dateInput.click();
  }

  /**
   * Set up listeners for inline mention click events (to edit time/date)
   */
  private setupInlineMentionListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    editorElement.addEventListener('inline-mention-click', ((event: CustomEvent) => {
      const { type, value, pos, element } = event.detail;
      this.handleInlineMentionClick(type, value, pos, element);
    }) as EventListener);
  }

  /**
   * Handle click on inline mention to edit value
   */
  private handleInlineMentionClick(
    type: 'time' | 'date' | 'user',
    currentValue: string,
    pos: number,
    element: HTMLElement,
  ): void {
    if (!this._editor) return;

    if (type === 'time') {
      // Show time picker
      const timeInput = document.createElement('input');
      timeInput.type = 'time';
      timeInput.value = currentValue;
      const rect = element.getBoundingClientRect();
      timeInput.style.position = 'fixed';
      timeInput.style.left = `${rect.left}px`;
      timeInput.style.top = `${rect.bottom + 4}px`;
      timeInput.style.zIndex = '1000';
      document.body.appendChild(timeInput);

      timeInput.addEventListener('change', () => {
        const newTime = timeInput.value;
        if (newTime && this._editor) {
          const { tr } = this._editor.state;
          tr.setNodeMarkup(pos, undefined, {
            type: 'time',
            value: newTime,
          });
          this._editor.view.dispatch(tr);
        }
        timeInput.remove();
      });

      timeInput.addEventListener('blur', () => {
        setTimeout(() => timeInput.remove(), 100);
      });

      timeInput.showPicker?.();
      timeInput.focus();
    } else if (type === 'date') {
      // Show date picker
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.value = currentValue;
      const rect = element.getBoundingClientRect();
      dateInput.style.position = 'fixed';
      dateInput.style.left = `${rect.left}px`;
      dateInput.style.top = `${rect.bottom + 4}px`;
      dateInput.style.zIndex = '1000';
      document.body.appendChild(dateInput);

      dateInput.addEventListener('change', () => {
        const newDate = dateInput.value;
        if (newDate && this._editor) {
          const { tr } = this._editor.state;
          tr.setNodeMarkup(pos, undefined, {
            type: 'date',
            value: newDate,
          });
          this._editor.view.dispatch(tr);
        }
        dateInput.remove();
      });

      dateInput.addEventListener('blur', () => {
        setTimeout(() => dateInput.remove(), 100);
      });

      dateInput.showPicker?.();
      dateInput.focus();
    }
    // User mentions are not editable
  }

  /**
   * Create renderer for inline mention suggestions popup
   */
  private createInlineMentionRenderer() {
    let popup: HTMLElement | null = null;
    let currentProps: any = null;

    return {
      onStart: (props: any) => {
        currentProps = props;

        popup = document.createElement('div');
        popup.classList.add('inline-mention-popup');
        popup.style.position = 'absolute';
        popup.style.zIndex = '1000';
        document.body.appendChild(popup);

        this.renderInlineMentionMenu(popup, props.items, (item: InlineMentionSuggestion) => {
          if (currentProps) {
            currentProps.command(item);
          }
        });

        this.updatePopupPosition(popup, props.clientRect);
      },

      onUpdate: (props: any) => {
        currentProps = props;

        if (popup) {
          popup.innerHTML = '';
          this.renderInlineMentionMenu(popup, props.items, (item: InlineMentionSuggestion) => {
            if (currentProps) {
              currentProps.command(item);
            }
          });
          if (props.clientRect) {
            this.updatePopupPosition(popup, props.clientRect);
          }
        }
      },

      onKeyDown: (props: any) => {
        if (props.event.key === 'Escape') {
          popup?.remove();
          return true;
        }

        // Handle arrow keys and enter for menu navigation
        if (['ArrowUp', 'ArrowDown', 'Enter'].includes(props.event.key)) {
          const items = popup?.querySelectorAll('.inline-mention-item');
          if (!items?.length) return false;

          const active = popup?.querySelector('.inline-mention-item.active');
          let activeIndex = active ? Array.from(items).indexOf(active) : -1;

          if (props.event.key === 'ArrowDown') {
            activeIndex = (activeIndex + 1) % items.length;
          } else if (props.event.key === 'ArrowUp') {
            activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
          } else if (props.event.key === 'Enter' && active) {
            (active as HTMLElement).click();
            return true;
          }

          items.forEach((item, i) => {
            item.classList.toggle('active', i === activeIndex);
          });

          return true;
        }

        return false;
      },

      onExit: () => {
        popup?.remove();
        popup = null;
      },
    };
  }

  /**
   * Render inline mention menu items
   */
  private renderInlineMentionMenu(
    container: HTMLElement,
    items: InlineMentionSuggestion[],
    onSelect: (item: InlineMentionSuggestion) => void,
  ): void {
    items.forEach((item, index) => {
      const div = document.createElement('div');
      div.classList.add('inline-mention-item');
      if (index === 0) div.classList.add('active');

      // Show avatar for users, icon for time/date
      if (item.type === 'user' && item.avatarUrl) {
        const avatar = document.createElement('img');
        avatar.src = item.avatarUrl;
        avatar.alt = '';
        avatar.classList.add('inline-mention-item-avatar');
        div.appendChild(avatar);
      } else if (item.type === 'user') {
        // User without avatar - show person icon
        const icon = document.createElement('span');
        icon.classList.add('material-symbols-rounded');
        icon.textContent = 'person';
        div.appendChild(icon);
      } else {
        // Time/date - show icon
        const icon = document.createElement('span');
        icon.classList.add('material-symbols-rounded');
        icon.textContent = item.icon || '';
        div.appendChild(icon);
      }

      const content = document.createElement('div');
      content.classList.add('inline-mention-item-content');

      const label = document.createElement('span');
      label.classList.add('inline-mention-item-label');
      label.textContent = item.label;
      content.appendChild(label);

      const desc = document.createElement('span');
      desc.classList.add('inline-mention-item-desc');
      desc.textContent = item.description;
      content.appendChild(desc);

      div.appendChild(content);

      div.addEventListener('click', () => onSelect(item));
      div.addEventListener('mouseenter', () => {
        container
          .querySelectorAll('.inline-mention-item')
          .forEach((el) => el.classList.remove('active'));
        div.classList.add('active');
      });

      container.appendChild(div);
    });
  }

  /**
   * Set up listeners for AI writing assistant events
   */
  private setupAIWritingListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    // Listen for AI writing command events from slash commands
    editorElement.addEventListener('ai-writing-command', ((event: CustomEvent) => {
      const { type } = event.detail as { type: AIWritingType };
      this.handleAIWritingCommand(type);
    }) as EventListener);

    // Listen for keyboard shortcut (Cmd/Ctrl+J) to open AI menu
    editorElement.addEventListener('keydown', ((event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'j') {
        event.preventDefault();
        this.openAICommandMenu();
      }
    }) as EventListener);
  }

  /**
   * Handle an AI writing command
   */
  private handleAIWritingCommand(
    type: AIWritingType,
    instruction?: string,
    targetLanguage?: string,
  ): void {
    if (!this._editor) return;

    // Get selected text and context
    const { state } = this._editor;
    const { from, to, empty } = state.selection;
    const selectedText = empty ? '' : state.doc.textBetween(from, to, ' ');

    // Get surrounding context (up to 2000 chars before cursor)
    const contextEnd = from;
    const contextStart = Math.max(0, contextEnd - 2000);
    const context = state.doc.textBetween(contextStart, contextEnd, '\n', ' ');

    // Store the command info
    this.pendingAICommand = {
      type,
      selection: selectedText,
      context,
      instruction,
      targetLanguage,
      insertPosition: empty ? from : to,
    };

    // Show the AI preview panel
    this.showAIPreviewPanel();
  }

  /**
   * Open the AI command menu
   */
  private openAICommandMenu(): void {
    if (!this._editor || this.aiCommandMenuComponent) return;

    const { state, view } = this._editor;
    const { from, to, empty } = state.selection;

    // Get cursor position for menu placement
    const coords = view.coordsAtPos(from);

    // Create menu element
    const menuElement = document.createElement('div');
    menuElement.classList.add('ai-command-menu-container');
    document.body.appendChild(menuElement);

    // Create Angular component
    const componentRef = createComponent(AICommandMenuComponent, {
      environmentInjector: this.injector,
      hostElement: menuElement,
    });

    // Set inputs
    componentRef.setInput('position', { top: coords.bottom + 8, left: coords.left });
    componentRef.setInput('hasSelection', !empty);

    // Handle command selection
    componentRef.instance.commandSelected.subscribe(
      (cmd: { type: AIWritingType; instruction?: string; targetLanguage?: string }) => {
        this.closeAICommandMenu();
        this.handleAIWritingCommand(cmd.type, cmd.instruction, cmd.targetLanguage);
      },
    );

    // Handle close
    componentRef.instance.closed.subscribe(() => {
      this.closeAICommandMenu();
    });

    this.appRef.attachView(componentRef.hostView);
    this.aiCommandMenuComponent = { componentRef, element: menuElement };
  }

  /**
   * Close the AI command menu
   */
  private closeAICommandMenu(): void {
    if (!this.aiCommandMenuComponent) return;

    this.appRef.detachView(this.aiCommandMenuComponent.componentRef.hostView);
    this.aiCommandMenuComponent.componentRef.destroy();
    this.aiCommandMenuComponent.element.remove();
    this.aiCommandMenuComponent = null;
  }

  /**
   * Show the AI preview panel for streaming generation
   */
  private showAIPreviewPanel(): void {
    if (!this._editor || !this.pendingAICommand || this.aiPreviewComponent) return;

    const { view } = this._editor;
    const coords = view.coordsAtPos(this.pendingAICommand.insertPosition);

    // Create panel element
    const panelElement = document.createElement('div');
    panelElement.classList.add('ai-preview-panel-container');
    document.body.appendChild(panelElement);

    // Create Angular component
    const componentRef = createComponent(AIPreviewPanelComponent, {
      environmentInjector: this.injector,
      hostElement: panelElement,
    });

    // Set inputs
    componentRef.setInput('notebookId', this.notebookId());
    componentRef.setInput('position', { top: coords.bottom + 8, left: coords.left });
    componentRef.setInput('actionType', this.pendingAICommand.type);
    componentRef.setInput('selection', this.pendingAICommand.selection);
    componentRef.setInput('context', this.pendingAICommand.context);
    componentRef.setInput('instruction', this.pendingAICommand.instruction || '');
    componentRef.setInput('targetLanguage', this.pendingAICommand.targetLanguage || '');

    // Handle accept
    componentRef.instance.accepted.subscribe((text: string) => {
      this.insertAIGeneratedText(text);
      this.closeAIPreviewPanel();
    });

    // Handle reject/close
    componentRef.instance.rejected.subscribe(() => {
      this.closeAIPreviewPanel();
    });

    componentRef.instance.closed.subscribe(() => {
      this.closeAIPreviewPanel();
    });

    this.appRef.attachView(componentRef.hostView);
    this.aiPreviewComponent = { componentRef, element: panelElement };
  }

  /**
   * Close the AI preview panel
   */
  private closeAIPreviewPanel(): void {
    if (!this.aiPreviewComponent) return;

    this.appRef.detachView(this.aiPreviewComponent.componentRef.hostView);
    this.aiPreviewComponent.componentRef.destroy();
    this.aiPreviewComponent.element.remove();
    this.aiPreviewComponent = null;
    this.pendingAICommand = null;
  }

  /**
   * Insert AI-generated text into the editor
   */
  private insertAIGeneratedText(text: string): void {
    if (!this._editor || !this.pendingAICommand) return;

    const { type, selection, insertPosition } = this.pendingAICommand;
    const { state } = this._editor;
    const { from, to, empty } = state.selection;

    if (type === 'continue' || type === 'summarize' || type === 'custom') {
      // Insert at cursor position
      this._editor.chain().focus().insertContentAt(insertPosition, text).run();
    } else if (selection && !empty) {
      // Replace selected text
      this._editor.chain().focus().deleteSelection().insertContent(text).run();
    } else {
      // Insert at cursor
      this._editor.chain().focus().insertContent(text).run();
    }
  }

  /**
   * Check if Claude bot is available for the current notebook
   */
  private checkClaudeBotAvailability(): void {
    const notebookId = this.notebookId();
    if (!notebookId) return;

    this.botService.getNotebookBots(notebookId).subscribe((bots) => {
      const hasClaudeBot = bots.some(
        (bot) => bot.handle.toLowerCase() === 'claude' || bot.handle.toLowerCase() === 'ai',
      );
      this.hasClaudeBot.set(hasClaudeBot);

      // Update existing agenda nodes to show/hide AI button
      this.updateAgendaAiButtons(hasClaudeBot);
    });
  }

  /**
   * Fetch notebook members for @mentions
   */
  private fetchNotebookMembers(): void {
    const notebookId = this.notebookId();
    if (!notebookId) return;

    this.notebookService.fetchNotebookMembers(notebookId).subscribe((members) => {
      const users: MentionableUser[] = members.map((member) => ({
        id: member.userId,
        displayName: member.displayName || member.email.split('@')[0],
        avatarUrl: member.profilePictureUrl,
      }));
      this.mentionableUsers.set(users);
      // The getUsers() getter in InlineMention will automatically read from the signal
    });
  }

  /**
   * Update AI button visibility on all agenda nodes
   */
  private updateAgendaAiButtons(show: boolean): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    const agendaNodes = editorElement.querySelectorAll('[data-type="agenda"]');
    agendaNodes.forEach((node) => {
      const aiButton = node.querySelector('.agenda-ai-btn') as HTMLElement;
      if (aiButton) {
        aiButton.style.display = show ? '' : 'none';
      }
    });
  }

  /**
   * Generate AI summary for agenda content
   */
  private async generateAgendaSummary(agendaId: string): Promise<void> {
    if (!this._editor || !this.hasClaudeBot()) return;

    // Find the agenda node and extract its content
    const { doc } = this._editor.state;
    let agendaContent = '';

    // Helper to extract text with proper inline mention rendering
    const extractNodeText = (node: any): string => {
      if (node.type.name === 'inlineMention') {
        const type = node.attrs['type'];
        const value = node.attrs['value'];
        if (type === 'time') {
          return formatTime(value);
        } else if (type === 'date') {
          return formatDate(value);
        } else if (type === 'user') {
          return node.attrs['displayName'] || 'User';
        }
        return '';
      }

      if (node.isText) {
        return node.text || '';
      }

      // Recursively extract from children
      let text = '';
      node.content?.forEach((child: any) => {
        text += extractNodeText(child);
      });

      // Add newline for block nodes
      if (node.isBlock && text) {
        text += '\n';
      }

      return text;
    };

    doc.descendants((node) => {
      if (node.type.name === 'agenda' && node.attrs['id'] === agendaId) {
        // Extract text content from the agenda with proper inline mention rendering
        node.content.forEach((child) => {
          agendaContent += extractNodeText(child);
        });
        return false;
      }
      return true;
    });

    if (!agendaContent.trim()) {
      console.log('[NotebookEditor] No content to summarize for agenda:', agendaId);
      return;
    }

    try {
      // Call AI service to generate summary
      const response = await firstValueFrom(
        this.http.post<{ summary?: string; response?: string }>(
          `/api/notebooks/${this.notebookId()}/ai-summarize`,
          {
            content: agendaContent,
            type: 'agenda',
            maxLength: 100,
          },
        ),
      );

      const summary = response.summary || response.response;
      if (summary) {
        // Truncate to 256 characters as per spec
        const truncatedSummary = summary.slice(0, 256);
        (this._editor.commands as any).setAgendaSummary(agendaId, truncatedSummary);
      }
    } catch (error) {
      console.error('[NotebookEditor] Failed to generate agenda summary:', error);
      // Fallback to simple first line extraction
      const fallbackSummary = agendaContent.trim().split('\n')[0].slice(0, 100);
      (this._editor?.commands as any).setAgendaSummary(agendaId, fallbackSummary);
    }
  }

  /**
   * Handle editor content updates - extract first heading and sync as title
   */
  private handleContentUpdate(editor: Editor): void {
    console.log('[NotebookEditor] Content updated', this.lastSyncedTitle);
    // Skip during initial sync to avoid unnecessary updates

    const title = this.extractFirstHeadingText(editor)?.trim();

    if (!this.lastSyncedTitle) {
      this.lastSyncedTitle = title || '';
      return;
    }

    // Only update if title changed and not empty
    if (title && title !== this.lastSyncedTitle) {
      // Clear existing timeout
      if (this.titleUpdateTimeout) {
        clearTimeout(this.titleUpdateTimeout);
      }

      // Debounce title updates (500ms)
      this.titleUpdateTimeout = setTimeout(() => {
        this.lastSyncedTitle = title;
        const pageId = this.pageId();
        this.pageService.updatePage(pageId, { title }).subscribe();
      }, 500);
    }

    // Sync todo metadata (debounced internally by TodoSyncService)
    const pageId = this.pageId();
    this.todoSyncService.syncTodoMeta(pageId, editor);
  }

  /**
   * Extract text from the first heading in the document
   */
  private extractFirstHeadingText(editor: Editor): string | null {
    const doc = editor.state.doc;
    let headingText: string | null = null;

    // Find the first heading node
    doc.descendants((node, pos) => {
      if (headingText !== null) return false; // Stop if found

      if (node.type.name === 'heading') {
        headingText = node.textContent.trim();
        return false; // Stop traversal
      }

      return true; // Continue
    });

    return headingText;
  }

  /**
   * Create the slash command menu renderer for TipTap suggestion
   */
  private createSlashMenuRenderer() {
    let popup: HTMLElement | null = null;
    let menuComponent: SlashCommandMenuComponent | null = null;
    let componentRef: any = null;
    let currentProps: any = null; // Track current props for command execution

    return {
      onStart: (props: any) => {
        currentProps = props; // Store initial props

        // Create popup element
        popup = document.createElement('div');
        popup.classList.add('slash-menu-popup');
        popup.style.position = 'absolute';
        popup.style.zIndex = '1000';
        document.body.appendChild(popup);

        // Create Angular component dynamically
        componentRef = createComponent(SlashCommandMenuComponent, {
          environmentInjector: this.injector,
          hostElement: popup,
        });

        menuComponent = componentRef.instance;
        menuComponent!.items.set(props.items);
        menuComponent!.query.set(props.query);

        // Handle command selection - use currentProps to get the latest range
        componentRef.instance.commandSelected.subscribe((item: SlashCommandItem) => {
          if (currentProps) {
            currentProps.command(item);
          }
        });

        this.appRef.attachView(componentRef.hostView);

        // Position the popup
        this.updatePopupPosition(popup, props.clientRect);
      },

      onUpdate: (props: any) => {
        currentProps = props; // Update props with latest range

        if (menuComponent) {
          menuComponent.items.set(props.items);
          menuComponent.query.set(props.query);
        }
        if (popup && props.clientRect) {
          this.updatePopupPosition(popup, props.clientRect);
        }
      },

      onKeyDown: (props: any) => {
        if (!menuComponent) return false;

        if (props.event.key === 'ArrowUp') {
          menuComponent.navigateUp();
          return true;
        }

        if (props.event.key === 'ArrowDown') {
          menuComponent.navigateDown();
          return true;
        }

        if (props.event.key === 'Enter') {
          menuComponent.selectCurrent();
          return true;
        }

        return false;
      },

      onExit: () => {
        if (componentRef) {
          this.appRef.detachView(componentRef.hostView);
          componentRef.destroy();
        }
        if (popup) {
          popup.remove();
          popup = null;
        }
        menuComponent = null;
      },
    };
  }

  /**
   * Position the slash menu popup near the cursor
   */
  private updatePopupPosition(popup: HTMLElement, clientRect: (() => DOMRect | null) | null): void {
    if (!clientRect) return;

    const rect = typeof clientRect === 'function' ? clientRect() : clientRect;
    if (!rect) return;

    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 8}px`;
  }

  private cleanup(): void {
    if (this.titleUpdateTimeout) {
      clearTimeout(this.titleUpdateTimeout);
      this.titleUpdateTimeout = null;
    }

    // Clear any pending todo sync
    if (this.lastPageId) {
      this.todoSyncService.clearPendingSync(this.lastPageId);
    }

    // Clean up recording components (legacy)
    this.recordingComponents.forEach((component) => {
      this.appRef.detachView(component.componentRef.hostView);
      component.componentRef.destroy();
    });
    this.recordingComponents.clear();

    // Clean up embed components (new system)
    this.embedComponents.forEach((component) => {
      this.appRef.detachView(component.componentRef.hostView);
      component.componentRef.destroy();
    });
    this.embedComponents.clear();

    // Clean up AI bot widget components
    this.aiBotWidgetComponents.forEach((component) => {
      this.appRef.detachView(component.componentRef.hostView);
      component.componentRef.destroy();
    });
    this.aiBotWidgetComponents.clear();

    // Clean up AI writing assistant components
    this.closeAIPreviewPanel();
    this.closeAICommandMenu();

    // Clean up page link listeners
    this.cleanupPageLinkListeners();

    if (this._editor) {
      this._editor.destroy();
      this._editor = null;
    }

    if (this.lastPageId) {
      this.memoService.closeDocument(this.lastPageId);
    }

    this.ydoc = null;
    this.awareness = null;
    this.isReady.set(false);
    this.lastSyncedTitle = '';
    this.isInitialSync = true;
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

  /**
   * Handle click on the editor wrapper to focus
   */
  onEditorWrapperClick(event: MouseEvent): void {
    // Only focus if clicking directly on the wrapper (not on editor content)
    const target = event.target as HTMLElement;
    if (
      target.classList.contains('editor-wrapper') ||
      target.classList.contains('editor-content')
    ) {
      this._editor?.commands.focus('end');
    }
  }

  /**
   * Export the memo content as Markdown
   */
  exportAsMarkdown(title?: string): void {
    if (!this._editor) return;

    const content = this._editor.getJSON() as PageContent;
    const markdown = proseMirrorToMarkdown(content);
    const filename = this.sanitizeFilename(title || 'memo') + '.md';

    this.downloadFile(markdown, filename, 'text/markdown');
  }

  /**
   * Export the memo content as HTML
   */
  exportAsHtml(title?: string): void {
    if (!this._editor) return;

    const content = this._editor.getJSON() as PageContent;
    const html = proseMirrorToHtmlDocument(content, title);
    const filename = this.sanitizeFilename(title || 'memo') + '.html';

    this.downloadFile(html, filename, 'text/html');
  }

  /**
   * Download content as a file
   */
  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  /**
   * Sanitize a string for use as a filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  // ==========================================
  // Page Link Methods
  // ==========================================

  /**
   * Set up event listeners for page link interactions
   */
  private setupPageLinkListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    // Clean up any existing listeners first
    this.cleanupPageLinkListeners();

    // Helper to add listener and track for cleanup
    const addListener = (event: string, handler: EventListener) => {
      editorElement.addEventListener(event, handler);
      this.pageLinkListeners.push({ event, handler });
    };

    // Listen for slash command to open page link search
    addListener('open-page-link-search', ((event: CustomEvent) => {
      event.stopPropagation();
      const { mode } = event.detail;
      this.pageLinkSearchMode.set(mode || 'inline');
      this.pageLinkSearchOpen.set(true);
    }) as EventListener);

    // Listen for page link clicks
    addListener('page-link-click', ((event: CustomEvent) => {
      event.stopPropagation();
      const { pageId } = event.detail;
      this.navigateToPage(pageId);
    }) as EventListener);

    // Listen for page link block clicks
    addListener('page-link-block-click', ((event: CustomEvent) => {
      event.stopPropagation();
      const { pageId } = event.detail;
      this.navigateToPage(pageId);
    }) as EventListener);

    // Listen for create new page and link command
    addListener('create-new-page-link', ((event: CustomEvent) => {
      event.stopPropagation();
      this.createNewPageAndLink();
    }) as EventListener);
  }

  /**
   * Clean up page link event listeners
   */
  private cleanupPageLinkListeners(): void {
    const editorElement = this.editorRef?.nativeElement;
    if (!editorElement) return;

    for (const { event, handler } of this.pageLinkListeners) {
      editorElement.removeEventListener(event, handler);
    }
    this.pageLinkListeners = [];
  }

  /**
   * Create a new page and insert a link to it
   * Used by the /new page slash command
   */
  private async createNewPageAndLink(): Promise<void> {
    if (!this._editor) return;

    try {
      const notebookId = this.notebookId();
      const title = 'Untitled';

      // Create new page
      const response = await firstValueFrom(
        this.http.post<{ page: { id: string; title: string } }>('/api/pages', {
          title,
          notebookId,
          type: 'memo',
        }),
      );

      if (response.page) {
        // Insert inline link to the new page
        this._editor
          .chain()
          .focus()
          .insertPageLink({ pageId: response.page.id, title: response.page.title })
          .run();

        // Navigate to the new page after a short delay
        setTimeout(() => {
          this.navigateToPage(response.page.id);
        }, 100);
      }
    } catch (error) {
      console.error('[NotebookEditor] Failed to create new page:', error);
    }
  }

  /**
   * Search pages for linking autocomplete
   */
  async searchPagesForLink(query: string): Promise<PageLinkSuggestion[]> {
    if (!query || query.length < 1) {
      return [];
    }

    try {
      const params: Record<string, string> = {
        q: query,
        limit: '8',
        excludePageId: this.pageId(),
      };

      const notebookId = this.notebookId();
      if (notebookId) {
        params['notebookId'] = notebookId;
      }

      const response = await firstValueFrom(
        this.http.get<{ pages: PageLinkSuggestion[] }>('/api/links/search', { params }),
      );

      return response.pages || [];
    } catch (error) {
      console.error('[NotebookEditor] Page search failed:', error);
      return [];
    }
  }

  /**
   * Navigate to a linked page
   */
  navigateToPage(pageId: string): void {
    const notebookId = this.notebookId();
    this.router.navigate(['/', notebookId, pageId]);
  }

  /**
   * Handle page link selection from search modal
   */
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

  /**
   * Handle creating a new page from link search
   */
  async onPageLinkCreateNew(event: { title: string; mode: 'inline' | 'block' }): Promise<void> {
    if (!this._editor) return;

    try {
      // Create new page
      const notebookId = this.notebookId();
      const response = await firstValueFrom(
        this.http.post<{ page: { id: string; title: string } }>('/api/pages', {
          title: event.title,
          notebookId,
          type: 'memo',
        }),
      );

      if (response.page) {
        // Insert link to new page
        if (event.mode === 'inline') {
          this._editor
            .chain()
            .focus()
            .insertPageLink({ pageId: response.page.id, title: response.page.title })
            .run();
        } else {
          this._editor
            .chain()
            .focus()
            .insertPageLinkBlock({ pageId: response.page.id, title: response.page.title })
            .run();
        }
      }
    } catch (error) {
      console.error('[NotebookEditor] Failed to create page:', error);
    }
  }

  /**
   * Close the page link search modal
   */
  closePageLinkSearch(): void {
    this.pageLinkSearchOpen.set(false);
  }

  /**
   * Create renderer for page link suggestions popup
   */
  private createPageLinkSuggestionRenderer() {
    let popup: HTMLElement | null = null;
    let currentProps: any = null;

    return {
      onStart: (props: any) => {
        currentProps = props;

        popup = document.createElement('div');
        popup.classList.add('page-link-suggestion-popup');
        popup.style.position = 'absolute';
        popup.style.zIndex = '1000';
        document.body.appendChild(popup);

        this.renderPageLinkMenu(popup, props.items, (item: PageLinkSuggestion) => {
          if (currentProps) {
            currentProps.command(item);
          }
        });

        this.updatePopupPosition(popup, props.clientRect);
      },

      onUpdate: (props: any) => {
        currentProps = props;

        if (popup) {
          popup.innerHTML = '';
          this.renderPageLinkMenu(popup, props.items, (item: PageLinkSuggestion) => {
            if (currentProps) {
              currentProps.command(item);
            }
          });
          if (props.clientRect) {
            this.updatePopupPosition(popup, props.clientRect);
          }
        }
      },

      onKeyDown: (props: any) => {
        if (props.event.key === 'Escape') {
          popup?.remove();
          return true;
        }

        // Handle arrow keys and enter for menu navigation
        if (['ArrowUp', 'ArrowDown', 'Enter'].includes(props.event.key)) {
          const items = popup?.querySelectorAll('.page-link-item');
          if (!items?.length) return false;

          const active = popup?.querySelector('.page-link-item.active');
          let activeIndex = active ? Array.from(items).indexOf(active) : -1;

          if (props.event.key === 'ArrowDown') {
            activeIndex = (activeIndex + 1) % items.length;
          } else if (props.event.key === 'ArrowUp') {
            activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
          } else if (props.event.key === 'Enter' && active) {
            (active as HTMLElement).click();
            return true;
          }

          items.forEach((item, i) => {
            item.classList.toggle('active', i === activeIndex);
          });

          return true;
        }

        return false;
      },

      onExit: () => {
        popup?.remove();
        popup = null;
      },
    };
  }

  /**
   * Render page link suggestion menu items
   */
  private renderPageLinkMenu(
    popup: HTMLElement,
    items: PageLinkSuggestion[],
    onSelect: (item: PageLinkSuggestion) => void,
  ): void {
    if (items.length === 0) {
      popup.innerHTML = '<div class="page-link-empty">No pages found</div>';
      return;
    }

    items.forEach((item, index) => {
      const div = document.createElement('div');
      div.classList.add('page-link-item');
      if (index === 0) div.classList.add('active');

      const icon = document.createElement('span');
      icon.classList.add('page-link-item-icon');
      icon.textContent = item.type === 'memo' ? '📝' : item.type === 'whiteboard' ? '🎨' : '📄';

      const title = document.createElement('span');
      title.classList.add('page-link-item-title');
      title.textContent = item.title;

      div.appendChild(icon);
      div.appendChild(title);

      if (item.notebookName) {
        const notebook = document.createElement('span');
        notebook.classList.add('page-link-item-notebook');
        notebook.textContent = item.notebookName;
        div.appendChild(notebook);
      }

      div.addEventListener('click', () => onSelect(item));
      div.addEventListener('mouseenter', () => {
        popup.querySelectorAll('.page-link-item').forEach((el) => el.classList.remove('active'));
        div.classList.add('active');
      });

      popup.appendChild(div);
    });
  }

  // ==========================================
  // HashTag Methods
  // ==========================================

  /**
   * Navigate to a tag view (filter pages by tag)
   */
  navigateToTag(tag: string): void {
    const notebookId = this.notebookId();
    // Navigate to notebook with tag filter query param
    this.router.navigate(['/', notebookId], { queryParams: { tag } });
  }

  /**
   * Create renderer for hashtag suggestions popup
   */
  private createHashTagSuggestionRenderer() {
    let popup: HTMLElement | null = null;
    let currentProps: any = null;

    return {
      onStart: (props: any) => {
        currentProps = props;

        popup = document.createElement('div');
        popup.classList.add('hashtag-suggestion-popup');
        popup.style.position = 'absolute';
        popup.style.zIndex = '1000';
        document.body.appendChild(popup);

        this.renderHashTagMenu(popup, props.items, (item: HashTagSuggestion) => {
          if (currentProps) {
            currentProps.command(item);
          }
        });

        this.updatePopupPosition(popup, props.clientRect);
      },

      onUpdate: (props: any) => {
        currentProps = props;

        if (popup) {
          popup.innerHTML = '';
          this.renderHashTagMenu(popup, props.items, (item: HashTagSuggestion) => {
            if (currentProps) {
              currentProps.command(item);
            }
          });
          if (props.clientRect) {
            this.updatePopupPosition(popup, props.clientRect);
          }
        }
      },

      onKeyDown: (props: any) => {
        if (props.event.key === 'Escape') {
          popup?.remove();
          return true;
        }

        // Handle arrow keys and enter for menu navigation
        if (['ArrowUp', 'ArrowDown', 'Enter'].includes(props.event.key)) {
          const items = popup?.querySelectorAll('.hashtag-item');
          if (!items?.length) return false;

          const active = popup?.querySelector('.hashtag-item.active');
          let activeIndex = active ? Array.from(items).indexOf(active) : -1;

          if (props.event.key === 'ArrowDown') {
            activeIndex = (activeIndex + 1) % items.length;
          } else if (props.event.key === 'ArrowUp') {
            activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
          } else if (props.event.key === 'Enter' && active) {
            (active as HTMLElement).click();
            return true;
          }

          items.forEach((item, i) => {
            item.classList.toggle('active', i === activeIndex);
          });

          return true;
        }

        return false;
      },

      onExit: () => {
        popup?.remove();
        popup = null;
      },
    };
  }

  /**
   * Render hashtag suggestion menu items
   */
  private renderHashTagMenu(
    popup: HTMLElement,
    items: HashTagSuggestion[],
    onSelect: (item: HashTagSuggestion) => void,
  ): void {
    if (items.length === 0) {
      popup.innerHTML = '<div class="hashtag-empty">Type to create a new tag</div>';
      return;
    }

    items.forEach((item, index) => {
      const div = document.createElement('div');
      div.classList.add('hashtag-item');
      if (index === 0) div.classList.add('active');

      const tagIcon = document.createElement('span');
      tagIcon.classList.add('hashtag-item-icon');
      tagIcon.textContent = '#';

      const tagName = document.createElement('span');
      tagName.classList.add('hashtag-item-name');
      tagName.textContent = item.name;

      div.appendChild(tagIcon);
      div.appendChild(tagName);

      if (item.color) {
        const colorDot = document.createElement('span');
        colorDot.classList.add('hashtag-item-color');
        colorDot.style.backgroundColor = item.color;
        div.appendChild(colorDot);
      }

      if (item.count !== undefined) {
        const count = document.createElement('span');
        count.classList.add('hashtag-item-count');
        count.textContent = `${item.count}`;
        div.appendChild(count);
      }

      div.addEventListener('click', () => onSelect(item));
      div.addEventListener('mouseenter', () => {
        popup.querySelectorAll('.hashtag-item').forEach((el) => el.classList.remove('active'));
        div.classList.add('active');
      });

      popup.appendChild(div);
    });
  }
}
