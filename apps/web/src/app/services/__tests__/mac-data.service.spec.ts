import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Route, UrlSegment } from '@angular/router';
import type { MacDataPage, MacDataSourceStatus } from '@maple/shared';
import { MacDataService } from '../mac-data.service';
import { IMessagePageGuard, MailPageGuard } from '../../guards/mac-data-page.guard';

const page: MacDataPage = {
  id: 'p1',
  notebookId: 'n1',
  source: 'imessage',
  title: 'iMessage',
  createdAt: 1,
};

const statuses: MacDataSourceStatus[] = [
  { source: 'imessage', state: 'syncing', itemCount: 4 },
  { source: 'mail', state: 'needsAccess', itemCount: 0, message: 'denied' },
  { source: 'calendar', state: 'off', itemCount: 0 },
];

/** Stands in for the Mac app's `macData` script handler. */
function installHandler(responses: Record<string, unknown>) {
  const postMessage = vi.fn(async (message: { action: string }) => {
    if (!(message.action in responses)) throw new Error(`unexpected ${message.action}`);
    return responses[message.action];
  });
  window.webkit = { messageHandlers: { macData: { postMessage } } };
  return postMessage;
}

function emit(detail: unknown) {
  window.dispatchEvent(new CustomEvent('maple:mac-data', { detail }));
}

describe('MacDataService', () => {
  afterEach(() => {
    delete window.webkit;
    TestBed.resetTestingModule();
  });

  it('does nothing outside the Mac app', async () => {
    const service = TestBed.inject(MacDataService);
    expect(service.isAvailable()).toBe(false);
    await service.loadPages();
    expect(service.pages()).toEqual([]);
    expect(await service.getPage('p1')).toBeNull();
    await expect(service.query({ source: 'mail' })).rejects.toThrow('only available');
  });

  describe('in the Mac app', () => {
    let postMessage: ReturnType<typeof installHandler>;
    let service: MacDataService;

    beforeEach(async () => {
      postMessage = installHandler({
        listPages: [page],
        status: statuses,
        createPage: { ...page, id: 'p2', source: 'mail', title: 'Email' },
        query: { items: [], total: 0 },
        deletePage: true,
      });
      service = TestBed.inject(MacDataService);
      await service.loadPages();
      await service.refreshStatus();
    });

    it('loads pages and status on start', () => {
      expect(service.isAvailable()).toBe(true);
      expect(service.pagesForNotebook('n1')).toEqual([page]);
      expect(service.pagesForNotebook('other')).toEqual([]);
      expect(service.statusBySource().mail?.state).toBe('needsAccess');
      // Loading twice reuses the first result.
      expect(postMessage.mock.calls.filter(([m]) => m.action === 'listPages')).toHaveLength(1);
    });

    it('adds and removes local pages without a server call', async () => {
      const created = await service.createPage('n1', 'mail');
      expect(postMessage).toHaveBeenCalledWith({
        action: 'createPage',
        notebookId: 'n1',
        source: 'mail',
      });
      expect(service.pagesForNotebook('n1').map((p) => p.id)).toEqual(['p1', 'p2']);
      await service.deletePage(created.id);
      expect(service.pages().map((p) => p.id)).toEqual(['p1']);
    });

    it('drops undefined fields before posting', async () => {
      await service.query({ source: 'mail', search: undefined, limit: 10 });
      expect(postMessage).toHaveBeenLastCalledWith({ action: 'query', source: 'mail', limit: 10 });
    });

    it('opens a cited item in the matching Mac page of the open notebook', async () => {
      const router = TestBed.inject(Router);
      Object.defineProperty(router, 'url', { get: () => '/n1/chat' });
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await service.openItem('imessage:guid-1');
      expect(navigate).toHaveBeenCalledWith(['/', 'n1', 'mac', 'p1'], {
        queryParams: { item: 'imessage:guid-1' },
      });
      // No Mac page for that source: nothing to open.
      navigate.mockClear();
      await service.openItem('calendar:x');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('applies status and change events from the Mac', () => {
      emit({ type: 'status', statuses: [{ source: 'mail', state: 'ready', itemCount: 9 }] });
      expect(service.statusBySource().mail?.itemCount).toBe(9);

      emit({ type: 'changed', source: 'mail' });
      emit({ type: 'changed', source: 'mail' });
      expect(service.versions().mail).toBe(2);
      expect(service.versions().imessage).toBeUndefined();
    });
  });
});

describe('Mac data page guards', () => {
  const route = {} as Route;
  const segments = (...paths: string[]) => paths.map((path) => ({ path }) as UrlSegment);

  afterEach(() => {
    delete window.webkit;
    TestBed.resetTestingModule();
  });

  it('matches only the page source it guards', async () => {
    installHandler({ listPages: [page], status: statuses });
    const run = (guard: typeof IMessagePageGuard, s: UrlSegment[]) =>
      TestBed.runInInjectionContext(() => guard(route, s));

    expect(await run(IMessagePageGuard, segments('mac', 'p1'))).toBe(true);
    expect(await run(MailPageGuard, segments('mac', 'p1'))).toBe(false);
    expect(await run(IMessagePageGuard, segments('mac', 'missing'))).toBe(false);
    expect(await run(IMessagePageGuard, segments('p1', 'x'))).toBe(false);
  });

  it('never matches outside the Mac app', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      IMessagePageGuard(route, segments('mac', 'p1')),
    );
    expect(result).toBe(false);
  });
});
