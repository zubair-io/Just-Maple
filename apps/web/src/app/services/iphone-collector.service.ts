import { Injectable, signal } from '@angular/core';
import type { MacDataSource } from '@maple/shared';
import { IPHONE_SOURCES } from '../utils/device-sources';

/** One iPhone source (Places or Health) as the iPhone app reports it. */
export interface IPhoneSourceStatus {
  source: MacDataSource;
  /** The iPhone can collect this at all (e.g. HealthKit exists on this device). */
  available: boolean;
  /** The user granted the permission the source needs. */
  authorized: boolean;
  /** Turned on in Maple on this iPhone. */
  enabled: boolean;
  lastUploadAt?: number | string | null;
  /** Items waiting to upload. */
  pending?: number;
}

/**
 * The iPhone app's collector for Location and Health, reached through the native
 * `deviceCollectors` script handler. Only present inside the iPhone app.
 */
@Injectable({ providedIn: 'root' })
export class IPhoneCollectorService {
  readonly isAvailable = signal(!!window.webkit?.messageHandlers?.deviceCollectors);
  readonly statuses = signal<IPhoneSourceStatus[]>([]);

  async refreshStatus(): Promise<void> {
    if (!this.isAvailable()) return;
    this.statuses.set(normalizeStatus(await this.call('status')));
  }

  async enable(source: MacDataSource): Promise<void> {
    await this.call('enable', { source });
    await this.refreshStatus();
  }

  async disable(source: MacDataSource): Promise<void> {
    await this.call('disable', { source });
    await this.refreshStatus();
  }

  async syncNow(): Promise<void> {
    await this.call('syncNow');
    await this.refreshStatus();
  }

  private async call(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const handler = window.webkit?.messageHandlers?.deviceCollectors;
    if (!handler) throw new Error('This is only available in the JapaneseMaple iPhone app.');
    return handler.postMessage({ action, ...params });
  }
}

/** Accepts `{ location: {...}, health: {...} }` or `[{ source, ... }]`. */
export function normalizeStatus(raw: unknown): IPhoneSourceStatus[] {
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((entry) => [String((entry as { source?: unknown })?.source ?? ''), entry])
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>)
      : [];
  const result: IPhoneSourceStatus[] = [];
  for (const source of IPHONE_SOURCES) {
    const value = entries.find(([key]) => key === source)?.[1] as
      | Partial<IPhoneSourceStatus>
      | undefined;
    if (!value) continue;
    result.push({
      source,
      available: value.available !== false,
      authorized: !!value.authorized,
      enabled: !!value.enabled,
      lastUploadAt: value.lastUploadAt ?? null,
      pending: typeof value.pending === 'number' ? value.pending : undefined,
    });
  }
  return result;
}
