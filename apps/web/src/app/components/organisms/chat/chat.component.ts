import {
  Component,
  input,
  signal,
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
import { ChatMessageComponent } from './chat-message.component';
import { ChatTypingComponent } from './chat-typing.component';
import type { Message, NoteContent, TypingEvent } from '@maple/shared';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, ChatMessageComponent, ChatTypingComponent],
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
  private readonly destroyRef = inject(DestroyRef);

  readonly tagId = input.required<string>();

  readonly messages = this.messageService.messagesForTag;
  readonly isLoading = this.messageService.isLoading;
  readonly hasMore = this.messageService.hasMore;
  readonly currentUserId = signal<string | null>(null);
  readonly typingUsers = signal<TypingEvent[]>([]);
  readonly showScrollButton = signal(false);
  readonly newMessageCount = signal(0);

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

    // When sending own message, always scroll to bottom
    this.isAtBottom = true;

    this.messageService.sendMessage(this.tagId(), content).subscribe({
      next: () => {
        this.editor?.commands.clearContent();
        this.scrollToBottom();
      },
    });

    // Clear typing indicator
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.messageService.sendTyping(this.tagId(), false);
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
