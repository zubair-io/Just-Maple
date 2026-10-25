import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, type Type } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import type { MacDataItem, Page } from '@maple/shared';
import { IMessageViewComponent } from './imessage-view/imessage-view.component';
import { ContactsViewComponent } from './contacts-view/contacts-view.component';
import { HealthViewComponent } from './health-view/health-view.component';
import {
  DeviceDataService,
  OwnerOnlyError,
  type DeviceItemsResult,
} from '../services/device-data.service';
import { MacDataService } from '../services/mac-data.service';
import { PageService } from '../services/page.service';
import { DialogService } from '../components/molecules/dialog/dialog.service';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function item(overrides: Partial<MacDataItem>): MacDataItem {
  return {
    id: 'imessage:1',
    source: 'imessage',
    revision: '1',
    occurredAt: 1_760_000_000,
    participants: [],
    body: '',
    ...overrides,
  };
}

describe('device data views', () => {
  const listItems = vi.fn<(query: unknown) => Promise<DeviceItemsResult>>();
  const deviceData = {
    listItems,
    getItem: vi.fn(async () => null),
    enableOnThisMac: vi.fn(async () => undefined),
  };
  const page = { id: 'p1', notebookId: 'n1', title: 'Family texts' } as Page;
  const pageService = { pages: signal([page]), moveToTrash: vi.fn(() => of(undefined)) };
  const macData = {
    isAvailable: signal(false),
    statusBySource: signal({}),
    versions: signal({}),
    requestAccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const params = convertToParamMap({ id: 'p1' });
    const query = convertToParamMap({});
    TestBed.configureTestingModule({
      providers: [
        { provide: DeviceDataService, useValue: deviceData },
        { provide: PageService, useValue: pageService },
        { provide: MacDataService, useValue: macData },
        { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(params),
            queryParamMap: of(query),
            snapshot: { paramMap: params, queryParamMap: query },
          },
        },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  async function render<T>(component: Type<T>) {
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    await wait();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  describe('Messages', () => {
    it('loads the page’s items from the API and names the collecting device', async () => {
      listItems.mockResolvedValue({
        items: [item({ thread: 'Mom', sender: 'Mom', body: 'Dinner at 7?' })],
        total: 250,
        collector: {
          name: "Zubair's MacBook",
          platform: 'macos',
          lastUploadAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        },
      });
      const { root } = await render(IMessageViewComponent);
      expect(listItems).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'imessage', pageId: 'p1', order: 'desc', offset: 0 }),
      );
      expect(root.querySelector('h1')?.textContent).toContain('Family texts');
      expect(root.querySelector('tbody')?.textContent).toContain('Dinner at 7?');
      expect(root.querySelector('[data-testid="collector"]')?.textContent).toContain(
        "Collected by Zubair's MacBook — last upload 3 min ago",
      );
      // Opening your own page in the Mac app makes sure the Mac collects it.
      expect(deviceData.enableOnThisMac).toHaveBeenCalledWith('imessage');

      // Paging continues where the list ends.
      const more = [...root.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Load more'),
      )!;
      expect(more.textContent).toContain('1 of 250');
      more.click();
      await wait();
      expect(listItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 1, limit: 100 }),
      );
    });

    it('searches after a pause in typing', async () => {
      listItems.mockResolvedValue({ items: [], total: 0, collector: null });
      const { root } = await render(IMessageViewComponent);
      const input = root.querySelector('input[type="search"]') as HTMLInputElement;
      input.value = 'dinner';
      input.dispatchEvent(new Event('input'));
      await wait(300);
      expect(listItems).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'dinner' }));
    });

    it('says which device to set up when nothing collects the source', async () => {
      listItems.mockResolvedValue({ items: [], total: 0, collector: null });
      const { root } = await render(IMessageViewComponent);
      expect(root.querySelector('[data-testid="empty"]')?.textContent).toContain(
        'Not collected yet: open Maple on your Mac and turn on Messages',
      );
    });

    it('shows only an owner-only notice on someone else’s page', async () => {
      listItems.mockRejectedValue(new OwnerOnlyError());
      const { root } = await render(IMessageViewComponent);
      expect(root.textContent).toContain('Only the owner of Family texts can see this');
      expect(root.querySelector('table')).toBeNull();
      expect(root.querySelector('input[type="search"]')).toBeNull();
      expect(deviceData.enableOnThisMac).not.toHaveBeenCalled();
    });
  });

  describe('Contacts', () => {
    it('shows names, phones, emails and relations, with "me" first', async () => {
      listItems.mockResolvedValue({
        items: [
          item({
            id: 'contacts:2',
            source: 'contacts',
            title: 'Zoe Park',
            extra: {
              phones: [{ label: '_$!<Mobile>!$_', value: '+1 555 0100' }],
              emails: ['zoe@example.com'],
              relations: [{ label: 'sister', name: 'Ana Park' }],
              organization: 'Acme',
            },
          }),
          item({ id: 'contacts:1', source: 'contacts', title: 'Ben Lee', extra: { isMe: true } }),
        ],
        total: 2,
        collector: { name: "Zubair's MacBook", platform: 'macos' },
      });
      const { root } = await render(ContactsViewComponent);
      expect(listItems).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'contacts', limit: 500 }),
      );
      const rows = root.querySelectorAll('tbody tr');
      expect(rows[0]?.textContent).toContain('Ben Lee');
      expect(rows[0]?.textContent).toContain('Me');
      expect(rows[1]?.textContent).toContain('+1 555 0100 (mobile)');
      expect(rows[1]?.textContent).toContain('zoe@example.com');
      expect(rows[1]?.textContent).toContain('Ana Park (sister)');
      expect(rows[1]?.textContent).toContain('Acme');
    });
  });

  describe('Health', () => {
    it('splits daily summaries from workouts and names the iPhone when empty', async () => {
      listItems.mockResolvedValue({
        items: [
          item({
            id: 'health:day:2025-10-09',
            source: 'health',
            extra: { steps: 9120, exerciseMinutes: 42, sleepHours: 7.25, restingHeartRate: 58 },
          }),
          item({
            id: 'health:workout:1',
            source: 'health',
            title: 'Running',
            endAt: 1_760_000_000 + 1800,
            extra: { kind: 'workout', activeEnergy: 310 },
          }),
        ],
        total: 2,
        collector: null,
      });
      const { root } = await render(HealthViewComponent);
      const [days, workouts] = root.querySelectorAll('table');
      expect(days?.textContent).toContain('9,120');
      expect(days?.textContent).toContain('42 min');
      expect(days?.textContent).toContain('7.3 h');
      expect(days?.textContent).toContain('58 bpm');
      expect(workouts?.textContent).toContain('Running');
      expect(workouts?.textContent).toContain('30 min');
      expect(workouts?.textContent).toContain('310 kcal');
      expect(root.querySelector('[data-testid="collector"]')?.textContent).toContain(
        'Not collected yet: open Maple on your iPhone and turn on Health',
      );
    });
  });
});
