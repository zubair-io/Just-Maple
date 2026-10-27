import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Collector } from '@maple/shared';
import { DevicesComponent } from './devices.component';
import { DeviceDataService } from '../../services/device-data.service';
import { MacDataService, type MacSourceStatus } from '../../services/mac-data.service';
import {
  IPhoneCollectorService,
  type IPhoneSourceStatus,
} from '../../services/iphone-collector.service';
import { DialogService } from '../../components/molecules/dialog/dialog.service';

const mac: Collector = {
  deviceId: 'mac-1',
  platform: 'macos',
  name: "Zubair's MacBook",
  sources: ['imessage', 'mail', 'calendar', 'contacts'],
  activeSources: ['imessage', 'mail'],
  lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
  lastUploadAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  itemCounts: { imessage: 120, mail: 40 },
};
const phone: Collector = {
  deviceId: 'phone-1',
  platform: 'ios',
  name: "Zubair's iPhone",
  sources: ['calendar', 'location', 'health'],
  activeSources: ['calendar', 'location'],
  itemCounts: { calendar: 12, location: 30 },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('DevicesComponent', () => {
  let fixture: ComponentFixture<DevicesComponent>;
  const deviceData = {
    listCollectors: vi.fn(async () => [mac, phone]),
    setActiveSources: vi.fn(async () => mac),
    removeCollector: vi.fn(async () => undefined),
    removeAllData: vi.fn(async () => 5),
  };
  const dialog = { confirm: vi.fn(async () => true) };
  const macStatuses = signal<Partial<Record<string, MacSourceStatus>>>({});
  const macData = {
    isAvailable: signal(false),
    statusBySource: macStatuses,
    refreshStatus: vi.fn(async () => undefined),
    enableSource: vi.fn(async () => undefined),
    disableSource: vi.fn(async () => undefined),
    requestAccess: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => undefined),
    actionCalendars: vi.fn(async () => ({
      calendars: [
        { id: 'home', title: 'Home', account: 'iCloud' },
        { id: 'kids', title: 'Kids', account: 'iCloud' },
      ],
      selected: null as string | null,
      defaultId: 'home',
    })),
    setActionCalendar: vi.fn(async () => undefined),
  };
  const iphoneStatuses = signal<IPhoneSourceStatus[]>([]);
  const iphone = {
    isAvailable: signal(false),
    statuses: iphoneStatuses,
    refreshStatus: vi.fn(async () => undefined),
    enable: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    syncNow: vi.fn(async () => undefined),
  };

  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(DevicesComponent);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function button(root: ParentNode, label: string): HTMLButtonElement {
    const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`No button "${label}"`);
    return found;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    macData.isAvailable.set(false);
    iphone.isAvailable.set(false);
    TestBed.configureTestingModule({
      imports: [DevicesComponent],
      providers: [
        { provide: DeviceDataService, useValue: deviceData },
        { provide: MacDataService, useValue: macData },
        { provide: IPhoneCollectorService, useValue: iphone },
        { provide: DialogService, useValue: dialog },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('lists each device with what it collects', async () => {
    const root = await render();
    const cards = root.querySelectorAll('[data-testid="collector"]');
    expect(cards).toHaveLength(2);
    const macCard = cards[0]!;
    expect(macCard.textContent).toContain("Zubair's MacBook");
    expect(macCard.textContent).toContain('last upload 3 min ago');
    expect(macCard.querySelector('[data-source="imessage"]')?.textContent).toContain(
      'Collected here · 120 items',
    );
    // Calendar comes from the iPhone, so the Mac offers to take it over.
    const calendar = macCard.querySelector('[data-source="calendar"]')!;
    expect(calendar.textContent).toContain("Collected by Zubair's iPhone");
    expect(calendar.textContent).toContain('Collect here');
    expect(macCard.querySelector('[data-source="contacts"]')?.textContent).toContain(
      'Not collected',
    );
    // No device app here: no local switches.
    expect(root.textContent).not.toContain('On this Mac');
    expect(root.textContent).not.toContain('On this iPhone');
  });

  it('makes a device collect a source, after confirming the move', async () => {
    const root = await render();
    const calendar = root.querySelector('[data-testid="collector"] [data-source="calendar"]')!;
    button(calendar, 'Collect here').click();
    await flush();
    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Collect Calendar on Zubair's MacBook?" }),
    );
    expect(deviceData.setActiveSources).toHaveBeenCalledWith('mac-1', [
      'imessage',
      'mail',
      'calendar',
    ]);
    expect(deviceData.listCollectors).toHaveBeenCalledTimes(2);
  });

  it('collects a source nobody collects without asking', async () => {
    const root = await render();
    const contacts = root.querySelector('[data-testid="collector"] [data-source="contacts"]')!;
    button(contacts, 'Collect here').click();
    await flush();
    expect(dialog.confirm).not.toHaveBeenCalled();
    expect(deviceData.setActiveSources).toHaveBeenCalledWith('mac-1', [
      'imessage',
      'mail',
      'contacts',
    ]);
  });

  it('removes a device only after confirming', async () => {
    const root = await render();
    const phoneCard = root.querySelectorAll('[data-testid="collector"]')[1]!;
    dialog.confirm.mockResolvedValueOnce(false);
    button(phoneCard, 'Remove device').click();
    await flush();
    expect(deviceData.removeCollector).not.toHaveBeenCalled();

    button(phoneCard, 'Remove device').click();
    await flush();
    expect(deviceData.removeCollector).toHaveBeenCalledWith('phone-1');
  });

  it('removes all device data after confirming', async () => {
    const root = await render();
    button(root, 'Remove all my device data from the cloud').click();
    await flush();
    expect(dialog.confirm).toHaveBeenCalled();
    expect(deviceData.removeAllData).toHaveBeenCalled();
  });

  it('shows a failure from the server', async () => {
    deviceData.removeAllData.mockRejectedValueOnce(new Error('Server unavailable'));
    const root = await render();
    button(root, 'Remove all my device data from the cloud').click();
    await flush();
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Server unavailable');
  });

  it('shows this Mac’s sources and turns one on inside the Mac app', async () => {
    macData.isAvailable.set(true);
    macStatuses.set({
      imessage: { source: 'imessage', state: 'ready', itemCount: 10, enabled: true },
      contacts: { source: 'contacts', state: 'off', itemCount: 0 },
    });
    const root = await render();
    expect(root.textContent).toContain('On this Mac');
    const rows = root.querySelectorAll('[data-testid="mac-source"]');
    expect(rows).toHaveLength(4);
    const contacts = [...rows].find((row) => row.textContent?.includes('Contacts'))!;
    button(contacts, 'Turn on').click();
    await flush();
    expect(macData.enableSource).toHaveBeenCalledWith('contacts');
  });

  it('picks the calendar that Add to calendar uses on this Mac', async () => {
    macData.isAvailable.set(true);
    macStatuses.set({
      calendar: { source: 'calendar', state: 'ready', itemCount: 3, enabled: true },
    });
    const root = await render();
    const picker = root.querySelector<HTMLSelectElement>('[data-testid="action-calendar"] select')!;
    expect([...picker.options].map((o) => o.textContent?.trim())).toEqual([
      'Default calendar (Home)',
      'Home · iCloud',
      'Kids · iCloud',
    ]);
    picker.value = 'kids';
    picker.dispatchEvent(new Event('change'));
    await flush();
    expect(macData.setActionCalendar).toHaveBeenCalledWith('kids');
    picker.value = '';
    picker.dispatchEvent(new Event('change'));
    await flush();
    expect(macData.setActionCalendar).toHaveBeenLastCalledWith(null);
  });

  it('shows iPhone switches for Places and Health inside the iPhone app', async () => {
    iphone.isAvailable.set(true);
    iphoneStatuses.set([
      { source: 'location', available: true, authorized: true, enabled: true, lastUploadAt: null },
      { source: 'health', available: true, authorized: false, enabled: false },
    ]);
    const root = await render();
    const rows = root.querySelectorAll('[data-testid="iphone-source"]');
    expect(rows).toHaveLength(2);
    const health = rows[1]!.querySelector('input')!;
    expect(health.checked).toBe(false);
    health.checked = true;
    health.dispatchEvent(new Event('change'));
    await flush();
    expect(iphone.enable).toHaveBeenCalledWith('health');
  });
});
