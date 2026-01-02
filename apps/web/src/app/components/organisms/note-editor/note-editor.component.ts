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
import { environment } from '../../../../environments/environment';
import { CollabAutomergeService } from '../../../services/collab-automerge.service';
import { CollabSignalRService } from '../../../services/collab-signalr.service';
import { HttpClient } from '@angular/common/http';
import type { CollabEvent } from '@maple/shared';

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
  private readonly collabAutomerge = inject(CollabAutomergeService);
  private readonly collabSignalR = inject(CollabSignalRService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  // Automerge collaboration state
  private isUpdatingFromAutomerge = false;
  private signalrSubscription: any = null;

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
  private lastCollabNoteId: string | null = null; // Track collaboration separately
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

    // Initialize Automerge collaboration when note changes
    effect(() => {
      const currentNote = this.note();
      if (!this.viewReady() || !this.editor || !currentNote?._id) {
        this.disconnectCollaboration();
        this.lastCollabNoteId = null;
        return;
      }

      if (currentNote._id !== this.lastCollabNoteId) {
        this.lastCollabNoteId = currentNote._id;
        this.initializeAutomergeCollaboration(currentNote);
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

  private getExtensions() {
    const TitleDocument = Document.extend({
      content: 'heading block*',
    });
    return [
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
      // No CollabExtension - using Automerge instead
    ];
  }

  private createEditor(content: any, extensions: any[], wasFocused: boolean, lastSelection: any) {
    // [FIX] Added lastSelection argument
    if (!this.editorRef?.nativeElement) return; // Guard clause

    this.editor = new Editor({
      element: this.editorRef.nativeElement,
      editable: this.editable(),
      extensions: extensions,
      content: content,
      onUpdate: ({ editor }) => {
        if (!this.isUpdatingFromNote && !this.isUpdatingFromAutomerge) {
          const json = editor.getJSON() as NoteContent;
          this.contentChange.emit(json);
          this.updateAutomergeDocument(json);
        }
      },
      onFocus: () => {
        this.isFocused.set(true);
      },
      onBlur: () => {
        this.isFocused.set(false);
      },
    });

    if (wasFocused) {
      setTimeout(() => {
        if (this.editor) {
          this.editor.commands.focus();
          if (lastSelection) {
            const docSize = this.editor.state.doc.content.size;
            const pos = Math.max(0, Math.min(lastSelection.from, docSize));
            this.editor.commands.setTextSelection(pos);
          }
        }
      }, 0);
    }
  }

  private initEditor(): void {
    this.createEditor('', this.getExtensions(), false, null);
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

  // Automerge Collaboration methods
  private async initializeAutomergeCollaboration(note: Note): Promise<void> {
    this.disconnectCollaboration();

    try {
      console.log('[Automerge Editor] Initializing collaboration for note', note._id);

      // 1. Initialize Automerge Wasm
      await this.collabAutomerge.initialize();

      // 2. Load or migrate document
      const doc = this.collabAutomerge.loadOrCreateDocument(note._id, {
        automergeDoc: note.automergeDoc as Uint8Array | undefined,
        content: note.content,
      });

      // 3. Set initial content from Automerge document
      if (doc && (doc as any)['content']) {
        this.isUpdatingFromAutomerge = true;
        try {
          this.editor?.commands.setContent((doc as any)['content']);
        } finally {
          this.isUpdatingFromAutomerge = false;
        }
      }

      // 4. Connect to SignalR and listen for automerge-sync events
      if (environment.useSignalR) {
        await this.collabSignalR.connect();

        const destroy$ = new Subject<void>();
        this.destroyRef.onDestroy(() => destroy$.next());

        this.signalrSubscription = this.collabSignalR
          .eventsForNote(note._id)
          .pipe(takeUntil(destroy$))
          .subscribe((event: CollabEvent) => {
            if (event.type === 'automerge-sync' && event.syncMessage) {
              this.handleRemoteSync(note._id, event.syncMessage);
            }
          });
      }

      console.log('[Automerge Editor] Collaboration initialized successfully');
    } catch (error) {
      console.error('[Automerge Editor] Failed to initialize collaboration:', error);
    }
  }

  private handleRemoteSync(noteId: string, base64Message: string): void {
    if (this.isUpdatingFromAutomerge) return;

    try {
      // Decode base64 sync message
      const binaryMessage = Uint8Array.from(atob(base64Message), (c) => c.charCodeAt(0));

      // Apply sync message to local document
      const updatedDoc = this.collabAutomerge.receiveSyncMessage(noteId, binaryMessage);

      if (updatedDoc && (updatedDoc as any)['content']) {
        console.log('[Automerge Editor] Applying remote changes');
        this.isUpdatingFromAutomerge = true;
        try {
          this.editor?.commands.setContent((updatedDoc as any)['content']);
        } finally {
          this.isUpdatingFromAutomerge = false;
        }
      }
    } catch (error) {
      console.error('[Automerge Editor] Error handling remote sync:', error);
    }
  }

  private updateAutomergeDocument(content: NoteContent): void {
    if (this.isUpdatingFromAutomerge) return;

    const noteId = this.note()?._id;
    if (!noteId) return;

    try {
      // Update the Automerge document
      this.collabAutomerge.updateDocument(noteId, content);

      // Generate sync message
      const syncMessage = this.collabAutomerge.generateSyncMessage(noteId);

      if (syncMessage && environment.useSignalR) {
        // Send sync message to backend via HTTP
        const base64Message = btoa(String.fromCharCode(...syncMessage));

        this.http
          .post<any>(`/api/collab/${noteId}/automerge-sync`, {
            syncMessage: base64Message,
          })
          .subscribe({
            next: () => {
              console.log('[Automerge Editor] Sync message sent successfully');
            },
            error: (error) => {
              console.error('[Automerge Editor] Failed to send sync message:', error);
            },
          });
      }

      console.log('[Automerge Editor] Updated document from editor changes');
    } catch (error) {
      console.error('[Automerge Editor] Error updating Automerge document:', error);
    }
  }

  private disconnectCollaboration(): void {
    const noteId = this.note()?._id;

    if (noteId) {
      // Clean up document
      this.collabAutomerge.cleanupDocument(noteId);
    }

    // Unsubscribe from SignalR
    if (this.signalrSubscription) {
      this.signalrSubscription.unsubscribe();
      this.signalrSubscription = null;
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
