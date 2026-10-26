import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';
import { formatDuration, visitRow, type VisitRow } from '../../utils/device-item-format';
import { AboutMeService } from '../../services/about-me.service';
import { DialogService } from '../../components';

/** Places the owner visited, recorded by their iPhone, most recent first. */
@Component({
  selector: 'app-places-view',
  standalone: true,
  imports: [DatePipe, DeviceDataPanelComponent],
  templateUrl: './places-view.component.html',
  styleUrl: './places-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlacesViewComponent {
  readonly list = injectDeviceDataList('location');
  readonly rows = computed(() => this.list.items().map(visitRow));
  readonly formatDuration = formatDuration;

  private readonly aboutMe = inject(AboutMeService);
  private readonly dialog = inject(DialogService);
  /** A short confirmation after naming a place. */
  readonly notice = signal<string | null>(null);

  /** Names the place of a visit ("Home"); new visits there, and reminders, use the name. */
  async namePlace(row: VisitRow): Promise<void> {
    if (row.lat === null || row.lon === null) return;
    const name = (
      await this.dialog.prompt({
        title: 'Name this place',
        message: 'Visits here will be called this from now on, e.g. Home, Work or School.',
        defaultValue: row.place,
        confirmLabel: 'Save',
      })
    )?.trim();
    if (!name) return;
    try {
      await this.aboutMe.namePlace({
        name,
        lat: row.lat,
        lon: row.lon,
        ...(row.address ? { address: row.address } : {}),
      });
      this.notice.set(`Saved "${name}". New visits there will use this name.`);
    } catch {
      this.notice.set('Could not save the place. Try again.');
    }
  }
}
