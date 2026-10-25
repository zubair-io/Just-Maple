import { Component, computed, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-chat-typing',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="typing-indicator" role="status" aria-live="polite">
      <div class="dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span class="text">{{ typingText() }}</span>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .typing-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        color: var(--color-text-muted);
        font-size: 12px;
      }

      .dots {
        display: flex;
        gap: 3px;

        span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-text-muted);
          animation: bounce 1.4s ease-in-out infinite;

          &:nth-child(2) {
            animation-delay: 0.16s;
          }

          &:nth-child(3) {
            animation-delay: 0.32s;
          }
        }
      }

      @keyframes bounce {
        0%,
        60%,
        100% {
          transform: translateY(0);
        }
        30% {
          transform: translateY(-4px);
        }
      }
    `,
  ],
})
export class ChatTypingComponent {
  /** Who is typing: people, or bots writing a reply. */
  readonly names = input<string[]>([]);
  /** Bots in a thread are "replying"; people and bots in the chat are "typing". */
  readonly verb = input<'typing' | 'replying in thread'>('typing');

  readonly typingText = computed(() => {
    const names = this.names();
    const verb = this.verb();
    if (names.length === 0) return '';
    if (names.length === 1) return `${names[0]} is ${verb}…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are ${verb}…`;
    return `${names[0]} and ${names.length - 1} others are ${verb}…`;
  });
}
