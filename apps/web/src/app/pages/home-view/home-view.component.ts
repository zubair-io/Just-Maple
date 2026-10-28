import { ChangeDetectionStrategy, Component, computed, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';
import { homeChangeRow, homeStateRow, isHomeChange } from '../../utils/device-item-format';

/**
 * The owner's Home Assistant devices, as their Mac reads them: only entities exposed to
 * assistants in Home Assistant. Current states, then recent changes.
 */
@Component({
  selector: 'app-home-view',
  standalone: true,
  imports: [DatePipe, DeviceDataPanelComponent],
  templateUrl: './home-view.component.html',
  styleUrl: './home-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeViewComponent {
  // Current states and changes load separately, so a busy day of changes never pushes
  // devices off the list. The panel pages the devices ("Load more").
  readonly list = injectDeviceDataList('home', { pageSize: 500, homeKind: 'state' });
  readonly changeList = injectDeviceDataList('home', { pageSize: 100, homeKind: 'change' });

  constructor() {
    // One search box, for both.
    effect(() => this.changeList.search.set(this.list.search()));
  }

  /** By area, then name; devices without an area last. */
  readonly devices = computed(() =>
    this.list
      .items()
      .filter((item) => !isHomeChange(item))
      .map(homeStateRow)
      .sort(
        (a, b) =>
          Number(!a.area) - Number(!b.area) ||
          (a.area ?? '').localeCompare(b.area ?? '') ||
          a.name.localeCompare(b.name),
      ),
  );

  /** Newest first. */
  readonly changes = computed(() =>
    this.changeList
      .items()
      .filter(isHomeChange)
      .map(homeChangeRow)
      .sort((a, b) => (b.when ?? 0) - (a.when ?? 0)),
  );
}
