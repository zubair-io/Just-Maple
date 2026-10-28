import type { CollectorPlatform, MacDataSource } from '@maple/shared';

export interface DeviceSourceInfo {
  source: MacDataSource;
  /** Menu and page label, e.g. "Messages". */
  label: string;
  icon: string;
  /** The device that collects this source. */
  platform: CollectorPlatform;
  /** What the user turns on in the Maple app on that device. */
  setting: string;
}

/** Every source a device can collect, in menu order. */
export const DEVICE_DATA_SOURCES: readonly DeviceSourceInfo[] = [
  { source: 'imessage', label: 'Messages', icon: 'sms', platform: 'macos', setting: 'Messages' },
  { source: 'mail', label: 'Email', icon: 'mail', platform: 'macos', setting: 'Mail' },
  {
    source: 'calendar',
    label: 'Calendar',
    icon: 'calendar_month',
    platform: 'macos',
    setting: 'Calendar',
  },
  {
    source: 'contacts',
    label: 'Contacts',
    icon: 'contacts',
    platform: 'macos',
    setting: 'Contacts',
  },
  { source: 'location', label: 'Places', icon: 'location_on', platform: 'ios', setting: 'Places' },
  { source: 'health', label: 'Health', icon: 'favorite', platform: 'ios', setting: 'Health' },
  { source: 'home', label: 'Home', icon: 'home', platform: 'macos', setting: 'Home Assistant' },
];

/** Sources the Mac collects. */
export const MAC_SOURCES: readonly MacDataSource[] = DEVICE_DATA_SOURCES.filter(
  (info) => info.platform === 'macos',
).map((info) => info.source);

/** Sources the iPhone collects. */
export const IPHONE_SOURCES: readonly MacDataSource[] = DEVICE_DATA_SOURCES.filter(
  (info) => info.platform === 'ios',
).map((info) => info.source);

export function deviceSourceInfo(source: MacDataSource): DeviceSourceInfo {
  return DEVICE_DATA_SOURCES.find((info) => info.source === source) ?? DEVICE_DATA_SOURCES[0]!;
}

export function isMacSource(source: MacDataSource): boolean {
  return MAC_SOURCES.includes(source);
}

export function platformLabel(platform: CollectorPlatform): string {
  return platform === 'ios' ? 'iPhone' : 'Mac';
}

export function platformIcon(platform: CollectorPlatform): string {
  return platform === 'ios' ? 'phone_iphone' : 'laptop_mac';
}

/**
 * A timestamp in milliseconds from whatever a device or the API sent: an ISO string,
 * seconds since 1970, or milliseconds since 1970.
 */
export function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** "just now", "3 min ago", "2 h ago", "4 days ago", or a date for anything older. */
export function timeAgo(value: unknown, now = Date.now()): string | null {
  const ms = toMillis(value);
  if (ms === null) return null;
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
