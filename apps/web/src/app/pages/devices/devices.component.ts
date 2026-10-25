import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import type { Collector, MacDataSource } from '@maple/shared';
import { SettingsHeaderComponent } from '../../components/molecules/settings-header/settings-header.component';
import { DialogService } from '../../components/molecules/dialog/dialog.service';
import { DeviceDataService } from '../../services/device-data.service';
import { MacDataService, type MacSourceStatus } from '../../services/mac-data.service';
import { IPhoneCollectorService } from '../../services/iphone-collector.service';
import {
  IPHONE_SOURCES,
  MAC_SOURCES,
  deviceSourceInfo,
  platformIcon,
  platformLabel,
  timeAgo,
} from '../../utils/device-sources';

/**
 * Settings → Devices: the devices that collect the user's personal data, which device
 * uploads each source, and removing devices or all uploaded data. Inside the Mac or
 * iPhone app it also shows that device's own switches.
 */
@Component({
  selector: 'app-devices',
  standalone: true,
  imports: [SettingsHeaderComponent],
  templateUrl: './devices.component.html',
  styleUrl: './devices.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicesComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogService);
  private readonly deviceData = inject(DeviceDataService);
  readonly macData = inject(MacDataService);
  readonly iphone = inject(IPhoneCollectorService);

  readonly collectors = signal<Collector[]>([]);
  readonly loading = signal(true);
  private readonly loadError = signal<string | null>(null);
  private readonly actionError = signal<string | null>(null);
  /** The last action's failure, or why the list didn't load. */
  readonly error = computed(() => this.actionError() ?? this.loadError());
  /** The action in flight, e.g. "collect:<deviceId>:mail", to disable its button. */
  readonly busy = signal<string | null>(null);

  readonly macSources = MAC_SOURCES;
  readonly iphoneSources = IPHONE_SOURCES;
  readonly sourceInfo = deviceSourceInfo;
  readonly platformIcon = platformIcon;
  readonly platformLabel = platformLabel;
  readonly timeAgo = timeAgo;

  /** Which device uploads each source right now. */
  readonly activeCollector = computed(() => {
    const map: Partial<Record<MacDataSource, Collector>> = {};
    for (const collector of this.collectors()) {
      for (const source of collector.activeSources) map[source] = collector;
    }
    return map;
  });

  readonly hasData = computed(() =>
    this.collectors().some((c) => Object.values(c.itemCounts ?? {}).some((n) => n > 0)),
  );

  ngOnInit(): void {
    void this.load();
    void this.macData.refreshStatus().catch(() => undefined);
    void this.iphone.refreshStatus().catch(() => undefined);
  }

  goBack(): void {
    this.router.navigate(['/settings']);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.collectors.set(await this.deviceData.listCollectors());
      this.loadError.set(null);
    } catch {
      this.loadError.set('Could not load your devices. Check your connection and try again.');
    } finally {
      this.loading.set(false);
    }
  }

  isActive(collector: Collector, source: MacDataSource): boolean {
    return collector.activeSources.includes(source);
  }

  itemCount(collector: Collector, source: MacDataSource): number {
    return collector.itemCounts?.[source] ?? 0;
  }

  /** Makes this device upload `source`; the device that uploaded it before stops. */
  async collectHere(collector: Collector, source: MacDataSource): Promise<void> {
    const previous = this.activeCollector()[source];
    if (previous && previous.deviceId !== collector.deviceId) {
      const confirmed = await this.dialog.confirm({
        title: `Collect ${deviceSourceInfo(source).label} on ${collector.name}?`,
        message: `${previous.name} stops uploading it, and what it uploaded is replaced by ${collector.name}'s copy.`,
        confirmLabel: 'Collect here',
      });
      if (!confirmed) return;
    }
    await this.run(`collect:${collector.deviceId}:${source}`, async () => {
      await this.deviceData.setActiveSources(collector.deviceId, [
        ...new Set([...collector.activeSources, source]),
      ]);
    });
  }

  async removeDevice(collector: Collector): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: `Remove ${collector.name}?`,
      message: `Everything ${collector.name} uploaded is deleted from the cloud. If Maple is still signed in there, it shows up again the next time it opens.`,
      confirmLabel: 'Remove device',
    });
    if (!confirmed) return;
    await this.run(`remove:${collector.deviceId}`, () =>
      this.deviceData.removeCollector(collector.deviceId),
    );
  }

  async removeAll(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Remove all your device data?',
      message:
        'Messages, email, events, contacts, places and health data your devices uploaded are deleted from the cloud. Your devices stop uploading until you turn sources back on.',
      confirmLabel: 'Remove all',
    });
    if (!confirmed) return;
    await this.run('remove-all', async () => {
      await this.deviceData.removeAllData();
    });
  }

  // MARK: - This Mac

  macStatus(source: MacDataSource): MacSourceStatus | null {
    return this.macData.statusBySource()[source] ?? null;
  }

  /** Older Mac builds don't report `enabled`; a source they read is on. */
  macEnabled(status: MacSourceStatus | null): boolean {
    if (!status) return false;
    return status.enabled ?? status.state !== 'off';
  }

  macStateLabel(status: MacSourceStatus | null): string {
    if (!status || !this.macEnabled(status)) return 'Off';
    switch (status.state) {
      case 'syncing':
        return 'Reading…';
      case 'needsAccess':
        return 'Needs permission';
      case 'error':
        return status.message || 'Something went wrong';
      default: {
        const ago = timeAgo(status.lastUploadAt);
        const pending = status.pendingUpload ? ` · ${status.pendingUpload} to upload` : '';
        return `${ago ? `Uploaded ${ago}` : 'On'}${pending}`;
      }
    }
  }

  async macTurnOn(source: MacDataSource): Promise<void> {
    await this.run(`mac:${source}`, () => this.macData.enableSource(source), false);
  }

  async macTurnOff(source: MacDataSource): Promise<void> {
    await this.run(`mac:${source}`, () => this.macData.disableSource(source), false);
  }

  async macRequestAccess(source: MacDataSource): Promise<void> {
    await this.run(`mac:${source}`, () => this.macData.requestAccess(source), false);
  }

  async macSyncNow(): Promise<void> {
    await this.run('mac:sync', () => this.macData.syncNow());
  }

  // MARK: - This iPhone

  iphoneStatus(source: MacDataSource) {
    return this.iphone.statuses().find((status) => status.source === source) ?? null;
  }

  async iphoneToggle(source: MacDataSource, enabled: boolean): Promise<void> {
    await this.run(`iphone:${source}`, () =>
      enabled ? this.iphone.enable(source) : this.iphone.disable(source),
    );
  }

  async iphoneSyncNow(): Promise<void> {
    await this.run('iphone:sync', () => this.iphone.syncNow());
  }

  // MARK: - Private

  /** Runs one action at a time, shows a failure, and reloads the list afterwards. */
  private async run(key: string, action: () => Promise<unknown>, reload = true): Promise<void> {
    if (this.busy()) return;
    this.busy.set(key);
    try {
      await action();
      this.actionError.set(null);
    } catch (err) {
      const serverMessage = err instanceof HttpErrorResponse ? err.error?.error : null;
      this.actionError.set(
        typeof serverMessage === 'string'
          ? serverMessage
          : err instanceof Error && !(err instanceof HttpErrorResponse)
            ? err.message
            : 'That didn’t work. Try again.',
      );
    } finally {
      this.busy.set(null);
    }
    if (reload) await this.load();
  }
}
