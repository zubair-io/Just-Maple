import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mac-data-relay.service', () => ({
    macDataRelay: { isOnline: vi.fn().mockResolvedValue(false), request: vi.fn() },
}));
vi.mock('../../repositories/page.repo', () => ({ findDeviceDataPages: vi.fn() }));
vi.mock('../../repositories/collector.repo', () => ({ collectorTimeZone: vi.fn() }));
vi.mock('../../repositories/device-item.repo', () => ({ findDeviceItem: vi.fn() }));
vi.mock('../device-search.service', () => ({ searchDeviceData: vi.fn() }));

import {
    executeMacDataTool,
    formatInZone,
    getMacDataToolContext,
    macDataSystemPrompt,
    macDataToolDefinitions,
    toEpochSeconds,
    type MacDataToolContext,
} from '../mac-data-tools.service';
import { macDataRelay } from '../mac-data-relay.service';
import { findDeviceDataPages } from '../../repositories/page.repo';
import { collectorTimeZone } from '../../repositories/collector.repo';
import { findDeviceItem } from '../../repositories/device-item.repo';
import { searchDeviceData } from '../device-search.service';

const ctx: MacDataToolContext = {
    userId: 'u1',
    notebookId: 'n1',
    sources: ['imessage', 'calendar'],
    timeZone: 'America/New_York',
    now: '2026-10-24T09:00:00-04:00',
};

describe('getMacDataToolContext', () => {
    beforeEach(() => vi.clearAllMocks());

    it("is null when the notebook has none of the user's device data pages", async () => {
        vi.mocked(findDeviceDataPages).mockResolvedValue([]);
        expect(await getMacDataToolContext('u1', 'n1')).toBeNull();
    });

    it("uses the sources of the user's pages and their devices' time zone", async () => {
        vi.mocked(findDeviceDataPages).mockResolvedValue([
            { deviceSource: 'imessage' },
            { deviceSource: 'imessage' },
            { deviceSource: 'location' },
        ] as never);
        vi.mocked(collectorTimeZone).mockResolvedValue('America/New_York');
        const context = await getMacDataToolContext('u1', 'n1');
        expect(context).toMatchObject({
            sources: ['imessage', 'location'],
            timeZone: 'America/New_York',
        });
        expect(context?.now).toMatch(/-0[45]:00$/);
        expect(findDeviceDataPages).toHaveBeenCalledWith('u1', 'n1');
        expect(macDataSystemPrompt(context!)).toContain('places visited');
    });
});

describe('local-data tools', () => {
    beforeEach(() => vi.clearAllMocks());

    it('only offers remember_instruction on the proactive page', () => {
        expect(macDataToolDefinitions(ctx).map((t) => t.name)).toEqual([
            'search_local_data',
            'get_local_item',
        ]);
        const withMemory = { ...ctx, rememberInstruction: vi.fn() };
        expect(macDataToolDefinitions(withMemory).map((t) => t.name)).toContain(
            'remember_instruction',
        );
    });

    it("searches the cloud copy with dates in the user's time zone and only allowed sources", async () => {
        vi.mocked(searchDeviceData).mockResolvedValue([{ id: 'imessage:1' }] as never);
        const result = await executeMacDataTool(ctx, 'search_local_data', {
            query: 'lacrosse',
            sources: ['imessage', 'mail'],
            from: '2026-10-19',
            to: '2026-10-25',
        });
        expect(JSON.parse(result)).toEqual({ results: [{ id: 'imessage:1' }] });
        expect(searchDeviceData).toHaveBeenCalledWith(
            'u1',
            {
                sources: ['imessage'],
                query: 'lacrosse',
                from: Date.parse('2026-10-19T00:00:00-04:00') / 1000,
                to: Date.parse('2026-10-25T23:59:59-04:00') / 1000,
                limit: undefined,
            },
            'America/New_York',
            null, // no device online to embed the query: keyword ranking
        );
    });

    it('embeds the query on an online device', async () => {
        vi.mocked(macDataRelay.isOnline).mockResolvedValueOnce(true);
        vi.mocked(macDataRelay.request).mockResolvedValueOnce([0.6, 0.8]);
        vi.mocked(searchDeviceData).mockResolvedValue([]);
        await executeMacDataTool(ctx, 'search_local_data', { query: 'practice' });
        expect(macDataRelay.request).toHaveBeenCalledWith(
            'u1',
            'embed',
            { text: 'practice' },
            3000,
        );
        expect(vi.mocked(searchDeviceData).mock.calls[0]![3]).toEqual([0.6, 0.8]);
    });

    it('only reads items from sources the notebook has pages for', async () => {
        vi.mocked(findDeviceItem).mockResolvedValueOnce({
            id: 'mail:1',
            source: 'mail',
            body: 'secret',
        } as never);
        expect(await executeMacDataTool(ctx, 'get_local_item', { id: 'mail:1' })).toBe(
            'No item with that id.',
        );
        vi.mocked(findDeviceItem).mockResolvedValueOnce({
            id: 'imessage:1',
            source: 'imessage',
            body: 'x'.repeat(7000),
        } as never);
        const item = JSON.parse(
            await executeMacDataTool(ctx, 'get_local_item', { id: 'imessage:1' }),
        );
        expect(item.body).toHaveLength(6000);
    });

    it('turns failures into text the model can read', async () => {
        vi.mocked(findDeviceItem).mockRejectedValueOnce(new Error('db down'));
        expect(await executeMacDataTool(ctx, 'get_local_item', { id: 'x' })).toBe('Error: db down');
        expect(await executeMacDataTool(ctx, 'remember_instruction', { instruction: 'x' })).toBe(
            'Nothing was saved.',
        );
    });

    it('saves corrections through the page callback', async () => {
        const rememberInstruction = vi.fn().mockResolvedValue(undefined);
        const result = await executeMacDataTool(
            { ...ctx, rememberInstruction },
            'remember_instruction',
            {
                instruction: '  Greyson stopped Leadership Academy ',
            },
        );
        expect(result).toContain('Saved');
        expect(rememberInstruction).toHaveBeenCalledWith('Greyson stopped Leadership Academy');
    });
});

describe('time helpers', () => {
    it('reads bare dates as local days and passes full timestamps through', () => {
        expect(toEpochSeconds('2026-01-15', 'America/New_York', 'start')).toBe(
            Date.parse('2026-01-15T00:00:00-05:00') / 1000,
        );
        expect(toEpochSeconds('2026-10-24T10:00:00Z', 'America/New_York', 'start')).toBe(
            Date.parse('2026-10-24T10:00:00Z') / 1000,
        );
        expect(toEpochSeconds('soon', 'UTC', 'end')).toBeUndefined();
        expect(toEpochSeconds(undefined, 'UTC', 'end')).toBeUndefined();
    });

    it('formats instants with the zone offset', () => {
        expect(formatInZone(new Date('2026-10-24T13:00:00Z'), 'America/New_York')).toBe(
            '2026-10-24T09:00:00-04:00',
        );
        expect(formatInZone(new Date('2026-10-24T13:00:00Z'), 'UTC')).toBe(
            '2026-10-24T13:00:00+00:00',
        );
    });
});
