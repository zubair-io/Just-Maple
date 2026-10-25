import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import type { Page } from '@maple/shared';
import { DeviceDataService, OwnerOnlyError } from '../device-data.service';
import { PageService } from '../page.service';
import { MacDataService } from '../mac-data.service';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function page(overrides: Partial<Page>): Page {
  return {
    _id: 'x',
    id: 'p1',
    userId: 'me',
    type: 'devicedata',
    title: 'Messages',
    content: { type: 'doc' },
    notebookId: 'n1',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('DeviceDataService', () => {
  let service: DeviceDataService;
  let http: HttpTestingController;
  const pages = signal<Page[]>([]);
  const createPage = vi.fn();
  const macData = { isAvailable: signal(false), enableSource: vi.fn(async () => undefined) };
  const router = { url: '/n2/chat', navigate: vi.fn(async () => true) };

  beforeEach(() => {
    createPage.mockReset();
    macData.enableSource.mockClear();
    macData.isAvailable.set(false);
    router.navigate.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PageService, useValue: { pages, createPage } },
        { provide: MacDataService, useValue: macData },
        { provide: Router, useValue: router },
      ],
    });
    service = TestBed.inject(DeviceDataService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('lists items with only the query fields that are set', async () => {
    const result = service.listItems({
      source: 'mail',
      pageId: 'p1',
      search: '',
      from: 100,
      limit: 50,
      offset: 0,
      order: 'desc',
    });
    const request = http.expectOne((r) => r.url === '/api/device-data/items');
    expect(request.request.params.keys().sort()).toEqual([
      'from',
      'limit',
      'offset',
      'order',
      'pageId',
      'source',
    ]);
    expect(request.request.params.get('offset')).toBe('0');
    request.flush({
      items: [{ id: 'mail:1' }],
      total: 1,
      collector: { name: "Zubair's MacBook", platform: 'macos' },
    });
    expect(await result).toEqual({
      items: [{ id: 'mail:1' }],
      total: 1,
      collector: { name: "Zubair's MacBook", platform: 'macos' },
    });
  });

  it('turns a 403 for someone else’s page into OwnerOnlyError', async () => {
    const result = service.listItems({ source: 'mail', pageId: 'theirs' });
    http
      .expectOne((r) => r.url === '/api/device-data/items')
      .flush(
        { error: 'Only the owner', ownerOnly: true },
        { status: 403, statusText: 'Forbidden' },
      );
    await expect(result).rejects.toBeInstanceOf(OwnerOnlyError);
  });

  it('reports other failures with the server message', async () => {
    const result = service.listItems({ source: 'mail' });
    http
      .expectOne((r) => r.url === '/api/device-data/items')
      .flush({ error: 'Page not found' }, { status: 404, statusText: 'Not Found' });
    await expect(result).rejects.toThrow('Page not found');
  });

  it('returns null for a cited item that no longer exists', async () => {
    const result = service.getItem('mail:gone');
    http
      .expectOne('/api/device-data/items/mail%3Agone')
      .flush({ error: 'Item not found' }, { status: 404, statusText: 'Not Found' });
    expect(await result).toBeNull();
  });

  it('creates a cloud page and waits for the server copy', async () => {
    const temp = page({ userId: 'temp' });
    const saved = page({ deviceSource: 'contacts', title: 'Contacts' });
    createPage.mockReturnValue(of(temp, saved));
    expect(await service.createPage('n1', 'contacts')).toBe(saved);
    expect(createPage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'devicedata',
        deviceSource: 'contacts',
        title: 'Contacts',
        notebookId: 'n1',
      }),
    );
    // Not in the Mac app: nothing to switch on.
    expect(macData.enableSource).not.toHaveBeenCalled();
  });

  it('switches on Mac sources only, and only inside the Mac app', async () => {
    macData.isAvailable.set(true);
    createPage.mockReturnValue(of(page({ deviceSource: 'mail' })));
    await service.createPage('n1', 'mail', 'Work mail');
    expect(createPage.mock.calls[0]![0].title).toBe('Work mail');
    expect(macData.enableSource).toHaveBeenCalledWith('mail');

    macData.enableSource.mockClear();
    createPage.mockReturnValue(of(page({ deviceSource: 'health' })));
    await service.createPage('n1', 'health');
    expect(macData.enableSource).not.toHaveBeenCalled();
  });

  it('opens a cited item in the matching page, preferring the open notebook', async () => {
    pages.set([
      page({ id: 'a', notebookId: 'n1', deviceSource: 'imessage' }),
      page({ id: 'b', notebookId: 'n2', deviceSource: 'imessage' }),
      page({ id: 'c', notebookId: 'n2', deviceSource: 'mail' }),
    ]);
    expect(await service.openItem('imessage:guid')).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/', 'n2', 'b'], {
      queryParams: { item: 'imessage:guid' },
    });
    router.navigate.mockClear();
    expect(await service.openItem('calendar:x')).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('manages collectors', async () => {
    const listing = service.listCollectors();
    http.expectOne('/api/collectors').flush({ collectors: [{ deviceId: 'mac-1' }] });
    expect(await listing).toEqual([{ deviceId: 'mac-1' }]);

    const patching = service.setActiveSources('mac-1', ['mail', 'contacts']);
    const patch = http.expectOne('/api/collectors/mac-1');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ activeSources: ['mail', 'contacts'] });
    patch.flush({ collector: { deviceId: 'mac-1' } });
    await patching;

    const removing = service.removeCollector('mac-1');
    const remove = http.expectOne('/api/collectors/mac-1');
    expect(remove.request.method).toBe('DELETE');
    remove.flush({ removed: 3 });
    await removing;

    const clearing = service.removeAllData();
    const clear = http.expectOne('/api/device-data');
    expect(clear.request.method).toBe('DELETE');
    clear.flush({ removed: 12 });
    expect(await clearing).toBe(12);
    await flush();
  });
});
