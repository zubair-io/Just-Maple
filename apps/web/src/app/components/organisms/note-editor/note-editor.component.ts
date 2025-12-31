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
  computed,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import Image from '@tiptap/extension-image';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { EmojiReplacer } from './extensions/emoji-replacer';
import { CodeEnterHandler } from './extensions/code-enter-handler';
import { ImageUpload } from './extensions/image-upload';
import { Mention, type MentionNodeAttrs } from '../../organisms/chat/extensions/mention';
import { BotWidget, type BotWidgetAttrs } from './extensions/bot-widget';
import { BotService, type BotSuggestion } from '../../../services/bot.service';
import { MentionSuggestionComponent } from '../../organisms/chat/mention-suggestion.component';
import {
  ActiveUsersListComponent,
  type ActiveUser,
} from '../../molecules/active-users-list/active-users-list.component';
import { AuthService } from '../../../services/auth.service';
import { Subject, takeUntil, combineLatest, switchMap, of } from 'rxjs';
import type { Note, Tag, NoteContent } from '@maple/shared';

@Component({
  selector: 'app-note-editor',
  standalone: true,
  imports: [CommonModule, MentionSuggestionComponent, ActiveUsersListComponent],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
})
export class NoteEditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  private readonly botService = inject(BotService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly note = input<Note | null>(null);
  readonly tag = input<Tag | null>(null);
  readonly editable = input<boolean>(true);

  readonly contentChange = output<NoteContent>();
  readonly botInvoked = output<{ botHandle: string; widgetId: string }>();

  readonly isFocused = signal(false);

  // Y.js collaboration
  private ydoc: Y.Doc | null = null;
  private provider: WebsocketProvider | null = null;
  private indexeddbProvider: IndexeddbPersistence | null = null;

  // Active users (collaboration presence)
  readonly activeUsers = signal<ActiveUser[]>([]);

  // Mention autocomplete state
  readonly showMentionSuggestions = signal(false);
  readonly mentionSuggestions = signal<BotSuggestion[]>([]);
  readonly mentionSuggestionsLoading = signal(false);
  readonly mentionPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  // Computed tag ID from either tag or note
  readonly tagId = computed(() => this.tag()?._id || this.note()?.tagId);

  // Reactively load bots when tag changes or cache is invalidated
  readonly allTagBots = toSignal(
    combineLatest([
      toObservable(this.tagId),
      toObservable(this.botService.tagBotsCacheVersion),
    ]).pipe(
      switchMap(([tagId, _cacheVersion]) => (tagId ? this.botService.getTagBots(tagId) : of([]))),
    ),
    { initialValue: [] as BotSuggestion[] },
  );

  mentionCommand: ((props: Record<string, unknown>) => void) | null = null;
  private readonly mentionSearch$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  private editor: Editor | null = null;
  private lastNoteId: string | null = null;
  private isUpdatingFromNote = false;
  private readonly viewReady = signal(false);

  constructor() {
    // Initialize editor after view is ready
    afterNextRender(() => {
      this.initEditor();
      this.viewReady.set(true);
    });

    // Handle note changes (initial load + updates)
    effect(() => {
      const currentNote = this.note();
      if (!this.viewReady() || !this.editor) return;

      if (currentNote?._id !== this.lastNoteId) {
        const previousNoteId = this.lastNoteId;
        this.lastNoteId = currentNote?._id ?? null;

        // If collaboration was initialized for previous note, destroy and recreate editor
        if (previousNoteId && currentNote?._id && this.ydoc) {
          console.log('[Note Editor] Switching notes, recreating editor with new Y.doc');

          // Cleanup old collaboration
          this.cleanupCollaboration();

          // Destroy old editor
          this.editor?.destroy();

          // Recreate editor with new collaboration
          this.initEditor();

          return; // Editor initialization will load content
        }

        // CRITICAL: When collaboration is enabled, do NOT call setContent()
        // Y.js Collaboration extension automatically syncs content from the Y.Doc
        // Calling setContent() would create duplicate content
        // Only update content if:
        // 1. No collaboration (no ydoc)
        // 2. AND either no note OR note has no _id (shouldn't have collaboration)
        if (!this.ydoc && (!currentNote || !currentNote._id)) {
          this.updateEditorContent(currentNote?.content ?? null);
        }
      }
    });

    // Update editable state
    effect(() => {
      const isEditable = this.editable();
      this.editor?.setEditable(isEditable);
    });

    // Setup mention search with client-side filtering (no debounce needed)
    this.mentionSearch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (query) => {
        const filtered = BotService.filterBots(this.allTagBots(), query);
        this.mentionSuggestions.set(filtered);
        this.mentionSuggestionsLoading.set(false);
      },
    });

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
    });
  }

  ngOnDestroy(): void {
    this.cleanupCollaboration();
    // Cleanup TipTap editor
    this.editor?.destroy();
  }

  private cleanupCollaboration(): void {
    console.log('[Note Editor] Cleaning up collaboration providers');

    // Cleanup Y.js providers in correct order
    // Important: destroy provider first (closes WebSocket), then IndexedDB, then doc
    if (this.provider) {
      this.provider.disconnect(); // Disconnect before destroy to clean up properly
      this.provider.destroy();
      this.provider = null;
    }
    if (this.indexeddbProvider) {
      this.indexeddbProvider.destroy();
      this.indexeddbProvider = null;
    }
    if (this.ydoc) {
      this.ydoc.destroy();
      this.ydoc = null;
    }
  }

  private initEditor(): void {
    if (!this.editorRef?.nativeElement) return;

    // Initialize Y.js collaboration
    const currentNote = this.note();
    if (currentNote?._id) {
      this.initializeCollaboration(currentNote._id);
    }

    // Document schema: must start with heading, then any blocks
    const TitleDocument = Document.extend({
      content: 'heading block*',
    });

    // Get collaboration extensions if Y.doc is initialized
    const collaborationExtensions =
      this.ydoc && this.provider
        ? [
            Collaboration.configure({
              document: this.ydoc,
              field: 'content',
            }),
            // TODO: Re-enable CollaborationCursor once we fix the provider.doc issue
            // CollaborationCursor.configure({
            //   provider: this.provider,
            //   user: {
            //     name:
            //       this.authService.user()?.displayName ||
            //       this.authService.user()?.email?.split('@')[0] ||
            //       'Anonymous',
            //     color: this.getRandomColor(),
            //   },
            // }),
          ]
        : [];

    this.editor = new Editor({
      element: this.editorRef.nativeElement,
      editable: this.editable(),
      extensions: [
        TitleDocument,
        StarterKit.configure({
          document: false,
          heading: false, // Use custom Heading below
          paragraph: false, // Use explicit Paragraph below
          ...(this.ydoc ? { history: false } : {}), // Disable history if using Y.js
        }),
        Paragraph,
        Heading.configure({
          levels: [1, 2, 3],
        }),
        TaskItem.configure({
          nested: true,
        }),
        TaskList,
        Highlight,
        Typography,
        Image.configure({
          inline: true,
          allowBase64: false, // Force URL-based images
          HTMLAttributes: {
            class: 'note-image',
          },
        }),
        ImageUpload.configure({
          uploadFn: (file: File) => this.uploadImage(file),
        }),
        ...collaborationExtensions,
        EmojiReplacer,
        CodeEnterHandler,
        Mention.configure({
          HTMLAttributes: {
            class: 'mention',
          },
          suggestion: {
            items: ({ query }) => {
              this.mentionSearch$.next(query);
              return [];
            },
            render: () => {
              return {
                onStart: (props) => {
                  this.mentionCommand = props.command;
                  this.showMentionSuggestions.set(true);
                  this.updateMentionPosition(props.clientRect);
                },
                onUpdate: (props) => {
                  this.mentionCommand = props.command;
                  this.updateMentionPosition(props.clientRect);
                },
                onKeyDown: (props) => {
                  if (props.event.key === 'Escape') {
                    this.showMentionSuggestions.set(false);
                    return true;
                  }
                  return false;
                },
                onExit: () => {
                  this.showMentionSuggestions.set(false);
                  this.mentionSuggestions.set([]);
                  this.mentionCommand = null;
                },
              };
            },
          },
        }),
        BotWidget,
        Placeholder.configure({
          placeholder: ({ node }) => {
            if (node.type.name === 'heading' && node.attrs['level'] === 1) {
              return 'Untitled';
            }
            return 'Start writing...';
          },
        }),
      ],
      content: '',
      onUpdate: ({ editor }) => {
        if (!this.isUpdatingFromNote) {
          const json = editor.getJSON() as NoteContent;
          this.contentChange.emit(json);
        }
      },
      onFocus: () => {
        this.isFocused.set(true);
      },
      onBlur: () => {
        this.isFocused.set(false);
      },
    });

    // Load initial content if note exists
  }

  private updateEditorContent(content: NoteContent | null | undefined): void {
    if (!this.editor) return;

    // Collaboration disabled - update content directly
    // (When collaboration is re-enabled, Y.js will handle content sync)

    this.isUpdatingFromNote = true;
    try {
      if (content && typeof content === 'object') {
        this.editor.commands.setContent(content);
      } else {
        this.editor.commands.setContent('');
      }
    } finally {
      this.isUpdatingFromNote = false;
    }
    this.focusTitle();
  }

  private updateMentionPosition(clientRect: (() => DOMRect | null) | null | undefined): void {
    if (!clientRect) return;
    const rect = clientRect();
    if (!rect) return;
    this.mentionPosition.set({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }

  onMentionSelected(bot: BotSuggestion): void {
    if (this.mentionCommand) {
      this.mentionCommand({
        id: bot.id,
        handle: bot.handle,
        type: bot.type,
      });

      // If it's a bot mention, insert a widget after the current block
      if (bot.type === 'bot') {
        const widgetId = `widget-${Date.now()}`;
        // Insert the bot widget after the current selection
        setTimeout(() => {
          this.editor
            ?.chain()
            .focus()
            .insertBotWidget({
              widgetId,
              botHandle: bot.handle,
              status: 'pending',
            })
            .run();

          // Emit event for parent to handle invocation
          this.botInvoked.emit({ botHandle: bot.handle, widgetId });
        }, 100);
      }
    }
    this.showMentionSuggestions.set(false);
  }

  onMentionDismissed(): void {
    this.showMentionSuggestions.set(false);
  }

  // Update a bot widget's state (called from parent when invocation completes)
  updateBotWidget(widgetId: string, attrs: Partial<BotWidgetAttrs>): void {
    this.editor?.commands.updateBotWidget(widgetId, attrs);
  }

  // Upload image to server
  private async uploadImage(file: File): Promise<string> {
    const noteId = this.note()?._id;
    if (!noteId) {
      throw new Error('No note ID available for image upload');
    }

    const token = this.authService.accessToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    // Upload image to API
    const response = await fetch(`/api/notes/${noteId}/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type,
      },
      body: await file.arrayBuffer(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Image upload failed');
    }

    const data = await response.json();
    return data.url;
  }

  // Y.js collaboration initialization
  private initializeCollaboration(noteId: string): void {
    // Create Y.Doc with noteId as GUID to ensure consistency across reloads
    // This prevents duplication issues when syncing with the server
    this.ydoc = new Y.Doc({ guid: noteId });

    // IndexedDB persistence for offline support
    this.indexeddbProvider = new IndexeddbPersistence(`note-${noteId}`, this.ydoc);

    console.log('[Collab] Initialized IndexedDB persistence for note:', noteId);

    // WebSocket provider for real-time sync
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // Determine API host:
    // - Local dev: ws://localhost:7071
    // - Azure production: wss://paperbark.justmaple.app
    let wsHost: string;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      wsHost = 'localhost:7071'; // API server port for local dev
    } else {
      // Production - use the same host (API serves frontend in production)
      wsHost = window.location.host;
    }

    // y-websocket automatically appends the room name (noteId) to the base URL
    const wsUrl = `${wsProtocol}//${wsHost}/ws/collab`;
    const token = this.authService.accessToken();

    this.provider = new WebsocketProvider(wsUrl, noteId, this.ydoc, {
      connect: true,
      params: { token: token || '' },
    });

    console.log('[Collab] Initialized WebSocket provider:', wsUrl);

    // Debug: Log when Y.doc gets synced
    this.provider.on('sync', (synced: boolean) => {
      if (synced) {
        const yxmlFragment = this.ydoc?.getXmlFragment('content');
        const childCount = yxmlFragment?.length || 0;
        console.log('[Collab] WebSocket synced, Y.XmlFragment has', childCount, 'children');
        console.log('[Collab] Editor content length:', this.editor?.state.doc.content.size);
      }
    });

    // Add message logging
    if (this.provider.ws) {
      const originalSend = this.provider.ws.send.bind(this.provider.ws);
      this.provider.ws.send = (data: any) => {
        console.log('[Collab] Sending message, length:', data.length || data.byteLength);
        return originalSend(data);
      };

      this.provider.ws.addEventListener('message', (event) => {
        console.log(
          '[Collab] Received message, length:',
          event.data.length || event.data.byteLength,
        );
      });

      this.provider.ws.addEventListener('error', (event) => {
        console.error('[Collab] WebSocket error:', event);
      });

      this.provider.ws.addEventListener('close', (event) => {
        console.log('[Collab] WebSocket closed:', event.code, event.reason);
      });
    }

    // Set up connection event listeners
    this.provider.on('status', ({ status }: { status: string }) => {
      console.log('[Collab] WebSocket status:', status);
    });

    this.provider.on('sync', (isSynced: boolean) => {
      console.log('[Collab] Sync status:', isSynced ? 'synced' : 'syncing');
    });

    // Set up awareness tracking for active users
    this.provider.awareness.on('change', () => {
      // Guard against provider being null during cleanup
      if (!this.provider?.awareness) return;

      const states = Array.from(this.provider.awareness.getStates().values());
      const users: ActiveUser[] = states
        .map((state: any) => state.user)
        .filter((user: any) => user?.name);
      this.activeUsers.set(users);
      console.log('[Collab] Active users:', users);
    });
  }

  private getRandomColor(): string {
    // Generate a random bright color for user cursor
    const colors = [
      '#FF6B6B', // Red
      '#4ECDC4', // Teal
      '#45B7D1', // Blue
      '#FFA07A', // Light Salmon
      '#98D8C8', // Mint
      '#F7DC6F', // Yellow
      '#BB8FCE', // Purple
      '#85C1E2', // Sky Blue
      '#F8B739', // Orange
      '#52C41A', // Green
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  focusTitle(): void {
    // Focus at the start (the H1 title)
    this.editor?.commands.focus('start');
  }

  // Toolbar commands
  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleHeading(level: 1 | 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  toggleTaskList(): void {
    this.editor?.chain().focus().toggleTaskList().run();
  }

  toggleBlockquote(): void {
    this.editor?.chain().focus().toggleBlockquote().run();
  }

  toggleCode(): void {
    this.editor?.chain().focus().toggleCode().run();
  }

  toggleCodeBlock(): void {
    this.editor?.chain().focus().toggleCodeBlock().run();
  }

  // Check if format is active
  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    return this.editor?.isActive(name, attrs) ?? false;
  }
}
