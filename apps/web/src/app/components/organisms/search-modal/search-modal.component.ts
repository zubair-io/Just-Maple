import {
  Component,
  signal,
  inject,
  OnInit,
  OnDestroy,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { SearchService, type SearchFilters } from '../../../services/search.service';
import { NotebookService } from '../../../services/notebook.service';
import { TagService } from '../../../services/tag.service';
import { PageService } from '../../../services/page.service';
import { getPageTypeIcon, getPageTypeName } from '../../../utils/page-types';
import type { SearchResult } from '@maple/shared';
import type { SearchModalOptions } from '../../../services/ui-state.service';

interface SearchAction {
  id: string;
  icon: string;
  label: string;
  note: string;
  link: string[];
  queryParams?: Record<string, string>;
}

const ROW_CLASS =
  'search-result-item flex items-center gap-3 w-[calc(100%-20px)] h-[46px] mx-2.5 px-3.5 box-border rounded-[10px] border-none font-sans text-[15px] text-left cursor-pointer';

@Component({
  selector: 'app-search-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search-modal.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './search-modal.component.scss',
})
export class SearchModalComponent implements OnInit, OnDestroy {
  private readonly searchService = inject(SearchService);
  private readonly notebookService = inject(NotebookService);
  private readonly tagService = inject(TagService);
  private readonly pageService = inject(PageService);
  private readonly router = inject(Router);
  private readonly dialogRef = inject(DialogRef);
  private readonly options = inject<SearchModalOptions | null>(DIALOG_DATA);

  readonly query = signal('');
  readonly selectedIndex = signal(0);
  readonly showFilters = signal(false);

  // Filter state
  readonly selectedTypes = signal<string[]>([]);
  readonly selectedNotebookIds = signal<string[]>([]);
  readonly selectedTags = signal<string[]>([]);

  // Search service state
  readonly isSearching = this.searchService.isSearching;
  readonly results = this.searchService.results;
  readonly error = this.searchService.error;
  readonly recentSearches = this.searchService.recentSearches;
  readonly hasResults = this.searchService.hasResults;

  readonly groupClass =
    'm-0 px-6 pt-4 pb-2 text-[11px] font-bold tracking-[0.08em] uppercase text-[var(--color-text-muted)]';
  readonly rowClass = `${ROW_CLASS} bg-transparent`;
  readonly rowOnClass = `${ROW_CLASS} selected bg-[var(--color-surface-alt)]`;
  readonly chipClass =
    'flex-none flex items-center gap-1 h-7 px-2.5 rounded-full border-none bg-[var(--color-maple-light)] text-xs font-bold text-[var(--color-maple)] cursor-pointer';

  /** The notebook the person is in, read from the address. */
  private readonly currentNotebook = computed(() => {
    const first = this.router.url.split(/[/?#]/).filter(Boolean)[0];
    const id = this.options?.notebookId ?? first;
    return this.notebooks().find((notebook) => notebook._id === id) ?? null;
  });

  /** Things to do from anywhere; the ones about pages need a notebook to do them in. */
  readonly actions = computed<SearchAction[]>(() => {
    const notebook = this.currentNotebook();
    const inNotebook: SearchAction[] = notebook
      ? [
          {
            id: 'new-page',
            icon: 'add',
            label: 'New page',
            note: `in ${notebook.label}`,
            link: ['/', notebook._id, 'new'],
            queryParams: { type: 'memo' },
          },
        ]
      : [];
    const todos: SearchAction[] = notebook
      ? [
          {
            id: 'todos',
            icon: 'checklist',
            label: 'Show todos',
            note: `in ${notebook.label}`,
            link: ['/', notebook._id, 'todos'],
          },
        ]
      : [];
    return [
      ...inNotebook,
      {
        id: 'record',
        icon: 'radio_button_checked',
        label: 'Record a meeting',
        note: '',
        link: ['/recorder'],
      },
      ...todos,
    ];
  });

  /** Notebooks whose name matches; with nothing typed, the first few others. */
  readonly notebookMatches = computed(() => {
    const query = this.query().trim().toLowerCase();
    const currentId = this.currentNotebook()?._id;
    const pages = this.pageService.pages();
    return this.notebooks()
      .filter((notebook) =>
        query ? notebook.label.toLowerCase().includes(query) : notebook._id !== currentId,
      )
      .slice(0, 5)
      .map((notebook) => {
        const count = pages.filter(
          (page) => page.notebookId === notebook._id && !page.isTrashed,
        ).length;
        return {
          id: notebook._id,
          label: notebook.label,
          pagesLabel: count === 1 ? '1 page' : `${count} pages`,
        };
      });
  });

  private readonly rowCount = computed(
    () => this.results().length + this.actions().length + this.notebookMatches().length,
  );

  // Notebooks for filtering (use computed to properly call the method)
  readonly notebooks = computed(() => this.notebookService.notebooks());

  // Tags for filtering
  readonly availableTags = this.tagService.tags;

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
    // Apply initial options from DIALOG_DATA
    const options = this.options;
    if (options) {
      if (options.query) {
        this.query.set(options.query);
      }
      if (options.tag) {
        this.selectedTags.set([options.tag]);
        this.showFilters.set(true);
      }
      if (options.notebookId) {
        this.selectedNotebookIds.set([options.notebookId]);
        this.showFilters.set(true);
      }

      // Trigger search if we have a query or tag filter
      if (options.query || options.tag) {
        // Use a small delay to ensure component is fully initialized
        setTimeout(() => {
          this.rerunSearch();
        }, 0);
      }
    }

    // Focus input on open
    setTimeout(() => {
      const input = document.querySelector('.search-input') as HTMLInputElement;
      input?.focus();
    });
  }

  ngOnDestroy(): void {
    this.searchService.clearResults();
  }

  onKeyDown(event: KeyboardEvent): void {
    const count = this.rowCount();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count > 0) {
          this.selectedIndex.update((i) => Math.min(i + 1, count - 1));
          this.scrollToSelected();
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count > 0) {
          this.selectedIndex.update((i) => Math.max(i - 1, 0));
          this.scrollToSelected();
        }
        break;
      case 'Enter':
        event.preventDefault();
        this.openSelected();
        break;
    }
  }

  /** Opens the highlighted row: a page, then an action, then a notebook. */
  private openSelected(): void {
    const results = this.results();
    const actions = this.actions();
    const notebooks = this.notebookMatches();
    let index = this.selectedIndex();
    if (index < results.length) return this.selectResult(results[index]);
    index -= results.length;
    if (index < actions.length) return this.runAction(actions[index]);
    index -= actions.length;
    if (index < notebooks.length) this.openNotebook(notebooks[index].id);
  }

  runAction(action: SearchAction): void {
    void this.router.navigate(action.link, { queryParams: action.queryParams });
    this.onClose();
  }

  openNotebook(notebookId: string): void {
    void this.router.navigate(['/', notebookId]);
    this.onClose();
  }

  onClose(): void {
    this.dialogRef.close();
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

  toggleTag(tag: string): void {
    this.selectedTags.update((tags) => {
      if (tags.includes(tag)) {
        return tags.filter((t) => t !== tag);
      }
      return [...tags, tag];
    });
    this.rerunSearch();
  }

  removeTag(tag: string): void {
    this.selectedTags.update((tags) => tags.filter((t) => t !== tag));
    this.rerunSearch();
  }

  clearFilters(): void {
    this.selectedTypes.set([]);
    this.selectedNotebookIds.set([]);
    this.selectedTags.set([]);
    this.rerunSearch();
  }

  hasActiveFilters(): boolean {
    return (
      this.selectedTypes().length > 0 ||
      this.selectedNotebookIds().length > 0 ||
      this.selectedTags().length > 0
    );
  }

  getTypeIcon(type: string): string {
    return getPageTypeIcon(type);
  }

  getTypeLabel(type: string): string {
    return getPageTypeName(type);
  }

  getNotebookLabel(notebookId: string): string {
    const notebook = this.notebooks().find((n) => n._id === notebookId);
    return notebook?.label || 'Unknown';
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

    const tags = this.selectedTags();
    if (tags.length > 0) {
      filters.tags = tags;
    }

    return filters;
  }

  private rerunSearch(): void {
    const q = this.query().trim();
    const filters = this.buildFilters();

    // Search if we have a query OR active tag filters
    if (q || filters.tags?.length) {
      // If no query but we have tags, use a wildcard search
      const searchQuery = q || '*';
      this.searchService.search(searchQuery, filters);
    }
  }

  private scrollToSelected(): void {
    setTimeout(() => {
      const selected = document.querySelector('.search-result-item.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    });
  }
}
