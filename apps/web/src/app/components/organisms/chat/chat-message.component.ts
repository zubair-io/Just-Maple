import { Component, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { isBotUIFallbackContent, type Message } from '@maple/shared';
import { BotUIComponent } from '../../atoms/bot-ui/bot-ui.component';
import { ContentRendererComponent } from '../../atoms/content-renderer/content-renderer.component';
import { ProfileAvatarComponent } from '../../atoms';

@Component({
  selector: 'app-chat-message',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    ContentRendererComponent,
    ProfileAvatarComponent,
    BotUIComponent,
  ],
  template: `
    <div [id]="'message-' + message().id" class="message-wrapper" [class.grouped]="isGrouped()">
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
            @if (!hideText()) {
              <app-content-renderer [content]="message().content" />
            }
            @if (message().senderType === 'bot' && message().botUI; as ui) {
              <app-bot-ui [response]="ui" (followUp)="followUp.emit($event)" />
            }
            @if (message().editedAt) {
              <span class="edited">(edited)</span>
            }
          </div>

          <!-- Thread replies link -->
          @if (message().hasThread) {
            <button type="button" class="thread-link" (click)="onThreadClick($event)">
              <span class="material-symbols-rounded thread-icon">forum</span>
              <span>View thread</span>
            </button>
          }

          <!-- Bot error -->
          @if (botError()) {
            <div class="bot-error">
              <span class="material-symbols-rounded">error</span>
              <span>{{ botError() }}</span>
            </div>
          }
        </div>

        <!-- Reply hover action -->
        <div class="message-actions">
          <button
            type="button"
            class="action-btn"
            (click)="onReplyClick($event)"
            aria-label="Reply in thread"
            title="Reply in thread"
          >
            <span class="material-symbols-rounded">reply</span>
          </button>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .message-wrapper {
        width: 100%;
        display: flex;
        justify-content: center;
        margin-bottom: 12px;
        transition: background-color 0.2s;
        border-radius: 8px;

        &:hover {
          background-color: rgba(0, 0, 0, 0.02);

          .message-actions {
            opacity: 1;
          }
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
        position: relative;
      }

      .avatar {
        flex-shrink: 0;
        margin-top: 2px;
      }

      .avatar-spacer {
        width: 28px;
        flex-shrink: 0;
      }

      .bubble-container {
        flex: 1;
        min-width: 0;
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
        font-weight: 600;
        color: var(--color-text-main);
      }

      .timestamp {
        font-size: 12px;
        color: var(--color-text-muted);
      }

      .message-body {
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

      .thread-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        padding: 4px 8px;
        margin-top: 4px;
        cursor: pointer;
        font-size: 13px;
        color: var(--color-primary);
        border-radius: 6px;
        transition: background-color 0.2s;
        width: fit-content;

        &:hover {
          background: var(--color-primary-light, rgba(217, 78, 59, 0.08));
        }

        .thread-icon {
          font-size: 16px;
        }
      }

      .message-actions {
        position: absolute;
        top: -4px;
        right: 0;
        opacity: 0;
        transition: opacity 0.15s;
        display: flex;
        gap: 2px;
      }

      .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid var(--color-border);
        background: var(--color-bg);
        cursor: pointer;
        color: var(--color-text-muted);
        transition: all 0.15s;

        &:hover {
          background: var(--color-bg-hover, rgba(0, 0, 0, 0.04));
          color: var(--color-text-main);
        }

        .material-symbols-rounded {
          font-size: 16px;
        }
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
  readonly botError = input<string | undefined>(undefined);

  readonly threadClicked = output<Message>();
  readonly replyClicked = output<Message>();
  /** A bot UI button or form was used; its text should be sent as the user's next message. */
  readonly followUp = output<string>();
  /** Bot replies made only of UI blocks carry a flattened text copy; show the blocks instead. */
  readonly hideText = computed(() =>
    isBotUIFallbackContent(this.message().content, this.message().botUI),
  );

  readonly senderDisplay = computed(() => {
    const msg = this.message();
    if (msg.senderDisplayName) return msg.senderDisplayName;
    return msg.senderEmail?.split('@')[0] || 'Unknown';
  });

  onThreadClick(event: Event): void {
    event.stopPropagation();
    this.threadClicked.emit(this.message());
  }

  onReplyClick(event: Event): void {
    event.stopPropagation();
    this.replyClicked.emit(this.message());
  }
}
