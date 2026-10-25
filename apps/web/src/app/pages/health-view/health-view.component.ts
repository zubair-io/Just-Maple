import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';
import {
  formatDuration,
  healthDayRow,
  isWorkout,
  workoutRow,
} from '../../utils/device-item-format';

/** The owner's daily health summaries and workouts, recorded by their iPhone. */
@Component({
  selector: 'app-health-view',
  standalone: true,
  imports: [DatePipe, DecimalPipe, DeviceDataPanelComponent],
  templateUrl: './health-view.component.html',
  styleUrl: './health-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthViewComponent {
  // 30 days of summaries plus their workouts fit in one page.
  readonly list = injectDeviceDataList('health', { pageSize: 200 });

  readonly days = computed(() =>
    this.list
      .items()
      .filter((item) => !isWorkout(item))
      .map(healthDayRow),
  );
  readonly workouts = computed(() => this.list.items().filter(isWorkout).map(workoutRow));
  readonly formatDuration = formatDuration;
}
