import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageService } from '../../../services/page.service';

interface PageSearchResult {
  id: string;
  title: string;
  type: string;
}

@Component({
  selector: 'app-page-link-search',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './page-link-search.component.html',
  styleUrl: './page-link-search.component.scss',
})
export class PageLinkSearchComponent {
  private readonly pageService = inject(PageService);

  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;

  readonly isOpen = input<boolean>(false);
  readonly mode = input<'inline' | 'block'>('inline');
  readonly folderId = input<string>();
  readonly excludePageId = input<string>();

  readonly closed = output<void>();
  readonly selected = output<{ pageId: string; title: string; mode: 'inline' | 'block' }>();
  readonly createNew = output<{ title: string; mode: 'inline' | 'block' }>();

  readonly searchQuery = signal('');
  readonly searchResults = signal<PageSearchResult[]>([]);
  readonly isLoading = signal(false);
  readonly selectedIndex = signal(0);

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Focus input when opened
    effect(() => {
      if (this.isOpen()) {
        setTimeout(() => {
          this.searchInputRef?.nativeElement?.focus();
        }, 50);
      } else {
        // Reset state when closed
        this.searchQuery.set('');
        this.searchResults.set([]);
        this.selectedIndex.set(0);
      }
    });
  }

  onSearchInput(event: Event) {
    const query = (event.target as HTMLInputElement).value;
    this.searchQuery.set(query);
    this.selectedIndex.set(0);

    // Debounce search
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    if (query.length >= 1) {
      this.searchDebounceTimer = setTimeout(() => {
        this.performSearch(query);
      }, 150);
    } else {
      this.searchResults.set([]);
    }
  }

  private performSearch(query: string) {
    this.isLoading.set(true);

    try {
      const pages = this.pageService.pages();
      const excludeId = this.excludePageId();
      const lowerQuery = query.toLowerCase();

      const results = pages
        .filter((page) => {
          if (excludeId && page.id === excludeId) return false;
          return page.title?.toLowerCase().includes(lowerQuery);
        })
        .slice(0, 10)
        .map((page) => ({
          id: page.id,
          title: page.title || 'Untitled',
          type: page.type || 'memo',
        }));

      this.searchResults.set(results);
    } catch (error) {
      console.error('Page search failed:', error);
      this.searchResults.set([]);
    }

    this.isLoading.set(false);
  }

  selectPage(page: PageSearchResult) {
    this.selected.emit({
      pageId: page.id,
      title: page.title,
      mode: this.mode(),
    });
    this.close();
  }

  createNewPage() {
    const title = this.searchQuery().trim();
    if (title) {
      this.createNew.emit({ title, mode: this.mode() });
      this.close();
    }
  }

  handleKeydown(event: KeyboardEvent) {
    const results = this.searchResults();
    const maxIndex = this.searchQuery().length >= 2 ? results.length : results.length - 1;

    switch (event.key) {
      case 'ArrowDown':
        this.selectedIndex.update((i) => Math.min(i + 1, maxIndex));
        event.preventDefault();
        break;
      case 'ArrowUp':
        this.selectedIndex.update((i) => Math.max(i - 1, 0));
        event.preventDefault();
        break;
      case 'Enter':
        const index = this.selectedIndex();
        if (index < results.length) {
          this.selectPage(results[index]);
        } else if (this.searchQuery().length >= 2) {
          this.createNewPage();
        }
        event.preventDefault();
        break;
      case 'Escape':
        this.close();
        event.preventDefault();
        break;
    }
  }

  onOverlayClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('page-link-search-overlay')) {
      this.close();
    }
  }

  close() {
    this.closed.emit();
  }

  getPageIcon(type: string): string {
    switch (type) {
      case 'memo':
        return '\uD83D\uDCDD';
      case 'whiteboard':
        return '\uD83C\uDFA8';
      case 'kanban':
        return '\uD83D\uDCCB';
      default:
        return '\uD83D\uDCC4';
    }
  }
}
