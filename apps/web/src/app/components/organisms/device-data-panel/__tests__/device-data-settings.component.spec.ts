import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DeviceDataFilterOptions, Page } from '@maple/shared';
import { DeviceDataSettingsComponent } from '../device-data-settings.component';
import type { DeviceDataList } from '../device-data-list';
import { DeviceDataService } from '../../../../services/device-data.service';

describe('DeviceDataSettingsComponent', () => {
  async function setup(saved: Page['deviceFilter'], options: Partial<DeviceDataFilterOptions>) {
    TestBed.configureTestingModule({
      imports: [DeviceDataSettingsComponent],
      providers: [
        {
          provide: DeviceDataService,
          useValue: { filterOptions: vi.fn(async () => ({ chats: [], ...options })) },
        },
      ],
    });
    const list = {
      source: 'imessage',
      page: signal({ id: 'p1', title: 'Texts', deviceFilter: saved } as Page),
      access: signal({ shared: true }),
      saveSettings: vi.fn(),
      settingsOpen: signal(true),
    } as unknown as DeviceDataList;
    const fixture = TestBed.createComponent(DeviceDataSettingsComponent);
    fixture.componentRef.setInput('list', list);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it("shows a person's iMessage and SMS chats as one row, checked when either is shared", async () => {
    const settings = await setup(
      { chats: [{ id: 'iMessage;-;+15185550142', name: 'Bob' }] },
      {
        chats: [
          { id: 'SMS;-;(518) 555-0142', name: 'Bob' },
          { id: 'iMessage;-;+447911123456', name: 'Ann' },
        ],
      },
    );
    const rows = settings.choices();
    expect(rows.map((row) => row.choice.name)).toEqual(['Bob', 'Ann']);
    expect(rows.map((row) => settings.isPicked(row))).toEqual([true, false]);
  });

  it('keeps people with numbers from different countries apart', async () => {
    const settings = await setup(
      { chats: [{ id: 'iMessage;-;+33612345678', name: '+33612345678' }] },
      { chats: [{ id: 'iMessage;-;+13612345678', name: '+13612345678' }] },
    );
    const rows = settings.choices();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => settings.isPicked(row))).toEqual([true, false]);
  });
});
