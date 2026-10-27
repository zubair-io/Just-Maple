import { DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, firstValueFrom, map } from 'rxjs';
import {
  deviceFilterIsEmpty,
  type DeviceDataAccess,
  type MacDataItem,
  type MacDataSource,
  type UpdateDeviceDataPageInput,
} from '@maple/shared';
import {
  DeviceDataService,
  OwnerOnlyError,
  type DeviceDataCollector,
} from '../../../services/device-data.service';
import { MacDataService } from '../../../services/mac-data.service';
import { PageService } from '../../../services/page.service';
import { DialogService } from '../../molecules/dialog/dialog.service';
import { isMacSource } from '../../../utils/device-sources';

export interface DeviceDataListOptions {
  pageSize?: number;
  /** Extra query constraints; re-read whenever the signals they read change. */
  order?: () => 'asc' | 'desc';
  range?: () => { from?: number; to?: number };
}

/**
 * State for a device data page: the page record, search, paging, who manages the page and
 * what it shares, and which device collects the source. Data comes from the API, so it works on every
 * device. Must be called in an injection context (a component field initializer).
 */
export function injectDeviceDataList(source: MacDataSource, options: DeviceDataListOptions = {}) {
  const deviceData = inject(DeviceDataService);
  const macData = inject(MacDataService);
  const pageService = inject(PageService);
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const dialog = inject(DialogService);
  const destroyRef = inject(DestroyRef);
  const pageSize = options.pageSize ?? 100;

  const pageId = toSignal(route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: route.snapshot.paramMap.get('id'),
  });
  const page = computed(() => pageService.pages().find((p) => p.id === pageId()) ?? null);
  /** Changes when the page is saved, here or by its creator elsewhere. */
  const pageVersion = computed(() => page()?.updatedAt);

  // ?item=<id>: an item a bot cited, shown in full above the table.
  const focusedId = toSignal(route.queryParamMap.pipe(map((params) => params.get('item'))), {
    initialValue: route.snapshot.queryParamMap.get('item'),
  });
  const focused = signal<MacDataItem | null>(null);
  effect(() => {
    const id = focusedId();
    focused.set(null);
    if (id) {
      deviceData.getItem(id, untracked(pageId) ?? undefined).then(
        (item) => focusedId() === id && focused.set(item),
        () => undefined,
      );
    }
  });

  /** This Mac's own status for the source, inside the Mac app only. */
  const macStatus = computed(() =>
    macData.isAvailable() && isMacSource(source)
      ? (macData.statusBySource()[source] ?? null)
      : null,
  );

  const search = signal('');
  const debouncedSearch = toSignal(toObservable(search).pipe(debounceTime(250)), {
    initialValue: '',
  });
  const items = signal<MacDataItem[]>([]);
  const total = signal(0);
  const collector = signal<DeviceDataCollector | null>(null);
  const ownerOnly = signal(false);
  const access = signal<DeviceDataAccess | null>(null);
  /** The creator's settings panel is open. */
  const settingsOpen = signal(false);
  /** The signed-in user created the page: rename, filter, move and remove are theirs. */
  const canManage = computed(() => access()?.canManage ?? false);
  /** The page has a filter that lets nothing through yet. */
  const nothingShared = computed(() => {
    const filter = page()?.deviceFilter;
    return !!filter && deviceFilterIsEmpty(source, filter);
  });
  const loading = signal(false);
  const loaded = signal(false);
  const error = signal<string | null>(null);
  const canLoadMore = computed(() => items().length < total());

  let destroyed = false;
  destroyRef.onDestroy(() => (destroyed = true));
  let latestRequest = 0;
  let enabledOnMac = false;

  async function load(offset: number, limit: number): Promise<void> {
    const request = ++latestRequest;
    loading.set(true);
    try {
      const result = await deviceData.listItems({
        source,
        pageId: pageId() ?? undefined,
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
      collector.set(result.collector);
      access.set(result.access ?? null);
      ownerOnly.set(false);
      error.set(null);
      // Opening your own page in the Mac app makes sure this Mac collects its source.
      if (!enabledOnMac && (result.access?.canManage ?? true)) {
        enabledOnMac = true;
        void deviceData.enableOnThisMac(source);
      }
    } catch (err) {
      if (destroyed || request !== latestRequest) return;
      if (err instanceof OwnerOnlyError) {
        ownerOnly.set(true);
        access.set(err.access ?? null);
        items.set([]);
        total.set(0);
      } else {
        error.set(err instanceof Error ? err.message : 'Could not load this data.');
      }
    } finally {
      if (request === latestRequest) {
        loading.set(false);
        loaded.set(true);
      }
    }
  }

  // Reload when the page (or its filter), the search, the query options, or this Mac's
  // uploads change.
  effect(() => {
    pageId();
    pageVersion();
    debouncedSearch();
    macData.versions()[source];
    options.order?.();
    options.range?.();
    // Keep however many rows are already showing so a live update doesn't collapse the list.
    untracked(() => void load(0, Math.max(pageSize, items().length)));
  });

  return {
    source,
    page,
    macStatus,
    search,
    items: items.asReadonly(),
    total: total.asReadonly(),
    collector: collector.asReadonly(),
    ownerOnly: ownerOnly.asReadonly(),
    access: access.asReadonly(),
    canManage,
    nothingShared,
    settingsOpen,
    loading: loading.asReadonly(),
    loaded: loaded.asReadonly(),
    error: error.asReadonly(),
    canLoadMore,
    focused: focused.asReadonly(),

    clearFocus(): void {
      router.navigate([], { relativeTo: route, queryParams: { item: null } });
    },

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

    /** Saves the creator's name, description and filter, then shows the page through it. */
    async saveSettings(input: UpdateDeviceDataPageInput): Promise<boolean> {
      const current = page();
      if (!current) return false;
      try {
        await deviceData.updateDataPage(current.id, input);
        settingsOpen.set(false);
        return true;
      } catch (err) {
        error.set(err instanceof Error ? err.message : 'Could not save this page.');
        return false;
      }
    },

    async remove(): Promise<void> {
      const current = page();
      if (!current || !canManage()) return;
      const confirmed = await dialog.confirm({
        title: `Remove ${current.title}?`,
        message:
          'This moves the page to the trash. Data your devices uploaded stays in your account; remove it in Settings → Devices.',
        confirmLabel: 'Remove',
      });
      if (!confirmed) return;
      try {
        await firstValueFrom(pageService.moveToTrash(current.id));
        router.navigate(['/', current.notebookId]);
      } catch (err) {
        error.set(err instanceof Error ? err.message : 'Could not remove the page.');
      }
    },
  };
}

export type DeviceDataList = ReturnType<typeof injectDeviceDataList>;
