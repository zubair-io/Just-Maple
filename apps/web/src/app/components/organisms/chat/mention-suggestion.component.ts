import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  ElementRef,
  inject,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { BotSuggestion } from '../../../services/bot.service';
import { ProfileAvatarComponent } from '../../atoms/profile-avatar/profile-avatar.component';

@Component({
  selector: 'app-mention-suggestion',
  standalone: true,
  imports: [CommonModule, ProfileAvatarComponent],
  template: `
    <div
      class="mention-dropdown bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg shadow-lg overflow-hidden"
      [class.hidden]="items().length === 0"
    >
      @for (item of items(); track item.id; let i = $index) {
        <button
          type="button"
          class="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--color-bg-secondary)] transition-colors text-left"
          [class.bg-[var(--color-bg-secondary)]]="i === selectedIndex()"
          (click)="selectItem(item)"
          (mouseenter)="selectedIndex.set(i)"
        >
          <app-profile-avatar
            [email]="item.ownerId + '@bot'"
            [displayName]="item.ownerName"
            [profilePictureUrl]="item.avatar"
            size="sm"
            [showBorder]="false"
          />
          <div class="flex-1 min-w-0">
            <div class="text-[var(--color-text-main)] font-medium truncate">
              @{{ item.handle }}
              @if (hasDuplicateHandle()(item.handle)) {
                <span class="text-[var(--color-text-muted)] font-normal">
                  ({{ item.ownerName }})
                </span>
              }
            </div>
            @if (item.displayName && item.displayName !== item.handle) {
              <div class="text-[var(--color-text-muted)] text-sm truncate">
                {{ item.displayName }}
              </div>
            }
          </div>
          <span
            class="text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
          >
            bot
          </span>
        </button>
      }
      @if (items().length === 0 && !isLoading()) {
        <div class="px-3 py-2 text-[var(--color-text-muted)] text-sm">No bots found</div>
      }
      @if (isLoading()) {
        <div class="px-3 py-2 text-[var(--color-text-muted)] text-sm">Loading...</div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      :host {
        display: block;
      }
      .mention-dropdown {
        min-width: 200px;
        max-width: 320px;
        max-height: 280px;
        overflow-y: auto;
      }
    `,
  ],
})
export class MentionSuggestionComponent {
  readonly items = input<BotSuggestion[]>([]);
  readonly isLoading = input<boolean>(false);
  readonly command = input<((props: Record<string, unknown>) => void) | null>(null);

  readonly selectedIndex = signal(0);

  readonly selected = output<BotSuggestion>();
  readonly dismissed = output<void>();

  // Detect duplicate handles
  readonly hasDuplicateHandle = computed(() => {
    const handles = this.items().map((item) => item.handle);
    const duplicates = new Set(
      handles.filter((handle, index) => handles.indexOf(handle) !== index),
    );
    return (handle: string) => duplicates.has(handle);
  });

  constructor() {
    // Reset selection when items change
    effect(() => {
      this.items();
      this.selectedIndex.set(0);
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.items().length === 0) return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update((i) => (i > 0 ? i - 1 : this.items().length - 1));
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update((i) => (i < this.items().length - 1 ? i + 1 : 0));
        break;
      case 'Enter':
        event.preventDefault();
        const item = this.items()[this.selectedIndex()];
        if (item) {
          this.selectItem(item);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.dismissed.emit();
        break;
    }
  }

  selectItem(item: BotSuggestion): void {
    const cmd = this.command();
    if (cmd) {
      cmd({
        id: item.id,
        handle: item.handle,
        type: item.type,
      });
    }
    this.selected.emit(item);
  }
}
