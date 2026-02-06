import {
  Component,
  input,
  signal,
  computed,
  effect,
  inject,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  DestroyRef,
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
  styleUrl: './chat.component.scss',
})
export class ChatComponent implements AfterViewInit, OnDestroy {
  @ViewChild('messageList') private messageListRef?: ElementRef<HTMLElement>;
  @ViewChild('editorElement', { static: false }) private editorRef?: ElementRef<HTMLElement>;

  private readonly messageService = inject(MessageService);
  private readonly realtimeService = inject(RealtimeService);
  private readonly authService = inject(AuthService);
  private readonly uiStateService = inject(UiStateService);
  private readonly botService = inject(BotService);
  private readonly destroyRef = inject(DestroyRef);

  readonly notebookId = input.required<string>();

  readonly messages = this.messageService.messagesForTag;
  readonly isLoading = this.messageService.isLoading;
  readonly hasMore = this.messageService.hasMore;
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

  // Reply functionality
  readonly replyingToMessage = signal<Message | null>(null);

  // Compute messages with grouping information
  readonly messagesWithGrouping = computed(() => {
    const messages = this.messages();
    const FIVE_MINUTES = 5 * 60 * 1000;

    return messages.map((message, index): MessageWithGrouping => {
      if (index === 0) {
        return { ...message, isGrouped: false };
      }

      const prevMessage = messages[index - 1];
      const isSameUser = message.userId === prevMessage.userId;
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
  private lastTagId: string | null = null;
  private isAtBottom = true;
  private lastMessageCount = 0;

  constructor() {
    effect(() => {
      const user = this.authService.user();
      this.currentUserId.set(user?._id || null);
    });

    effect(() => {
      const notebookId = this.notebookId();
      if (notebookId && notebookId !== this.lastTagId) {
        this.lastTagId = notebookId;
        this.loadMessages(notebookId);
        this.subscribeToTyping(notebookId);
        this.subscribeToBotEvents(notebookId);
      }
    });

    // Watch for new messages and handle scroll behavior
    effect(() => {
      const currentMessages = this.messages();
      const currentCount = currentMessages.length;

      // Check if new messages arrived (not initial load or load more)
      if (this.lastMessageCount > 0 && currentCount > this.lastMessageCount) {
        const newCount = currentCount - this.lastMessageCount;
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

      this.lastMessageCount = currentCount;
    });

    this.destroyRef.onDestroy(() => {
      this.typingSubscription?.unsubscribe();
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
  }

  ngOnDestroy(): void {
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

  private loadMessages(notebookId: string): void {
    // Reset state for new tag
    this.lastMessageCount = 0;
    this.isAtBottom = true;

    this.messageService.loadMessages(notebookId).subscribe({
      next: () => {
        // Scroll to bottom on initial load with longer delay to ensure rendering
        setTimeout(() => {
          this.scrollToBottom();
        }, 300);
      },
    });
  }

  private subscribeToTyping(notebookId: string): void {
    this.typingSubscription?.unsubscribe();
    this.typingSubscription = this.realtimeService.typingForTag(notebookId).subscribe((event) => {
      this.handleTypingEvent(event);
    });
  }

  private subscribeToBotEvents(notebookId: string): void {
    // Subscribe to bot invocation events for this tag
    this.realtimeService
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

  // Check if a message has a pending bot invocation
  hasPendingBot(messageId: string): boolean {
    return this.pendingBotInvocations().some(
      (i) => i.messageId === messageId && i.status === 'running',
    );
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

    // Auto-remove after 5 seconds
    setTimeout(() => {
      this.typingUsers.set(this.typingUsers().filter((t) => t.userId !== event.userId));
    }, 5000);
  }

  private handleTyping(): void {
    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Send typing start
    this.messageService.sendTyping(this.notebookId(), true);

    // Set timeout to send typing stop
    this.typingTimeout = setTimeout(() => {
      this.messageService.sendTyping(this.notebookId(), false);
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

    const replyingTo = this.replyingToMessage();

    if (replyingTo) {
      // Clear reply state immediately
      this.clearReply();

      // Replying to a message - backend will create thread if needed
      this.messageService
        .sendMessage(this.notebookId(), content, { parentMessageId: replyingTo.id })
        .subscribe({
          next: (message) => {
            // Invoke bots for each mention (using parent message as source)
            if (message && mentions.length > 0) {
              this.invokeMentionedBots(message, mentions, content);
            }
          },
        });
    } else {
      // Regular top-level message
      this.sendRegularMessage(content, mentions);
    }

    // Clear typing indicator
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.messageService.sendTyping(this.notebookId(), false);
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
    // Don't auto-scroll when loading older messages
    this.isAtBottom = false;
    this.messageService.loadMore().subscribe();
  }

  trackByMessage(_index: number, message: Message): string {
    return message.id;
  }

  private scrollToBottom(): void {
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (this.messageListRef?.nativeElement) {
          const element = this.messageListRef.nativeElement;
          element.scrollTop = element.scrollHeight;
          this.isAtBottom = true;
          this.showScrollButton.set(false);
          this.newMessageCount.set(0);
        }
      });
    });
  }

  scrollToBottomClicked(): void {
    this.scrollToBottom();
  }

  // Reply functionality
  selectMessageForReply(message: Message): void {
    this.replyingToMessage.set(message);

    // If message has a thread, load it and add bot mentions
    if (message.hasThread) {
      // Use cached bots
      const botSuggestionMap = new Map(this.allNotebookBots().map((s) => [s.id, s]));

      // Fetch thread messages
      this.botService.getThreadForMessage(message.id).subscribe((result) => {
        if (result && this.editor) {
          // Extract unique bots from thread messages
          const botHandles = new Map<string, { id: string; handle: string }>();

          for (const msg of result.messages) {
            if (msg.senderType === 'bot' && msg.userBotId) {
              // Look up the bot from suggestions
              const botSuggestion = botSuggestionMap.get(msg.userBotId);

              if (botSuggestion) {
                botHandles.set(msg.userBotId, {
                  id: msg.userBotId,
                  handle: botSuggestion.handle,
                });
              }
            }
          }

          // Insert mentions for all bots in the thread
          if (botHandles.size > 0) {
            const mentions = Array.from(botHandles.values()).map((bot) => ({
              type: 'mention',
              attrs: {
                id: bot.id,
                handle: bot.handle,
                type: 'bot',
              },
            }));

            // Add space between each mention
            const content: any[] = [];
            mentions.forEach((mention, index) => {
              content.push(mention);
              if (index < mentions.length - 1) {
                content.push({ type: 'text', text: ' ' });
              }
            });
            content.push({ type: 'text', text: ' ' });

            // Clear existing content and insert mentions
            this.editor.chain().focus().clearContent().insertContentAt(0, content).run();
          }
        }
      });
    }

    // Focus the editor when selecting a message for reply
    setTimeout(() => {
      (
        this.editorRef?.nativeElement.querySelector('[contenteditable]') as HTMLInputElement
      )?.focus();
    }, 100);
  }

  clearReply(): void {
    this.replyingToMessage.set(null);
  }

  scrollToMessage(messageId: string): void {
    const messageElement = document.getElementById(`message-${messageId}`);
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight the message briefly
      messageElement.classList.add('highlight-message');
      setTimeout(() => {
        messageElement.classList.remove('highlight-message');
      }, 2000);
    }
  }

  onScroll(): void {
    const el = this.messageListRef?.nativeElement;
    if (!el) return;

    // Load more when scrolled near top
    if (el.scrollTop < 100 && this.hasMore() && !this.isLoading()) {
      this.loadMore();
    }

    // Track if user is at bottom (within 50px)
    this.isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

    // Hide scroll button and reset count when user reaches bottom
    if (this.isAtBottom) {
      this.showScrollButton.set(false);
      this.newMessageCount.set(0);
    }
  }

  isOwnMessage(message: Message): boolean {
    return message.userId === this.currentUserId();
  }
}
