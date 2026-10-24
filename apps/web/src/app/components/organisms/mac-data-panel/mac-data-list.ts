import { DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, map } from 'rxjs';
import type { MacDataItem, MacDataSource } from '@maple/shared';
import { MacDataService } from '../../../services/mac-data.service';
import { DialogService } from '../../molecules/dialog/dialog.service';

export interface MacDataListOptions {
  pageSize?: number;
  /** Extra query constraints; re-read whenever the signals they read change. */
  order?: () => 'asc' | 'desc';
  range?: () => { from?: number; to?: number };
}

/**
 * State for a Mac data table page: the page record, search, paging and live refresh.
 * Must be called in an injection context (a component field initializer).
 */
export function injectMacDataList(source: MacDataSource, options: MacDataListOptions = {}) {
  const macData = inject(MacDataService);
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const dialog = inject(DialogService);
  const destroyRef = inject(DestroyRef);
  const pageSize = options.pageSize ?? 100;

  const pageId = toSignal(route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: route.snapshot.paramMap.get('id'),
  });
  const page = computed(() => macData.pages().find((p) => p.id === pageId()) ?? null);
  const status = computed(() => macData.statusBySource()[source] ?? null);

  const search = signal('');
  const debouncedSearch = toSignal(toObservable(search).pipe(debounceTime(250)), {
    initialValue: '',
  });
  const items = signal<MacDataItem[]>([]);
  const total = signal(0);
  const loading = signal(false);
  const error = signal<string | null>(null);
  const canLoadMore = computed(() => items().length < total());

  let destroyed = false;
  destroyRef.onDestroy(() => (destroyed = true));
  let latestRequest = 0;

  async function load(offset: number, limit: number): Promise<void> {
    const request = ++latestRequest;
    loading.set(true);
    try {
      const result = await macData.query({
        source,
        search: debouncedSearch().trim() || undefined,
        order: options.order?.() ?? 'desc',
        limit,
        offset,
        ...options.range?.(),
      });
      // A newer search or refresh started while this one was in flight.
      if (destroyed || request !== latestRequest) return;
      items.set(offset === 0 ? result.items : [...items(), ...result.items]);
      total.set(result.total);
      error.set(null);
    } catch (err) {
      if (request === latestRequest) {
        error.set(err instanceof Error ? err.message : 'Could not read data on this Mac.');
      }
    } finally {
      if (request === latestRequest) loading.set(false);
    }
  }

  // Reload when the search, the query options, or the Mac's data change.
  effect(() => {
    debouncedSearch();
    macData.versions()[source];
    options.order?.();
    options.range?.();
    // Keep however many rows are already showing so a live update doesn't collapse the list.
    untracked(() => void load(0, Math.max(pageSize, items().length)));
  });

  return {
    page,
    status,
    search,
    items: items.asReadonly(),
    total: total.asReadonly(),
    loading: loading.asReadonly(),
    error: error.asReadonly(),
    canLoadMore,

    loadMore(): void {
      if (!loading() && canLoadMore()) void load(items().length, pageSize);
    },

    async requestAccess(): Promise<void> {
      try {
        await macData.requestAccess(source);
      } catch (err) {
        error.set(err instanceof Error ? err.message : 'Could not request access.');
      }
    },

    async remove(): Promise<void> {
      const current = page();
      if (!current) return;
      const confirmed = await dialog.confirm({
        title: `Remove ${current.title}?`,
        message:
          'This removes the page from the notebook. Data already imported stays on this Mac.',
        confirmLabel: 'Remove',
      });
      if (!confirmed) return;
      await macData.deletePage(current.id);
      router.navigate(['/', current.notebookId]);
    },
  };
}

export type MacDataList = ReturnType<typeof injectMacDataList>;
