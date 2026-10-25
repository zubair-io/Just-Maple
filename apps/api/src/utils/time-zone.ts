// Dates for the user's device data, read and written in their own time zone.

/**
 * Accepts ISO dates or date-times. A bare date is read in the Mac's time zone, as the
 * start or end of that day.
 */
export function toEpochSeconds(
    value: unknown,
    timeZone: string,
    edge: 'start' | 'end',
): number | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [y, m, d] = text.split('-').map(Number) as [number, number, number];
        const local =
            edge === 'start' ? Date.UTC(y, m - 1, d, 0, 0, 0) : Date.UTC(y, m - 1, d, 23, 59, 59);
        return Math.floor((local - zoneOffsetMs(new Date(local), timeZone)) / 1000);
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (e.g. -4h for New York in October). */
function zoneOffsetMs(date: Date, timeZone: string): number {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(date);
        const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
        const asUTC = Date.UTC(
            get('year'),
            get('month') - 1,
            get('day'),
            get('hour'),
            get('minute'),
            get('second'),
        );
        return asUTC - Math.floor(date.getTime() / 1000) * 1000;
    } catch {
        return 0;
    }
}

export function formatInZone(date: Date, timeZone: string): string {
    const offset = zoneOffsetMs(date, timeZone);
    const local = new Date(date.getTime() + offset).toISOString().slice(0, 19);
    const minutes = Math.round(offset / 60000);
    const sign = minutes >= 0 ? '+' : '-';
    const abs = Math.abs(minutes);
    return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
