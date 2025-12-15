import { Component, input, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import type { Message } from '@maple/shared';
import { ContentRendererComponent } from '../../atoms/content-renderer/content-renderer.component';

@Component({
  selector: 'app-chat-message',
  standalone: true,
  imports: [CommonModule, DatePipe, ContentRendererComponent],
  template: `
    <div class="message">
      <div class="bubble" [class.own]="isOwn()">
        <div class="sender">{{ senderDisplay() }}</div>
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
        margin-bottom: 4px;
      }

      .bubble {
        max-width: 800px;
        padding: 8px 12px;
        border-radius: 12px;
        background: var(--color-bg-elevated);
        border-bottom-left-radius: 4px;

        &.own {
          background: rgba(199, 91, 57, 0.1); // Maple at 10% opacity
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

  readonly senderDisplay = computed(() => {
    const msg = this.message();
    if (this.isOwn()) return 'You';
    return msg.senderEmail || 'Unknown';
  });
}
