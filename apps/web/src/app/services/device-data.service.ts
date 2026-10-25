import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import type { Collector, CollectorPlatform, MacDataItem, MacDataSource, Page } from '@maple/shared';
import { PageService } from './page.service';
import { MacDataService } from './mac-data.service';
import { deviceSourceInfo, isMacSource } from '../utils/device-sources';

/** The device that uploads a source, as the items endpoint reports it. */
export interface DeviceDataCollector {
  name: string;
  platform: CollectorPlatform;
  lastUploadAt?: string;
}

export interface DeviceItemsQuery {
  source: MacDataSource;
  /** The page being shown; the server checks that the signed-in user owns it. */
  pageId?: string;
  search?: string;
  /** Seconds since 1970. */
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

export interface DeviceItemsResult {
  items: MacDataItem[];
  total: number;
  collector: DeviceDataCollector | null;
}

/** The page belongs to someone else: only its owner can read the data. */
export class OwnerOnlyError extends Error {
  constructor() {
    super('Only the owner of this page can see its data.');
    this.name = 'OwnerOnlyError';
  }
}

/**
 * Personal data the user's devices upload (Messages, Mail, Calendar and Contacts from
 * the Mac; Places and Health from the iPhone), read from the API so the pages work on
 * every device. Also manages the collectors: which device uploads which source.
 */
@Injectable({ providedIn: 'root' })
export class DeviceDataService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly macData = inject(MacDataService);

  // MARK: - Items

  async listItems(query: DeviceItemsQuery): Promise<DeviceItemsResult> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    try {
      const result = await firstValueFrom(
        this.http.get<DeviceItemsResult>('/api/device-data/items', { params }),
      );
      return { items: result.items ?? [], total: result.total ?? 0, collector: result.collector };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getItem(id: string): Promise<MacDataItem | null> {
    try {
      const result = await firstValueFrom(
        this.http.get<{ item: MacDataItem }>(`/api/device-data/items/${encodeURIComponent(id)}`),
      );
      return result.item ?? null;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) return null;
      throw this.mapError(error);
    }
  }

  // MARK: - Pages

  /**
   * Creates a cloud page showing one source. Inside the Mac app, a Mac source is also
   * switched on so this Mac starts uploading it.
   */
  async createPage(notebookId: string, source: MacDataSource, title?: string): Promise<Page> {
    // Wait for the server's copy: the optimistic one has no deviceSource for the route guard.
    const page = await lastValueFrom(
      this.pageService.createPage({
        id: crypto.randomUUID(),
        type: 'devicedata',
        deviceSource: source,
        title: title ?? deviceSourceInfo(source).label,
        notebookId,
      }),
    );
    await this.enableOnThisMac(source);
    return page;
  }

  /** Inside the Mac app, makes sure this Mac collects a Mac source. Never throws. */
  async enableOnThisMac(source: MacDataSource): Promise<void> {
    if (!this.macData.isAvailable() || !isMacSource(source)) return;
    await this.macData.enableSource(source).catch((error: unknown) => {
      console.warn(`[DeviceData] Could not turn on ${source} on this Mac:`, error);
    });
  }

  /**
   * Opens an item a bot cited in the page for its source, preferring the notebook
   * that's open. Returns false when no page shows that source.
   */
  async openItem(itemId: string): Promise<boolean> {
    const source = itemId.split(':')[0] as MacDataSource;
    const notebookId = this.router.url.split(/[/?#]/)[1];
    const candidates = this.pageService
      .pages()
      .filter(
        (page) => page.type === 'devicedata' && page.deviceSource === source && !page.isTrashed,
      );
    const page = candidates.find((p) => p.notebookId === notebookId) ?? candidates[0];
    if (!page?.notebookId) return false;
    return this.router.navigate(['/', page.notebookId, page.id], {
      queryParams: { item: itemId },
    });
  }

  // MARK: - Collectors

  async listCollectors(): Promise<Collector[]> {
    const result = await firstValueFrom(
      this.http.get<{ collectors: Collector[] }>('/api/collectors'),
    );
    return result.collectors ?? [];
  }

  /** Makes a device the collector for these sources; the previous device's copy is removed. */
  async setActiveSources(deviceId: string, activeSources: MacDataSource[]): Promise<Collector> {
    const result = await firstValueFrom(
      this.http.patch<{ collector: Collector }>(`/api/collectors/${encodeURIComponent(deviceId)}`, {
        activeSources,
      }),
    );
    return result.collector;
  }

  /** Forgets a device and deletes everything it uploaded. */
  async removeCollector(deviceId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/collectors/${encodeURIComponent(deviceId)}`));
  }

  /** Deletes all uploaded device data. Devices stop uploading until switched back on. */
  async removeAllData(): Promise<number> {
    const result = await firstValueFrom(this.http.delete<{ removed: number }>('/api/device-data'));
    return result.removed ?? 0;
  }

  // MARK: - Private

  private mapError(error: unknown): Error {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 403 && error.error?.ownerOnly) return new OwnerOnlyError();
      const message = error.error?.message || error.error?.error;
      return new Error(typeof message === 'string' ? message : 'Could not load this data.');
    }
    return error instanceof Error ? error : new Error('Could not load this data.');
  }
}
