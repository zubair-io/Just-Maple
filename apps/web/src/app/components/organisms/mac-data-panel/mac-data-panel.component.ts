import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { MacDataSource, MacDataSourceStatus } from '@maple/shared';

const SOURCE_COPY: Record<MacDataSource, { app: string; accessButton: string }> = {
  imessage: { app: 'Messages', accessButton: 'Open Full Disk Access settings' },
  mail: { app: 'Mail', accessButton: 'Open Full Disk Access settings' },
  calendar: { app: 'Calendar', accessButton: 'Allow Calendar access' },
};

/**
 * Frame shared by the iMessage, Email and Calendar pages: title, search,
 * import status, access prompts and paging. The table itself is projected.
 */
@Component({
  selector: 'app-mac-data-panel',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './mac-data-panel.component.html',
  styleUrl: './mac-data-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MacDataPanelComponent {
  readonly source = input.required<MacDataSource>();
  readonly title = input.required<string>();
  readonly icon = input.required<string>();
  readonly status = input<MacDataSourceStatus | null>(null);
  readonly total = input(0);
  readonly shown = input(0);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly canLoadMore = input(false);

  readonly search = model('');

  readonly loadMore = output<void>();
  readonly requestAccess = output<void>();
  readonly remove = output<void>();

  readonly copy = computed(() => SOURCE_COPY[this.source()]);
  readonly needsAccess = computed(() => this.status()?.state === 'needsAccess');
  readonly syncing = computed(() => this.status()?.state === 'syncing');
  /** Seconds-since-1970 → milliseconds for the date pipe. */
  readonly lastSyncMs = computed(() => {
    const at = this.status()?.lastSyncAt;
    return at ? at * 1000 : null;
  });
}
