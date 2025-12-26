import { Component, input, output, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import type { Message } from '@maple/shared';
import { ContentRendererComponent } from '../../atoms/content-renderer/content-renderer.component';
import { ProfileAvatarComponent } from '../../atoms';
import { ChatThreadComponent } from './chat-thread.component';

@Component({
  selector: 'app-chat-message',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    ContentRendererComponent,
    ProfileAvatarComponent,
    ChatThreadComponent,
  ],
  template: `
    <div
      [id]="'message-' + message()._id"
      class="message-wrapper"
      [class.grouped]="isGrouped()"
      (click)="onMessageClick()"
    >
      <div class="message-content">
        <!-- Avatar (hidden when grouped) -->
        @if (!isGrouped()) {
          <app-profile-avatar
            [email]="message().senderEmail ?? 'unknown@justmaple.app'"
            [displayName]="message().senderDisplayName"
            [profilePictureUrl]="message().senderProfilePictureUrl"
            size="sm"
            class="avatar"
          />
        } @else {
          <div class="avatar-spacer"></div>
        }

        <!-- Message bubble with two rows -->
        <div class="bubble-container">
          <!-- Top row: Name and datetime (hidden when grouped) -->
          @if (!isGrouped()) {
            <div class="message-header">
              <span class="sender-name">{{ senderDisplay() }}</span>
              <span class="timestamp">{{ message().createdAt | date: 'short' }}</span>
            </div>
          }

          <!-- Bottom row: Message content -->
          <div class="message-body">
            <app-content-renderer [content]="message().content" />
            @if (message().editedAt) {
              <span class="edited">(edited)</span>
            }
          </div>

          <!-- Thread replies -->
          @if (message().hasThread) {
            <app-chat-thread [messageId]="message()._id" [hasThread]="true" />
          }

          <!-- Bot typing indicator -->
          @if (botTyping()) {
            <div class="bot-typing">
              <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span class="typing-text">Bot is thinking...</span>
            </div>
          }

          <!-- Bot error -->
          @if (botError()) {
            <div class="bot-error">
              <span class="material-symbols-rounded">error</span>
              <span>{{ botError() }}</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .message-wrapper {
        width: 100%;
        display: flex;
        justify-content: center;
        margin-bottom: 12px;
        cursor: pointer;
        transition: background-color 0.2s;
        border-radius: 8px;

        &:hover {
          background-color: rgba(0, 0, 0, 0.02);
        }

        &.grouped {
          margin-bottom: 2px;
        }
      }

      .message-content {
        width: 100%;
        max-width: 800px;
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }

      .avatar {
        flex-shrink: 0;
        margin-top: 2px;
      }

      .avatar-spacer {
        width: 28px; // Same as sm avatar size (w-7)
        flex-shrink: 0;
      }

      .bubble-container {
        flex: 1;
        min-width: 0; // Allow text to wrap
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .message-header {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .sender-name {
        // font-size: 14px;
        font-weight: 600;
        color: var(--color-text-main);
      }

      .timestamp {
        font-size: 12px;
        color: var(--color-text-muted);
      }

      .message-body {
        // font-size: 14px;
        color: var(--color-text-main);
        line-height: 1.5;
        word-wrap: break-word;
      }

      .edited {
        font-size: 11px;
        font-style: italic;
        color: var(--color-text-muted);
        margin-left: 4px;
      }

      .bot-typing {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        padding: 8px 12px;
        background: var(--color-bg-elevated, rgba(0, 0, 0, 0.05));
        border-radius: 8px;
        width: fit-content;
      }

      .typing-dots {
        display: flex;
        gap: 4px;
      }

      .typing-dots span {
        width: 6px;
        height: 6px;
        background: var(--color-primary);
        border-radius: 50%;
        animation: bounce 1.4s infinite ease-in-out both;
      }

      .typing-dots span:nth-child(1) {
        animation-delay: -0.32s;
      }

      .typing-dots span:nth-child(2) {
        animation-delay: -0.16s;
      }

      @keyframes bounce {
        0%,
        80%,
        100% {
          transform: scale(0);
        }
        40% {
          transform: scale(1);
        }
      }

      .typing-text {
        font-size: 12px;
        color: var(--color-text-muted);
        font-style: italic;
      }

      .bot-error {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 8px 12px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 8px;
        color: rgb(239, 68, 68);
        font-size: 13px;
        width: fit-content;
      }

      .bot-error .material-symbols-rounded {
        font-size: 16px;
      }
    `,
  ],
})
export class ChatMessageComponent {
  readonly message = input.required<Message>();
  readonly isOwn = input<boolean>(false);
  readonly isGrouped = input<boolean>(false);
  readonly botTyping = input<boolean>(false);
  readonly botError = input<string | undefined>(undefined);

  readonly messageClicked = output<Message>();

  readonly senderDisplay = computed(() => {
    const msg = this.message();
    if (msg.senderDisplayName) return msg.senderDisplayName;
    return msg.senderEmail?.split('@')[0] || 'Unknown';
  });

  onMessageClick(): void {
    this.messageClicked.emit(this.message());
  }
}
