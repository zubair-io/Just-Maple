import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MacDataPanelComponent } from '../../components/organisms/mac-data-panel/mac-data-panel.component';
import { injectMacDataList } from '../../components/organisms/mac-data-panel/mac-data-list';

/** Mac-only table of email from every account in the Mail app. */
@Component({
  selector: 'app-mail-view',
  standalone: true,
  imports: [DatePipe, MacDataPanelComponent],
  templateUrl: './mail-view.component.html',
  styleUrl: './mail-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MailViewComponent {
  readonly list = injectMacDataList('mail');

  /** First lines of the body, for the preview under the subject. */
  preview(body: string): string {
    return body.replace(/\s+/g, ' ').slice(0, 240);
  }
}
