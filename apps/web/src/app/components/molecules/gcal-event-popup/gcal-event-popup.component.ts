import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  inject,
  ElementRef,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GoogleCalendarService } from '../../../services/google-calendar/google-calendar.service';
import type { GoogleCalendarEvent } from '@maple/shared';

/**
 * Extract time portion (HH:MM) from an ISO datetime string.
 * When timeZone is provided, extracts time in that timezone.
 */
function toTimeValue(isoStr: string, timeZone?: string | null): string {
  const d = new Date(isoStr);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${hour}:${get('minute')}`;
  }
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Add one hour to an HH:MM time string, capping at 23:59.
 */
function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const newH = h + 1;
  if (newH >= 24) return '23:59';
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

@Component({
  selector: 'app-gcal-event-popup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './gcal-event-popup.component.html',
})
export class GcalEventPopupComponent {
  @ViewChild('titleInput') private titleInputRef?: ElementRef<HTMLInputElement>;

  // Inputs
  readonly isOpen = input(false);
  readonly mode = input<'create' | 'edit'>('create');
  readonly calendarId = input<string | null>(null);
  readonly event = input<GoogleCalendarEvent | null>(null);
  readonly defaultDate = input<string | null>(null);
  readonly timezone = input<string | null>(null);

  // Outputs
  readonly closed = output<void>();
  readonly saved = output<void>();

  // Internal state — time-only values (HH:MM)
  readonly title = signal('');
  readonly startTime = signal('');
  readonly endTime = signal('');
  readonly location = signal('');
  readonly description = signal('');
  readonly saving = signal(false);

  // Track whether user has manually changed the end time
  private endDirty = false;

  readonly isAllDay = computed(() => {
    const ev = this.event();
    return this.mode() === 'edit' && !!ev?.start.date;
  });

  // For all-day events in edit mode, keep date values
  readonly startDateValue = signal('');
  readonly endDateValue = signal('');

  // Validation: end must be after start (for timed events)
  readonly endBeforeStart = computed(() => {
    if (this.isAllDay()) return false;
    const start = this.startTime();
    const end = this.endTime();
    if (!start || !end) return false;
    return end <= start;
  });

  // Display the date label in the popup
  readonly dateLabel = computed(() => {
    // Try defaultDate first (set for create mode)
    const d = this.defaultDate();
    if (d) {
      const date = new Date(d + 'T00:00:00');
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
    // For edit mode, extract date from the event
    const ev = this.event();
    if (ev?.start.dateTime) {
      const tz = this.timezone();
      if (tz) {
        const date = new Date(ev.start.dateTime);
        return date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: tz,
        });
      }
      const date = new Date(ev.start.dateTime);
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
    return '';
  });

  private readonly gcalService = inject(GoogleCalendarService);

  constructor() {
    // Initialize form when popup opens
    effect(() => {
      if (this.isOpen()) {
        this.initForm();
        // Focus title input for create mode
        if (this.mode() === 'create') {
          setTimeout(() => this.titleInputRef?.nativeElement?.focus(), 0);
        }
      }
    });
  }

  private initForm(): void {
    const ev = this.event();
    const mode = this.mode();
    const tz = this.timezone();

    this.endDirty = false;

    if (mode === 'edit' && ev) {
      this.title.set(ev.summary || '');
      this.location.set(ev.location || '');
      this.description.set(ev.description || '');

      if (ev.start.date) {
        // All-day event — use date inputs
        this.startDateValue.set(ev.start.date);
        if (ev.end.date) {
          const endD = new Date(ev.end.date + 'T00:00:00');
          endD.setDate(endD.getDate() - 1);
          this.endDateValue.set(endD.toISOString().split('T')[0]);
        } else {
          this.endDateValue.set(ev.start.date);
        }
        this.startTime.set('');
        this.endTime.set('');
      } else if (ev.start.dateTime) {
        this.startTime.set(toTimeValue(ev.start.dateTime, tz));
        this.endTime.set(ev.end.dateTime ? toTimeValue(ev.end.dateTime, tz) : '');
        // In edit mode, end is already set so treat as dirty
        this.endDirty = true;
      }
    } else {
      // Create mode
      this.title.set('');
      this.location.set('');
      this.description.set('');

      const now = new Date();
      const startHour = now.getHours() + 1;
      const startTime = `${String(startHour >= 24 ? 23 : startHour).padStart(2, '0')}:00`;
      this.startTime.set(startTime);
      this.endTime.set(addOneHour(startTime));
    }
  }

  onStartTimeChange(value: string): void {
    this.startTime.set(value);
    if (!this.endDirty) {
      this.endTime.set(addOneHour(value));
    } else if (this.endTime() <= value) {
      // Even if dirty, auto-fix if end is now before start
      this.endTime.set(addOneHour(value));
    }
  }

  onEndTimeChange(value: string): void {
    this.endDirty = true;
    this.endTime.set(value);
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    this.close();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
    }
  }

  async save(): Promise<void> {
    const calendarId = this.calendarId();
    if (!calendarId) return;
    if (this.endBeforeStart()) return;

    this.saving.set(true);
    try {
      const tz = this.timezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const mode = this.mode();
      const ev = this.event();
      const allDay = this.isAllDay();
      const useCustomTz = !!this.timezone();

      // Build a full datetime string from the date (from defaultDate or event) + time
      const getDateStr = (): string => {
        if (mode === 'edit' && ev?.start.dateTime) {
          // For edit, extract the date from the event's start
          if (useCustomTz) {
            const d = new Date(ev.start.dateTime);
            const parts = new Intl.DateTimeFormat('en-US', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              timeZone: tz,
            }).formatToParts(d);
            const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
            return `${get('year')}-${get('month')}-${get('day')}`;
          }
          return ev.start.dateTime.split('T')[0];
        }
        return this.defaultDate() || new Date().toISOString().split('T')[0];
      };

      const dateStr = getDateStr();

      const buildDateTime = (time: string) => {
        const fullValue = `${dateStr}T${time}`;
        if (useCustomTz) {
          return { dateTime: `${fullValue}:00`, timeZone: tz };
        }
        return { dateTime: new Date(fullValue).toISOString(), timeZone: tz };
      };

      if (mode === 'create') {
        await this.gcalService.createEvent(calendarId, {
          summary: this.title() || '(No title)',
          start: allDay ? { date: this.startDateValue() } : buildDateTime(this.startTime()),
          end: allDay
            ? {
                date: (() => {
                  const endD = new Date(this.endDateValue() + 'T00:00:00');
                  endD.setDate(endD.getDate() + 1);
                  return endD.toISOString().split('T')[0];
                })(),
              }
            : buildDateTime(this.endTime()),
          location: this.location() || undefined,
          description: this.description() || undefined,
        });
      } else if (ev?.id) {
        const updates: Record<string, unknown> = {};
        if (this.title() !== (ev.summary || '')) updates['summary'] = this.title() || '(No title)';
        if (this.location() !== (ev.location || '')) updates['location'] = this.location();
        if (this.description() !== (ev.description || ''))
          updates['description'] = this.description();

        if (allDay) {
          updates['start'] = { date: this.startDateValue() };
          const endD = new Date(this.endDateValue() + 'T00:00:00');
          endD.setDate(endD.getDate() + 1);
          updates['end'] = { date: endD.toISOString().split('T')[0] };
        } else {
          updates['start'] = buildDateTime(this.startTime());
          updates['end'] = buildDateTime(this.endTime());
        }

        await this.gcalService.updateEvent(calendarId, ev.id, updates);
      }

      this.saving.set(false);
      this.saved.emit();
      this.close();
    } catch (err) {
      this.saving.set(false);
      console.error('Failed to save event:', err);
    }
  }
}
