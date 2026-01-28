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
import { ActivatedRoute } from '@angular/router';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import { marked } from 'marked';
import { MemoDocumentService } from '../../../services/memo-document.service';
import { PageService } from '../../../services/page.service';
import { AuthService } from '../../../services/auth.service';
import { TodoSyncService } from '../../../services/todo-sync.service';
import { MemoImageService } from '../../../services/memo-image.service';
import { SyncStatusComponent } from '../../atoms/sync-status/sync-status.component';
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
  AiBotWidget,
  ImageNode,
  type SlashCommandItem,
} from './extensions';
import { RecordingBlockComponent } from '../../molecules/recording-block/recording-block.component';
import { PaperEmbedComponent } from '../../molecules/paper-embed/paper-embed.component';
import { EditorToolbarComponent } from '../../molecules/editor-toolbar/editor-toolbar.component';
import { AiBotWidgetComponent } from '../../molecules/ai-bot-widget/ai-bot-widget.component';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

@Component({
  selector: 'app-notebook-editor',
  standalone: true,
  imports: [CommonModule, SyncStatusComponent, EditorToolbarComponent],
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
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly memoImageService = inject(MemoImageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);

  readonly pageId = input.required<string>();
  readonly notebookId = input.required<string>();
  readonly editable = input<boolean>(true);

  readonly isReady = signal(false);
  readonly isFocused = signal(false);
  readonly error = signal<string | null>(null);
  readonly isFullWidth = signal(false);

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
      const { ydoc, awareness, markdownContent } = await this.memoService.openDocument(pageId);
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
          // StarterKit without document (we use CustomDocument) and undoRedo (Collaboration has its own)
          StarterKit.configure({
            document: false,
            undoRedo: false,
          } as any),
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
          // Task lists with enhanced attributes (id, dueDate, priority, color)
          TaskList,
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
      }

      this.isReady.set(true);

      // Handle deep linking to todos via URL fragment
      this.handleTodoDeepLink();
    } catch {
      this.error.set('Failed to load memo');
    }
  }

  /**
   * Handle deep linking to a specific todo via URL fragment
   * Expects fragment format: #todo-{todoId}
   */
  private handleTodoDeepLink(): void {
    // Subscribe to fragment changes
    this.activatedRoute.fragment.subscribe((fragment) => {
      if (fragment && fragment.startsWith('todo-') && this._editor) {
        const todoId = fragment.replace('todo-', '');

        // Wait a bit for the editor content to fully render
        setTimeout(() => {
          (this._editor?.commands as any).scrollToTodo(todoId);
        }, 300);
      }
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
}
