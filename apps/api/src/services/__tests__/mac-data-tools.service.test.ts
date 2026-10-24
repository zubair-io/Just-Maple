import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mac-data-relay.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../mac-data-relay.service')>();
    return {
        ...actual,
        macDataRelay: { isOnline: vi.fn(), request: vi.fn() },
    };
});
vi.mock('../../repositories/mac-data-host.repo', () => ({ findMacDataHost: vi.fn() }));

import {
    executeMacDataTool,
    formatInZone,
    getMacDataToolContext,
    macDataSystemPrompt,
    macDataToolDefinitions,
    toEpochSeconds,
    type MacDataToolContext,
} from '../mac-data-tools.service';
import { macDataRelay, MacDataUnavailableError } from '../mac-data-relay.service';
import { findMacDataHost } from '../../repositories/mac-data-host.repo';

const ctx: MacDataToolContext = {
    userId: 'u1',
    notebookId: 'n1',
    sources: ['imessage', 'calendar'],
    online: true,
    timeZone: 'America/New_York',
    now: '2026-10-24T09:00:00-04:00',
};

describe('getMacDataToolContext', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is null when the notebook has no Mac pages', async () => {
        vi.mocked(findMacDataHost).mockResolvedValue({
            userId: 'u1',
            notebooks: [{ notebookId: 'other', sources: ['mail'] }],
            timeZone: 'UTC',
            lastSeenAt: '2026-10-24T00:00:00.000Z',
        });
        expect(await getMacDataToolContext('u1', 'n1')).toBeNull();
    });

    it('reads local time from the stored time zone, without asking the Mac', async () => {
        vi.mocked(findMacDataHost).mockResolvedValue({
            userId: 'u1',
            notebooks: [{ notebookId: 'n1', sources: ['imessage'] }],
            timeZone: 'America/New_York',
            lastSeenAt: '2026-10-24T00:00:00.000Z',
        });
        vi.mocked(macDataRelay.isOnline).mockResolvedValue(true);
        const ctx = await getMacDataToolContext('u1', 'n1');
        expect(ctx).toMatchObject({
            sources: ['imessage'],
            online: true,
            timeZone: 'America/New_York',
        });
        expect(ctx?.now).toMatch(/-0[45]:00$/);
        expect(macDataRelay.request).not.toHaveBeenCalled();
    });

    it('still gives offline context so the bot can say the Mac is unreachable', async () => {
        vi.mocked(findMacDataHost).mockResolvedValue({
            userId: 'u1',
            notebooks: [{ notebookId: 'n1', sources: ['calendar'] }],
            timeZone: 'America/New_York',
            lastSeenAt: '2026-10-23T22:00:00.000Z',
        });
        vi.mocked(macDataRelay.isOnline).mockResolvedValue(false);
        const offline = await getMacDataToolContext('u1', 'n1');
        expect(offline?.online).toBe(false);
        expect(offline?.now).toMatch(/-0[45]:00$/);
        expect(macDataSystemPrompt(offline!)).toContain("can't reach their Mac");
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

    it('searches the Mac with dates in its time zone and only allowed sources', async () => {
        vi.mocked(macDataRelay.request).mockResolvedValue([{ id: 'imessage:1' }]);
        const result = await executeMacDataTool(ctx, 'search_local_data', {
            query: 'lacrosse',
            sources: ['imessage', 'mail'],
            from: '2026-10-19',
            to: '2026-10-25',
        });
        expect(JSON.parse(result)).toEqual({ results: [{ id: 'imessage:1' }] });
        expect(macDataRelay.request).toHaveBeenCalledWith('u1', 'search', {
            notebookId: 'n1',
            query: 'lacrosse',
            sources: ['imessage'],
            from: Date.parse('2026-10-19T00:00:00-04:00') / 1000,
            to: Date.parse('2026-10-25T23:59:59-04:00') / 1000,
            limit: undefined,
        });
    });

    it('turns failures into text the model can read', async () => {
        vi.mocked(macDataRelay.request).mockRejectedValueOnce(new MacDataUnavailableError());
        expect(await executeMacDataTool(ctx, 'get_local_item', { id: 'x' })).toMatch(
            /^Unavailable:/,
        );
        vi.mocked(macDataRelay.request).mockRejectedValueOnce(new Error('No item x'));
        expect(await executeMacDataTool(ctx, 'get_local_item', { id: 'x' })).toBe(
            'Error: No item x',
        );
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
