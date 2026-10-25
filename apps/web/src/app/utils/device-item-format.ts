import type { MacDataItem } from '@maple/shared';
import { toMillis } from './device-sources';

/**
 * Readers for the source-specific `extra` fields devices attach to items. Devices are
 * free to send a plain value or a labeled one, so every reader accepts both.
 */

type Extra = Record<string, unknown>;

function extra(item: MacDataItem): Extra {
  return item.extra ?? {};
}

function firstNumber(source: Extra, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function firstString(source: Extra, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** "home", "mobile: +1 555…" or "Jane (sister)" from a string or a labeled object. */
export function formatLabeled(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
  if (typeof value !== 'object') return null;
  const record = value as Extra;
  const label = firstString(record, 'label', 'relation', 'type');
  const main =
    firstString(record, 'value', 'number', 'email', 'name', 'address', 'formatted') ??
    formatAddress(record);
  if (!main) return label;
  return label ? `${main} (${cleanLabel(label)})` : main;
}

/** Apple's labels look like `_$!<Mobile>!$_`; keep just "mobile". */
function cleanLabel(label: string): string {
  return label
    .replace(/^_\$!</, '')
    .replace(/>!\$_$/, '')
    .toLowerCase();
}

function formatAddress(record: Extra): string | null {
  const parts = ['street', 'city', 'state', 'postalCode', 'country']
    .map((key) => firstString(record, key))
    .filter((part): part is string => !!part);
  return parts.length ? parts.join(', ') : null;
}

export function labeledList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  return values.map(formatLabeled).filter((text): text is string => !!text);
}

// MARK: - Contacts

export interface ContactRow {
  id: string;
  name: string;
  subtitle: string | null;
  phones: string[];
  emails: string[];
  relations: string[];
  addresses: string[];
  birthday: string | null;
  isMe: boolean;
}

export function contactRow(item: MacDataItem): ContactRow {
  const data = extra(item);
  const organization = firstString(data, 'organization');
  const jobTitle = firstString(data, 'jobTitle');
  const subtitle = [jobTitle, organization].filter(Boolean).join(', ') || null;
  return {
    id: item.id,
    name: item.title?.trim() || organization || '(no name)',
    subtitle,
    phones: labeledList(data['phones']),
    emails: labeledList(data['emails']),
    relations: labeledList(data['relations']),
    addresses: labeledList(data['addresses']),
    birthday: formatBirthday(data['birthday']),
    isMe: data['isMe'] === true,
  };
}

function formatBirthday(value: unknown): string | null {
  if (typeof value === 'string' && value) {
    // "--05-14" (no year) or "1990-05-14"
    const match = /^(?:(\d{4})|--)-?(\d{2})-(\d{2})/.exec(value);
    if (!match) return value;
    const date = new Date(Number(match[1] ?? 2000), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(match[1] ? { year: 'numeric' } : {}),
    });
  }
  if (value && typeof value === 'object') {
    const record = value as Extra;
    const month = firstNumber(record, 'month');
    const day = firstNumber(record, 'day');
    if (!month || !day) return null;
    const year = firstNumber(record, 'year');
    return new Date(year ?? 2000, month - 1, day).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(year ? { year: 'numeric' } : {}),
    });
  }
  return null;
}

// MARK: - Places

export interface VisitRow {
  id: string;
  place: string;
  address: string | null;
  /** Milliseconds since 1970. */
  arrived: number | null;
  departed: number | null;
  durationMinutes: number | null;
}

export function visitRow(item: MacDataItem): VisitRow {
  const data = extra(item);
  const arrived = toMillis(data['arrived']) ?? toMillis(item.occurredAt);
  const departed = toMillis(data['departed']) ?? toMillis(item.endAt);
  const address = item.location?.trim() || firstString(data, 'address') || null;
  return {
    id: item.id,
    place: item.title?.trim() || firstString(data, 'name', 'placeName') || address || 'Somewhere',
    address: address && address !== item.title?.trim() ? address : null,
    arrived,
    departed,
    durationMinutes:
      arrived !== null && departed !== null && departed > arrived
        ? Math.round((departed - arrived) / 60_000)
        : null,
  };
}

/** "45 min", "2 h 5 min". */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// MARK: - Health

export interface HealthDayRow {
  id: string;
  /** Milliseconds since 1970, the start of the day. */
  day: number;
  steps: number | null;
  exerciseMinutes: number | null;
  sleepHours: number | null;
  restingHeartRate: number | null;
}

export interface WorkoutRow {
  id: string;
  activity: string;
  start: number;
  durationMinutes: number | null;
  energy: number | null;
  distanceKm: number | null;
}

/** Workouts are their own items; everything else in the health source is a day summary. */
export function isWorkout(item: MacDataItem): boolean {
  const data = extra(item);
  return (
    data['kind'] === 'workout' || data['type'] === 'workout' || item.id.startsWith('health:workout')
  );
}

export function healthDayRow(item: MacDataItem): HealthDayRow {
  const data = extra(item);
  const sleepMinutes = firstNumber(data, 'sleepMinutes');
  const sleepSeconds = firstNumber(data, 'sleepSeconds');
  return {
    id: item.id,
    day: toMillis(item.occurredAt) ?? 0,
    steps: firstNumber(data, 'steps', 'stepCount'),
    exerciseMinutes: firstNumber(data, 'exerciseMinutes', 'activeMinutes', 'exercise'),
    sleepHours:
      firstNumber(data, 'sleepHours', 'sleep') ??
      (sleepMinutes !== null
        ? sleepMinutes / 60
        : sleepSeconds !== null
          ? sleepSeconds / 3600
          : null),
    restingHeartRate: firstNumber(data, 'restingHeartRate', 'restingHR', 'restingHeartRateBpm'),
  };
}

export function workoutRow(item: MacDataItem): WorkoutRow {
  const data = extra(item);
  const start = toMillis(item.occurredAt) ?? 0;
  const end = toMillis(item.endAt);
  const distanceMeters = firstNumber(data, 'distanceMeters', 'distance');
  return {
    id: item.id,
    activity: item.title?.trim() || firstString(data, 'activity', 'workoutType') || 'Workout',
    start,
    durationMinutes:
      firstNumber(data, 'durationMinutes') ??
      (end !== null && end > start ? Math.round((end - start) / 60_000) : null),
    energy: firstNumber(data, 'activeEnergy', 'energy', 'calories', 'kilocalories'),
    distanceKm:
      firstNumber(data, 'distanceKm') ?? (distanceMeters !== null ? distanceMeters / 1000 : null),
  };
}
