import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { MacDataSource } from '@maple/shared';
import type { DeviceDataList } from './device-data-list';
import { DeviceDataSettingsComponent } from './device-data-settings.component';
import { deviceSourceInfo, platformLabel, timeAgo } from '../../../utils/device-sources';

/** How to get each Mac source's access prompt past macOS privacy settings. */
const MAC_ACCESS_COPY: Partial<Record<MacDataSource, { app: string; button: string }>> = {
  imessage: { app: 'Messages', button: 'Open Full Disk Access settings' },
  mail: { app: 'Mail', button: 'Open Full Disk Access settings' },
  calendar: { app: 'Calendar', button: 'Allow Calendar access' },
  contacts: { app: 'Contacts', button: 'Allow Contacts access' },
  home: { app: 'Home Assistant', button: 'Set up Home Assistant' },
};

/**
 * Frame shared by every device data page: title, search, which device collects the
 * source, whose data it is and what it shares, the creator's settings, the owner-only
 * notice, access prompts (in the Mac app) and paging. The table itself is projected.
 */
@Component({
  selector: 'app-device-data-panel',
  standalone: true,
  imports: [DatePipe, DeviceDataSettingsComponent],
  templateUrl: './device-data-panel.component.html',
  styleUrl: './device-data-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceDataPanelComponent {
  readonly list = input.required<DeviceDataList>();
  readonly searchable = input(true);
  readonly searchPlaceholder = input('Search');

  readonly info = computed(() => deviceSourceInfo(this.list().source));
  readonly title = computed(() => this.list().page()?.title || this.info().label);
  readonly shown = computed(() => this.list().items().length);
  readonly accessCopy = computed(() => MAC_ACCESS_COPY[this.list().source] ?? null);
  readonly needsAccess = computed(
    () => !!this.accessCopy() && this.list().macStatus()?.state === 'needsAccess',
  );

  /** "Collected by Zubair's MacBook — last upload 3 min ago". */
  readonly collectorLine = computed(() => {
    const collector = this.list().collector();
    if (!collector) return null;
    const ago = timeAgo(collector.lastUploadAt);
    return `Collected by ${collector.name}${ago ? ` — last upload ${ago}` : ' — nothing uploaded yet'}`;
  });

  /**
   * Whose data and what it shares, when that matters: "Alex's data, filtered: Only the
   * Family calendar" for other members; "Shared with this notebook: …" for the creator.
   */
  readonly sharingLine = computed(() => {
    const access = this.list().access();
    if (!access) return null;
    if (!access.canManage) {
      return access.filterSummary
        ? `${access.ownerName}'s data, filtered: ${access.filterSummary}`
        : `${access.ownerName}'s data`;
    }
    if (!access.shared) return null;
    return access.filterSummary
      ? `Shared with this notebook: ${access.filterSummary}`
      : 'Only you can see this data. Use settings to share some of it.';
  });

  /** "Not collected yet: open Maple on your Mac and turn on Messages". */
  readonly notCollectedLine = computed(() => {
    const info = this.info();
    return `Not collected yet: open Maple on your ${platformLabel(info.platform)} and turn on ${info.setting}`;
  });
}
