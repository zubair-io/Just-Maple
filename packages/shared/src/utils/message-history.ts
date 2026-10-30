import type { MacDataItem } from '../schemas/mac-data';

export const MESSAGE_PLATFORM_NAMES: Record<string, string> = {
    imessage: 'iMessage',
    sms: 'SMS / MMS',
    aim: 'AIM',
    gchat: 'Google Chat',
    gtalk: 'Google Talk',
    fbchat: 'Facebook Chat',
    fbmsg: 'Messenger',
    fbpost: 'Facebook posts',
    instagram: 'Instagram',
    voice: 'Google Voice',
    yahoo: 'Yahoo',
    msn: 'MSN',
    digsby: 'Digsby',
    jabber: 'Jabber',
};
export const messagePlatform = (item: MacDataItem): string =>
    typeof item.extra?.['archivePlatform'] === 'string'
        ? item.extra['archivePlatform']
        : 'imessage';

const archiveFormatters = new Map<string, Intl.DateTimeFormat>();

/** A wall-clock date is not UTC. Reject nonexistent dates rather than inventing one.
 * Repeated DST times use the earlier occurrence; the original wall-clock text is retained.
 */
export function archiveTimestamp(text: string, timeZone: string): number {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if (!match) return 0;
    const parts = match.slice(1).map(Number);
    const wall = Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3], parts[4], parts[5]);
    if (new Date(wall).toISOString().slice(0, 19).replace('T', ' ') !== text) return 0;
    let formatter = archiveFormatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        });
        if (archiveFormatters.size >= 16)
            archiveFormatters.delete(archiveFormatters.keys().next().value!);
        archiveFormatters.set(timeZone, formatter);
    }
    const asWall = (at: number) => {
        const p = Object.fromEntries(
            formatter.formatToParts(at).map(({ type, value }) => [type, value]),
        );
        return Date.UTC(
            +p['year']!,
            +p['month']! - 1,
            +p['day']!,
            +p['hour']!,
            +p['minute']!,
            +p['second']!,
        );
    };
    const candidates = new Set<number>();
    for (const hours of [-24, -12, 0, 12, 24]) {
        const sample = wall + hours * 3_600_000;
        const candidate = wall - (asWall(sample) - sample);
        if (asWall(candidate) === wall) candidates.add(candidate);
    }
    return candidates.size ? Math.min(...candidates) / 1000 : 0;
}
