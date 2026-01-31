import {
  Component,
  signal,
  computed,
  effect,
  HostListener,
  output,
  ViewChildren,
  QueryList,
  ElementRef,
  AfterViewInit,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Generic suggestion item interface
 * Used by slash commands, hashtags, and page links
 */
export interface SuggestionItem {
  /** Unique identifier for tracking */
  id: string;
  /** Icon to display (emoji or text) */
  icon: string;
  /** Primary text */
  title: string;
  /** Secondary description text (optional) */
  description?: string;
  /** Additional data to pass through */
  data?: unknown;
}

@Component({
  selector: 'app-suggestion-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './suggestion-menu.component.html',
  styleUrl: './suggestion-menu.component.scss',
})
export class SuggestionMenuComponent implements AfterViewInit {
  @ViewChildren('menuItem') menuItems!: QueryList<ElementRef<HTMLButtonElement>>;

  // Input: items to display
  readonly items = signal<SuggestionItem[]>([]);

  // Input: filter query
  readonly query = signal<string>('');

  // Input: whether to filter items by query (default true)
  // Set to false if filtering is done externally (e.g., by the extension)
  readonly filterEnabled = input<boolean>(true);

  // Input: empty state message
  readonly emptyMessage = input<string>('No results');

  // Output: item selected
  readonly itemSelected = output<SuggestionItem>();

  // Internal state
  readonly selectedIndex = signal(0);
  private itemElements: ElementRef<HTMLButtonElement>[] = [];

  // Filtered items (if filterEnabled, filter by query; otherwise return all items)
  readonly filteredItems = computed(() => {
    if (!this.filterEnabled()) {
      return this.items();
    }

    const q = this.query().toLowerCase();
    if (!q) return this.items();

    return this.items().filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    );
  });

  constructor() {
    // Reset selection when items change
    effect(() => {
      this.filteredItems();
      this.selectedIndex.set(0);
    });
  }

  ngAfterViewInit(): void {
    this.updateItemElements();
    this.menuItems.changes.subscribe(() => {
      this.updateItemElements();
    });
  }

  private updateItemElements(): void {
    this.itemElements = this.menuItems.toArray();
  }

  private scrollToSelected(): void {
    const index = this.selectedIndex();
    const element = this.itemElements[index]?.nativeElement;
    if (element) {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  @HostListener('keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): boolean {
    const items = this.filteredItems();

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update((i) => (i > 0 ? i - 1 : items.length - 1));
        setTimeout(() => this.scrollToSelected(), 0);
        return false;

      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update((i) => (i < items.length - 1 ? i + 1 : 0));
        setTimeout(() => this.scrollToSelected(), 0);
        return false;

      case 'Enter':
        event.preventDefault();
        const selectedItem = items[this.selectedIndex()];
        if (selectedItem) {
          this.itemSelected.emit(selectedItem);
        }
        return false;

      default:
        return true;
    }
  }

  selectItem(item: SuggestionItem): void {
    this.itemSelected.emit(item);
  }

  navigateUp(): void {
    const items = this.filteredItems();
    this.selectedIndex.update((i) => (i > 0 ? i - 1 : items.length - 1));
    setTimeout(() => this.scrollToSelected(), 0);
  }

  navigateDown(): void {
    const items = this.filteredItems();
    this.selectedIndex.update((i) => (i < items.length - 1 ? i + 1 : 0));
    setTimeout(() => this.scrollToSelected(), 0);
  }

  selectCurrent(): void {
    const items = this.filteredItems();
    const item = items[this.selectedIndex()];
    if (item) {
      this.itemSelected.emit(item);
    }
  }
}
