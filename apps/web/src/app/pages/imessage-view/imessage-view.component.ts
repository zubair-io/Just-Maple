import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';

/** Table of the owner's iMessage history, uploaded by their Mac. */
@Component({
  selector: 'app-imessage-view',
  standalone: true,
  imports: [DatePipe, DeviceDataPanelComponent],
  templateUrl: './imessage-view.component.html',
  styleUrl: './imessage-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IMessageViewComponent {
  readonly list = injectDeviceDataList('imessage');
}
