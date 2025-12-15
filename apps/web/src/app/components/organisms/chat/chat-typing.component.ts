import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TypingEvent } from '@maple/shared';

@Component({
    selector: 'app-chat-typing',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="typing-indicator">
            <div class="dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <span class="text">{{ typingText() }}</span>
        </div>
    `,
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
    readonly users = input<TypingEvent[]>([]);

    typingText(): string {
        const count = this.users().length;
        if (count === 0) return '';
        if (count === 1) return 'Someone is typing...';
        return `${count} people are typing...`;
    }
}
