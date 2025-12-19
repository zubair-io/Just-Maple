import { Component, input, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import type { Message } from '@maple/shared';
import { ContentRendererComponent } from '../../atoms/content-renderer/content-renderer.component';
import { ProfileAvatarComponent } from '../../atoms';

@Component({
  selector: 'app-chat-message',
  standalone: true,
  imports: [CommonModule, DatePipe, ContentRendererComponent, ProfileAvatarComponent],
  template: `
    <div class="message-wrapper" [class.grouped]="isGrouped()">
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
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-main);
      }

      .timestamp {
        font-size: 12px;
        color: var(--color-text-muted);
      }

      .message-body {
        font-size: 14px;
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
    `,
  ],
})
export class ChatMessageComponent {
  readonly message = input.required<Message>();
  readonly isOwn = input<boolean>(false);
  readonly isGrouped = input<boolean>(false);

  readonly senderDisplay = computed(() => {
    const msg = this.message();
    if (msg.senderDisplayName) return msg.senderDisplayName;
    return msg.senderEmail?.split('@')[0] || 'Unknown';
  });
}
