import { ChatViewport } from './chat-viewport';
import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  inject,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  DestroyRef,
  ChangeDetectionStrategy,
  untracked,
  afterRenderEffect,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { MessageService } from '../../../services/message.service';
import { RealtimeService } from '../../../services/realtime.service';
import { AuthService } from '../../../services/auth.service';
import { UiStateService } from '../../../services/ui-state.service';
import { BotService, type BotSuggestion } from '../../../services/bot.service';
import { ChatMessageComponent } from './chat-message.component';
import { ChatTypingComponent } from './chat-typing.component';
import { BotActivityService } from '../../../services/bot-activity.service';
import { MentionSuggestionComponent } from './mention-suggestion.component';
import { Mention, type MentionNodeAttrs } from './extensions/mention';
import type { Message, PageContent, TypingEvent, ChatEvent } from '@maple/shared';
import { extractMentions, extractText } from '@maple/shared';
import { Subscription, Subject, takeUntil, filter, combineLatest, switchMap, of } from 'rxjs';

// Track pending bot invocations for loading states
interface PendingBotInvocation {
  invocationId: string;
  messageId: string;
  botHandle: string;
  userBotId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

interface MessageWithGrouping extends Message {
  isGrouped: boolean;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, ChatMessageComponent, ChatTypingComponent, MentionSuggestionComponent],
  templateUrl: './chat.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './chat.component.scss',
})
export class ChatComponent implements AfterViewInit, OnDestroy {
  @ViewChild('messageList') private messageListRef?: ElementRef<HTMLElement>;
  @ViewChild('messageContent') private messageContentRef?: ElementRef<HTMLElement>;
  private viewport?: ChatViewport;
  private historyLoad?: Subscription;
  @ViewChild('editorElement', { static: false }) private editorRef?: ElementRef<HTMLElement>;

  private readonly messageService = inject(MessageService);
  private readonly realtimeService = inject(RealtimeService);
  private readonly authService = inject(AuthService);
  private readonly uiStateService = inject(UiStateService);
  private readonly botService = inject(BotService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly botActivity = inject(BotActivityService);

  readonly notebookId = input.required<string>();

  /** The messages page being shown; without it, the notebook's default chat. */

  readonly pageId = input<string | null>(null);

  readonly messages = this.messageService.messagesForTag;
  readonly isLoading = this.messageService.isLoading;
  readonly hasMore = this.messageService.hasMore;
  readonly loadError = this.messageService.historyError;
  readonly currentUserId = signal<string | null>(null);
  readonly typingUsers = signal<TypingEvent[]>([]);
  readonly showScrollButton = signal(false);
  readonly newMessageCount = signal(0);

  // Mention autocomplete state
  readonly showMentionSuggestions = signal(false);
  readonly mentionSuggestions = signal<BotSuggestion[]>([]);
  readonly mentionSuggestionsLoading = signal(false);
  readonly mentionPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  readonly mentionPositionAbove = signal(false);

  // Reactively load bots when notebook changes or cache is invalidated
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

  // Bot invocation tracking
  readonly pendingBotInvocations = signal<PendingBotInvocation[]>([]);

  // Thread panel
  readonly openThread = output<Message>();

  /** People typing (named when they've posted here) plus bots answering in the chat itself. */
  readonly typingNames = computed(() => {
    const messages = this.messageService.messagesForTag();
    const people = this.typingUsers().map(
      (typing) =>
        messages.find((m) => m.userId === typing.userId && m.senderType !== 'bot')
          ?.senderDisplayName || 'Someone',
    );
    return [...people, ...(this.botActivity.topLevelByNotebook().get(this.notebookId()) ?? [])];
  });
  /** Messages that failed to send, shown with Retry and Delete. */
  readonly failedSends = this.messageService.failedSends;

  retrySend(tempId: string): void {
    const failed = this.messageService.takeFailedSend(tempId);
    if (!failed) return;
    // Same path as a fresh send, so bots mentioned in it are invoked.
    this.sendRegularMessage(failed.content, this.extractMentionsFromContent(failed.content));
  }

  discardSend(tempId: string): void {
    this.messageService.discardFailedSend(tempId);
  }

  /** Bots writing a reply in each message's thread. */
  readonly replyingInThread = this.botActivity.inThreadBySource;

  // Compute messages with grouping information
  readonly messagesWithGrouping = computed(() => {
    const messages = this.messages();
    const FIVE_MINUTES = 5 * 60 * 1000;

    return messages.map((message, index): MessageWithGrouping => {
      if (index === 0) {
        return { ...message, isGrouped: false };
      }

      const prevMessage = messages[index - 1];
      const isSameUser = senderKey(message) === senderKey(prevMessage);
      const timeDiff =
        new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime();
      const isWithinFiveMinutes = timeDiff < FIVE_MINUTES;

      return {
        ...message,
        isGrouped: isSameUser && isWithinFiveMinutes,
      };
    });
  });

  private editor: Editor | null = null;
  private typingSubscription: Subscription | null = null;
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastLoadedChat: string | null = null;
  private isAtBottom = true;
  private lastNewestId: string | null = null;
  private botEventsSubscription: Subscription | null = null;
  private readonly typingExpiry = new Map<string, ReturnType<typeof setTimeout>>();
  private lastTypingSentAt = 0;

  constructor() {
    afterRenderEffect(() => {
      this.messages();
      this.typingNames();
      this.viewport?.layoutChanged();
    });
    effect(() => {
      const user = this.authService.user();
      this.currentUserId.set(user?._id || null);
    });

    effect(() => {
      const notebookId = this.notebookId();
      const pageId = this.pageId();
      const key = `${notebookId}|${pageId ?? ''}`;
      if (notebookId && key !== this.lastLoadedChat) {
        const notebookChanged = !this.lastLoadedChat?.startsWith(`${notebookId}|`);
        this.lastLoadedChat = key;
        untracked(() => {
          this.loadMessages(notebookId, pageId);
          if (notebookChanged) {
            this.subscribeToTyping(notebookId);
            this.subscribeToBotEvents(notebookId);
          }
        });
      }
    });

    // Watch for new messages and handle scroll behavior
    effect(() => {
      const currentMessages = this.messages();
      const newest = currentMessages.at(-1)?.id ?? null;

      // Only messages after the previous newest are new; older history loaded
      // at the top (load more) never counts.
      const previousIndex = this.lastNewestId
        ? currentMessages.findIndex((m) => m.id === this.lastNewestId)
        : -1;
      const newCount = previousIndex >= 0 ? currentMessages.length - 1 - previousIndex : 0;
      if (newCount > 0) {
        // New message(s) came in
        if (this.isAtBottom) {
          // User was at bottom, auto-scroll
          this.scrollToBottom();
        } else {
          // User was scrolled up, show the button and increment count
          this.showScrollButton.set(true);
          this.newMessageCount.update((c) => c + newCount);
        }
      }

      this.lastNewestId = newest;
    });

    this.destroyRef.onDestroy(() => {
      this.typingSubscription?.unsubscribe();
      this.botEventsSubscription?.unsubscribe();
      this.typingExpiry.forEach((timer) => clearTimeout(timer));
      if (this.typingTimeout) {
        clearTimeout(this.typingTimeout);
      }
      this.destroy$.next();
      this.destroy$.complete();
    });

    // Setup mention search with client-side filtering (no debounce needed)
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
    if (this.messageListRef && this.messageContentRef) {
      this.viewport = new ChatViewport(
        this.messageListRef.nativeElement,
        this.messageContentRef.nativeElement,
      );
      if (!this.isLoading()) this.viewport.completeInitialLoad();
    }
  }

  ngOnDestroy(): void {
    this.historyLoad?.unsubscribe();
    this.viewport?.dispose();
    this.editor?.destroy();
    this.uiStateService.setChatInputFocused(false);
  }

  private initEditor(): void {
    if (!this.editorRef?.nativeElement) return;

    // Custom extension to handle Enter key for sending messages
    const SendOnEnter = Extension.create({
      name: 'sendOnEnter',
      addKeyboardShortcuts: () => ({
        Enter: () => {
          // Don't send if mention suggestions are showing
          // Return true to prevent ProseMirror from creating a new paragraph
          if (this.showMentionSuggestions()) {
            return true;
          }
          this.sendMessage();
          return true;
        },
        'Shift-Enter': () => {
          // Allow Shift+Enter to create new line
          return false;
        },
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
          placeholder: 'Type a message...',
        }) as any,
        Mention.configure({
          HTMLAttributes: {
            class: 'mention',
          },
          suggestion: {
            items: ({ query }) => {
              // Trigger search - results handled async via mentionSearch$
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
                  // Consume Enter and arrow keys so ProseMirror doesn't handle them
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
              };
            },
          },
        }) as any,
        SendOnEnter as any,
      ],
      content: '',
      onUpdate: () => {
        this.handleTyping();
      },
      onFocus: () => {
        this.uiStateService.setChatInputFocused(true);
      },
      onBlur: () => {
        this.uiStateService.setChatInputFocused(false);
      },
    });
  }

  private updateMentionPosition(clientRect: (() => DOMRect | null) | null | undefined): void {
    if (!clientRect) return;
    const rect = clientRect();
    if (!rect) return;

    // Estimate dropdown height (max-height is 280px from CSS)
    const dropdownHeight = 280;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Check if there's enough space below
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Position above if not enough space below
    const shouldPositionAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
    this.mentionPositionAbove.set(shouldPositionAbove);

    // Calculate top position
    let top = shouldPositionAbove ? rect.top : rect.bottom + 4;

    // Ensure it doesn't go off the top
    if (top < 0) {
      top = 4;
    }

    // Calculate left position and ensure it doesn't go off the right edge
    let left = rect.left;
    const dropdownWidth = 320; // max-width from CSS
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

  /** Loads the open chat: this page's messages, or the notebook's default chat without one. */
  private loadMessages(notebookId: string, pageId: string | null): void {
    this.historyLoad?.unsubscribe();
    this.viewport?.reset();
    // Reset state for the selected page, including scheduled scroll work.
    this.lastNewestId = null;
    this.isAtBottom = true;
    this.typingUsers.set([]);
    this.typingExpiry.forEach((timer) => clearTimeout(timer));
    this.typingExpiry.clear();
    this.pendingBotInvocations.set([]);
    this.showScrollButton.set(false);
    this.newMessageCount.set(0);

    const load = pageId
      ? this.messageService.loadMessagesByPageId(pageId)
      : this.messageService.loadMessages(notebookId);
    this.historyLoad = load.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.viewport?.completeInitialLoad(),
    });
  }

  private subscribeToTyping(notebookId: string): void {
    this.typingSubscription?.unsubscribe();
    this.typingSubscription = this.realtimeService.typingForTag(notebookId).subscribe((event) => {
      this.handleTypingEvent(event);
    });
  }

  private subscribeToBotEvents(notebookId: string): void {
    // One subscription per open notebook; switching notebooks replaces it.
    this.botEventsSubscription?.unsubscribe();
    this.botEventsSubscription = this.realtimeService
      .messagesForTag(notebookId)
      .pipe(
        filter((event) => this.isBotEvent(event)),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        this.handleBotEvent(event);
      });
  }

  private isBotEvent(event: ChatEvent): boolean {
    return [
      'bot_invocation_started',
      'bot_invocation_completed',
      'bot_invocation_failed',
      'thread_message',
    ].includes(event.action);
  }

  private handleBotEvent(event: ChatEvent): void {
    const data = event.data as Record<string, unknown>;

    switch (event.action) {
      case 'bot_invocation_started':
        this.handleBotStarted(data);
        break;
      case 'bot_invocation_completed':
        this.handleBotCompleted(data);
        break;
      case 'bot_invocation_failed':
        this.handleBotFailed(data);
        break;
      case 'thread_message':
        this.handleThreadMessage(data);
        break;
    }
  }

  private handleBotStarted(data: Record<string, unknown>): void {
    const invocationId = data['invocationId'] as string;
    const sourceId = data['sourceId'] as string;
    const userBotId = data['userBotId'] as string | undefined;
    const botHandle = (data['botHandle'] as string) || 'bot';

    // Add to pending invocations
    this.pendingBotInvocations.update((invocations) => [
      ...invocations.filter((i) => i.invocationId !== invocationId),
      {
        invocationId,
        messageId: sourceId,
        botHandle,
        userBotId,
        status: 'running',
      },
    ]);
  }

  private handleBotCompleted(data: Record<string, unknown>): void {
    const invocationId = data['invocationId'] as string;

    // Update invocation status
    this.pendingBotInvocations.update((invocations) =>
      invocations.map((i) =>
        i.invocationId === invocationId ? { ...i, status: 'completed' as const } : i,
      ),
    );

    // Clean up completed invocations after a short delay
    setTimeout(() => {
      this.pendingBotInvocations.update((invocations) =>
        invocations.filter((i) => i.invocationId !== invocationId),
      );
    }, 1000);
  }

  private handleBotFailed(data: Record<string, unknown>): void {
    const invocationId = data['invocationId'] as string;
    const error = data['error'] as string | undefined;

    // Update invocation status
    this.pendingBotInvocations.update((invocations) =>
      invocations.map((i) =>
        i.invocationId === invocationId ? { ...i, status: 'failed' as const, error } : i,
      ),
    );

    // Keep failed invocations visible for longer
    setTimeout(() => {
      this.pendingBotInvocations.update((invocations) =>
        invocations.filter((i) => i.invocationId !== invocationId),
      );
    }, 5000);
  }

  private handleThreadMessage(data: Record<string, unknown>): void {
    const parentMessageId = data['parentMessageId'] as string;
    const message = data['message'] as Record<string, unknown> | undefined;

    // Mark the parent message as having a thread (this triggers UI update)
    this.messageService.markMessageHasThread(parentMessageId);

    // If the message is from a bot, clear the specific pending invocation
    if (message?.['senderType'] === 'bot') {
      const invocationId = message['invocationId'] as string | undefined;
      const userBotId = message['userBotId'] as string | undefined;

      this.pendingBotInvocations.update((invocations) => {
        // First priority: match by invocationId if available (most precise)
        if (invocationId) {
          return invocations.filter((i) => i.invocationId !== invocationId);
        }

        // Second priority: match by userBotId + messageId
        if (userBotId) {
          let removed = false;
          return invocations.filter((i) => {
            if (!removed && i.messageId === parentMessageId && i.userBotId === userBotId) {
              removed = true;
              return false; // Remove only the first matching invocation
            }
            return true;
          });
        }

        // Fallback: no identifiers available, keep all invocations
        // This prevents accidentally canceling other bots waiting on the same message
        return invocations;
      });
    }

    // If user is at bottom, scroll to show the new thread indicator
    if (this.isAtBottom) {
      this.scrollToBottom();
    }
  }

  // Check if a message has a failed bot invocation
  hasFailedBot(messageId: string): string | undefined {
    const failed = this.pendingBotInvocations().find(
      (i) => i.messageId === messageId && i.status === 'failed',
    );
    return failed?.error;
  }

  private handleTypingEvent(event: TypingEvent): void {
    // Don't show own typing
    if (event.userId === this.currentUserId()) return;

    const current = this.typingUsers();
    if (event.isTyping) {
      // Add if not already present
      if (!current.some((t) => t.userId === event.userId)) {
        this.typingUsers.set([...current, event]);
      }
    } else {
      // Remove
      this.typingUsers.set(current.filter((t) => t.userId !== event.userId));
    }

    // Expire 5 seconds after the latest event from this person (not the first one).
    clearTimeout(this.typingExpiry.get(event.userId));
    this.typingExpiry.set(
      event.userId,
      setTimeout(() => {
        this.typingExpiry.delete(event.userId);
        this.typingUsers.update((users) => users.filter((t) => t.userId !== event.userId));
      }, 5000),
    );
  }

  private handleTyping(): void {
    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Announce typing at most every 3 seconds, not on every keystroke.
    const now = Date.now();
    if (now - this.lastTypingSentAt > 3000) {
      this.lastTypingSentAt = now;
      this.messageService.sendTyping(this.notebookId(), true);
    }

    // Set timeout to send typing stop
    this.typingTimeout = setTimeout(() => {
      this.messageService.sendTyping(this.notebookId(), false);
      this.lastTypingSentAt = 0; // resuming should announce typing again right away
    }, 3000);
  }

  sendMessage(): void {
    if (!this.editor) return;

    const content = this.trimContent(this.editor.getJSON() as PageContent);

    // Check if empty
    if (this.isContentEmpty(content)) return;

    // Extract mentions from content
    const mentions = this.extractMentionsFromContent(content);

    // Optimistic UI update - clear editor immediately
    this.editor.commands.clearContent();

    // When sending own message, always scroll to bottom
    this.isAtBottom = true;
    this.scrollToBottom();

    // Regular top-level message
    this.sendRegularMessage(content, mentions);

    // Clear typing indicator
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.messageService.sendTyping(this.notebookId(), false);
    this.lastTypingSentAt = 0;
  }

  /** Sends a bot UI button's or form's text as a plain message in this chat. */
  sendFollowUp(text: string): void {
    const content: PageContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: text.slice(0, 9000) }] }],
    };
    this.isAtBottom = true;
    this.scrollToBottom();
    this.sendRegularMessage(content, []);
  }

  private sendRegularMessage(content: PageContent, mentions: MentionNodeAttrs[]): void {
    const hasBotMentions = mentions.some((m) => m.type === 'bot');

    // Use HTTP when there are bot mentions so we get the real message ID back
    this.messageService
      .sendMessage(this.notebookId(), content, { forceHttp: hasBotMentions })
      .subscribe({
        next: (message) => {
          // Invoke bots for each mention (only if we have the message)
          if (message && hasBotMentions) {
            this.invokeMentionedBots(message, mentions, content);
          }
        },
        // Failures are shown on the message itself ("Not sent" with Retry).
        error: () => undefined,
      });
  }

  private extractMentionsFromContent(content: PageContent): MentionNodeAttrs[] {
    // Use shared utility and map to local MentionNodeAttrs type
    return extractMentions(content) as MentionNodeAttrs[];
  }

  private invokeMentionedBots(
    message: Message,
    mentions: MentionNodeAttrs[],
    content: PageContent,
  ): void {
    const fullText = this.extractTextFromContent(content);

    // Determine the source message ID for the bot invocation
    // If this message is in a thread, we need to use the thread's parent message ID
    // so that all bot responses go to the same thread (threads are one level deep)
    if (message.threadId) {
      // Message is inside a thread - get the thread to find its parent message ID
      this.botService.getThreadById(message.threadId).subscribe({
        next: (thread) => {
          if (thread) {
            // Use the thread's parent message ID as sourceId
            this.invokeBots(mentions, fullText, thread.parentMessageId);
          } else {
            // Fallback to current message if thread not found
            this.invokeBots(mentions, fullText, message.id);
          }
        },
        error: () => {
          // Fallback to current message on error
          this.invokeBots(mentions, fullText, message.id);
        },
      });
    } else {
      // Top-level message - use its own ID
      this.invokeBots(mentions, fullText, message.id);
    }
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

  private extractTextFromContent(content: PageContent): string {
    // Use shared utility (without newlines for chat messages)
    return extractText(content, { includeNewlines: false });
  }

  private trimContent(content: PageContent): PageContent {
    if (!content?.content) return content;
    // Remove trailing empty paragraphs
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

  loadMore(): void {
    if (!this.hasMore() || this.isLoading()) return;
    this.messageService
      .loadMore()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.viewport?.layoutChanged(),
      });
  }

  retryLoad(): void {
    this.loadMessages(this.notebookId(), this.pageId());
  }

  trackByMessage(_index: number, message: Message): string {
    return message.id;
  }

  private scrollToBottom(): void {
    this.viewport?.followLatest();
    this.isAtBottom = true;
    this.showScrollButton.set(false);
    this.newMessageCount.set(0);
  }

  scrollToBottomClicked(): void {
    this.scrollToBottom();
  }

  onScroll(): void {
    if (!this.viewport) return;
    const atTop = this.viewport.scrolled();
    this.isAtBottom = this.viewport.atBottom;
    this.showScrollButton.set(!this.isAtBottom);
    if (this.isAtBottom) this.newMessageCount.set(0);
    if (atTop && this.hasMore() && !this.isLoading() && !this.loadError()) this.loadMore();
  }

  isOwnMessage(message: Message): boolean {
    return message.senderType !== 'bot' && message.userId === this.currentUserId();
  }
}

/** Who sent a message: a bot (posted under its owner's user id) or the person. */
function senderKey(message: Message): string {
  return message.senderType === 'bot' ? `bot:${message.userBotId}` : `user:${message.userId}`;
}
