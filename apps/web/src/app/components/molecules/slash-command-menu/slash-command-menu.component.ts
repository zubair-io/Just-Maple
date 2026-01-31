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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { SlashCommandItem } from '../../organisms/notebook-editor/extensions/slash-commands';

@Component({
  selector: 'app-slash-command-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './slash-command-menu.component.html',
  styleUrl: './slash-command-menu.component.scss',
})
export class SlashCommandMenuComponent implements AfterViewInit {
  @ViewChildren('commandItem') commandItems!: QueryList<ElementRef<HTMLButtonElement>>;

  // Using writable signals for dynamic component creation
  readonly items = signal<SlashCommandItem[]>([]);
  readonly query = signal<string>('');

  readonly commandSelected = output<SlashCommandItem>();

  readonly selectedIndex = signal(0);
  private itemElements: ElementRef<HTMLButtonElement>[] = [];

  readonly filteredItems = computed(() => {
    const q = this.query().toLowerCase();
    if (!q) return this.items();
    return this.items().filter(
      (item) => item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
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
    this.commandItems.changes.subscribe(() => {
      this.updateItemElements();
    });
  }

  private updateItemElements(): void {
    this.itemElements = this.commandItems.toArray();
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
          this.commandSelected.emit(selectedItem);
        }
        return false;

      default:
        return true;
    }
  }

  selectItem(item: SlashCommandItem): void {
    this.commandSelected.emit(item);
  }

  navigateUp(): void {
    const items = this.filteredItems();
    this.selectedIndex.update((i) => (i > 0 ? i - 1 : items.length - 1));
    // Use setTimeout to ensure DOM has updated before scrolling
    setTimeout(() => this.scrollToSelected(), 0);
  }

  navigateDown(): void {
    const items = this.filteredItems();
    this.selectedIndex.update((i) => (i < items.length - 1 ? i + 1 : 0));
    // Use setTimeout to ensure DOM has updated before scrolling
    setTimeout(() => this.scrollToSelected(), 0);
  }

  selectCurrent(): void {
    const items = this.filteredItems();
    const item = items[this.selectedIndex()];
    if (item) {
      this.commandSelected.emit(item);
    }
  }
}
