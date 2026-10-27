import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { ObjectId } from 'mongodb';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import {
    dataGraphItemNodeId,
    graphPageId,
    type DataGraph,
    type DeviceDataFilter,
    type MacDataItem,
    type MacDataSource,
} from '@maple/shared';

vi.mock('../../services/bot-executor.service', () => ({ botExecutor: { invoke: vi.fn() } }));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));
vi.mock('../../services/mac-data-relay.service', () => ({
    macDataRelay: { isOnline: vi.fn().mockResolvedValue(false), request: vi.fn() },
}));
vi.mock('../../services/graph-model.service', () => ({
    graphModelAvailable: () => true,
    judgeGraphBatch: vi.fn(),
}));
// Tests run passes themselves; uploads don't schedule one.
vi.mock('../../services/graph.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/graph.service')>()),
    markGraphDirty: vi.fn(),
}));

import { judgeGraphBatch, type GraphJudgeRequest } from '../../services/graph-model.service';
import {
    getDataGraph,
    graphTick,
    NOTEBOOK_DAILY_CALLS,
    runGraphPass,
    runIncrementalGraphPass,
    USER_DAILY_CALLS,
} from '../../services/graph.service';
import { findDecidedPairs, findGraphLinks } from '../../repositories/graph.repo';
import { executeMacDataTool, getMacDataToolContext } from '../../services/mac-data-tools.service';
import { saveTravelEstimates } from '../../repositories/travel-estimate.repo';

const judge = vi.mocked(judgeGraphBatch);
const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);

function item(id: string, source: MacDataSource, fields: Partial<MacDataItem> = {}): MacDataItem {
    return {
        id,
        source,
        revision: '1',
        occurredAt: now - HOUR,
        participants: [],
        body: '',
        ...fields,
    };
}

// The dental office: a visit there, and the follow-up booked during it.
const visit = item('location:visit:dentist', 'location', {
    occurredAt: now - 3 * HOUR,
    endAt: now - 2 * HOUR,
    title: 'Bright Smiles Dental',
    location: '12 Main St, Albany, NY',
    body: 'At Bright Smiles Dental',
    extra: { lat: 42.65, lon: -73.75, place: 'Bright Smiles Dental' },
});
const followUp = item('calendar:followup@1', 'calendar', {
    occurredAt: now + 14 * 24 * HOUR,
    endAt: now + 14 * 24 * HOUR + HOUR,
    title: 'Dentist follow-up',
    calendar: 'Family',
    location: 'Bright Smiles Dental, 12 Main Street, Albany NY',
    extra: { createdAt: new Date((now - 2.5 * HOUR) * 1000).toISOString() },
});
// The pizza party: an email and the event, which only the model can connect.
const partyMail = item('mail:party', 'mail', {
    occurredAt: now - 2 * 24 * HOUR,
    title: "Greyson's soccer pizza party",
    sender: 'Coach Dana <dana@club.org>',
    mailbox: 'Inbox',
    body: 'Pizza party at Riverside field after Saturday’s game.',
});
const partyEvent = item('calendar:party@1', 'calendar', {
    occurredAt: now + 24 * HOUR,
    title: 'Soccer pizza party',
    calendar: 'Family',
    location: 'Riverside field',
});

/** The model links every pair and puts every item in "Soccer season". */
function agreeableModel(topic = 'Soccer season') {
    judge.mockImplementation(async (request: GraphJudgeRequest) => ({
        pairs: request.pairs.map((pair) => ({
            p: pair.p,
            related: true,
            confidence: 0.9,
            reason: 'Same party',
        })),
        topics: [{ name: topic, items: request.items.map((i) => i.n), confidence: 0.9 }],
    }));
}

describe.runIf(mongoAvailable)('connected-data graph', () => {
    let app: ReturnType<typeof createTestApp>;
    let alex: { id: string; token: string };
    let sam: { id: string; token: string };

    const call = (who: { token: string }, path: string, method = 'GET', body?: unknown) =>
        app.handle(
            new Request('http://localhost' + path, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + who.token,
                },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            }),
        );
    const json = async (response: Promise<Response>) => (await response).json();

    async function person(displayName: string) {
        const user = await createUserFixture({ displayName });
        const id = user._id.toString();
        return { id, token: await createAuthToken(id) };
    }

    async function upload(sources: MacDataSource[], items: MacDataItem[], who = alex) {
        await call(who, '/api/collectors', 'POST', {
            deviceId: `device-${who.id}`,
            platform: 'macos',
            name: 'Test Mac',
            sources,
            timeZone: 'America/New_York',
        });
        await call(who, `/api/collectors/device-${who.id}`, 'PATCH', { activeSources: sources });
        const result = await json(
            call(who, '/api/device-data/items', 'POST', {
                deviceId: `device-${who.id}`,
                upserts: items,
                removals: [],
            }),
        );
        expect(result.stored).toBe(items.length);
    }

    /** A notebook with data pages for these sources and a Graph page. */
    async function notebook(sources: MacDataSource[], shared = false) {
        const doc = await createNotebookFixture({
            createdBy: alex.id,
            sharedWith: [
                { userId: alex.id, accessLevel: 'owner' },
                ...(shared ? [{ userId: sam.id, accessLevel: 'write' as const }] : []),
            ],
        });
        const notebookId = doc._id.toString();
        const pages: Record<string, string> = {};
        for (const source of sources) {
            const { page } = await json(
                call(alex, '/api/pages', 'POST', {
                    type: 'devicedata',
                    deviceSource: source,
                    title: source,
                    notebookId,
                }),
            );
            pages[source] = page.id;
        }
        await createPageFixture({
            id: graphPageId(notebookId),
            userId: alex.id,
            notebookId,
            type: 'graph',
            title: 'Graph',
        });
        return { notebookId, pages };
    }

    const setFilter = (pageId: string, deviceFilter: DeviceDataFilter) =>
        json(call(alex, `/api/device-data/pages/${pageId}`, 'PATCH', { deviceFilter }));

    const graphOf = async (who: { token: string }, notebookId: string, query = '') => {
        const response = await call(who, `/api/graph/${notebookId}${query}`);
        return { status: response.status, graph: (await response.json()).graph as DataGraph };
    };

    const node = (ownerId: string, id: string) => dataGraphItemNodeId(ownerId, id);
    const between = (graph: DataGraph, a: string, b: string) =>
        graph.links.find(
            (l) => (l.source === a && l.target === b) || (l.source === b && l.target === a),
        );

    beforeEach(async () => {
        vi.clearAllMocks();
        judge.mockResolvedValue({ pairs: [], topics: [] });
        app = createTestApp();
        alex = await person('Alex');
        sam = await person('Sam');
    });

    // MARK: - Rule links

    it('links the dental appointment to the visit, the office and the drive', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const { notebookId } = await notebook(['calendar', 'location']);
        await saveTravelEstimates(alex.id, 'phone', [
            {
                eventId: followUp.id,
                minutes: 18,
                origin: 'Home',
                computedAt: new Date().toISOString(),
            },
        ]);

        const result = await runGraphPass(notebookId);
        expect(result?.ruleLinks).toBeGreaterThan(0);

        const { graph } = await graphOf(alex, notebookId);
        const appointment = node(alex.id, followUp.id);
        const atOffice = node(alex.id, visit.id);
        expect(between(graph, appointment, atOffice)).toMatchObject({
            kind: 'created_at',
            madeBy: 'rule',
            confidence: 1,
        });
        const office = graph.nodes.find(
            (n) => n.kind === 'place' && n.label === 'Bright Smiles Dental',
        )!.id;
        expect(between(graph, appointment, office)?.kind).toBe('at_place');
        expect(between(graph, atOffice, office)?.kind).toBe('at_place');
        const drive = graph.links.find((l) => l.kind === 'travel')!;
        expect(drive.evidence).toBe('18 min drive from Home');

        const appointmentNode = graph.nodes.find((n) => n.id === appointment)!;
        expect(appointmentNode).toMatchObject({
            kind: 'item',
            source: 'calendar',
            label: 'Dentist follow-up',
        });
        expect(appointmentNode.pageId).toBeTruthy();
    });

    // MARK: - Notebook isolation

    it('links the same items independently in two notebooks, and never mixes them', async () => {
        await upload(['calendar', 'mail'], [partyMail, partyEvent]);
        const a = await notebook(['calendar', 'mail']);
        const b = await notebook(['calendar', 'mail']);

        // In A the model links the email to the event and makes a topic; in B it doesn't.
        agreeableModel();
        await runGraphPass(a.notebookId);
        judge.mockResolvedValue({ pairs: [], topics: [] });
        await runGraphPass(b.notebookId);

        const inA = (await graphOf(alex, a.notebookId)).graph;
        const inB = (await graphOf(alex, b.notebookId)).graph;
        expect(
            between(inA, node(alex.id, partyMail.id), node(alex.id, partyEvent.id)),
        ).toMatchObject({
            kind: 'related',
            madeBy: 'model',
            evidence: 'Same party',
        });
        expect(inA.nodes.some((n) => n.kind === 'topic' && n.label === 'Soccer season')).toBe(true);
        expect(inB.links.some((l) => l.kind === 'related' || l.kind === 'topic')).toBe(false);
        expect(inB.nodes.some((n) => n.kind === 'topic')).toBe(false);
        expect(inB.links.every((l) => l.id.startsWith(`${b.notebookId}|`))).toBe(true);

        // Every stored document carries its own notebook.
        const stored = await testDb!.collection('graph_links').find({}).toArray();
        for (const doc of stored)
            expect(String(doc._id).startsWith(`${doc.notebookId}|`)).toBe(true);

        // Removing A's link leaves B alone, and B's id can't remove anything through A.
        const linkA = between(inA, node(alex.id, partyMail.id), node(alex.id, partyEvent.id))!;
        const crossed = await call(
            alex,
            `/api/graph/${b.notebookId}/links/${encodeURIComponent(linkA.id)}`,
            'DELETE',
        );
        expect(crossed.status).toBe(404);
        expect(
            (
                await call(
                    alex,
                    `/api/graph/${a.notebookId}/links/${encodeURIComponent(linkA.id)}`,
                    'DELETE',
                )
            ).status,
        ).toBe(200);

        // B learns its own link later; A's removal doesn't block it.
        agreeableModel('Soccer');
        await testDb!.collection('graph_judged').deleteMany({ notebookId: b.notebookId });
        await testDb!
            .collection('graph_links')
            .deleteMany({ notebookId: b.notebookId, status: 'rejected' });
        await runGraphPass(b.notebookId);
        const later = (await graphOf(alex, b.notebookId)).graph;
        expect(
            between(later, node(alex.id, partyMail.id), node(alex.id, partyEvent.id)),
        ).toBeDefined();
        expect(later.nodes.some((n) => n.label === 'Soccer season')).toBe(false);
    });

    it("gives a bot in notebook B only B's links", async () => {
        await upload(['calendar', 'mail'], [partyMail, partyEvent]);
        const a = await notebook(['calendar', 'mail']);
        const b = await notebook(['calendar', 'mail']);
        agreeableModel();
        await runGraphPass(a.notebookId);
        judge.mockResolvedValue({ pairs: [], topics: [] });
        await runGraphPass(b.notebookId);

        const bot = { id: 'bot', name: 'Bot', ownerId: alex.id };
        const ctxA = await getMacDataToolContext(alex.id, a.notebookId, bot);
        const readA = JSON.parse(
            await executeMacDataTool(ctxA!, 'get_local_item', { id: partyMail.id }),
        );
        expect(readA.linked).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: partyEvent.id, link: 'Same party' }),
                expect.objectContaining({ kind: 'topic', title: 'Soccer season' }),
            ]),
        );

        const ctxB = await getMacDataToolContext(alex.id, b.notebookId, bot);
        const readB = JSON.parse(
            await executeMacDataTool(ctxB!, 'get_local_item', { id: partyMail.id }),
        );
        expect(readB.linked).toBeUndefined();
    });

    // MARK: - Filters and access

    it('hides links the moment a filter stops sharing an item, and deletes nothing on read', async () => {
        await upload(['calendar', 'mail'], [partyMail, partyEvent]);
        const { notebookId, pages } = await notebook(['calendar', 'mail']);
        agreeableModel();
        await runGraphPass(notebookId);
        const event = node(alex.id, partyEvent.id);
        const stored = async () =>
            testDb!
                .collection('graph_links')
                .countDocuments({ notebookId, $or: [{ a: event }, { b: event }] });
        const before = await stored();
        expect(before).toBeGreaterThan(0);

        await setFilter(pages.calendar!, { calendars: [{ name: 'Work' }] });
        const after = (await graphOf(alex, notebookId)).graph;
        expect(after.nodes.some((n) => n.id === event)).toBe(false);
        expect(after.links.some((l) => l.source === event || l.target === event)).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(await stored()).toBe(before);

        // Widened again: the model's links are back, with no new model call.
        judge.mockClear();
        await setFilter(pages.calendar!, { includeAll: true });
        const again = (await graphOf(alex, notebookId)).graph;
        expect(between(again, node(alex.id, partyMail.id), event)).toMatchObject({
            madeBy: 'model',
        });
        expect(judge).not.toHaveBeenCalled();
    });

    it('deletes model links only once an item has been gone for 30 days', async () => {
        await upload(['calendar', 'mail'], [partyMail, partyEvent]);
        const { notebookId } = await notebook(['calendar', 'mail']);
        agreeableModel();
        await runGraphPass(notebookId);
        const linkId = (await findGraphLinks(notebookId)).find((l) => l.kind === 'related')!._id;
        const pass = (days: number) =>
            runGraphPass(notebookId, new Date(Date.now() + days * 24 * HOUR * 1000));

        // Still in the device data: not gone.
        await pass(1);
        expect(
            await testDb!.collection('graph_links').findOne({ _id: linkId as never }),
        ).not.toHaveProperty('goneSince');

        await testDb!
            .collection('device_items')
            .deleteOne({ userId: alex.id, 'item.id': partyEvent.id });
        await pass(2);
        const missing = await testDb!.collection('graph_links').findOne({ _id: linkId as never });
        expect(missing?.goneSince).toBeInstanceOf(Date);
        await pass(20);
        expect(
            await testDb!.collection('graph_links').countDocuments({ _id: linkId as never }),
        ).toBe(1);
        await pass(33);
        expect(
            await testDb!.collection('graph_links').countDocuments({ _id: linkId as never }),
        ).toBe(0);
    });

    it('shows members only what the pages share them, and nothing to outsiders', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const { notebookId, pages } = await notebook(['calendar', 'location'], true);
        // A shared notebook: nothing is shared until Alex picks.
        await runGraphPass(notebookId);
        expect((await graphOf(sam, notebookId)).graph.nodes).toEqual([]);

        await setFilter(pages.calendar!, { includeAll: true });
        await setFilter(pages.location!, { includeAll: true });
        await saveTravelEstimates(alex.id, 'phone', [
            {
                eventId: followUp.id,
                minutes: 18,
                origin: 'Home',
                computedAt: new Date().toISOString(),
            },
        ]);
        await runGraphPass(notebookId);
        const seen = (await graphOf(sam, notebookId)).graph;
        expect(seen.nodes.find((n) => n.id === node(alex.id, followUp.id))).toMatchObject({
            ownerName: 'Alex',
        });
        // Where Alex drove from stays out of a shared notebook.
        expect(seen.links.some((l) => l.kind === 'travel')).toBe(false);

        const stranger = await person('Pat');
        expect((await graphOf(stranger, notebookId)).status).toBe(404);
        expect(
            (
                await call(
                    stranger,
                    `/api/graph/${notebookId}/links/${encodeURIComponent(seen.links[0]!.id)}`,
                    'DELETE',
                )
            ).status,
        ).toBe(404);
    });

    it('keeps private matters off links and topics in shared notebooks', async () => {
        await upload(['calendar', 'mail'], [partyMail, partyEvent]);
        const { notebookId, pages } = await notebook(['calendar', 'mail'], true);
        await setFilter(pages.calendar!, { includeAll: true });
        await setFilter(pages.mail!, { mailboxes: ['Inbox'] });
        judge.mockImplementation(async (request) => ({
            pairs: request.pairs.map((pair) => ({
                p: pair.p,
                related: true,
                confidence: 0.9,
                reason: 'Both about the lawyer meeting',
            })),
            topics: [{ name: 'Divorce', items: request.items.map((i) => i.n), confidence: 0.9 }],
        }));
        await runGraphPass(notebookId);
        expect(judge.mock.calls[0]![0].shared).toBe(true);
        const graph = (await graphOf(alex, notebookId)).graph;
        expect(graph.links.find((l) => l.kind === 'related')?.evidence).toBe('Related');
        expect(graph.nodes.some((n) => n.kind === 'topic')).toBe(false);
    });

    // MARK: - Removing links

    it('never adds a removed link again', async () => {
        await upload(['calendar', 'location', 'mail'], [visit, followUp, partyMail, partyEvent]);
        const { notebookId } = await notebook(['calendar', 'location', 'mail']);
        agreeableModel();
        await runGraphPass(notebookId);
        const graph = (await graphOf(alex, notebookId)).graph;
        const rule = between(graph, node(alex.id, followUp.id), node(alex.id, visit.id))!;
        const model = between(graph, node(alex.id, partyMail.id), node(alex.id, partyEvent.id))!;
        for (const link of [rule, model]) {
            const response = await call(
                alex,
                `/api/graph/${notebookId}/links/${encodeURIComponent(link.id)}`,
                'DELETE',
            );
            expect(response.status).toBe(200);
        }

        // Run again from scratch: rules and the model would both make them.
        await testDb!.collection('graph_state').deleteMany({});
        await runGraphPass(notebookId);
        const after = (await graphOf(alex, notebookId)).graph;
        expect(after.links.some((l) => l.id === rule.id || l.id === model.id)).toBe(false);
        expect(
            await testDb!
                .collection('graph_links')
                .countDocuments({ _id: { $in: [rule.id, model.id] } as never, status: 'removed' }),
        ).toBe(2);
        // The model wasn't asked about the removed pair.
        const asked = judge.mock.calls.flatMap(([request]) =>
            request.pairs.map((p) =>
                [request.items[p.a]!.title, request.items[p.b]!.title].sort().join(' + '),
            ),
        );
        expect(
            asked.filter((pair) => pair.includes('pizza party') && pair.includes('Soccer')),
        ).toHaveLength(1);
    });

    it('lets only members who can edit remove links', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const doc = await createNotebookFixture({
            createdBy: alex.id,
            sharedWith: [
                { userId: alex.id, accessLevel: 'owner' },
                { userId: sam.id, accessLevel: 'read' },
            ],
        });
        const notebookId = doc._id.toString();
        await createPageFixture({
            id: graphPageId(notebookId),
            userId: alex.id,
            notebookId,
            type: 'graph',
        });
        const response = await call(
            sam,
            `/api/graph/${notebookId}/links/${encodeURIComponent(`${notebookId}|x|y`)}`,
            'DELETE',
        );
        expect(response.status).toBe(404);
    });

    // MARK: - Backfill

    it('backfills 30 days in bounded batches, then links only new uploads', async () => {
        const old = item('mail:old', 'mail', {
            occurredAt: now - 40 * 24 * HOUR,
            title: 'Ancient pizza party',
            mailbox: 'Inbox',
        });
        const many = Array.from({ length: 300 }, (_, i) =>
            item(`mail:m${i}`, 'mail', {
                occurredAt: now - (i + 1) * 2 * HOUR,
                title: `Soccer pizza update ${i}`,
                mailbox: 'Inbox',
                body: `Team pizza news number ${i}`,
            }),
        );
        await upload(['calendar', 'mail'], [old, partyEvent, ...many]);
        const { notebookId } = await notebook(['calendar', 'mail']);

        const first = await runGraphPass(notebookId);
        expect(first).toMatchObject({ backfilled: false });
        expect(first!.modelCalls).toBeLessThanOrEqual(4);
        for (const [request] of judge.mock.calls) {
            expect(request.pairs.length).toBeLessThanOrEqual(30);
            expect(request.items.length).toBeLessThanOrEqual(100);
        }
        // Nothing older than 30 days is sent.
        const sent = judge.mock.calls.flatMap(([request]) => request.items.map((i) => i.title));
        expect(sent).not.toContain('Ancient pizza party');

        let passes = 1;
        while (
            !(await testDb!.collection('graph_state').findOne({ _id: notebookId as never }))
                ?.backfilledAt
        ) {
            await runGraphPass(notebookId);
            if (++passes > 5) throw new Error('backfill never finished');
        }
        expect(passes).toBe(2); // 301 items, 160 per pass

        // Afterwards only new uploads go to the model.
        judge.mockClear();
        const fresh = item('mail:fresh', 'mail', {
            occurredAt: now,
            title: 'Pizza party moved',
            mailbox: 'Inbox',
            body: 'Soccer pizza party is now at noon',
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
        await upload(['calendar', 'mail'], [fresh]);
        const next = await runGraphPass(notebookId);
        expect(next!.modelCalls).toBeLessThanOrEqual(2);
        const focus = judge.mock.calls.flatMap(([request]) => request.items.map((i) => i.title));
        expect(focus).toContain('Pizza party moved');
        expect(focus).not.toContain('Soccer pizza update 250');
    });

    it('only links notebooks with a Graph page, one pass at a time', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const doc = await createNotebookFixture({
            createdBy: alex.id,
            sharedWith: [{ userId: alex.id, accessLevel: 'owner' }],
        });
        expect(await runGraphPass(doc._id.toString())).toBeNull();

        const { notebookId } = await notebook(['calendar', 'location']);
        const [one, two] = await Promise.all([runGraphPass(notebookId), runGraphPass(notebookId)]);
        expect([one, two].filter(Boolean)).toHaveLength(1);
        await graphTick();
        expect(
            await testDb!.collection('graph_state').findOne({ _id: notebookId as never }),
        ).toMatchObject({ lastRunAt: expect.any(Date) });
    });

    // MARK: - The page

    it('adds one Graph page per notebook and starts linking', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const doc = await createNotebookFixture({
            createdBy: alex.id,
            sharedWith: [{ userId: alex.id, accessLevel: 'owner' }],
        });
        const notebookId = doc._id.toString();
        await json(
            call(alex, '/api/pages', 'POST', {
                type: 'devicedata',
                deviceSource: 'calendar',
                title: 'Calendar',
                notebookId,
            }),
        );
        await json(
            call(alex, '/api/pages', 'POST', {
                type: 'devicedata',
                deviceSource: 'location',
                title: 'Places',
                notebookId,
            }),
        );
        const first = await json(
            call(alex, '/api/pages', 'POST', { type: 'graph', title: 'Graph', notebookId }),
        );
        expect(first.page.id).toBe(graphPageId(notebookId));
        const again = await json(
            call(alex, '/api/pages', 'POST', { type: 'graph', title: 'Graph', notebookId }),
        );
        expect(again.page.id).toBe(first.page.id);

        await vi.waitFor(async () => {
            const { graph } = await graphOf(alex, notebookId);
            expect(graph.links.length).toBeGreaterThan(0);
        });
    });

    it('filters the graph by date', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const { notebookId } = await notebook(['calendar', 'location']);
        await runGraphPass(notebookId);
        const { graph } = await getDataGraph(notebookId, alex.id, {
            from: now + 7 * 24 * HOUR,
        }).then((g) => ({ graph: g }));
        expect(graph.nodes.some((n) => n.id === node(alex.id, visit.id))).toBe(false);
        expect(graph.nodes.some((n) => n.id === node(alex.id, followUp.id))).toBe(true);
    });

    // MARK: - Review fixes

    it('hides what was written while private once the notebook is shared, then scrubs it', async () => {
        await upload(['calendar', 'mail', 'location'], [partyMail, partyEvent, visit, followUp]);
        const { notebookId, pages } = await notebook(['calendar', 'mail', 'location']);
        await saveTravelEstimates(alex.id, 'phone', [
            {
                eventId: followUp.id,
                minutes: 18,
                origin: 'Home',
                computedAt: new Date().toISOString(),
            },
        ]);
        judge.mockImplementation(async (request) => ({
            pairs: request.pairs.map((pair) => ({
                p: pair.p,
                related: true,
                confidence: 0.9,
                reason: 'Both about the lawyer meeting',
            })),
            topics: [{ name: 'Divorce', items: request.items.map((i) => i.n), confidence: 0.9 }],
        }));
        // Private: everything is saved as the model said it.
        await runGraphPass(notebookId);
        const private_ = (await graphOf(alex, notebookId)).graph;
        expect(private_.nodes.some((n) => n.label === 'Divorce')).toBe(true);
        expect(private_.links.some((l) => l.kind === 'travel')).toBe(true);

        // Shared with Sam, before any pass: reads already hide it.
        await testDb!.collection('notebooks').updateOne(
            { _id: new ObjectId(notebookId) },
            {
                $push: {
                    'sharing.sharedWith': { userId: sam.id, accessLevel: 'write' },
                } as never,
            },
        );
        for (const source of ['calendar', 'mail', 'location'])
            await setFilter(pages[source]!, { includeAll: true });
        for (const who of [alex, sam]) {
            const seen = (await graphOf(who, notebookId)).graph;
            expect(seen.nodes.some((n) => n.label === 'Divorce')).toBe(false);
            expect(seen.links.some((l) => l.kind === 'travel')).toBe(false);
            expect(seen.links.some((l) => /lawyer|Divorce|Home/.test(l.evidence))).toBe(false);
            expect(seen.links.find((l) => l.kind === 'related')?.evidence).toBe('Related');
        }
        const bot = { id: 'bot', name: 'Bot', ownerId: alex.id };
        const ctx = await getMacDataToolContext(alex.id, notebookId, bot);
        const read = JSON.stringify(
            JSON.parse(await executeMacDataTool(ctx!, 'get_local_item', { id: partyMail.id })),
        );
        expect(read).not.toMatch(/lawyer|Divorce/);

        // The next pass scrubs what's stored.
        judge.mockResolvedValue({ pairs: [], topics: [] });
        await runGraphPass(notebookId);
        expect(
            await testDb!
                .collection('graph_nodes')
                .countDocuments({ notebookId, label: 'Divorce' }),
        ).toBe(0);
        expect(
            await testDb!.collection('graph_links').countDocuments({
                notebookId,
                $or: [{ evidence: /lawyer|Divorce|Home/ }, { kind: 'travel', status: 'active' }],
            }),
        ).toBe(0);
    });

    it('judges items that arrive later: a new page, a wider filter, a big upload', async () => {
        const judgedTitles = () =>
            judge.mock.calls.flatMap(([request]) => request.items.map((i) => i.title));
        await upload(['calendar', 'mail'], [partyMail, partyEvent]);
        const { notebookId, pages } = await notebook(['calendar']);
        await setFilter(pages.calendar!, { calendars: [{ name: 'Work' }] });
        await runGraphPass(notebookId);
        expect(judgedTitles()).toEqual([]);

        // The calendar filter widens: the party event is new to the model.
        await setFilter(pages.calendar!, { includeAll: true });
        expect(
            await testDb!.collection('graph_state').findOne({ _id: notebookId as never }),
        ).toMatchObject({ fullPassRequested: true });
        await runGraphPass(notebookId);
        expect(judgedTitles()).toEqual(['Soccer pizza party']);

        // A mail page is added: the email uploaded long ago is new too.
        judge.mockClear();
        await json(
            call(alex, '/api/pages', 'POST', {
                type: 'devicedata',
                deviceSource: 'mail',
                title: 'Mail',
                notebookId,
            }),
        );
        await runGraphPass(notebookId);
        expect(judgedTitles()).toContain("Greyson's soccer pizza party");

        // A big upload goes through over several passes; the cursor doesn't skip any.
        judge.mockClear();
        const many = Array.from({ length: 200 }, (_, i) =>
            item(`mail:bulk${i}`, 'mail', { occurredAt: now - i * 60, title: `Bulk ${i}` }),
        );
        await upload(['calendar', 'mail'], many);
        const first = await runGraphPass(notebookId);
        expect(first).toMatchObject({ pending: 40, modelCalls: 4 });
        const second = await runGraphPass(notebookId);
        expect(second).toMatchObject({ pending: 0, modelCalls: 1 });
        expect(new Set(judgedTitles()).size).toBe(200);
    });

    it('keeps a removed person link removed when two people merge into one', async () => {
        const coach = item('imessage:coach', 'imessage', {
            sender: 'Coach Dana',
            participants: ['+15185550199'],
            body: 'Practice at 5',
        });
        const smith = item('imessage:smith', 'imessage', {
            sender: 'Dana Smith',
            participants: ['+15185550142'],
            body: 'See you there',
        });
        await upload(['imessage', 'contacts'], [coach, smith]);
        const { notebookId } = await notebook(['imessage', 'contacts']);
        await runGraphPass(notebookId);
        const graph = (await graphOf(alex, notebookId)).graph;
        const coachLink = graph.links.find(
            (l) => l.kind === 'person' && [l.source, l.target].includes(node(alex.id, coach.id)),
        )!;
        expect(
            (
                await call(
                    alex,
                    `/api/graph/${notebookId}/links/${encodeURIComponent(coachLink.id)}`,
                    'DELETE',
                )
            ).status,
        ).toBe(200);

        // One contact card with both numbers: they're one person now, under one of the ids.
        await upload(
            ['imessage', 'contacts'],
            [
                item('contacts:dana', 'contacts', {
                    title: 'Dana Smith',
                    extra: {
                        phones: [
                            { label: 'mobile', value: '(518) 555-0199' },
                            { label: 'work', value: '(518) 555-0142' },
                        ],
                    },
                }),
            ],
        );
        await runGraphPass(notebookId);
        const after = (await graphOf(alex, notebookId)).graph;
        const people = after.nodes.filter((n) => n.kind === 'person');
        expect(people).toHaveLength(1);
        expect(
            after.links.some(
                (l) =>
                    l.kind === 'person' && [l.source, l.target].includes(node(alex.id, coach.id)),
            ),
        ).toBe(false);
        expect(
            after.links.some(
                (l) =>
                    l.kind === 'person' && [l.source, l.target].includes(node(alex.id, smith.id)),
            ),
        ).toBe(true);
    });

    it('caps model calls a day, and runs full passes at most every 15 minutes', async () => {
        const many = Array.from({ length: 200 }, (_, i) =>
            item(`mail:m${i}`, 'mail', { occurredAt: now - i * 60, title: `Mail ${i}` }),
        );
        await upload(['mail', 'location'], [...many, visit]);
        const { notebookId } = await notebook(['mail', 'location']);
        const day = new Date().toISOString().slice(0, 10);
        const usage = testDb!.collection('graph_usage');
        await usage.insertOne({
            _id: `notebook:${notebookId}|${day}` as never,
            day,
            calls: NOTEBOOK_DAILY_CALLS - 1,
        });
        const first = await runGraphPass(notebookId);
        // 200 emails and a visit: one call's batch of 40 is done.
        expect(first).toMatchObject({ modelCalls: 1, pending: 161 });
        expect(await runGraphPass(notebookId)).toMatchObject({ modelCalls: 0 });

        // The person who added the Graph page has a cap of their own across notebooks.
        await usage.deleteMany({});
        await usage.insertOne({
            _id: `user:${alex.id}|${day}` as never,
            day,
            calls: USER_DAILY_CALLS,
        });
        expect(await runGraphPass(notebookId)).toMatchObject({ modelCalls: 0 });
        expect(
            await usage.findOne({ _id: `notebook:${notebookId}|${day}` as never }),
        ).toMatchObject({ calls: 0 });
        await usage.deleteMany({});

        // Between full passes, uploads are linked by rules alone.
        judge.mockClear();
        const state = () => testDb!.collection('graph_state').findOne({ _id: notebookId as never });
        const lastFull = (await state())!.lastFullRunAt as Date;
        const later = new Date(lastFull.getTime() + 60_000);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const again = item('location:visit:again', 'location', {
            ...visit,
            id: 'location:visit:again',
            occurredAt: now - 30 * 60,
        });
        await upload(['mail', 'location'], [again]);
        await graphTick(later);
        expect(judge).not.toHaveBeenCalled();
        expect((await state())!.lastFullRunAt).toEqual(lastFull);
        expect(await runIncrementalGraphPass(notebookId, later)).toMatchObject({ items: 1 });
        const atOffice = (await graphOf(alex, notebookId)).graph.links.find(
            (l) => l.kind === 'at_place' && l.source === node(alex.id, again.id),
        );
        expect(atOffice).toBeDefined();

        // Items still waiting: a full pass after 15 minutes, not before.
        await graphTick(new Date(lastFull.getTime() + 10 * 60_000));
        expect(judge).not.toHaveBeenCalled();
        await graphTick(new Date(lastFull.getTime() + 16 * 60_000));
        expect(judge).toHaveBeenCalled();
    });

    it('asks only about the pairs at hand, forgets old rejections, and reads newest first', async () => {
        await upload(['calendar', 'mail'], [partyMail, partyEvent]);
        const { notebookId } = await notebook(['calendar', 'mail']);
        const links = testDb!.collection('graph_links');
        const old = new Date(Date.now() - 100 * 24 * HOUR * 1000);
        await links.insertMany(
            Array.from({ length: 5 }, (_, i) => ({
                _id: `${notebookId}|item:x:${i}|item:y:${i}` as never,
                notebookId,
                a: `item:x:${i}`,
                b: `item:y:${i}`,
                kind: 'related',
                confidence: i === 0 ? 0.8 : 0,
                evidence: '',
                madeBy: 'model',
                status: i === 0 ? 'removed' : i === 1 ? 'active' : 'rejected',
                createdAt: old,
                updatedAt: i === 4 ? new Date() : old,
            })),
        );
        const keys = [0, 1, 2, 3, 4, 9].map((i) => `${notebookId}|item:x:${i}|item:y:${i}`);
        expect([...(await findDecidedPairs(notebookId, keys))].sort()).toEqual(keys.slice(0, 5));
        expect(await findDecidedPairs(notebookId, [])).toEqual(new Set());

        await runGraphPass(notebookId);
        const left = (await links.find({ notebookId, a: /^item:x:/ }).toArray()).map(
            (l) => l.status,
        );
        // Old rejections go; removals and links stay.
        expect(left.sort()).toEqual(['active', 'rejected', 'removed']);

        const newest = await findGraphLinks(notebookId, ['active', 'rejected', 'removed'], 1);
        expect(newest[0]!._id).toBe(`${notebookId}|item:x:4|item:y:4`);
    });

    it('removes a link whose id has a % in it', async () => {
        const sale = item('mail:50%off', 'mail', {
            title: 'Pizza party 50% off',
            mailbox: 'Inbox',
            body: 'Soccer pizza party deal',
        });
        await upload(['calendar', 'mail'], [sale, partyEvent]);
        const { notebookId } = await notebook(['calendar', 'mail']);
        agreeableModel();
        await runGraphPass(notebookId);
        const link = (await findGraphLinks(notebookId)).find((l) => l._id.includes('%'))!;
        expect(link).toBeDefined();
        const response = await call(
            alex,
            `/api/graph/${notebookId}/links/${encodeURIComponent(link._id)}`,
            'DELETE',
        );
        expect(response.status).toBe(200);
        expect(
            await testDb!.collection('graph_links').findOne({ _id: link._id as never }),
        ).toMatchObject({ status: 'removed' });
    });
});
