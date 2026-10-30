import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, type Type } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import type { MacDataItem, Page } from '@maple/shared';
import { MessageHistoryService } from '../services/message-history.service';
import { MailViewComponent } from './mail-view/mail-view.component';
import { IMessageViewComponent } from './imessage-view/imessage-view.component';
import { ContactsViewComponent } from './contacts-view/contacts-view.component';
import { HealthViewComponent } from './health-view/health-view.component';
import { PlacesViewComponent } from './places-view/places-view.component';
import { HomeViewComponent } from './home-view/home-view.component';
import { AboutMeService } from '../services/about-me.service';
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
    filterOptions: vi.fn(async () => ({
      calendars: [],
      mailboxes: [],
      chats: [
        { id: 'chat-1', name: 'Group chat' },
        { id: 'chat-2', name: 'Book club' },
      ],
      places: [],
      homeEntities: [
        { id: 'light.kitchen', name: 'Kitchen Light', domain: 'light', area: 'Kitchen' },
        { id: 'person.ria', name: 'Ria', domain: 'person' },
      ],
      homeAreas: ['Kitchen'],
    })),
    updateDataPage: vi.fn(async () => page),
  };
  const history = {
    directory: vi.fn(async () => ({
      conversations: [
        {
          key: 'person:alice',
          name: 'Alice Green',
          kind: 'person',
          platforms: ['imessage'],
          count: 250,
          matches: 250,
          latestAt: 1760000000,
          preview: 'Dinner at 7?',
        },
      ],
      platforms: ['imessage'],
      total: 250,
    })),
    messages: vi.fn(async () => ({
      items: [item({ sender: 'raw@example.com', senderName: 'Alice Green', body: 'Dinner at 7?' })],
      total: 250,
      offset: 0,
    })),
    imports: vi.fn(async () => ({ imports: [] })),
  };
  const page = { id: 'p1', notebookId: 'n1', title: 'Family texts' } as Page;
  const pageService = {
    pages: signal<Page[]>([page]),
    moveToTrash: vi.fn(() => of(undefined)),
  };
  const macData = {
    isAvailable: signal(false),
    statusBySource: signal({}),
    versions: signal({}),
    requestAccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pageService.pages.set([page]);
    const params = convertToParamMap({ id: 'p1' });
    const query = convertToParamMap({});
    TestBed.configureTestingModule({
      providers: [
        { provide: DeviceDataService, useValue: deviceData },
        { provide: MessageHistoryService, useValue: history },
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

  it('shows resolved contact names for messages and email instead of raw sender addresses', async () => {
    for (const component of [IMessageViewComponent, MailViewComponent]) {
      listItems.mockResolvedValue({
        items: [item({ sender: 'raw@example.com', senderName: 'Alice Green' })],
        total: 1,
        collector: null,
      });
      const { root, fixture } = await render(component as Type<IMessageViewComponent>);
      if (component === IMessageViewComponent) {
        (root.querySelector('[data-testid=conversation]') as HTMLButtonElement).click();
        fixture.detectChanges();
        await wait();
        fixture.detectChanges();
      }
      const row = root.querySelector(
        component === IMessageViewComponent ? '[data-testid=message]' : 'tbody',
      )!;
      expect(row.textContent).toContain('Alice Green');
      expect(row.textContent).not.toContain('raw@example.com');
      fixture.destroy();
    }
  });

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
      const { root, fixture } = await render(IMessageViewComponent);
      expect(listItems).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'imessage', pageId: 'p1', order: 'desc', offset: 0 }),
      );
      expect(root.querySelector('h1')?.textContent).toContain('Family texts');
      (root.querySelector('[data-testid=conversation]') as HTMLButtonElement).click();
      fixture.detectChanges();
      await wait();
      fixture.detectChanges();
      expect(root.querySelector('[data-testid=message]')?.textContent).toContain('Dinner at 7?');
      expect(root.querySelector('[data-testid="collector"]')?.textContent).toContain(
        "Collected by Zubair's MacBook — last upload 3 min ago",
      );
      // Opening your own page in the Mac app makes sure the Mac collects it.
      expect(deviceData.enableOnThisMac).toHaveBeenCalledWith('imessage');

      // Paging continues where the list ends.
      const more = [...root.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Load earlier messages'),
      )!;
      expect(more).toBeTruthy();
      more.click();
      await wait();
      expect(history.messages).toHaveBeenLastCalledWith(
        expect.objectContaining({ conversation: 'person:alice', before: 'imessage:1', limit: 100 }),
      );
    });

    it('searches after a pause in typing', async () => {
      listItems.mockResolvedValue({ items: [], total: 0, collector: null });
      const { root } = await render(IMessageViewComponent);
      const input = root.querySelector('input[type="search"]') as HTMLInputElement;
      input.value = 'dinner';
      input.dispatchEvent(new Event('input'));
      await wait(300);
      expect(history.directory).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'dinner' }),
      );
    });

    it('filters conversations by person or group and sends platform and date filters to the server', async () => {
      history.directory.mockResolvedValueOnce({
        conversations: [
          {
            key: 'person:alice',
            name: 'Alice',
            kind: 'person',
            platforms: ['aim'],
            count: 1,
            matches: 1,
            latestAt: 1,
            preview: 'Hello',
          },
          {
            key: 'group:friends',
            name: 'Friends',
            kind: 'group',
            platforms: ['aim'],
            count: 2,
            matches: 2,
            latestAt: 2,
            preview: 'Picnic',
          },
        ],
        platforms: ['aim'],
        total: 3,
      });
      listItems.mockResolvedValue({ items: [], total: 3, collector: null });
      const { root, fixture } = await render(IMessageViewComponent);
      const groups = [...root.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Groups',
      )!;
      groups.click();
      fixture.detectChanges();
      expect(root.querySelectorAll('[data-testid=conversation]')).toHaveLength(1);
      expect(root.querySelector('[data-testid=conversation]')?.textContent).toContain('Friends');
      const select = root.querySelector('select')!;
      select.value = 'aim';
      select.dispatchEvent(new Event('change'));
      const dates = root.querySelectorAll<HTMLInputElement>('input[type=date]');
      dates[0]!.value = '2020-01-01';
      dates[0]!.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await wait();
      fixture.detectChanges();
      expect(history.directory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          platform: 'aim',
          from: new Date('2020-01-01T00:00:00').getTime() / 1000,
        }),
      );
    });

    it('opens a search result with surrounding messages and keeps text safely escaped', async () => {
      listItems.mockResolvedValue({ items: [], total: 1, collector: null });
      history.messages.mockResolvedValueOnce({
        items: [item({ body: 'Dinner <script>alert(1)</script>' })],
        total: 1,
        offset: 0,
      });
      const { root, fixture } = await render(IMessageViewComponent);
      fixture.componentInstance.search.set('Dinner');
      fixture.detectChanges();
      await wait(280);
      fixture.detectChanges();
      (root.querySelector('[data-testid=conversation]') as HTMLButtonElement).click();
      fixture.detectChanges();
      await wait();
      fixture.detectChanges();
      expect(root.querySelector('[data-testid=message] script')).toBeNull();
      expect(root.querySelector('mark')?.textContent).toBe('Dinner');
      const context = [...root.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Show in conversation'),
      )!;
      context.click();
      fixture.detectChanges();
      await wait(280);
      fixture.detectChanges();
      expect(history.messages).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: '', around: 'imessage:1' }),
      );
    });

    it('says which device to set up when nothing collects the source', async () => {
      listItems.mockResolvedValue({ items: [], total: 0, collector: null });
      const { root } = await render(IMessageViewComponent);
      expect(root.querySelector('[data-testid="collector"]')?.textContent).toContain(
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

  describe('Shared data pages', () => {
    const buttons = (root: HTMLElement) =>
      [...root.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent?.trim(),
      );

    it("tells other members whose data it is and that it's filtered, with no way to change it", async () => {
      listItems.mockResolvedValue({
        items: [item({ thread: 'Group chat', body: 'See you there' })],
        total: 1,
        collector: null,
        access: {
          canManage: false,
          ownerName: 'Alex',
          shared: true,
          description: 'Plans for the weekend',
          filterSummary: 'Only the Group chat chat',
        },
      });
      const { root } = await render(IMessageViewComponent);
      expect(root.querySelector('[data-testid="collector"]')?.textContent).toContain(
        "Alex's data, filtered: Only the Group chat chat",
      );
      expect(root.textContent).toContain('Plans for the weekend');
      expect(buttons(root)).not.toContain('Page settings');
      expect(buttons(root)).not.toContain('Remove page');
      expect(deviceData.enableOnThisMac).not.toHaveBeenCalled();
    });

    it('prompts the creator to choose what a new shared page shows, and saves the choice', async () => {
      pageService.pages.set([{ ...page, deviceFilter: {} } as Page]);
      listItems.mockResolvedValue({
        items: [],
        total: 0,
        collector: null,
        access: { canManage: true, ownerName: 'Alex', shared: true, filterSummary: 'Nothing yet' },
      });
      const { fixture, root } = await render(IMessageViewComponent);
      expect(root.querySelector('[data-testid="empty"]')?.textContent).toContain(
        'Nothing is shared yet',
      );
      expect(root.querySelector('[data-testid="sharing"]')?.textContent).toContain(
        'Shared with this notebook: Nothing yet',
      );
      const choose = [...root.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Choose what to share',
      )!;
      choose.click();
      await wait();
      fixture.detectChanges();
      expect(deviceData.filterOptions).toHaveBeenCalledWith('p1');

      const chat = [...root.querySelectorAll('form label')].find((l) =>
        l.textContent?.includes('Book club'),
      )!;
      const box = chat.querySelector('input') as HTMLInputElement;
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(root.querySelector('[data-testid="share-preview"]')?.textContent).toContain(
        'Everyone in this notebook sees: Only the Book club chat',
      );
      (root.querySelector('form button[type="submit"]') as HTMLButtonElement).click();
      await wait();
      expect(deviceData.updateDataPage).toHaveBeenCalledWith('p1', {
        title: 'Family texts',
        description: '',
        deviceFilter: { includeAll: false, chats: [{ id: 'chat-2', name: 'Book club' }] },
      });
    });

    it('keeps an older unfiltered page unshared when the creator only renames it', async () => {
      pageService.pages.set([page]);
      deviceData.updateDataPage.mockClear();
      listItems.mockResolvedValue({
        items: [],
        total: 0,
        collector: null,
        access: { canManage: true, ownerName: 'Alex', shared: true },
      });
      const { fixture, root } = await render(IMessageViewComponent);
      (root.querySelector('button[aria-label="Page settings"]') as HTMLButtonElement).click();
      await wait();
      fixture.detectChanges();
      // Nothing starts out shared.
      const all = root.querySelector('form input[name="includeAll"]') as HTMLInputElement;
      expect(all.checked).toBe(false);
      expect(root.querySelector('[data-testid="share-preview"]')?.textContent).toContain(
        'Nothing yet',
      );
      const name = root.querySelector('form input[name="name"]') as HTMLInputElement;
      name.value = 'Group texts';
      name.dispatchEvent(new Event('input'));
      (root.querySelector('form button[type="submit"]') as HTMLButtonElement).click();
      await wait();
      expect(deviceData.updateDataPage).toHaveBeenCalledWith('p1', {
        title: 'Group texts',
        description: '',
      });
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

  describe('Home', () => {
    const home = (overrides: Partial<MacDataItem>) => item({ source: 'home', ...overrides });

    it('lists devices by area with their state, then recent changes', async () => {
      const change = home({
        id: 'home:light.kitchen@1760000100',
        title: 'Kitchen Light',
        occurredAt: 1_760_000_100,
        extra: { entityId: 'light.kitchen', kind: 'change', state: 'on', from: 'off' },
      });
      const states = [
        home({
          id: 'home:sensor.porch_temp',
          title: 'Porch Temperature',
          extra: { entityId: 'sensor.porch_temp', state: '18.5', unit: '°C', kind: 'state' },
        }),
        home({
          id: 'home:light.kitchen',
          title: 'Kitchen Light',
          extra: { entityId: 'light.kitchen', state: 'on', area: 'Kitchen', kind: 'state' },
        }),
      ];
      listItems.mockImplementation(async (query: { homeKind?: string }) =>
        query.homeKind === 'change'
          ? { items: [change], total: 1, collector: null }
          : { items: states, total: 2, collector: null },
      );
      const { root } = await render(HomeViewComponent);
      // States and changes load separately, so changes can't crowd devices off the list.
      expect(listItems).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'home', homeKind: 'state', limit: 500 }),
      );
      expect(listItems).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'home', homeKind: 'change' }),
      );
      const [devices, changes] = root.querySelectorAll('table');
      const rows = devices!.querySelectorAll('tbody tr');
      // Devices with an area first.
      expect(rows[0]?.textContent).toContain('Kitchen Light');
      expect(rows[0]?.textContent).toContain('Kitchen');
      expect(rows[1]?.textContent).toContain('Porch Temperature');
      expect(rows[1]?.textContent).toContain('18.5 °C');
      expect(changes?.textContent).toContain('off → on');
      expect(root.querySelector('[data-testid="collector"]')?.textContent).toContain(
        'Not collected yet: open Maple on your Mac and turn on Home Assistant',
      );
    });

    it("shares chosen areas, and who's home only when asked", async () => {
      pageService.pages.set([{ ...page, deviceSource: 'home', deviceFilter: {} } as Page]);
      deviceData.updateDataPage.mockClear();
      listItems.mockResolvedValue({
        items: [],
        total: 0,
        collector: null,
        access: { canManage: true, ownerName: 'Alex', shared: true, filterSummary: 'Nothing yet' },
      });
      const { fixture, root } = await render(HomeViewComponent);
      (root.querySelector('button[aria-label="Page settings"]') as HTMLButtonElement).click();
      await wait();
      fixture.detectChanges();
      const check = (label: string) => {
        const box = [...root.querySelectorAll('form label')]
          .find((l) => l.textContent?.trim().startsWith(label))!
          .querySelector('input') as HTMLInputElement;
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        fixture.detectChanges();
      };
      check('Kitchen');
      expect(root.querySelector('[data-testid="share-preview"]')?.textContent).toContain(
        'Devices in Kitchen',
      );
      check("Include who's home");
      expect(root.querySelector('[data-testid="share-preview"]')?.textContent).toContain(
        "Devices in Kitchen and who's home",
      );
      (root.querySelector('form button[type="submit"]') as HTMLButtonElement).click();
      await wait();
      expect(deviceData.updateDataPage).toHaveBeenCalledWith('p1', {
        title: 'Family texts',
        description: '',
        deviceFilter: {
          includeAll: false,
          homeEntities: [],
          homeAreas: ['Kitchen'],
          includePresence: true,
        },
      });
    });
  });

  describe('Places', () => {
    it("names a visit's place, so new visits and reminders use the name", async () => {
      listItems.mockResolvedValue({
        items: [
          item({
            id: 'location:visit:1',
            source: 'location',
            title: '12 Maple St',
            location: '12 Maple St, Springfield',
            extra: { lat: 40.7128, lon: -74.006 },
          }),
        ],
        total: 1,
        collector: { name: 'iPhone', platform: 'ios', lastUploadAt: undefined },
      } as unknown as DeviceItemsResult);
      const namePlace = vi.fn(async () => undefined);
      TestBed.overrideProvider(AboutMeService, { useValue: { namePlace } });
      TestBed.overrideProvider(DialogService, {
        useValue: { confirm: vi.fn(async () => true), prompt: vi.fn(async () => ' Home ') },
      });
      const { fixture, root } = await render(PlacesViewComponent);
      const button = [...root.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Name',
      ) as HTMLButtonElement;
      button.click();
      await wait();
      fixture.detectChanges();
      expect(namePlace).toHaveBeenCalledWith({
        name: 'Home',
        lat: 40.7128,
        lon: -74.006,
        address: '12 Maple St, Springfield',
      });
      expect(root.textContent).toContain('Saved "Home"');
    });
  });
});
