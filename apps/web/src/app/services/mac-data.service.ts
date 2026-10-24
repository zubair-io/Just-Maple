import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import type {
  MacDataPage,
  MacDataQuery,
  MacDataQueryResult,
  MacDataSource,
  MacDataSourceStatus,
} from '@maple/shared';

interface MacDataEventDetail {
  type: 'changed' | 'status';
  source?: MacDataSource;
  statuses?: MacDataSourceStatus[];
}

export const MAC_DATA_SOURCES: ReadonlyArray<{
  source: MacDataSource;
  label: string;
  icon: string;
}> = [
  { source: 'imessage', label: 'iMessage', icon: 'sms' },
  { source: 'mail', label: 'Email', icon: 'mail' },
  { source: 'calendar', label: 'Calendar', icon: 'calendar_month' },
];

/**
 * iMessage, Mail and Calendar data that lives only on this Mac.
 *
 * The Mac app reads the sources into its own database; this service talks to it
 * through the `macData` script message handler. Pages created here are local-only:
 * they never create a cloud record and don't exist on other devices.
 */
@Injectable({ providedIn: 'root' })
export class MacDataService {
  private readonly zone = inject(NgZone);

  /** True only inside the native macOS app. */
  readonly isAvailable = signal(!!window.webkit?.messageHandlers?.macData);

  readonly pages = signal<MacDataPage[]>([]);
  readonly statuses = signal<MacDataSourceStatus[]>([]);

  /** Bumped per source whenever the Mac imports, changes or removes items. */
  private readonly _versions = signal<Partial<Record<MacDataSource, number>>>({});
  readonly versions = this._versions.asReadonly();

  readonly statusBySource = computed(() => {
    const map: Partial<Record<MacDataSource, MacDataSourceStatus>> = {};
    for (const status of this.statuses()) map[status.source] = status;
    return map;
  });

  private pagesLoaded: Promise<void> | null = null;

  constructor() {
    if (!this.isAvailable()) return;
    window.addEventListener('maple:mac-data', (event) => {
      const detail = (event as CustomEvent<MacDataEventDetail>).detail;
      this.zone.run(() => this.handleEvent(detail));
    });
    void this.loadPages();
    void this.refreshStatus();
  }

  // MARK: - Pages

  /** Loads the page registry once; later calls reuse the same result. */
  loadPages(): Promise<void> {
    if (!this.isAvailable()) return Promise.resolve();
    this.pagesLoaded ??= this.call<MacDataPage[]>('listPages').then(
      (pages) => this.pages.set([...pages]),
      (error: unknown) => {
        this.pagesLoaded = null; // allow a retry
        throw error;
      },
    );
    return this.pagesLoaded;
  }

  pagesForNotebook(notebookId: string): MacDataPage[] {
    return this.pages().filter((page) => page.notebookId === notebookId);
  }

  async getPage(id: string): Promise<MacDataPage | null> {
    if (!this.isAvailable()) return null;
    await this.loadPages();
    return this.pages().find((page) => page.id === id) ?? null;
  }

  async createPage(notebookId: string, source: MacDataSource): Promise<MacDataPage> {
    const page = await this.call<MacDataPage>('createPage', { notebookId, source });
    this.pages.update((pages) => [...pages.filter((p) => p.id !== page.id), page]);
    void this.refreshStatus();
    return page;
  }

  async renamePage(id: string, title: string): Promise<void> {
    await this.call('renamePage', { id, title });
    this.pages.update((pages) => pages.map((page) => (page.id === id ? { ...page, title } : page)));
  }

  async deletePage(id: string): Promise<void> {
    await this.call('deletePage', { id });
    this.pages.update((pages) => pages.filter((page) => page.id !== id));
  }

  // MARK: - Data

  query(query: MacDataQuery): Promise<MacDataQueryResult> {
    return this.call<MacDataQueryResult>('query', { ...query });
  }

  async requestAccess(source: MacDataSource): Promise<void> {
    await this.call('requestAccess', { source });
  }

  async refreshStatus(): Promise<void> {
    if (!this.isAvailable()) return;
    this.statuses.set(await this.call<MacDataSourceStatus[]>('status'));
  }

  // MARK: - Private

  private handleEvent(detail: MacDataEventDetail): void {
    if (detail.type === 'status' && detail.statuses) {
      this.statuses.set(detail.statuses);
    } else if (detail.type === 'changed' && detail.source) {
      const source = detail.source;
      this._versions.update((versions) => ({ ...versions, [source]: (versions[source] ?? 0) + 1 }));
    }
  }

  private async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const handler = window.webkit?.messageHandlers?.macData;
    if (!handler) throw new Error('Mac data is only available in the Just Maple Mac app.');
    // Drop undefined values: WebKit can't bridge them.
    const message = Object.fromEntries(
      Object.entries({ action, ...params }).filter(([, value]) => value !== undefined),
    ) as { action: string };
    return (await handler.postMessage(message)) as T;
  }
}
