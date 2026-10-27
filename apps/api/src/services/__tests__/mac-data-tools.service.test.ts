import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../mac-data-relay.service', () => ({
    macDataRelay: { isOnline: vi.fn().mockResolvedValue(false), request: vi.fn() },
}));
vi.mock('../../repositories/page.repo', () => ({
    findAboutMePage: vi.fn().mockResolvedValue({ id: 'about-page', type: 'aboutme' }),
}));
vi.mock('../device-data-access.service', () => ({
    dataPageSlicesFor: vi.fn(),
    isMemberOf: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../repositories/collector.repo', () => ({
    collectorTimeZone: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../about-me.service', () => ({
    loadNotebookAboutMe: vi.fn(),
    currentPlace: vi.fn().mockResolvedValue(null),
    aboutMeSummary: vi.fn().mockReturnValue('## About the people in this notebook\n### Zubair'),
    recallAboutMe: vi.fn().mockReturnValue('{"facts":[]}'),
    rememberAboutMe: vi.fn().mockResolvedValue('Saved (f1).'),
    updateAboutMe: vi.fn().mockResolvedValue('Updated.'),
}));
vi.mock('../../repositories/device-item.repo', () => ({ findDeviceItem: vi.fn() }));
vi.mock('../device-search.service', () => ({ searchDeviceData: vi.fn() }));
vi.mock('../calendar-overlap.service', () => ({ findOverlapsForBot: vi.fn() }));

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
import { findAboutMePage } from '../../repositories/page.repo';
import { dataPageSlicesFor } from '../device-data-access.service';
import { collectorTimeZone } from '../../repositories/collector.repo';
import { findDeviceItem } from '../../repositories/device-item.repo';
import { searchDeviceData } from '../device-search.service';
import { findOverlapsForBot } from '../calendar-overlap.service';
import { currentPlace, loadNotebookAboutMe, type NotebookAboutMe } from '../about-me.service';

const ownBot = { id: 'b1', name: 'Maple', ownerId: 'u1' };

const notebook = (shared = false): NotebookAboutMe => ({
    notebookId: 'n1',
    shared,
    people: [],
    members: [
        { userId: 'u1', name: 'Zubair' },
        { userId: 'u2', name: 'Julia' },
    ],
});

const ctx: MacDataToolContext = {
    userId: 'u1',
    notebookId: 'n1',
    sources: ['imessage', 'calendar'],
    timeZone: 'America/New_York',
    now: '2026-10-24T09:00:00-04:00',
};

describe('getMacDataToolContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(loadNotebookAboutMe).mockResolvedValue(notebook());
    });

    it("is null when the notebook has none of the user's device data pages", async () => {
        vi.mocked(dataPageSlicesFor).mockResolvedValue([]);
        vi.mocked(findAboutMePage).mockResolvedValueOnce(null); // and no About me page
        expect(await getMacDataToolContext('u1', 'n1', ownBot)).toBeNull();
    });

    it("uses the sources of the user's pages and their devices' time zone", async () => {
        vi.mocked(dataPageSlicesFor).mockResolvedValue([
            { source: 'imessage' },
            { source: 'imessage' },
            { source: 'location' },
        ] as never);
        vi.mocked(collectorTimeZone).mockResolvedValue('America/New_York');
        const context = await getMacDataToolContext('u1', 'n1', ownBot);
        expect(context).toMatchObject({
            sources: ['imessage', 'location'],
            timeZone: 'America/New_York',
        });
        expect(context?.now).toMatch(/-0[45]:00$/);
        expect(dataPageSlicesFor).toHaveBeenCalledWith('u1', 'n1');
        expect(macDataSystemPrompt(context!)).toContain('places visited');
    });
});

describe('About me in bot context', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(loadNotebookAboutMe).mockResolvedValue(notebook());
    });

    it("gives About me only to the user's own bots, in notebooks with an About me page", async () => {
        vi.mocked(dataPageSlicesFor).mockResolvedValue([]);
        const own = await getMacDataToolContext('u1', 'n1', ownBot);
        expect(own?.sources).toEqual([]);
        expect(macDataToolDefinitions(own!).map((t) => t.name)).toEqual([
            'recall_about_me',
            'remember_about_me',
            'update_about_me',
        ]);
        expect(macDataSystemPrompt(own!)).toContain('### Zubair');
        // Another member's About me can be written to by name.
        const remember = macDataToolDefinitions(own!).find((t) => t.name === 'remember_about_me')!;
        expect(
            (remember.parameters as { properties: { whose: { enum: string[] } } }).properties.whose
                .enum,
        ).toEqual(['Julia']);
        // A bot someone else shared into the notebook: no data, no profile, no tools,
        // even when the user has device data pages there.
        vi.mocked(dataPageSlicesFor).mockResolvedValue([{ source: 'imessage' }] as never);
        expect(
            await getMacDataToolContext('u1', 'n1', { id: 'b2', name: 'Theirs', ownerId: 'u2' }),
        ).toBeNull();
    });

    it('keeps About me out of notebooks without an About me page', async () => {
        vi.mocked(dataPageSlicesFor).mockResolvedValue([{ source: 'imessage' }] as never);
        vi.mocked(findAboutMePage).mockResolvedValueOnce(null);
        const context = await getMacDataToolContext('u1', 'n1', ownBot);
        expect(context?.sources).toEqual(['imessage']);
        expect(context?.aboutMe).toBeUndefined();
    });

    it('leaves where the user is out of shared notebooks', async () => {
        vi.mocked(dataPageSlicesFor).mockResolvedValue([]);
        vi.mocked(loadNotebookAboutMe).mockResolvedValueOnce(notebook(true));
        const shared = await getMacDataToolContext('u1', 'n1', ownBot);
        expect(shared?.aboutMe?.notebook.shared).toBe(true);
        expect(currentPlace).not.toHaveBeenCalled();
        const remember = macDataToolDefinitions(shared!).find(
            (t) => t.name === 'remember_about_me',
        )!;
        // `sensitive` is described in every mode; shared ones say those aren't kept, and
        // no example suggests saving health or whereabouts.
        expect(remember.description).toContain('Set sensitive for health');
        expect(remember.description).toContain('never saved here');
        expect(remember.description).not.toMatch(/sick|traveling until/i);
        const own = await getMacDataToolContext('u1', 'n1', ownBot);
        const privateRemember = macDataToolDefinitions(own!).find(
            (t) => t.name === 'remember_about_me',
        )!;
        expect(privateRemember.description).toContain('Set sensitive for health');
        expect(privateRemember.description).not.toMatch(/sick/i);
    });

    it('holds what a bot saves for approval once it has read messages or mail', async () => {
        const { rememberAboutMe } = await import('../about-me.service');
        vi.mocked(searchDeviceData).mockResolvedValue([]);
        const context: MacDataToolContext = {
            ...ctx,
            aboutMe: { notebook: notebook(), summary: '', source: { type: 'bot', botId: 'b1' } },
        };
        await executeMacDataTool(context, 'search_local_data', { query: 'new address' });
        await executeMacDataTool(context, 'remember_about_me', {
            about: 'me',
            key: 'home_address',
            value: '1 Phish Way',
            kind: 'lasting',
        });
        const input = vi.mocked(rememberAboutMe).mock.calls.at(-1)![2];
        expect(input).toMatchObject({ pending: true, sensitive: false });
    });

    it('saves what the bot learned with the bot as its source', async () => {
        const { rememberAboutMe } = await import('../about-me.service');
        const context = {
            ...ctx,
            aboutMe: {
                notebook: notebook(),
                summary: '',
                source: { type: 'bot' as const, botId: 'b1' },
            },
        };
        await executeMacDataTool(context, 'remember_about_me', {
            about: 'me',
            key: 'travel',
            value: 'In Denver',
            kind: 'current',
            until: '2026-10-30',
        });
        expect(rememberAboutMe).toHaveBeenCalledWith(
            context.aboutMe.notebook,
            'u1',
            expect.objectContaining({
                key: 'travel',
                kind: 'current',
                until: '2026-10-30',
                sensitive: false,
                pending: false,
            }),
            { type: 'bot', botId: 'b1' },
            'America/New_York',
        );
        // Without a profile in context, the tools don't exist.
        expect(await executeMacDataTool(ctx, 'remember_about_me', {})).toContain('Unknown tool');
    });
});

describe('local-data tools', () => {
    beforeEach(() => vi.clearAllMocks());

    it('only offers remember_instruction on the proactive page', () => {
        expect(macDataToolDefinitions(ctx).map((t) => t.name)).toEqual([
            'search_local_data',
            'get_local_item',
            'find_overlaps',
        ]);
        const withMemory = { ...ctx, rememberInstruction: vi.fn() };
        expect(macDataToolDefinitions(withMemory).map((t) => t.name)).toContain(
            'remember_instruction',
        );
    });

    it('offers find_overlaps only with a calendar, and answers from the overlap check', async () => {
        const noCalendar = { ...ctx, sources: ['imessage' as const] };
        expect(macDataToolDefinitions(noCalendar).map((t) => t.name)).not.toContain(
            'find_overlaps',
        );
        expect(await executeMacDataTool(noCalendar, 'find_overlaps', {})).toBe(
            'Unknown tool: find_overlaps',
        );
        vi.mocked(findOverlapsForBot).mockResolvedValue([
            { kind: 'overlap', summary: 'A overlaps B by 30 min', events: [] },
        ]);
        const result = await executeMacDataTool(ctx, 'find_overlaps', { from: '2026-10-28' });
        expect(JSON.parse(result).overlaps[0].summary).toBe('A overlaps B by 30 min');
        expect(findOverlapsForBot).toHaveBeenCalledWith(ctx, { from: '2026-10-28' });
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
