import {
  Component,
  untracked,
  computed,
  input,
  output,
  signal,
  effect,
  inject,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  DestroyRef,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BotUIComponent } from '../../../atoms/bot-ui/bot-ui.component';
import { CommonModule, DatePipe } from '@angular/common';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { BotService, type BotSuggestion } from '../../../../services/bot.service';
import { MessageService } from '../../../../services/message.service';
import { RealtimeService } from '../../../../services/realtime.service';
import { ContentRendererComponent } from '../../../atoms/content-renderer/content-renderer.component';
import { ProfileAvatarComponent } from '../../../atoms/profile-avatar/profile-avatar.component';
import { ChatTypingComponent } from '../chat-typing.component';
import { BotActivityService } from '../../../../services/bot-activity.service';
import { MentionSuggestionComponent } from '../mention-suggestion.component';
import { Mention, type MentionNodeAttrs } from '../extensions/mention';
import { isBotUIFallbackContent } from '@maple/shared';
import type { Message, Thread, PageContent } from '@maple/shared';
import { extractMentions, extractText } from '@maple/shared';
import { Subscription, Subject, takeUntil, filter, combineLatest, switchMap, of } from 'rxjs';

@Component({
  selector: 'app-thread-panel',
  standalone: true,
  imports: [
    BotUIComponent,
    CommonModule,
    DatePipe,
    ContentRendererComponent,
    ProfileAvatarComponent,
    MentionSuggestionComponent,
    ChatTypingComponent,
  ],
  templateUrl: './thread-panel.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './thread-panel.component.scss',
  host: {
    '[class.fullscreen]': 'isFullscreen()',
    '[style.--thread-width.px]': 'width()',
  },
})
export class ThreadPanelComponent implements AfterViewInit, OnDestroy {
  readonly isBotUIFallbackContent = isBotUIFallbackContent;
  @ViewChild('threadMessageList') private messageListRef?: ElementRef<HTMLElement>;
  @ViewChild('threadEditorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  private readonly botService = inject(BotService);
  private readonly messageService = inject(MessageService);
  private readonly realtimeService = inject(RealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly botActivity = inject(BotActivityService);
  /** Bots writing a reply in this thread right now. */
  readonly replyingBots = computed(
    () => this.botActivity.inThreadBySource().get(this.parentMessage().id) ?? [],
  );
  // Keep the "typing…" line in view when a bot starts replying.
  private readonly scrollToTyping = effect(() => {
    if (this.replyingBots().length > 0) untracked(() => setTimeout(() => this.scrollToBottom()));
  });

  readonly parentMessage = input.required<Message>();
  readonly notebookId = input.required<string>();

  readonly closed = output<void>();

  readonly threadMessages = signal<Message[]>([]);
  readonly thread = signal<Thread | null>(null);
  readonly isLoading = signal(false);
  readonly actionPending = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly isClosing = signal(false);

  // Size: drag the left edge to resize (remembered), or fill the chat area.
  private static readonly widthKey = 'maple.threadPanelWidth';
  private static readonly minWidth = 320;
  readonly width = signal(ThreadPanelComponent.savedWidth());
  readonly isFullscreen = signal(false);
  readonly isResizing = signal(false);

  // Mention autocomplete state
  readonly showMentionSuggestions = signal(false);
  readonly mentionSuggestions = signal<BotSuggestion[]>([]);
  readonly mentionSuggestionsLoading = signal(false);
  readonly mentionPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  readonly mentionPositionAbove = signal(false);

  readonly allNotebookBots = toSignal(
    combineLatest([
      toObservable(this.notebookId),
      toObservable(this.botService.notebookBotsCacheVersion),
    ]).pipe(
      switchMap(([notebookId, _cacheVersion]) =>
        notebookId ? this.botService.getNotebookBots(notebookId) : of([]),
      ),
    ),
    { initialValue: [] as BotSuggestion[] },
  );

  mentionCommand: ((props: Record<string, unknown>) => void) | null = null;
  private readonly mentionSearch$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  private editor: Editor | null = null;
  private realtimeSubscription: Subscription | null = null;
  private threadLoad: Subscription | null = null;

  constructor() {
    // Load thread when parentMessage changes
    effect(() => {
      const message = this.parentMessage();
      if (message) {
        // A new thread starts with an empty composer (and gets its own mention prefill).
        untracked(() => this.editor?.commands.clearContent());
        this.loadThread(message.id);
        this.subscribeToThreadMessages(message.id);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
    });

    // Setup mention search
    this.mentionSearch$.pipe(takeUntil(this.destroy$)).subscribe({
      next: (query) => {
        const filtered = BotService.filterBots(this.allNotebookBots(), query);
        this.mentionSuggestions.set(filtered);
        this.mentionSuggestionsLoading.set(false);
      },
    });
  }

  ngAfterViewInit(): void {
    this.initEditor();
    this.prefillBotMentions();
  }

  /** The parent message the mention prefill already ran for. */
  private prefilledFor: string | null = null;
  // The bot list can arrive after the thread does; try the prefill again then.
  private readonly prefillWhenBotsLoad = effect(() => {
    this.allNotebookBots();
    untracked(() => this.prefillBotMentions());
  });

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.realtimeSubscription?.unsubscribe();
    this.threadLoad?.unsubscribe();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: Event): void {
    if (event.defaultPrevented || this.showMentionSuggestions()) return;
    // Escape leaves full screen first, then closes the thread.
    if (this.isFullscreen()) {
      this.isFullscreen.set(false);
    } else {
      this.close();
    }
  }

  toggleFullscreen(): void {
    this.isFullscreen.update((full) => !full);
  }

  /** Drag the left edge; the panel grows to the left. Arrow keys resize from the keyboard. */
  startResize(event: PointerEvent): void {
    if (this.isFullscreen()) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = this.width();
    this.isResizing.set(true);
    const move = (e: PointerEvent) => this.setWidth(startWidth + (startX - e.clientX));
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.isResizing.set(false);
      this.saveWidth();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  resizeWithKeyboard(event: KeyboardEvent): void {
    const step = event.shiftKey ? 80 : 20;
    if (event.key === 'ArrowLeft') this.setWidth(this.width() + step);
    else if (event.key === 'ArrowRight') this.setWidth(this.width() - step);
    else return;
    event.preventDefault();
    this.saveWidth();
  }

  private setWidth(width: number): void {
    const max = Math.max(ThreadPanelComponent.minWidth, window.innerWidth * 0.7);
    this.width.set(Math.round(Math.min(Math.max(width, ThreadPanelComponent.minWidth), max)));
  }

  private saveWidth(): void {
    try {
      localStorage.setItem(ThreadPanelComponent.widthKey, String(this.width()));
    } catch {
      // Storage unavailable (private mode); the width just isn't remembered.
    }
  }

  private static savedWidth(): number {
    try {
      const saved = Number(localStorage.getItem(ThreadPanelComponent.widthKey));
      return saved >= ThreadPanelComponent.minWidth ? saved : 380;
    } catch {
      return 380;
    }
  }

  close(): void {
    // Closing plays the slide-out animation, which full screen turns off.
    this.isFullscreen.set(false);
    this.isClosing.set(true);
  }

  onAnimationEnd(event: AnimationEvent): void {
    if (event.animationName === 'slideOut') {
      this.closed.emit();
    }
  }

  get parentSenderDisplay(): string {
    const msg = this.parentMessage();
    if (msg.senderDisplayName) return msg.senderDisplayName;
    return msg.senderEmail?.split('@')[0] || 'Unknown';
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ---- Editor & Mentions ----

  private initEditor(): void {
    if (!this.editorRef?.nativeElement) return;

    const SendOnEnter = Extension.create({
      name: 'sendOnEnter',
      addKeyboardShortcuts: () => ({
        Enter: () => {
          if (this.showMentionSuggestions()) {
            return true;
          }
          this.sendMessage();
          return true;
        },
        'Shift-Enter': () => false,
      }),
    });

    this.editor = new Editor({
      element: this.editorRef.nativeElement,
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
        }) as any,
        Placeholder.configure({
          placeholder: 'Reply in thread...',
        }) as any,
        Mention.configure({
          HTMLAttributes: {
            class: 'mention',
          },
          suggestion: {
            items: ({ query }) => {
              this.mentionSearch$.next(query);
              return [];
            },
            render: () => ({
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
                const key = props.event.key;
                if (key === 'Escape') {
                  this.showMentionSuggestions.set(false);
                  return true;
                }
                // With nothing to pick, Enter closes the list and sends as usual.
                if (key === 'Enter' && this.mentionSuggestions().length === 0) {
                  this.showMentionSuggestions.set(false);
                  return false;
                }
                if (key === 'Enter' || key === 'ArrowUp' || key === 'ArrowDown') {
                  return true;
                }
                return false;
              },
              onExit: () => {
                this.showMentionSuggestions.set(false);
                this.mentionSuggestions.set([]);
                this.mentionCommand = null;
              },
            }),
          },
        }) as any,
        SendOnEnter as any,
      ],
      content: '',
    });
  }

  /**
   * Start the reply with @mentions of the bots already in this thread, so following up
   * reaches them. Uses the loaded thread, and never replaces text the user typed.
   */
  private prefillBotMentions(): void {
    const parentId = this.parentMessage().id;
    if (!this.editor || this.prefilledFor === parentId || !this.editor.isEmpty) return;
    const bots = new Map(this.allNotebookBots().map((bot) => [bot.id, bot]));
    const handles = new Map<string, string>();
    for (const message of this.threadMessages()) {
      const bot = message.senderType === 'bot' && message.userBotId && bots.get(message.userBotId);
      if (bot) handles.set(bot.id, bot.handle);
    }
    if (handles.size === 0) return;
    this.prefilledFor = parentId;
    const content: Array<Record<string, unknown>> = [];
    for (const [id, handle] of handles) {
      content.push({ type: 'mention', attrs: { id, handle, type: 'bot' } });
      content.push({ type: 'text', text: ' ' });
    }
    this.editor.chain().focus().insertContentAt(0, content).run();
  }

  private updateMentionPosition(clientRect: (() => DOMRect | null) | null | undefined): void {
    if (!clientRect) return;
    const rect = clientRect();
    if (!rect) return;

    const dropdownHeight = 280;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldPositionAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
    this.mentionPositionAbove.set(shouldPositionAbove);

    let top = shouldPositionAbove ? rect.top : rect.bottom + 4;
    if (top < 0) top = 4;

    let left = rect.left;
    const dropdownWidth = 320;
    if (left + dropdownWidth > viewportWidth) {
      left = viewportWidth - dropdownWidth - 4;
    }

    this.mentionPosition.set({ top, left });
  }

  onMentionSelected(bot: BotSuggestion): void {
    if (this.mentionCommand) {
      this.mentionCommand({
        id: bot.id,
        handle: bot.handle,
        type: bot.type,
      });
    }
    this.showMentionSuggestions.set(false);
  }

  onMentionDismissed(): void {
    this.showMentionSuggestions.set(false);
  }

  // ---- Thread Loading ----

  private loadThread(messageId: string): void {
    this.isLoading.set(true);
    this.threadMessages.set([]);
    this.thread.set(null);

    this.threadLoad?.unsubscribe();
    this.threadLoad = this.botService.getThreadForMessage(messageId).subscribe({
      next: (result) => {
        if (result) {
          this.thread.set(result.thread);
          this.threadMessages.set(result.messages);
        }
        this.isLoading.set(false);
        this.scrollToBottom();
        this.prefillBotMentions();
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  private subscribeToThreadMessages(messageId: string): void {
    this.realtimeSubscription?.unsubscribe();
    this.realtimeSubscription = this.realtimeService.events$
      .pipe(
        filter(
          (event) =>
            event.action === 'thread_message' &&
            (event.data as Record<string, unknown>)['parentMessageId'] === messageId,
        ),
      )
      .subscribe((event) => {
        const data = event.data as Record<string, unknown>;
        const newMessage = data['message'] as Message;

        if (newMessage) {
          this.threadMessages.update((messages) => {
            if (messages.some((m) => m.id === newMessage.id)) {
              return messages;
            }
            return [...messages, newMessage];
          });
          this.scrollToBottom();
        }
      });
  }

  // ---- Send Message ----

  sendMessage(): void {
    if (!this.editor) return;

    const content = this.trimContent(this.editor.getJSON() as PageContent);
    if (this.isContentEmpty(content)) return;

    const mentions = extractMentions(content) as MentionNodeAttrs[];

    this.editor.commands.clearContent();

    const parentMsg = this.parentMessage();

    this.actionError.set(null);
    this.messageService
      .sendMessage(this.notebookId(), content, { parentMessageId: parentMsg.id })
      .subscribe({
        next: (message) => {
          if (!message) return;
          this.threadMessages.update((messages) =>
            messages.some((m) => m.id === message.id) ? messages : [...messages, message],
          );
          this.scrollToBottom();
          if (mentions.length > 0) this.invokeMentionedBots(mentions, content);
        },
        error: (err: Error) => {
          // Put the text back so nothing is lost, and say what happened.
          if (this.editor?.isEmpty) this.editor.commands.setContent(content);
          this.actionError.set(`Not sent: ${err.message}`);
        },
      });
  }

  continueBot(message: Message, text: string): void {
    const bot = this.allNotebookBots().find((bot) => bot.id === message.userBotId);
    if (!bot || this.actionPending()) return;
    const content: PageContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: bot.id, handle: bot.handle, type: 'bot' } },
            { type: 'text', text: ' ' + text.slice(0, 9000) },
          ],
        },
      ],
    };
    this.actionPending.set(true);
    this.actionError.set(null);
    this.messageService
      .sendMessage(this.notebookId(), content, {
        parentMessageId: this.parentMessage().id,
        forceHttp: true,
      })
      .pipe(
        switchMap(() =>
          this.botService.invokeBot(
            this.notebookId(),
            bot.handle,
            'message',
            this.parentMessage().id,
            {
              mentionText: text.slice(0, 10000),
              fullContent: text.slice(0, 10000),
            },
          ),
        ),
      )
      .subscribe({
        next: () => this.actionPending.set(false),
        error: (err) => {
          this.actionPending.set(false);
          this.actionError.set(err.message || 'Could not send follow-up');
        },
      });
  }

  private invokeMentionedBots(mentions: MentionNodeAttrs[], content: PageContent): void {
    const fullText = extractText(content, { includeNewlines: false });
    this.invokeBots(mentions, fullText, this.parentMessage().id);
  }

  private invokeBots(mentions: MentionNodeAttrs[], fullText: string, sourceId: string): void {
    mentions
      .filter((m) => m.type === 'bot')
      .forEach((mention) => {
        this.botService
          .invokeBot(this.notebookId(), mention.handle, 'message', sourceId, {
            mentionText: fullText,
            fullContent: fullText,
          })
          .subscribe({
            error: (err) => {
              console.error(`Failed to invoke bot @${mention.handle}:`, err);
            },
          });
      });
  }

  private trimContent(content: PageContent): PageContent {
    if (!content?.content) return content;
    const nodes = [...content.content];
    while (nodes.length > 0) {
      const last = nodes[nodes.length - 1];
      if (last.type === 'paragraph' && (!last.content || last.content.length === 0)) {
        nodes.pop();
      } else {
        break;
      }
    }
    return { ...content, content: nodes };
  }

  private isContentEmpty(content: PageContent): boolean {
    if (!content || !content.content) return true;
    if (content.content.length === 0) return true;
    if (
      content.content.length === 1 &&
      content.content[0].type === 'paragraph' &&
      (!content.content[0].content || content.content[0].content.length === 0)
    ) {
      return true;
    }
    return false;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (this.messageListRef?.nativeElement) {
          const el = this.messageListRef.nativeElement;
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }
}
