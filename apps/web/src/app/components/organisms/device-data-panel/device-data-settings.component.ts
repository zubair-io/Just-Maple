import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  describeDeviceFilter,
  type DeviceDataFilter,
  type DeviceDataFilterOptions,
  type DeviceDataTimeWindow,
} from '@maple/shared';
import type { DeviceDataList } from './device-data-list';
import { DeviceDataService } from '../../../services/device-data.service';

/** What the creator picks from, per source: the item field the filter matches on. */
const PICK_COPY = {
  calendar: { key: 'calendars', label: 'Calendars', all: 'Share every calendar' },
  mail: { key: 'mailboxes', label: 'Mailboxes and labels', all: 'Share all mail' },
  imessage: { key: 'chats', label: 'Chats', all: 'Share every chat' },
} as const;

type PickSource = keyof typeof PICK_COPY;

/**
 * The creator's settings for a data page: its name, what it's for, and what it shares
 * with everyone in the notebook. Bots in the notebook read the name and description too.
 */
@Component({
  selector: 'app-device-data-settings',
  standalone: true,
  templateUrl: './device-data-settings.component.html',
  styleUrl: './device-data-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceDataSettingsComponent implements OnInit {
  private readonly deviceData = inject(DeviceDataService);

  readonly list = input.required<DeviceDataList>();

  readonly name = signal('');
  readonly description = signal('');
  readonly includeAll = signal(false);
  readonly picked = signal<string[]>([]);
  readonly windows = signal<DeviceDataTimeWindow[]>([]);
  readonly excludedPlaces = signal<string[]>([]);
  readonly options = signal<DeviceDataFilterOptions | null>(null);
  readonly optionsError = signal<string | null>(null);
  readonly pickQuery = signal('');
  readonly saving = signal(false);

  readonly source = computed(() => this.list().source);
  readonly pick = computed(() => PICK_COPY[this.source() as PickSource] ?? null);
  readonly isPlaces = computed(() => this.source() === 'location');
  readonly shared = computed(() => this.list().access()?.shared ?? false);

  /** Names to choose from: what the data has, plus anything already picked. */
  readonly choices = computed(() => {
    const pick = this.pick();
    const options = this.options();
    if (!pick || !options) return [];
    const names = [...new Set([...this.picked(), ...options[pick.key]])];
    const query = this.pickQuery().trim().toLowerCase();
    return query ? names.filter((name) => name.toLowerCase().includes(query)) : names;
  });

  readonly filter = computed<DeviceDataFilter>(() => {
    const filter: DeviceDataFilter = { includeAll: this.includeAll() };
    const pick = this.pick();
    if (pick && !this.includeAll()) filter[pick.key] = this.picked();
    if (this.isPlaces()) {
      filter.timeWindows = this.windows();
      filter.excludePlaceIds = this.excludedPlaces();
    }
    return filter;
  });

  /** "Others in this notebook see: Only the … calendar". */
  readonly preview = computed(() => {
    const names = Object.fromEntries(
      (this.options()?.places ?? []).map((place) => [place.id, place.name]),
    );
    return describeDeviceFilter(this.source(), this.filter(), names);
  });

  readonly windowsValid = computed(() => this.windows().every((w) => w.start !== w.end));

  ngOnInit(): void {
    const page = this.list().page();
    const filter = page?.deviceFilter;
    this.name.set(page?.title ?? '');
    this.description.set(page?.description ?? '');
    // An older page without a filter shows everything: start from that.
    this.includeAll.set(filter ? filter.includeAll === true : true);
    const pick = this.pick();
    this.picked.set(pick ? [...(filter?.[pick.key] ?? [])] : []);
    this.windows.set((filter?.timeWindows ?? []).map((w) => ({ ...w })));
    this.excludedPlaces.set([...(filter?.excludePlaceIds ?? [])]);
    if (page) {
      this.deviceData.filterOptions(page.id).then(
        (options) => this.options.set(options),
        () => this.optionsError.set('Could not load the choices from your data.'),
      );
    }
  }

  isPicked(name: string): boolean {
    return this.picked().includes(name);
  }

  togglePicked(name: string, on: boolean): void {
    this.picked.update((names) =>
      on ? [...new Set([...names, name])] : names.filter((n) => n !== name),
    );
  }

  isExcluded(id: string): boolean {
    return this.excludedPlaces().includes(id);
  }

  toggleExcluded(id: string, on: boolean): void {
    this.excludedPlaces.update((ids) =>
      on ? [...new Set([...ids, id])] : ids.filter((i) => i !== id),
    );
  }

  addWindow(): void {
    this.windows.update((windows) => [...windows, { start: '09:00', end: '17:00' }]);
  }

  setWindow(index: number, field: 'start' | 'end', value: string): void {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return;
    this.windows.update((windows) =>
      windows.map((w, i) => (i === index ? { ...w, [field]: value } : w)),
    );
  }

  removeWindow(index: number): void {
    this.windows.update((windows) => windows.filter((_, i) => i !== index));
  }

  async save(): Promise<void> {
    if (this.saving() || !this.windowsValid()) return;
    this.saving.set(true);
    try {
      await this.list().saveSettings({
        ...(this.name().trim() ? { title: this.name().trim() } : {}),
        description: this.description().trim(),
        deviceFilter: this.filter(),
      });
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.list().settingsOpen.set(false);
  }
}
