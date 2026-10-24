import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface NotificationFilters {
  type: string | null;
  showUnreadOnly: boolean;
}

@Component({
  selector: 'app-notification-filters',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-filters.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './notification-filters.component.scss',
})
export class NotificationFiltersComponent {
  readonly filters = input.required<NotificationFilters>();
  readonly filtersChanged = output<NotificationFilters>();

  readonly notificationTypes = [
    { value: null, label: 'All Types' },
    { value: 'share_received', label: 'Shares' },
    { value: 'message_received', label: 'Messages' },
    { value: 'transcription_complete', label: 'Transcriptions' },
    { value: 'reminder', label: 'Reminders' },
    { value: 'export_ready', label: 'Exports' },
    { value: 'processing_failed', label: 'Errors' },
  ];

  onTypeChange(type: string | null): void {
    this.filtersChanged.emit({
      ...this.filters(),
      type,
    });
  }

  onUnreadToggle(): void {
    this.filtersChanged.emit({
      ...this.filters(),
      showUnreadOnly: !this.filters().showUnreadOnly,
    });
  }
}
