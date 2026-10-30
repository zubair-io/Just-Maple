import { describe, it, expect } from 'vitest';
import { archiveTimestamp } from './message-history';
describe('archive wall-clock timestamps', () => {
    it('applies the chosen zone instead of treating wall-clock dates as UTC', () => {
        expect(archiveTimestamp('2020-01-01 12:00:00', 'America/New_York')).toBe(
            Date.parse('2020-01-01T17:00:00Z') / 1000,
        );
        expect(archiveTimestamp('2020-07-01 12:00:00', 'America/New_York')).toBe(
            Date.parse('2020-07-01T16:00:00Z') / 1000,
        );
        expect(archiveTimestamp('2020-01-01 12:00:00', 'UTC')).toBe(
            Date.parse('2020-01-01T12:00:00Z') / 1000,
        );
    });
    it('marks missing, impossible and DST-gap dates unknown, and resolves a fold consistently', () => {
        for (const value of ['', '2020-02-31 12:00:00', '2020-03-08 02:30:00'])
            expect(archiveTimestamp(value, 'America/New_York')).toBe(0);
        expect(archiveTimestamp('2020-11-01 01:30:00', 'America/New_York')).toBe(
            Date.parse('2020-11-01T05:30:00Z') / 1000,
        );
    });
});
