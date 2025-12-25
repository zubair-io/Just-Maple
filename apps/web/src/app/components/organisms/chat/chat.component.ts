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
import type { Message, NoteContent, TypingEvent, ChatEvent } from '@maple/shared';
import { extractMentions, extractText } from '@maple/shared';
import { Subscription, Subject, debounceTime, switchMap, takeUntil, filter } from 'rxjs';

// Track pending bot invocations for loading states
interface PendingBotInvocation {
  invocationId: string;
  messageId: string;
  botHandle: string;
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

  readonly tagId = input.required<string>();

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
  mentionCommand: ((props: Record<string, unknown>) => void) | null = null;
  private readonly mentionSearch$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  // Bot invocation tracking
  readonly pendingBotInvocations = signal<PendingBotInvocation[]>([]);
  readonly botsTyping = signal<{ messageId: string; botHandle: string }[]>([]);

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
      const tagId = this.tagId();
      if (tagId && tagId !== this.lastTagId) {
        this.lastTagId = tagId;
        this.loadMessages(tagId);
        this.subscribeToTyping(tagId);
        this.subscribeToBotEvents(tagId);
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

    // Setup mention search with debounce
    this.mentionSearch$
      .pipe(
        debounceTime(200),
        switchMap((query) => {
          this.mentionSuggestionsLoading.set(true);
          return this.botService.searchBots(this.tagId(), query);
        }),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (bots) => {
          this.mentionSuggestions.set(bots);
          this.mentionSuggestionsLoading.set(false);
        },
        error: () => {
          this.mentionSuggestions.set([]);
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
          if (this.showMentionSuggestions()) {
            return false;
          }
          this.sendMessage();
          return true; // Prevent default (new paragraph)
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
        }),
        Placeholder.configure({
          placeholder: 'Type a message...',
        }),
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
        SendOnEnter,
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
    }
    this.showMentionSuggestions.set(false);
  }

  onMentionDismissed(): void {
    this.showMentionSuggestions.set(false);
  }

  private loadMessages(tagId: string): void {
    // Reset state for new tag
    this.lastMessageCount = 0;
    this.isAtBottom = true;

    this.messageService.loadMessages(tagId).subscribe({
      next: () => {
        // Scroll to bottom on initial load
        this.scrollToBottom();
      },
    });
  }

  private subscribeToTyping(tagId: string): void {
    this.typingSubscription?.unsubscribe();
    this.typingSubscription = this.realtimeService.typingForTag(tagId).subscribe((event) => {
      this.handleTypingEvent(event);
    });
  }

  private subscribeToBotEvents(tagId: string): void {
    // Subscribe to bot invocation events for this tag
    this.realtimeService
      .messagesForTag(tagId)
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

    // Add to pending invocations
    this.pendingBotInvocations.update((invocations) => [
      ...invocations.filter((i) => i.invocationId !== invocationId),
      {
        invocationId,
        messageId: sourceId,
        botHandle: 'bot', // Will be updated when we have more info
        status: 'running',
      },
    ]);

    // Add to bots typing indicator
    this.botsTyping.update((bots) => [
      ...bots.filter((b) => b.messageId !== sourceId),
      { messageId: sourceId, botHandle: 'bot' },
    ]);
  }

  private handleBotCompleted(data: Record<string, unknown>): void {
    const invocationId = data['invocationId'] as string;
    const sourceId = data['sourceId'] as string;

    // Update invocation status
    this.pendingBotInvocations.update((invocations) =>
      invocations.map((i) =>
        i.invocationId === invocationId ? { ...i, status: 'completed' as const } : i,
      ),
    );

    // Remove from bots typing
    this.botsTyping.update((bots) => bots.filter((b) => b.messageId !== sourceId));

    // Clean up completed invocations after a short delay
    setTimeout(() => {
      this.pendingBotInvocations.update((invocations) =>
        invocations.filter((i) => i.invocationId !== invocationId),
      );
    }, 1000);
  }

  private handleBotFailed(data: Record<string, unknown>): void {
    const invocationId = data['invocationId'] as string;
    const sourceId = data['sourceId'] as string;
    const error = data['error'] as string | undefined;

    // Update invocation status
    this.pendingBotInvocations.update((invocations) =>
      invocations.map((i) =>
        i.invocationId === invocationId ? { ...i, status: 'failed' as const, error } : i,
      ),
    );

    // Remove from bots typing
    this.botsTyping.update((bots) => bots.filter((b) => b.messageId !== sourceId));

    // Keep failed invocations visible for longer
    setTimeout(() => {
      this.pendingBotInvocations.update((invocations) =>
        invocations.filter((i) => i.invocationId !== invocationId),
      );
    }, 5000);
  }

  private handleThreadMessage(data: Record<string, unknown>): void {
    const parentMessageId = data['parentMessageId'] as string;

    // Mark the parent message as having a thread (this triggers UI update)
    this.messageService.markMessageHasThread(parentMessageId);

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

  // Check if a bot is "typing" for a message
  isBotTyping(messageId: string): boolean {
    return this.botsTyping().some((b) => b.messageId === messageId);
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
    this.messageService.sendTyping(this.tagId(), true);

    // Set timeout to send typing stop
    this.typingTimeout = setTimeout(() => {
      this.messageService.sendTyping(this.tagId(), false);
    }, 3000);
  }

  sendMessage(): void {
    if (!this.editor) return;

    const content = this.editor.getJSON() as NoteContent;

    // Check if empty
    if (this.isContentEmpty(content)) return;

    // Extract mentions from content
    const mentions = this.extractMentionsFromContent(content);

    // When sending own message, always scroll to bottom
    this.isAtBottom = true;

    this.messageService.sendMessage(this.tagId(), content).subscribe({
      next: (message) => {
        this.editor?.commands.clearContent();
        this.scrollToBottom();

        // Invoke bots for each mention
        if (mentions.length > 0) {
          this.invokeMentionedBots(message, mentions, content);
        }
      },
    });

    // Clear typing indicator
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.messageService.sendTyping(this.tagId(), false);
  }

  private extractMentionsFromContent(content: NoteContent): MentionNodeAttrs[] {
    // Use shared utility and map to local MentionNodeAttrs type
    return extractMentions(content) as MentionNodeAttrs[];
  }

  private invokeMentionedBots(
    message: Message,
    mentions: MentionNodeAttrs[],
    content: NoteContent,
  ): void {
    const fullText = this.extractTextFromContent(content);

    mentions
      .filter((m) => m.type === 'bot')
      .forEach((mention) => {
        this.botService
          .invokeBot(this.tagId(), mention.handle, 'message', message._id, {
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

  private extractTextFromContent(content: NoteContent): string {
    // Use shared utility (without newlines for chat messages)
    return extractText(content, { includeNewlines: false });
  }

  private isContentEmpty(content: NoteContent): boolean {
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

  trackByMessage(index: number, message: Message): string {
    return message._id;
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.messageListRef?.nativeElement) {
        this.messageListRef.nativeElement.scrollTop =
          this.messageListRef.nativeElement.scrollHeight;
        this.isAtBottom = true;
        this.showScrollButton.set(false);
        this.newMessageCount.set(0);
      }
    }, 100);
  }

  scrollToBottomClicked(): void {
    this.scrollToBottom();
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
