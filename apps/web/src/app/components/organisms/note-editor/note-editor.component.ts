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
import { collab, getVersion, sendableSteps, receiveTransaction } from 'prosemirror-collab';
import { Step } from 'prosemirror-transform';
import { AuthService } from '../../../services/auth.service';
import { OfflineCollabService } from '../../../services/offline-collab.service';
import { NetworkService } from '../../../services/network.service';
import { CollabSignalRService } from '../../../services/collab-signalr.service';
import { CollabHttpService } from '../../../services/collab-http.service';
import { environment } from '../../../../environments/environment';
import { Extension } from '@tiptap/core';
import { Subscription } from 'rxjs';

// TipTap extension that wraps ProseMirror collab plugin with dynamic version
const CollabExtension = Extension.create<{ version: number; clientID?: string | number }>({
  name: 'collaboration',

  addOptions() {
    return {
      version: 0,
      clientID: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [
      collab({
        version: this.options.version,
        clientID: this.options.clientID,
      }),
    ];
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
  private readonly offlineCollab = inject(OfflineCollabService);
  private readonly network = inject(NetworkService);
  private readonly collabSignalR = inject(CollabSignalRService);
  private readonly collabHttp = inject(CollabHttpService);
  private readonly destroyRef = inject(DestroyRef);

  // ProseMirror collaboration state
  private collabWS: WebSocket | null = null;
  private signalrSubscription: Subscription | null = null;
  private clientID: string | null = null;
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

    // Initialize collaboration when note changes
    effect(() => {
      const currentNote = this.note();
      if (!this.viewReady() || !this.editor || !currentNote?._id) {
        this.disconnectCollaboration();
        this.lastCollabNoteId = null;
        return;
      }

      if (currentNote._id !== this.lastCollabNoteId) {
        this.lastCollabNoteId = currentNote._id;
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

  private getExtensions(collabVersion: number = 0, clientID?: string | number) {
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
      CollabExtension.configure({ version: collabVersion, clientID }),
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
        if (!this.isUpdatingFromNote) {
          const json = editor.getJSON() as NoteContent;
          this.contentChange.emit(json);
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
    this.createEditor('', this.getExtensions(0), false, null);
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

    if (environment.useSignalR) {
      this.initializeSignalRCollab(noteId, version);
    } else {
      this.initializeWebSocketCollab(noteId, version);
    }
  }

  private initializeSignalRCollab(noteId: string, version: number): void {
    // Connect to SignalR hub
    this.collabSignalR.connect().then(() => {
      // Subscribe to events for this note
      this.signalrSubscription = this.collabSignalR.eventsForNote(noteId).subscribe((event) => {
        this.handleCollabMessage(event);
      });

      // Join collaboration session via HTTP
      this.joinCollabSession(noteId);
    });

    // Register flush callback for offline queue (SignalR/HTTP mode)
    this.offlineCollab.registerFlushCallback(noteId, async (queuedSteps) => {
      if (!this.clientID) {
        console.error('[Collab HTTP] Cannot flush - no clientID');
        return;
      }

      console.log(`[Collab HTTP] Flushing ${queuedSteps.length} queued steps in single batch`);

      try {
        // Convert queued steps to batch format
        const stepsBatch = queuedSteps.map((qStep) => ({
          version: qStep.version,
          steps: [qStep.step],
        }));

        // Send all steps in a single HTTP request
        const result = await this.collabHttp.sendStepsBatchAsync(
          noteId,
          this.clientID,
          stepsBatch,
          this.editor!.getJSON(),
        );

        // Handle server responses
        if ('resync' in result && result.resync) {
          console.log('[Collab HTTP] Server requested resync during flush');
          this.handleCollabMessage({ type: 'resync' });
        } else {
          console.log(`[Collab HTTP] Successfully flushed ${queuedSteps.length} steps`);
        }
      } catch (error) {
        console.error('[Collab HTTP] Error flushing batch:', error);
        throw error; // Re-throw to keep steps in queue
      }
    });
  }

  private initializeWebSocketCollab(noteId: string, version: number): void {
    const token = this.authService.accessToken();
    if (!token) {
      console.error('[Collab] No access token available');
      return;
    }

    // Determine WebSocket URL from environment
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = environment.production
      ? window.location.host
      : `${window.location.hostname}:7071`;
    const wsUrl = `${wsProtocol}//${wsHost}/ws/collab/${noteId}?token=${token}`;

    this.collabWS = new WebSocket(wsUrl);

    this.collabWS.onopen = () => {
      // Connected successfully
    };

    this.collabWS.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleCollabMessage(data);
      } catch (error) {
        console.error('[Collab WS] Error processing message:', error);
      }
    };

    this.collabWS.onerror = (error) => {
      console.error('[Collab WS] WebSocket error:', error);
    };

    this.collabWS.onclose = (event) => {
      console.log('[Collab WS] WebSocket closed:', event.code, event.reason);
    };

    // Register flush callback for offline queue
    this.offlineCollab.registerFlushCallback(noteId, async (queuedSteps) => {
      // When back online, send all queued steps
      if (this.collabWS && this.collabWS.readyState === WebSocket.OPEN) {
        for (const qStep of queuedSteps) {
          this.collabWS.send(
            JSON.stringify({
              type: 'steps',
              version: qStep.version,
              steps: [qStep.step], // Send as array
            }),
          );
        }
        console.log(`[Collab WS] Flushed ${queuedSteps.length} queued steps`);
      }
    });
  }

  private handleCollabMessage(data: any): void {
    if (data.type === 'resync') {
      console.log('[Collab] Received resync request - reinitializing');
      this.initializeCollaboration(this.note()?._id || '', 0);
      return;
    }

    if (data.type === 'init') {
      // Server sends authoritative document content and version
      // Store clientID for later use
      this.clientID = data.clientID;

      // CRITICAL: Reinitialize editor or update state
      // If the editor is already initialized and valid, we just need to re-inject the collaboration state
      if (this.editor && !this.editor.isDestroyed && data.doc) {
        const currentContent = data.doc;
        const serverVersion = data.version;
        const clientID = data.clientID; // Server assigned clientID

        // We need to re-configure the extensions to get a fresh collab plugin instance
        const extensions = this.getExtensions(serverVersion, clientID);

        const wasFocused = this.isFocused();
        const lastSelection = this.editor.state.selection;

        this.editor.destroy();
        this.createEditor(currentContent, extensions, wasFocused, lastSelection);
      } else if (this.editorRef?.nativeElement && data.doc) {
        // First time init
        const serverVersion = data.version;
        const clientID = data.clientID;
        const extensions = this.getExtensions(serverVersion, clientID);
        this.createEditor(data.doc, extensions, false, null);
      }
      return;
    }

    if (data.type === 'steps' && this.editor) {
      // Receive steps from all clients (including echo of our own)
      // ProseMirror's collab plugin needs to receive ALL steps to track versions correctly
      const steps = data.steps.map((stepJSON: any) => Step.fromJSON(this.editor!.schema, stepJSON));
      const clientIDs = data.clientIDs || data.steps.map(() => data.clientID);

      // Apply ALL steps (collab plugin handles deduplication)
      const tr = receiveTransaction(this.editor.state, steps, clientIDs);

      this.isUpdatingFromNote = true;
      try {
        this.editor.view.dispatch(tr);
        // Version is automatically updated by the collab plugin
      } finally {
        this.isUpdatingFromNote = false;
      }

      // Unlock sending mechanism now that we've processed the response
      this.isSendingSteps = false;

      // Send rebased steps after a short delay to avoid retry storm
      // If we have pending steps that were rebased, they need to be sent
      setTimeout(() => {
        const sendable = sendableSteps(this.editor!.state);
        if (sendable && sendable.steps.length > 0) {
          this.sendSteps();
        }
      }, 100);
      return;
    }
  }

  private async joinCollabSession(noteId: string): Promise<void> {
    try {
      const initData = await this.collabHttp.joinSessionAsync(noteId);

      // CRITICAL: Store the clientID from the server for future step submissions
      if (initData.clientID) {
        this.clientID = initData.clientID;
      }

      // Handle init message
      this.handleCollabMessage(initData);
    } catch (error) {
      console.error('[Collab SignalR] Failed to join session:', error);
    }
  }

  private disconnectCollaboration(): void {
    // Disconnect WebSocket
    if (this.collabWS) {
      this.collabWS.close();
      this.collabWS = null;
    }

    // Disconnect SignalR subscription
    if (this.signalrSubscription) {
      this.signalrSubscription.unsubscribe();
      this.signalrSubscription = null;
    }

    // Unregister flush callback
    const noteId = this.note()?._id;
    if (noteId) {
      this.offlineCollab.unregisterFlushCallback(noteId);
    }

    this.clientID = null;
  }

  private sendSteps(): void {
    if (!this.editor || this.isSendingSteps) return;

    // Get sendable steps from ProseMirror collab plugin
    const sendable = sendableSteps(this.editor.state);
    if (!sendable || sendable.steps.length === 0) return;

    const noteId = this.note()?._id;
    if (!noteId) return;

    // Delegate to appropriate transport
    if (environment.useSignalR) {
      this.sendStepsViaHTTP(noteId, sendable);
    } else {
      this.sendStepsViaWebSocket(noteId, sendable);
    }
  }

  private sendStepsViaWebSocket(noteId: string, sendable: any): void {
    // Check WebSocket state
    const wsState = this.collabWS?.readyState;

    // Check if we can send immediately (WebSocket is fully open)
    const canSendNow = this.collabWS && wsState === WebSocket.OPEN;

    if (canSendNow) {
      // Online: send immediately
      this.isSendingSteps = true;
      try {
        // Send steps along with current document state
        // This allows the server to maintain the authoritative document
        this.collabWS!.send(
          JSON.stringify({
            type: 'steps',
            version: sendable.version,
            steps: sendable.steps.map((s: any) => s.toJSON()),
            doc: this.editor!.getJSON(), // Send current document state
          }),
        );
      } catch (error) {
        console.error('[Collab WS] Error sending steps:', error);
        // Queue for retry on error
        this.queueStepsOffline(noteId, Array.from(sendable.steps), sendable.version);
        this.isSendingSteps = false; // Unlock if error occurred
      }
      // CRITICAL: Do NOT unlock isSendingSteps here. Wait for ACK (onmessage).
      // This enforces sequential processing and prevents "Client Ahead" race conditions.
    } else if (this.collabWS && wsState === WebSocket.CONNECTING) {
      // WebSocket is connecting - wait for it to open then send
      let attempts = 0;
      const maxAttempts = 50; // Max 5 seconds (50 * 100ms)
      const waitForOpen = () => {
        attempts++;
        if (this.collabWS?.readyState === WebSocket.OPEN) {
          this.sendSteps(); // Retry sending
        } else if (this.collabWS?.readyState === WebSocket.CONNECTING && attempts < maxAttempts) {
          // Still connecting, wait a bit more
          setTimeout(waitForOpen, 100);
        } else {
          // Connection failed or timeout, queue for later
          this.queueStepsOffline(noteId, Array.from(sendable.steps), sendable.version);
        }
      };
      setTimeout(waitForOpen, 100);
    } else {
      // Offline or disconnected: queue for later
      this.queueStepsOffline(noteId, Array.from(sendable.steps), sendable.version);
    }
  }

  private async sendStepsViaHTTP(noteId: string, sendable: any): Promise<void> {
    // CRITICAL: Use the stored clientID from join session
    if (!this.clientID) {
      console.error('[Collab HTTP] No clientID - cannot send steps. Did join fail?');
      return;
    }

    // Check if we're online before attempting HTTP request
    if (!this.network.isOnline()) {
      this.queueStepsOffline(noteId, Array.from(sendable.steps), sendable.version);
      return;
    }

    this.isSendingSteps = true;

    try {
      const result = await this.collabHttp.sendStepsAsync(
        noteId,
        this.clientID,
        sendable.version,
        sendable.steps.map((s: any) => s.toJSON()),
        this.editor!.getJSON(),
      );

      // Handle response
      if ('resync' in result && result.resync) {
        console.log('[Collab HTTP] Server requested resync - unlocking and reinitializing');
        this.isSendingSteps = false;
        this.handleCollabMessage({ type: 'resync' });
      } else if (
        'type' in result &&
        result.type === 'steps' &&
        result.steps.length > 0 &&
        result.version !== sendable.version + sendable.steps.length
      ) {
        // Server sent catch-up steps (client was behind)
        // Only apply if version indicates these are NOT our own steps
        console.log('[Collab HTTP] Received catch-up steps from server');
        this.isSendingSteps = false;
        this.handleCollabMessage(result);
      } else {
        // Success ACK or our own steps echoed back - don't apply
        this.isSendingSteps = false;

        // Check for rebased steps
        setTimeout(() => {
          const newSendable = sendableSteps(this.editor!.state);
          if (newSendable && newSendable.steps.length > 0) {
            this.sendSteps();
          }
        }, 100);
      }
    } catch (error) {
      console.error('[Collab HTTP] Error sending steps:', error);
      // Queue steps for retry when back online
      this.queueStepsOffline(noteId, Array.from(sendable.steps), sendable.version);
      this.isSendingSteps = false;
    }
  }

  private queueStepsOffline(noteId: string, steps: readonly Step[], version: number): void {
    // Queue each step separately
    steps.forEach((step) => {
      this.offlineCollab.queueStep(noteId, step.toJSON(), version);
    });
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
