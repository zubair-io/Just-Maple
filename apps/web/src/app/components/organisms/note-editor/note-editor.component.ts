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
import Heading from '@tiptap/extension-heading';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import { EmojiReplacer } from './extensions/emoji-replacer';
import { CodeEnterHandler } from './extensions/code-enter-handler';
import { Mention, type MentionNodeAttrs } from '../../organisms/chat/extensions/mention';
import { BotWidget, type BotWidgetAttrs } from './extensions/bot-widget';
import { BotService, type BotSuggestion } from '../../../services/bot.service';
import { MentionSuggestionComponent } from '../../organisms/chat/mention-suggestion.component';
import { Subject, takeUntil, combineLatest, switchMap, of } from 'rxjs';
import type { Note, Tag, NoteContent } from '@maple/shared';
import { collab, sendableSteps, receiveTransaction, getVersion } from 'prosemirror-collab';
import { Step } from 'prosemirror-transform';
import { AuthService } from '../../../services/auth.service';
import { environment } from '../../../../environments/environment';
import { Extension } from '@tiptap/core';

// TipTap extension that wraps ProseMirror collab plugin
const CollabExtension = Extension.create({
  name: 'collaboration',

  addProseMirrorPlugins() {
    return [collab({ version: 0 })];
  },
});

@Component({
  selector: 'app-note-editor',
  standalone: true,
  imports: [CommonModule, MentionSuggestionComponent],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
})
export class NoteEditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  private readonly botService = inject(BotService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // ProseMirror collaboration state
  private collabWS: WebSocket | null = null;
  private collabVersion: number = 0;
  private isSendingSteps = false;

  readonly note = input<Note | null>(null);
  readonly tag = input<Tag | null>(null);
  readonly editable = input<boolean>(true);

  readonly contentChange = output<NoteContent>();
  readonly botInvoked = output<{ botHandle: string; widgetId: string }>();

  readonly isFocused = signal(false);

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
        this.lastNoteId = currentNote?._id ?? null;
        this.updateEditorContent(currentNote?.content ?? null);
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

    // Initialize collaboration when note changes
    effect(() => {
      const currentNote = this.note();
      if (!this.viewReady() || !this.editor || !currentNote?._id) {
        this.disconnectCollaboration();
        return;
      }

      if (currentNote._id !== this.lastNoteId) {
        this.initializeCollaboration(currentNote._id, currentNote.version || 0);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
      this.disconnectCollaboration();
    });
  }

  ngOnDestroy(): void {
    this.disconnectCollaboration();
    this.editor?.destroy();
  }

  private initEditor(): void {
    if (!this.editorRef?.nativeElement) return;

    // Document schema: must start with heading, then any blocks
    const TitleDocument = Document.extend({
      content: 'heading block*',
    });

    this.editor = new Editor({
      element: this.editorRef.nativeElement,
      editable: this.editable(),
      extensions: [
        TitleDocument,
        StarterKit.configure({
          document: false,
          heading: false, // Use custom Heading below
        }),
        Heading.configure({
          levels: [1, 2, 3],
        }),
        TaskItem.configure({
          nested: true,
        }),
        TaskList,
        Highlight,
        Typography,
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
        CollabExtension,
      ],
      content: '',
      onUpdate: ({ editor }) => {
        if (!this.isUpdatingFromNote) {
          const json = editor.getJSON() as NoteContent;
          this.contentChange.emit(json);
          // Send steps to collaboration server
          this.sendSteps();
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

  focusTitle(): void {
    // Focus at the start (the H1 title)
    this.editor?.commands.focus('start');
  }

  // Collaboration methods
  private initializeCollaboration(noteId: string, version: number): void {
    this.disconnectCollaboration();
    this.collabVersion = version;

    const token = this.authService.accessToken();
    if (!token) {
      console.error('[Collab] No access token available');
      return;
    }

    // Determine WebSocket URL from environment
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = environment.production ? window.location.host : 'localhost:7071';
    const wsUrl = `${wsProtocol}//${wsHost}/ws/collab/${noteId}?token=${token}`;

    console.log('[Collab] Connecting to:', wsUrl);
    this.collabWS = new WebSocket(wsUrl);

    this.collabWS.onopen = () => {
      console.log('[Collab] Connected to collaboration server');
    };

    this.collabWS.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Collab] Received message:', data.type);

        if (data.type === 'init') {
          this.collabVersion = data.version;
          console.log('[Collab] Initialized with version:', data.version);
          // Document content is already loaded, just sync version
        }

        if (data.type === 'steps' && this.editor) {
          // Receive steps from other clients
          const steps = data.steps.map((stepJSON: any) =>
            Step.fromJSON(this.editor!.schema, stepJSON),
          );

          // Apply the steps to the editor
          const tr = receiveTransaction(
            this.editor.state,
            steps,
            data.steps.map(() => data.clientID),
          );

          this.isUpdatingFromNote = true;
          try {
            this.editor.view.dispatch(tr);
            this.collabVersion = data.version;
            console.log('[Collab] Applied remote steps, new version:', data.version);
          } finally {
            this.isUpdatingFromNote = false;
          }
        }
      } catch (error) {
        console.error('[Collab] Error processing message:', error);
      }
    };

    this.collabWS.onerror = (error) => {
      console.error('[Collab] WebSocket error:', error);
    };

    this.collabWS.onclose = (event) => {
      console.log('[Collab] WebSocket closed:', event.code, event.reason);
    };
  }

  private disconnectCollaboration(): void {
    if (this.collabWS) {
      this.collabWS.close();
      this.collabWS = null;
    }
  }

  private sendSteps(): void {
    if (!this.editor || this.isSendingSteps || !this.collabWS) return;
    if (this.collabWS.readyState !== WebSocket.OPEN) return;

    // Get sendable steps from ProseMirror collab plugin
    const sendable = sendableSteps(this.editor.state);
    if (!sendable || sendable.steps.length === 0) return;

    this.isSendingSteps = true;
    try {
      this.collabWS.send(
        JSON.stringify({
          type: 'steps',
          version: sendable.version,
          steps: sendable.steps.map((s) => s.toJSON()),
        }),
      );
      console.log('[Collab] Sent steps, version:', sendable.version);
    } catch (error) {
      console.error('[Collab] Error sending steps:', error);
    } finally {
      this.isSendingSteps = false;
    }
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
