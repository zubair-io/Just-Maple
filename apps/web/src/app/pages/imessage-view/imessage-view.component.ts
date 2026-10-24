import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MacDataPanelComponent } from '../../components/organisms/mac-data-panel/mac-data-panel.component';
import { injectMacDataList } from '../../components/organisms/mac-data-panel/mac-data-list';

/** Mac-only table of iMessage history. */
@Component({
  selector: 'app-imessage-view',
  standalone: true,
  imports: [DatePipe, MacDataPanelComponent],
  templateUrl: './imessage-view.component.html',
  styleUrl: './imessage-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IMessageViewComponent {
  readonly list = injectMacDataList('imessage');
}
