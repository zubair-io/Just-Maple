import type { Due } from './world.models';

/** Editing a title must not round an instant or reinterpret an untouched date's zone. */
export class TaskTimingField {
  kind: 'none' | Due['kind'] = 'none';
  date = '';
  time = '';
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private original?: Due;
  private originalTime = '';

  load(value?: Due) {
    this.original = value ? structuredClone(value) : undefined;
    this.kind = value?.kind ?? 'none';
    this.date = value?.date ?? '';
    this.zone = value?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const instant = value?.instant;
    this.time = instant === undefined ? '' : new Date(instant * 1000 - new Date(instant * 1000).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    this.originalTime = this.time;
  }

  value(): Due | undefined {
    if (this.kind === 'none') return undefined;
    if (this.kind === 'date') return { kind: 'date', date: this.date, timeZone: this.zone };
    const instant = this.original?.kind === 'instant' && this.time === this.originalTime
      ? this.original.instant : new Date(this.time).getTime() / 1000;
    return { kind: 'instant', date: '', instant, timeZone: this.zone };
  }
}
