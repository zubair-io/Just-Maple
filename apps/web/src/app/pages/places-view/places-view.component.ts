import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';
import { formatDuration, visitRow } from '../../utils/device-item-format';

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
}
