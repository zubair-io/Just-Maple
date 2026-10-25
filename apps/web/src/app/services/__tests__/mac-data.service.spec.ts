import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import type { MacDataPage, MacDataSourceStatus } from '@maple/shared';
import { MacDataService } from '../mac-data.service';
import { PageService } from '../page.service';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const oldPages: MacDataPage[] = [
  { id: 'p-msgs', notebookId: 'n1', source: 'imessage', title: 'Family texts', createdAt: 1 },
  { id: 'p-mail', notebookId: 'n2', source: 'mail', title: 'Email', createdAt: 2 },
];

const statuses: MacDataSourceStatus[] = [
  { source: 'imessage', state: 'ready', itemCount: 4 },
  { source: 'mail', state: 'needsAccess', itemCount: 0, message: 'denied' },
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

describe('MacDataService', () => {
  const createPage = vi.fn();

  beforeEach(() => {
    createPage.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PageService, useValue: { createPage } },
      ],
    });
  });

  afterEach(() => {
    delete window.webkit;
    TestBed.resetTestingModule();
  });

  it('does nothing outside the Mac app', async () => {
    const service = TestBed.inject(MacDataService);
    expect(service.isAvailable()).toBe(false);
    expect(await service.migrateLocalPages()).toBe(0);
    await service.enableSource('mail'); // no-op, no throw
    await expect(service.syncNow()).rejects.toThrow('only available');
  });

  it('reads status and turns sources on and off through the bridge', async () => {
    const postMessage = installHandler({
      status: statuses,
      relayStatus: 'Connected',
      enableSource: true,
      disableSource: true,
    });
    const service = TestBed.inject(MacDataService);
    await service.refreshStatus();
    expect(service.statusBySource().mail?.state).toBe('needsAccess');
    expect(service.relay()).toBe('Connected');

    await service.enableSource('contacts');
    expect(postMessage).toHaveBeenCalledWith({ action: 'enableSource', source: 'contacts' });
    // iPhone sources are never sent to the Mac.
    await service.enableSource('health');
    expect(postMessage).not.toHaveBeenCalledWith({ action: 'enableSource', source: 'health' });

    await service.disableSource('mail');
    expect(postMessage).toHaveBeenCalledWith({ action: 'disableSource', source: 'mail' });
  });

  describe('moving old local pages to the cloud', () => {
    let http: HttpTestingController;

    beforeEach(() => {
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    /** Answers the "does this cloud page already exist?" checks. */
    async function answerExistenceChecks(existing: string[] = []) {
      for (let i = 0; i < 20; i++) {
        await flush();
        const open = http.match((r) => r.url.startsWith('/api/pages/'));
        if (!open.length) continue;
        for (const request of open) {
          const id = request.request.url.split('/').pop()!;
          if (existing.includes(id)) request.flush({ page: { id } });
          else request.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
        }
      }
    }

    it('creates each page in the cloud, then deletes the local record', async () => {
      const postMessage = installHandler({
        status: statuses,
        relayStatus: 'Connected',
        listPages: oldPages,
        deletePage: true,
        enableSource: true,
      });
      createPage.mockImplementation((data) => of({ ...data, userId: 'temp' }, { ...data }));
      const service = TestBed.inject(MacDataService);

      const moving = service.migrateLocalPages();
      await answerExistenceChecks();
      expect(await moving).toBe(2);

      expect(createPage).toHaveBeenCalledWith({
        id: 'p-msgs',
        type: 'devicedata',
        deviceSource: 'imessage',
        title: 'Family texts',
        notebookId: 'n1',
      });
      expect(createPage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p-mail', deviceSource: 'mail', notebookId: 'n2' }),
      );
      const actions = postMessage.mock.calls.map(([m]) => m);
      expect(actions).toContainEqual({ action: 'deletePage', id: 'p-msgs' });
      expect(actions).toContainEqual({ action: 'deletePage', id: 'p-mail' });
      expect(actions).toContainEqual({ action: 'enableSource', source: 'imessage' });

      // Once per launch.
      expect(await service.migrateLocalPages()).toBe(2);
      expect(postMessage.mock.calls.filter(([m]) => m.action === 'listPages')).toHaveLength(1);
    });

    it('skips creating a page an interrupted run already created', async () => {
      const postMessage = installHandler({
        status: statuses,
        relayStatus: 'Connected',
        listPages: [oldPages[0]],
        deletePage: true,
        enableSource: true,
      });
      const service = TestBed.inject(MacDataService);
      const moving = service.migrateLocalPages();
      await answerExistenceChecks(['p-msgs']);
      expect(await moving).toBe(1);
      expect(createPage).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({ action: 'deletePage', id: 'p-msgs' });
    });

    it('keeps the local record when the cloud page could not be created', async () => {
      const postMessage = installHandler({
        status: statuses,
        relayStatus: 'Connected',
        listPages: oldPages,
        deletePage: true,
        enableSource: true,
      });
      createPage.mockImplementation((data) =>
        data.id === 'p-msgs' ? throwError(() => new Error('offline')) : of(data),
      );
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const service = TestBed.inject(MacDataService);
      const moving = service.migrateLocalPages();
      await answerExistenceChecks();
      expect(await moving).toBe(1);
      const deleted = postMessage.mock.calls
        .map(([m]) => m as { action: string; id?: string })
        .filter((m) => m.action === 'deletePage')
        .map((m) => m.id);
      expect(deleted).toEqual(['p-mail']);
    });

    it('leaves pages of notebooks stored in local files alone', async () => {
      const postMessage = installHandler({
        status: statuses,
        relayStatus: 'Connected',
        listPages: [{ ...oldPages[0], notebookId: 'local-notebook-abc' }],
        deletePage: true,
      });
      const service = TestBed.inject(MacDataService);
      expect(await service.migrateLocalPages()).toBe(0);
      expect(createPage).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deletePage' }),
      );
    });
  });
});
