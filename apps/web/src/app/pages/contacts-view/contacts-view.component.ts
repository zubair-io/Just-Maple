import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { DeviceDataPanelComponent } from '../../components/organisms/device-data-panel/device-data-panel.component';
import { injectDeviceDataList } from '../../components/organisms/device-data-panel/device-data-list';
import { contactRow } from '../../utils/device-item-format';

/** The owner's contacts, uploaded by their Mac, sorted by name. */
@Component({
  selector: 'app-contacts-view',
  standalone: true,
  imports: [DeviceDataPanelComponent],
  templateUrl: './contacts-view.component.html',
  styleUrl: './contacts-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactsViewComponent {
  // Large pages so sorting by name covers most address books in one go.
  readonly list = injectDeviceDataList('contacts', { pageSize: 500 });

  readonly rows = computed(() =>
    this.list
      .items()
      .map(contactRow)
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name)),
  );
}
