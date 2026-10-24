import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { MacDataItem } from '@maple/shared';
import { MacDataPanelComponent } from '../../components/organisms/mac-data-panel/mac-data-panel.component';
import { injectMacDataList } from '../../components/organisms/mac-data-panel/mac-data-list';

type CalendarRange = 'upcoming' | 'past';

/** Mac-only table of events from every calendar account on this Mac. */
@Component({
  selector: 'app-calendar-view',
  standalone: true,
  imports: [DatePipe, MacDataPanelComponent],
  templateUrl: './calendar-view.component.html',
  styleUrl: './calendar-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarViewComponent {
  readonly range = signal<CalendarRange>('upcoming');

  readonly list = injectMacDataList('calendar', {
    // Upcoming: soonest first from the start of today. Past: most recent first.
    order: () => (this.range() === 'upcoming' ? 'asc' : 'desc'),
    range: () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const boundary = startOfToday.getTime() / 1000;
      return this.range() === 'upcoming' ? { from: boundary } : { to: boundary };
    },
  });

  readonly ranges: { id: CalendarRange; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  /** Whether the event starts and ends on the same calendar day. */
  sameDay(item: MacDataItem): boolean {
    if (!item.endAt) return true;
    // All-day events end at midnight of the following day.
    const end = new Date((item.endAt - (item.allDay ? 1 : 0)) * 1000);
    return new Date(item.occurredAt * 1000).toDateString() === end.toDateString();
  }
}
