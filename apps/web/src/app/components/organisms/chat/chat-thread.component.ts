import { Component, input, output, signal, effect, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BotService } from '../../../services/bot.service';
import { ContentRendererComponent } from '../../atoms/content-renderer/content-renderer.component';
import { ProfileAvatarComponent } from '../../atoms/profile-avatar/profile-avatar.component';
import type { Message, Thread } from '@maple/shared';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat-thread',
  standalone: true,
  imports: [CommonModule, ContentRendererComponent, ProfileAvatarComponent],
  template: `
    <div class="thread-container border-l-2 border-[var(--color-primary)]/30 ml-4 pl-4 mt-2">
      <!-- Thread header -->
      <button
        type="button"
        class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition-colors mb-2"
        (click)="toggleExpanded()"
      >
        <svg
          class="w-4 h-4 transition-transform"
          [class.rotate-90]="isExpanded()"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        <span>
          @if (threadMessages().length > 0) {
            {{ threadMessages().length }}
            {{ threadMessages().length === 1 ? 'reply' : 'replies' }}
          } @else if (isLoading()) {
            Loading thread...
          } @else {
            View thread
          }
        </span>
      </button>

      <!-- Thread messages -->
      @if (isExpanded()) {
        <div class="thread-messages space-y-3">
          @for (message of threadMessages(); track message._id) {
            <div class="flex gap-3">
              <!-- Avatar -->
              <div class="shrink-0">
                @if (message.senderType === 'bot') {
                  <div
                    class="w-8 h-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-sm font-medium"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                } @else {
                  <app-profile-avatar
                    [email]="message.senderEmail || ''"
                    [displayName]="message.senderDisplayName"
                    [profilePictureUrl]="message.senderProfilePictureUrl"
                    size="sm"
                  />
                }
              </div>

              <!-- Message content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2 mb-1">
                  <span class="font-medium text-[var(--color-text-main)]">
                    @if (message.senderType === 'bot') {
                      {{ message.senderDisplayName || 'Bot' }}
                    } @else {
                      {{ message.senderDisplayName || message.senderEmail || 'Unknown' }}
                    }
                  </span>
                  <span class="text-xs text-[var(--color-text-muted)]">
                    {{ formatTime(message.createdAt) }}
                  </span>
                  @if (message.senderType === 'bot') {
                    <span
                      class="text-xs px-1.5 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    >
                      bot
                    </span>
                  }
                </div>
                <div class="text-[var(--color-text-main)]">
                  <app-content-renderer [content]="message.content" />
                </div>
              </div>
            </div>
          }

          @if (isLoading()) {
            <div class="flex items-center gap-2 text-[var(--color-text-muted)]">
              <div class="animate-pulse flex gap-1">
                <div class="w-2 h-2 bg-current rounded-full"></div>
                <div class="w-2 h-2 bg-current rounded-full"></div>
                <div class="w-2 h-2 bg-current rounded-full"></div>
              </div>
              <span class="text-sm">Loading...</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ChatThreadComponent implements OnInit, OnDestroy {
  private readonly botService = inject(BotService);

  readonly messageId = input.required<string>();
  readonly hasThread = input<boolean>(false);

  readonly isExpanded = signal(false);
  readonly isLoading = signal(false);
  readonly threadMessages = signal<Message[]>([]);
  readonly thread = signal<Thread | null>(null);

  private loadSubscription: Subscription | null = null;

  constructor() {
    // Load thread when expanded
    effect(() => {
      if (this.isExpanded() && this.threadMessages().length === 0 && !this.isLoading()) {
        this.loadThread();
      }
    });
  }

  ngOnInit(): void {
    // Auto-expand if there's a new thread
    if (this.hasThread()) {
      this.isExpanded.set(true);
    }
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
  }

  toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }

  private loadThread(): void {
    this.isLoading.set(true);
    this.loadSubscription = this.botService.getThreadForMessage(this.messageId()).subscribe({
      next: (result) => {
        if (result) {
          this.thread.set(result.thread);
          this.threadMessages.set(result.messages);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
