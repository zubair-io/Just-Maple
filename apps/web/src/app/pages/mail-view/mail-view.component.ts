import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';

/** Table of the owner's email from every account in Mail, uploaded by their Mac. */
@Component({
  selector: 'app-mail-view',
  standalone: true,
  imports: [DatePipe, DeviceDataPanelComponent],
  templateUrl: './mail-view.component.html',
  styleUrl: './mail-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailViewComponent {
  readonly list = injectDeviceDataList('mail');

  /** First lines of the body, for the preview under the subject. */
  preview(body: string): string {
    return body.replace(/\s+/g, ' ').slice(0, 240);
  }
}
