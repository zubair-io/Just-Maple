import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  ElementRef,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { BotSuggestion } from '../../../services/bot.service';
import { ProfileAvatarComponent } from '../../atoms/profile-avatar/profile-avatar.component';

@Component({
  selector: 'app-mention-suggestion',
  standalone: true,
  imports: [CommonModule, ProfileAvatarComponent],
  templateUrl: './mention-suggestion.component.html',
  styleUrl: './mention-suggestion.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MentionSuggestionComponent {
  readonly items = input<BotSuggestion[]>([]);
  readonly isLoading = input<boolean>(false);

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

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.isComposing || event.shiftKey || !this.items().length) return false;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update((i) => (i > 0 ? i - 1 : this.items().length - 1));
        return true;
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update((i) => (i < this.items().length - 1 ? i + 1 : 0));
        return true;
      case 'Enter':
        event.preventDefault();
        const item = this.items()[this.selectedIndex()];
        if (item) {
          this.selectItem(item);
        }
        return true;
      case 'Escape':
        event.preventDefault();
        this.dismissed.emit();
        return true;
    }
    return false;
  }

  /** The parent inserts the mention; this list only reports the choice. */
  selectItem(item: BotSuggestion): void {
    this.selected.emit(item);
  }
}
