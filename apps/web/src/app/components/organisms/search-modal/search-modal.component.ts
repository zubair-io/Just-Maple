import { Component, output, signal, inject, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SearchService, type SearchFilters } from '../../../services/search.service';
import { NotebookService } from '../../../services/notebook.service';
import type { SearchResult } from '@maple/shared';

@Component({
  selector: 'app-search-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search-modal.component.html',
  styleUrl: './search-modal.component.scss',
})
export class SearchModalComponent implements OnInit, OnDestroy {
  private readonly searchService = inject(SearchService);
  private readonly notebookService = inject(NotebookService);
  private readonly router = inject(Router);

  readonly closed = output<void>();

  readonly query = signal('');
  readonly selectedIndex = signal(0);
  readonly showFilters = signal(false);

  // Filter state
  readonly selectedTypes = signal<string[]>([]);
  readonly selectedNotebookIds = signal<string[]>([]);

  // Search service state
  readonly isSearching = this.searchService.isSearching;
  readonly results = this.searchService.results;
  readonly error = this.searchService.error;
  readonly recentSearches = this.searchService.recentSearches;
  readonly hasResults = this.searchService.hasResults;

  // Notebooks for filtering
  readonly notebooks = this.notebookService.notebooks;

  // Navigator for platform detection
  readonly navigator = typeof window !== 'undefined' ? window.navigator : { platform: '' };

  // Page type options
  readonly typeOptions = [
    { value: 'memo', label: 'Memos', icon: 'description' },
    { value: 'whiteboard', label: 'Whiteboards', icon: 'draw' },
    { value: 'message', label: 'Messages', icon: 'chat' },
    { value: 'collectable', label: 'Collectables', icon: 'inventory_2' },
  ];

  ngOnInit(): void {
    // Focus input on open
    setTimeout(() => {
      const input = document.querySelector('.search-input') as HTMLInputElement;
      input?.focus();
    });
  }

  ngOnDestroy(): void {
    this.searchService.clearResults();
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const results = this.results();

    switch (event.key) {
      case 'Escape':
        this.onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (results.length > 0) {
          this.selectedIndex.update((i) => Math.min(i + 1, results.length - 1));
          this.scrollToSelected();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (results.length > 0) {
          this.selectedIndex.update((i) => Math.max(i - 1, 0));
          this.scrollToSelected();
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (results.length > 0 && this.selectedIndex() < results.length) {
          this.selectResult(results[this.selectedIndex()]);
        }
        break;
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    this.selectedIndex.set(0);

    if (value.trim()) {
      const filters = this.buildFilters();
      this.searchService.search(value, filters);
    } else {
      this.searchService.clearResults();
    }
  }

  selectResult(result: SearchResult): void {
    // Add to recent searches
    const q = this.query().trim();
    if (q) {
      this.searchService.addToRecentSearches(q);
    }

    // Navigate to the page
    if (result.notebookId) {
      this.router.navigate([result.notebookId, result.pageId]);
    } else {
      this.router.navigate([result.pageId]);
    }

    this.onClose();
  }

  selectRecentSearch(query: string): void {
    this.query.set(query);
    this.onQueryChange(query);
  }

  removeRecentSearch(query: string, event: Event): void {
    event.stopPropagation();
    this.searchService.removeFromRecentSearches(query);
  }

  clearRecentSearches(): void {
    this.searchService.clearRecentSearches();
  }

  toggleFilter(): void {
    this.showFilters.update((v) => !v);
  }

  toggleType(type: string): void {
    this.selectedTypes.update((types) => {
      if (types.includes(type)) {
        return types.filter((t) => t !== type);
      }
      return [...types, type];
    });
    this.rerunSearch();
  }

  toggleNotebook(notebookId: string): void {
    this.selectedNotebookIds.update((ids) => {
      if (ids.includes(notebookId)) {
        return ids.filter((id) => id !== notebookId);
      }
      return [...ids, notebookId];
    });
    this.rerunSearch();
  }

  clearFilters(): void {
    this.selectedTypes.set([]);
    this.selectedNotebookIds.set([]);
    this.rerunSearch();
  }

  hasActiveFilters(): boolean {
    return this.selectedTypes().length > 0 || this.selectedNotebookIds().length > 0;
  }

  getTypeIcon(type: string): string {
    switch (type) {
      case 'memo':
        return 'description';
      case 'whiteboard':
        return 'draw';
      case 'message':
        return 'chat';
      case 'collectable':
        return 'inventory_2';
      case 'recording':
        return 'mic';
      default:
        return 'article';
    }
  }

  getTypeLabel(type: string): string {
    switch (type) {
      case 'memo':
        return 'Memo';
      case 'whiteboard':
        return 'Whiteboard';
      case 'message':
        return 'Message';
      case 'collectable':
        return 'Collectable';
      case 'recording':
        return 'Recording';
      default:
        return type;
    }
  }

  private buildFilters(): SearchFilters {
    const filters: SearchFilters = {};

    const types = this.selectedTypes();
    if (types.length > 0) {
      filters.types = types;
    }

    const notebookIds = this.selectedNotebookIds();
    if (notebookIds.length > 0) {
      filters.notebookIds = notebookIds;
    }

    return filters;
  }

  private rerunSearch(): void {
    const q = this.query().trim();
    if (q) {
      const filters = this.buildFilters();
      this.searchService.search(q, filters);
    }
  }

  private scrollToSelected(): void {
    setTimeout(() => {
      const selected = document.querySelector('.search-result-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    });
  }
}
