import { describe, expect, it } from 'vitest';
import { mongoAvailable } from '../../__tests__/setup';
import { incrementWebSearchUsage } from '../web-search-usage.repo';

describe.runIf(mongoAvailable)('web search usage', () => {
    it('counts searches per owner per UTC day and starts again the next day', async () => {
        const monday = new Date('2026-10-26T10:00:00Z');
        const lateMonday = new Date('2026-10-26T23:59:00Z');
        const tuesday = new Date('2026-10-27T00:01:00Z');

        expect(await incrementWebSearchUsage('owner-a', monday)).toBe(1);
        expect(await incrementWebSearchUsage('owner-a', lateMonday)).toBe(2);
        expect(await incrementWebSearchUsage('owner-b', monday)).toBe(1);
        expect(await incrementWebSearchUsage('owner-a', tuesday)).toBe(1);
        expect(await incrementWebSearchUsage('owner-a', tuesday)).toBe(2);
    });
});
