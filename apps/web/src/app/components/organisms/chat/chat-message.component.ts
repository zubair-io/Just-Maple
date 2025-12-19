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
    <div class="message" [class.own]="isOwn()">
      @if (!isOwn()) {
        <app-profile-avatar
          [email]="message().senderEmail ?? 'unknown@justmaple.app'"
          [displayName]="senderDisplayName()"
          [profilePictureUrl]="senderProfilePictureUrl()"
          size="sm"
          class="avatar"
        />
      }
      <div class="bubble" [class.own]="isOwn()">
        @if (!isOwn()) {
          <div class="sender">{{ senderDisplay() }}</div>
        }
        <app-content-renderer [content]="message().content" />
        <div class="meta">
          <span class="time">{{ message().createdAt | date: 'shortTime' }}</span>
          @if (message().editedAt) {
            <span class="edited">(edited)</span>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .message {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;

        &.own {
          justify-content: flex-end;
        }
      }

      .avatar {
        flex-shrink: 0;
        margin-top: 4px;
      }

      .bubble {
        max-width: 800px;
        padding: 8px 12px;
        border-radius: 12px;
        background: var(--color-bg-elevated);

        &.own {
          background: rgba(199, 91, 57, 0.1); // Maple at 10% opacity
          border-bottom-right-radius: 4px;
          border-bottom-left-radius: 12px;
        }

        &:not(.own) {
          border-bottom-left-radius: 4px;
        }
      }

      .sender {
        font-size: 12px;
        font-weight: 500;
        color: var(--color-primary);
        margin-bottom: 2px;
      }

      .meta {
        display: flex;
        gap: 4px;
        margin-top: 4px;
        font-size: 11px;
        color: var(--color-text-muted);
      }

      .edited {
        font-style: italic;
      }
    `,
  ],
})
export class ChatMessageComponent {
  readonly message = input.required<Message>();
  readonly isOwn = input<boolean>(false);
  readonly senderDisplayName = input<string | undefined>();
  readonly senderProfilePictureUrl = input<string | undefined>();

  readonly senderDisplay = computed(() => {
    const displayName = this.senderDisplayName();
    if (displayName) return displayName;

    const msg = this.message();
    return msg.senderEmail?.split('@')[0] || 'Unknown';
  });
}
