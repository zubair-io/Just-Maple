import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import type { MacDataPage, MacDataSource, MacDataSourceStatus } from '@maple/shared';
import { PageService } from './page.service';
import { isLocalNotebook } from '../providers/data-provider.interface';
import { deviceSourceInfo, isMacSource } from '../utils/device-sources';

/**
 * One source's state on this Mac. Besides reading, the Mac now reports its uploads;
 * those fields are optional because older builds don't send them.
 */
export interface MacSourceStatus extends MacDataSourceStatus {
  /** Whether this Mac collects and uploads the source. */
  enabled?: boolean;
  /** Last confirmed upload (seconds since 1970, or ISO). */
  lastUploadAt?: number | string;
  /** Items read but not uploaded yet. */
  pendingUpload?: number;
}

interface MacDataEventDetail {
  type: 'changed' | 'status';
  source?: MacDataSource;
  statuses?: MacSourceStatus[];
  relay?: string;
}

/**
 * The Mac app's side of device data: what this Mac collects, its access prompts, and the
 * one-time move of the old local pages to the cloud. Page data itself comes from the API
 * (see DeviceDataService); this service only talks to the `macData` script handler.
 */
/** Where events the user adds from bot cards go on this Mac. */
export interface MacActionCalendars {
  calendars: Array<{ id: string; title: string; account?: string }>;
  /** Chosen in Settings → Devices; null means the default calendar. */
  selected: string | null;
  defaultId: string | null;
}

/** This Mac's Home Assistant connection. The token never reaches the page. */
export interface MacHomeStatus {
  configured: boolean;
  url: string | null;
  state: 'stopped' | 'connecting' | 'connected' | 'retrying' | 'failed';
  /** Entities exposed to assistants, once connected. */
  exposed?: number;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class MacDataService {
  private readonly zone = inject(NgZone);
  private readonly http = inject(HttpClient);
  private readonly pageService = inject(PageService);

  /** True only inside the native macOS app. */
  readonly isAvailable = signal(!!window.webkit?.messageHandlers?.macData);

  readonly statuses = signal<MacSourceStatus[]>([]);
  /** Whether this Mac is connected to the server, e.g. "Connected". */
  readonly relay = signal<string | null>(null);

  /** Bumped per source whenever the Mac reads or uploads new items. */
  private readonly _versions = signal<Partial<Record<MacDataSource, number>>>({});
  readonly versions = this._versions.asReadonly();

  readonly statusBySource = computed(() => {
    const map: Partial<Record<MacDataSource, MacSourceStatus>> = {};
    for (const status of this.statuses()) map[status.source] = status;
    return map;
  });

  private migration: Promise<number> | null = null;

  constructor() {
    if (!this.isAvailable()) return;
    window.addEventListener('maple:mac-data', (event) => {
      const detail = (event as CustomEvent<MacDataEventDetail>).detail;
      this.zone.run(() => this.handleEvent(detail));
    });
    void this.refreshStatus().catch(() => undefined);
  }

  // MARK: - Status and access

  async refreshStatus(): Promise<void> {
    if (!this.isAvailable()) return;
    this.statuses.set(await this.call<MacSourceStatus[]>('status'));
    this.relay.set(await this.call<string>('relayStatus').catch(() => null));
  }

  async requestAccess(source: MacDataSource): Promise<void> {
    await this.call('requestAccess', { source });
  }

  async syncNow(): Promise<void> {
    await this.call('syncNow');
  }

  /** Starts collecting and uploading a source on this Mac. No-op outside the Mac app. */
  async enableSource(source: MacDataSource): Promise<void> {
    if (!this.isAvailable() || !isMacSource(source)) return;
    await this.call('enableSource', { source });
    void this.refreshStatus().catch(() => undefined);
  }

  async disableSource(source: MacDataSource): Promise<void> {
    if (!this.isAvailable()) return;
    await this.call('disableSource', { source });
    void this.refreshStatus().catch(() => undefined);
  }

  // MARK: - Add to calendar

  /** Calendars on this Mac that accept new events, and the one "Add to calendar" uses. */
  async actionCalendars(): Promise<MacActionCalendars | null> {
    if (!this.isAvailable()) return null;
    return this.call<MacActionCalendars>('actionCalendars');
  }

  /** null goes back to the Mac's default calendar. */
  async setActionCalendar(calendarId: string | null): Promise<void> {
    await this.call('setActionCalendar', calendarId ? { calendarId } : {});
  }

  // MARK: - Home Assistant

  async homeStatus(): Promise<MacHomeStatus | null> {
    if (!this.isAvailable()) return null;
    return this.call<MacHomeStatus>('homeStatus');
  }

  /** Opens the Mac's own window for the address and access token. */
  async openHomeSettings(): Promise<void> {
    await this.call('homeOpenSettings');
  }

  // MARK: - Migration

  /**
   * Moves pages from the Mac's old local registry to the cloud, once per launch.
   * Each local page becomes a cloud page with the same id, title, notebook and source;
   * the local record is removed only after the cloud page exists, so an interrupted
   * run picks up where it left off. Resolves to the number of pages moved.
   */
  migrateLocalPages(): Promise<number> {
    if (!this.isAvailable()) return Promise.resolve(0);
    this.migration ??= this.runMigration().catch((error: unknown) => {
      console.error('[MacData] Moving local pages to the cloud failed:', error);
      this.migration = null; // try again on the next call
      return 0;
    });
    return this.migration;
  }

  private async runMigration(): Promise<number> {
    const pages = await this.call<MacDataPage[]>('listPages');
    let moved = 0;
    for (const page of pages ?? []) {
      // Pages in a notebook kept in local files have no cloud to move to.
      if (!page.notebookId || isLocalNotebook(page.notebookId)) continue;
      try {
        if (!(await this.cloudPageExists(page.id))) {
          await lastValueFrom(
            this.pageService.createPage({
              id: page.id,
              type: 'devicedata',
              deviceSource: page.source,
              title: page.title || deviceSourceInfo(page.source).label,
              notebookId: page.notebookId,
            }),
          );
        }
        await this.call('deletePage', { id: page.id });
        await this.enableSource(page.source).catch(() => undefined);
        moved++;
      } catch (error) {
        // Leave this one for the next launch; keep moving the rest.
        console.error(`[MacData] Could not move page ${page.id}:`, error);
      }
    }
    return moved;
  }

  private async cloudPageExists(id: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.get(`/api/pages/${id}`));
      return true;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) return false;
      throw error;
    }
  }

  // MARK: - Private

  private handleEvent(detail: MacDataEventDetail): void {
    if (detail.type === 'status' && detail.statuses) {
      this.statuses.set(detail.statuses);
      if (detail.relay) this.relay.set(detail.relay);
    } else if (detail.type === 'changed' && detail.source) {
      const source = detail.source;
      this._versions.update((versions) => ({ ...versions, [source]: (versions[source] ?? 0) + 1 }));
    }
  }

  private async call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const handler = window.webkit?.messageHandlers?.macData;
    if (!handler) throw new Error('This is only available in the JapaneseMaple Mac app.');
    // Drop undefined values: WebKit can't bridge them.
    const message = Object.fromEntries(
      Object.entries({ action, ...params }).filter(([, value]) => value !== undefined),
    ) as { action: string };
    return (await handler.postMessage(message)) as T;
  }
}
