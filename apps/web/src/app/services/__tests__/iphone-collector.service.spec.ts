import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { IPhoneCollectorService, normalizeStatus } from '../iphone-collector.service';
import { timeAgo, toMillis } from '../../utils/device-sources';

describe('IPhoneCollectorService', () => {
  afterEach(() => {
    delete window.webkit;
    TestBed.resetTestingModule();
  });

  it('accepts status keyed by source or as a list', () => {
    const keyed = normalizeStatus({
      location: { available: true, authorized: true, enabled: true, pending: 2 },
      health: { available: false },
    });
    expect(keyed).toEqual([
      {
        source: 'location',
        available: true,
        authorized: true,
        enabled: true,
        lastUploadAt: null,
        pending: 2,
      },
      {
        source: 'health',
        available: false,
        authorized: false,
        enabled: false,
        lastUploadAt: null,
        pending: undefined,
      },
    ]);
    expect(normalizeStatus([{ source: 'health', enabled: true }])[0]?.enabled).toBe(true);
    expect(normalizeStatus(null)).toEqual([]);
  });

  it('talks to the deviceCollectors handler', async () => {
    const postMessage = vi.fn(async (message: { action: string }) =>
      message.action === 'status' ? { health: { enabled: true, authorized: true } } : true,
    );
    window.webkit = { messageHandlers: { deviceCollectors: { postMessage } } };
    const service = TestBed.inject(IPhoneCollectorService);
    expect(service.isAvailable()).toBe(true);
    await service.enable('health');
    expect(postMessage).toHaveBeenCalledWith({ action: 'enable', source: 'health' });
    expect(service.statuses()[0]?.enabled).toBe(true);
  });
});

describe('device time helpers', () => {
  it('reads seconds, milliseconds and ISO strings', () => {
    expect(toMillis(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMillis('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000_000);
    expect(toMillis(undefined)).toBeNull();
  });

  it('says how long ago', () => {
    const now = 1_700_000_000_000;
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 3 * 60_000, now)).toBe('3 min ago');
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(timeAgo(now - 86_400_000, now)).toBe('1 day ago');
    expect(timeAgo(null, now)).toBeNull();
  });
});
