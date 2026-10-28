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
import {
    findDecidedPairs,
    findGraphRelations,
    interactionInput,
    migrateLegacyGraphLinks,
    relationId,
    removeGraphRelation,
    saveGraphRelations,
} from '../../repositories/graph.repo';
import { addRelation, createEntity } from '../../repositories/profile.repo';
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
        const stored = await testDb!.collection('graph_relations').find({}).toArray();
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
            .collection('graph_relations')
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
                .collection('graph_relations')
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
        const linkId = (await findGraphRelations(notebookId)).find(
            (l) => l.kind === 'related',
        )!._id;
        const pass = (days: number) =>
            runGraphPass(notebookId, new Date(Date.now() + days * 24 * HOUR * 1000));

        // Still in the device data: not gone.
        await pass(1);
        expect(
            await testDb!.collection('graph_relations').findOne({ _id: linkId as never }),
        ).not.toHaveProperty('goneSince');

        await testDb!
            .collection('device_items')
            .deleteOne({ userId: alex.id, 'item.id': partyEvent.id });
        await pass(2);
        const missing = await testDb!
            .collection('graph_relations')
            .findOne({ _id: linkId as never });
        expect(missing?.goneSince).toBeInstanceOf(Date);
        await pass(20);
        expect(
            await testDb!.collection('graph_relations').countDocuments({ _id: linkId as never }),
        ).toBe(1);
        await pass(33);
        expect(
            await testDb!.collection('graph_relations').countDocuments({ _id: linkId as never }),
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
                .collection('graph_relations')
                .countDocuments({ pair: { $in: [rule.id, model.id] }, status: 'removed' }),
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
            await testDb!.collection('graph_relations').countDocuments({
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

    it('keeps a removed reason removed when two people merge into one', async () => {
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
        const practice = item('calendar:practice@1', 'calendar', {
            title: 'Practice',
            participants: ['+15185550142'],
            occurredAt: now + HOUR,
        });
        await upload(['imessage', 'contacts', 'calendar'], [coach, smith, practice]);
        const { notebookId } = await notebook(['imessage', 'contacts', 'calendar']);
        await runGraphPass(notebookId);
        const graph = (await graphOf(alex, notebookId)).graph;
        const me = graph.nodes.find((n) => n.isOwner)!.id;
        const ids = graph.nodes
            .filter((n) => n.kind === 'person' && !n.isOwner)
            .map((n) => n.id)
            .sort();
        expect(ids).toHaveLength(2);
        const coachPerson = graph.nodes.find((n) => n.label === 'Coach Dana')!.id;
        const texts = between(graph, me, coachPerson)!.reasons.find(
            (r) => r.kind === 'messages_with',
        )!;
        expect(texts).toMatchObject({ count: 1, evidence: '1 message' });
        expect(
            (
                await call(
                    alex,
                    `/api/graph/${notebookId}/links/${encodeURIComponent(texts.id)}`,
                    'DELETE',
                )
            ).status,
        ).toBe(200);

        // One contact card with both numbers: they're one person now, under the older id.
        await upload(
            ['imessage', 'contacts', 'calendar'],
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
        const people = after.nodes.filter((n) => n.kind === 'person' && !n.isOwner);
        expect(people.map((p) => p.id)).toEqual([ids[0]]);
        expect(
            await testDb!
                .collection('graph_nodes')
                .findOne({ _id: `${notebookId}|${ids[0]}` as never }),
        ).toMatchObject({ aliases: [ids[1]] });
        // Their messages are one interaction now, and the removal still holds; the
        // practice they're both in still joins them.
        const reasons = between(after, me, ids[0]!)!.reasons.map((r) => r.kind);
        expect(reasons).not.toContain('messages_with');
        expect(reasons).toContain('met_with');
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
        const links = testDb!.collection('graph_relations');
        const old = new Date(Date.now() - 100 * 24 * HOUR * 1000);
        await links.insertMany(
            Array.from({ length: 5 }, (_, i) => ({
                _id: `${notebookId}|item:x:${i}|item:y:${i}|related` as never,
                pair: `${notebookId}|item:x:${i}|item:y:${i}`,
                key: 'related',
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

        const newest = await findGraphRelations(notebookId, ['active', 'rejected', 'removed'], 1);
        expect(newest[0]!._id).toBe(`${notebookId}|item:x:4|item:y:4|related`);
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
        const link = (await findGraphRelations(notebookId)).find((l) => l._id.includes('%'))!;
        expect(link).toBeDefined();
        const response = await call(
            alex,
            `/api/graph/${notebookId}/links/${encodeURIComponent(link._id)}`,
            'DELETE',
        );
        expect(response.status).toBe(200);
        expect(
            await testDb!.collection('graph_relations').findOne({ _id: link._id as never }),
        ).toMatchObject({ status: 'removed' });
    });
    // MARK: - People and their reasons

    // Alex's own card, Jen's card, three texts and a dinner Jen is invited to.
    const meCard = item('contacts:me', 'contacts', {
        title: 'Alex Lawrence',
        extra: {
            isMe: true,
            phones: [{ label: 'mobile', value: '(518) 555-0100' }],
            relations: [{ label: 'wife', name: 'Jen' }],
        },
    });
    const jenCard = item('contacts:jen', 'contacts', {
        title: 'Jen Lawrence',
        extra: {
            phones: [{ label: 'mobile', value: '(518) 555-0123' }],
            emails: [{ label: 'home', value: 'jen@example.com' }],
            birthday: '1986-02-03',
            organization: 'Albany Med',
            relations: [{ label: 'husband', name: 'Alex' }],
        },
    });
    const texts = [3, 2, 1].map((hours, i) =>
        item(`imessage:t${i + 1}`, 'imessage', {
            participants: ['+15185550123'],
            sender: 'Jen Lawrence',
            body: `Text ${i + 1}`,
            occurredAt: now - hours * HOUR,
        }),
    );
    const dinner = item('calendar:dinner@1', 'calendar', {
        title: 'Dinner',
        calendar: 'Family',
        participants: ['jen@example.com'],
        occurredAt: now - 5 * HOUR,
    });
    const family = [meCard, jenCard, ...texts, dinner];
    const familySources: MacDataSource[] = ['contacts', 'imessage', 'calendar'];
    const meAndJen = (graph: DataGraph) => {
        const me = graph.nodes.find((n) => n.isOwner)!;
        const jen = graph.nodes.find((n) => n.kind === 'person' && n.label === 'Jen Lawrence')!;
        return { me, jen, line: between(graph, me.id, jen.id) };
    };
    const remove = (notebookId: string, id: string) =>
        call(alex, `/api/graph/${notebookId}/links/${encodeURIComponent(id)}`, 'DELETE');

    it('makes a contact card its person, and holds every reason a pair is connected on one line', async () => {
        await upload(familySources, family);
        const { notebookId } = await notebook(familySources);
        await runGraphPass(notebookId);
        const graph = (await graphOf(alex, notebookId)).graph;
        const { me, jen, line } = meAndJen(graph);

        // Contacts aren't nodes of their own: the card's details are Jen's.
        expect(graph.nodes.some((n) => n.source === 'contacts')).toBe(false);
        expect(me.label).toBe('Alex Lawrence');
        expect(jen).toMatchObject({
            kind: 'person',
            itemId: jenCard.id,
            birthday: '1986-02-03',
            organization: 'Albany Med',
            relations: [{ label: 'husband', name: 'Alex' }],
        });
        expect(jen.pageId).toBeTruthy();
        expect(jen.handles).toEqual(expect.arrayContaining(['(518) 555-0123', 'jen@example.com']));

        // One line, many reasons: both cards' relationships first, then what they share.
        const lines = graph.links.filter(
            (l) => [l.source, l.target].sort().join() === [me.id, jen.id].sort().join(),
        );
        expect(lines).toHaveLength(1);
        const kinds = line!.reasons.map((r) => (r.type ? `${r.kind}:${r.type}` : r.kind));
        expect(kinds.slice(0, 2).sort()).toEqual(['relationship:husband', 'relationship:wife']);
        expect(kinds.slice(2).sort()).toEqual(['messages_with', 'met_with']);
        expect(line!.kind).toBe('relationship');
        const wife = line!.reasons.find((r) => r.type === 'wife')!;
        expect(wife).toMatchObject({ from: me.id, to: jen.id, madeBy: 'rule' });
        expect(wife.evidence).toBe("Jen Lawrence is Alex Lawrence's wife");
        const messages = line!.reasons.find((r) => r.kind === 'messages_with')!;
        expect(messages).toMatchObject({
            count: 3,
            evidence: '3 messages',
            firstAt: now - 3 * HOUR,
            lastAt: now - HOUR,
            madeBy: 'rule',
        });
        expect(messages.examples!.map((e) => e.itemId)).toEqual([
            'imessage:t3',
            'imessage:t2',
            'imessage:t1',
        ]);
        expect(line!.weight).toBeGreaterThan(4);
        // Texts aren't a line each.
        expect(graph.nodes.some((n) => n.source === 'imessage')).toBe(false);
        // The dinner is a hub Jen is invited to.
        expect(between(graph, node(alex.id, dinner.id), jen.id)?.kind).toBe('attendee');

        // One reason goes on its own, and stays gone.
        expect((await remove(notebookId, messages.id)).status).toBe(200);
        await runGraphPass(notebookId);
        const after = meAndJen((await graphOf(alex, notebookId)).graph).line!;
        expect(after.reasons.map((r) => r.kind)).not.toContain('messages_with');
        expect(after.reasons.map((r) => r.kind)).toEqual(
            expect.arrayContaining(['relationship', 'met_with']),
        );
        expect(
            await testDb!.collection('graph_relations').findOne({ _id: messages.id as never }),
        ).toMatchObject({ status: 'removed', removedBy: alex.id });
    });

    it('adds new messages to the interaction between full passes, counting none twice', async () => {
        await upload(['contacts', 'imessage'], [meCard, jenCard, ...texts]);
        const { notebookId } = await notebook(['contacts', 'imessage']);
        await runGraphPass(notebookId);
        const interaction = async () =>
            (await testDb!
                .collection('graph_relations')
                .findOne({ notebookId, kind: 'messages_with' }))!;
        expect((await interaction()).count).toBe(3);

        await new Promise((resolve) => setTimeout(resolve, 5));
        const newer = [
            item('imessage:t4', 'imessage', {
                participants: ['+15185550123'],
                body: 'On my way',
                occurredAt: now - 30 * 60,
            }),
            item('imessage:t5', 'imessage', {
                participants: ['+15185550123'],
                body: 'Here',
                occurredAt: now - 10 * 60,
            }),
        ];
        await upload(['contacts', 'imessage'], newer);
        expect(await runIncrementalGraphPass(notebookId)).toMatchObject({ items: 2 });
        const updated = await interaction();
        expect(updated).toMatchObject({
            count: 5,
            evidence: '5 messages',
            firstAt: now - 3 * HOUR,
            lastAt: now - 10 * 60,
        });
        expect(updated.items).toEqual([
            node(alex.id, 'imessage:t5'),
            node(alex.id, 'imessage:t4'),
            node(alex.id, 'imessage:t3'),
            node(alex.id, 'imessage:t2'),
            node(alex.id, 'imessage:t1'),
        ]);

        // The same message uploaded again (a new revision) isn't counted again.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await upload(['contacts', 'imessage'], [{ ...newer[1]!, revision: '2', body: 'Here!' }]);
        await runIncrementalGraphPass(notebookId);
        expect((await interaction()).count).toBe(5);
        // One document for the pair, however many messages.
        expect(
            await testDb!
                .collection('graph_relations')
                .countDocuments({ notebookId, kind: 'messages_with' }),
        ).toBe(1);
        // A full pass counts the window exactly.
        await runGraphPass(notebookId);
        expect((await interaction()).count).toBe(5);
    });

    it('hides relationships in shared notebooks, even ones saved while private, then scrubs them', async () => {
        await upload(familySources, family);
        const { notebookId, pages } = await notebook(familySources);
        await runGraphPass(notebookId);
        const relationships = () =>
            testDb!
                .collection('graph_relations')
                .countDocuments({ notebookId, kind: 'relationship', status: 'active' });
        expect(await relationships()).toBe(2);

        await testDb!.collection('notebooks').updateOne(
            { _id: new ObjectId(notebookId) },
            {
                $push: {
                    'sharing.sharedWith': { userId: sam.id, accessLevel: 'write' },
                } as never,
            },
        );
        for (const source of familySources) await setFilter(pages[source]!, { includeAll: true });
        for (const who of [alex, sam]) {
            const graph = (await graphOf(who, notebookId)).graph;
            const { jen, line } = meAndJen(graph);
            expect(line!.reasons.map((r) => r.kind).sort()).toEqual(['messages_with', 'met_with']);
            expect(jen.relations).toBeUndefined();
            expect(JSON.stringify(graph)).not.toMatch(/husband|wife/);
        }
        const bot = { id: 'bot', name: 'Bot', ownerId: alex.id };
        const ctx = await getMacDataToolContext(alex.id, notebookId, bot);
        const read = await executeMacDataTool(ctx!, 'get_local_item', {
            id: texts[2]!.id,
        });
        expect(read).toContain('3 messages');
        expect(read).not.toMatch(/husband|wife/);

        await runGraphPass(notebookId);
        expect(await relationships()).toBe(0);
    });

    it('keeps relations, removals and About me to their own notebook', async () => {
        await upload(familySources, family);
        const a = await notebook(familySources);
        const b = await notebook(familySources);
        // About me in A: Jen is Alex's best friend too.
        await createPageFixture({
            id: `aboutme-${a.notebookId}`,
            userId: alex.id,
            notebookId: a.notebookId,
            // The fixture's types predate About me pages.
            type: 'aboutme' as never,
            title: 'About me',
        });
        const scope = { userId: alex.id, notebookId: a.notebookId };
        const me = await createEntity(scope, {
            kind: 'person',
            name: 'Alex',
            isMe: true,
        });
        const jen = await createEntity(scope, {
            kind: 'person',
            name: 'Jennifer',
            contactId: jenCard.id,
        });
        await addRelation(scope, me.id, jen.id, 'best friend');
        await runGraphPass(a.notebookId);
        await runGraphPass(b.notebookId);
        const reasonsIn = async (notebookId: string) =>
            meAndJen((await graphOf(alex, notebookId)).graph).line!.reasons;

        expect((await reasonsIn(a.notebookId)).find((r) => r.type === 'best_friend')).toMatchObject(
            {
                madeBy: 'user',
                evidence: expect.stringMatching(
                    /^(Jen Lawrence is Alex Lawrence's|Alex Lawrence is Jen Lawrence's) best friend$/,
                ),
            },
        );
        expect((await reasonsIn(b.notebookId)).some((r) => r.type === 'best_friend')).toBe(false);

        // Removing A's message count leaves B's; B's id can't remove anything through A.
        const messagesA = (await reasonsIn(a.notebookId)).find((r) => r.kind === 'messages_with')!;
        expect(messagesA.id.startsWith(`${a.notebookId}|`)).toBe(true);
        expect((await remove(b.notebookId, messagesA.id)).status).toBe(404);
        expect((await remove(a.notebookId, messagesA.id)).status).toBe(200);
        expect((await reasonsIn(a.notebookId)).some((r) => r.kind === 'messages_with')).toBe(false);
        expect((await reasonsIn(b.notebookId)).some((r) => r.kind === 'messages_with')).toBe(true);
        for (const doc of await testDb!.collection('graph_relations').find({}).toArray())
            expect(String(doc._id).startsWith(`${doc.notebookId}|`)).toBe(true);
    });

    it('tells bots every reason a person in an item is connected', async () => {
        await upload(familySources, family);
        const { notebookId } = await notebook(familySources);
        await runGraphPass(notebookId);
        const bot = { id: 'bot', name: 'Bot', ownerId: alex.id };
        const ctx = await getMacDataToolContext(alex.id, notebookId, bot);
        const read = JSON.parse(
            await executeMacDataTool(ctx!, 'get_local_item', { id: texts[2]!.id }),
        );
        const jen = (
            read.linked as Array<{
                kind: string;
                title?: string;
                link: string;
                reasons: string[];
            }>
        ).find((l) => l.kind === 'person')!;
        expect(jen.title).toBe('Jen Lawrence');
        expect(jen.reasons).toContain('wife');
        expect(jen.link).toMatch(/wife; .*3 messages, last (today|yesterday)/);
        expect(jen.reasons.some((r) => r.startsWith('1 event together'))).toBe(true);
    });

    it('joins items about one happening at a hub instead of pair by pair', async () => {
        const text = item('imessage:party', 'imessage', {
            participants: ['+15185550123'],
            sender: 'Jen Lawrence',
            body: 'Soccer pizza party at the Commons Saturday!',
            occurredAt: now - 3 * HOUR,
        });
        await upload(['contacts', 'imessage', 'mail'], [meCard, jenCard, text, partyMail]);
        const { notebookId } = await notebook(['contacts', 'imessage', 'mail']);
        judge.mockImplementation(async (request: GraphJudgeRequest) => ({
            pairs: request.pairs.map((pair) => ({
                p: pair.p,
                related: true,
                confidence: 0.9,
                reason: 'Same party',
            })),
            topics: [],
            happenings: [
                {
                    name: 'Pizza party',
                    items: request.items.map((i) => i.n),
                    people: ['Jen Lawrence', 'Alex Lawrence'],
                    confidence: 0.9,
                },
            ],
        }));
        await runGraphPass(notebookId);
        expect(judge.mock.calls[0]![0].pairs.length).toBeGreaterThan(0);
        const graph = (await graphOf(alex, notebookId)).graph;
        const hub = graph.nodes.find((n) => n.kind === 'event')!;
        expect(hub.label).toBe('Pizza party');
        for (const id of [text.id, partyMail.id])
            expect(between(graph, node(alex.id, id), hub.id)?.kind).toBe('part_of');
        // No pairwise line: the hub joins them.
        expect(between(graph, node(alex.id, text.id), node(alex.id, partyMail.id))).toBeUndefined();
        const { me, jen } = meAndJen(graph);
        expect(between(graph, hub.id, jen.id)).toMatchObject({
            kind: 'attendee',
            madeBy: 'model',
        });
        expect(between(graph, hub.id, me.id)).toBeUndefined();
    });

    // MARK: - Migration

    it('moves links from before reasons into relations, keeping removals and person ids', async () => {
        const dana = item('contacts:dana', 'contacts', {
            title: 'Coach Dana',
            extra: { phones: [{ label: 'mobile', value: '(518) 555-0199' }] },
        });
        const practice = item('calendar:practice@1', 'calendar', {
            title: 'Practice',
            participants: ['+15185550199'],
            occurredAt: now + 2 * HOUR,
        });
        await upload(['calendar', 'location', 'contacts'], [visit, followUp, dana, practice]);
        const { notebookId } = await notebook(['calendar', 'location', 'contacts']);
        const n = (id: string) => node(alex.id, id);
        const pairOf = (x: string, y: string) => `${notebookId}|${[x, y].sort().join('|')}`;
        // The graph as it was: one link per pair, and Dana's person with an earlier id merged in.
        await testDb!.collection('graph_nodes').insertOne({
            _id: `${notebookId}|person:keep` as never,
            notebookId,
            id: 'person:keep',
            kind: 'person',
            label: 'Coach Dana',
            handles: ['+15185550199'],
            aliases: ['person:gone'],
            updatedAt: new Date(0),
        });
        const legacy = (x: string, y: string, fields: Record<string, unknown>) => {
            const [a, b] = [x, y].sort();
            return {
                _id: pairOf(x, y) as never,
                notebookId,
                a,
                b,
                confidence: 1,
                evidence: 'Old',
                madeBy: 'rule',
                createdAt: new Date(0),
                updatedAt: new Date(0),
                ...fields,
            };
        };
        await testDb!.collection('graph_links').insertMany([
            legacy(n(followUp.id), n(visit.id), {
                kind: 'created_at',
                status: 'removed',
                removedBy: alex.id,
            }),
            legacy(n(practice.id), 'person:gone', {
                kind: 'person',
                status: 'removed',
            }),
            legacy(n(dana.id), 'person:keep', { kind: 'person', status: 'active' }),
            legacy(n('imessage:x'), 'person:keep', {
                kind: 'person',
                status: 'active',
            }),
            // Rejections are forgotten after 90 days; this one is recent.
            legacy(n('mail:a'), n('calendar:b'), {
                kind: 'related',
                status: 'rejected',
                confidence: 0,
                madeBy: 'model',
                updatedAt: new Date(),
            }),
            legacy(n('mail:c'), 'topic:t', {
                kind: 'topic',
                status: 'active',
                madeBy: 'model',
                confidence: 0.9,
            }),
        ]);

        await runGraphPass(notebookId);
        const relations = testDb!.collection('graph_relations');
        // Nothing is deleted: every old link is still there, marked as copied.
        expect(
            await testDb!
                .collection('graph_links')
                .countDocuments({ notebookId, migratedAt: { $exists: true } }),
        ).toBe(6);
        expect(
            await relations.findOne({
                _id: `${pairOf(n(followUp.id), n(visit.id))}|created_at` as never,
            }),
        ).toMatchObject({ status: 'removed', blocksPair: true, removedBy: alex.id });
        expect(
            await relations.findOne({ pair: pairOf(n(practice.id), 'person:gone') }),
        ).toMatchObject({ kind: 'attendee', status: 'removed', blocksPair: true });
        expect(
            await relations.findOne({ pair: pairOf(n('mail:a'), n('calendar:b')) }),
        ).toMatchObject({ kind: 'related', status: 'rejected' });
        expect(await relations.findOne({ pair: pairOf(n('mail:c'), 'topic:t') })).toMatchObject({
            kind: 'topic',
            status: 'active',
            madeBy: 'model',
        });
        // A card is its person now, and messages are counted: neither is a relation of its own.
        expect(await relations.countDocuments({ notebookId, kind: 'person' })).toBe(0);
        expect(
            await testDb!.collection('graph_state').findOne({ _id: notebookId as never }),
        ).toMatchObject({ relationsMigratedAt: expect.any(Date) });

        // Removed stays removed: the rules don't bring back the visit link, or Dana at
        // practice under her current id.
        const graph = (await graphOf(alex, notebookId)).graph;
        expect(between(graph, n(followUp.id), n(visit.id))).toBeUndefined();
        expect(between(graph, n(practice.id), 'person:keep')).toBeUndefined();
        // Dana keeps her id, and her card is hers.
        expect(
            await testDb!
                .collection('graph_nodes')
                .findOne({ _id: `${notebookId}|person:keep` as never }),
        ).toMatchObject({ aliases: ['person:gone'], contactIds: [n(dana.id)] });
        expect(graph.nodes.find((x) => x.id === 'person:keep')).toMatchObject({
            itemId: dana.id,
        });

        // Running it again copies nothing twice.
        const before = await relations.countDocuments({
            notebookId,
            status: 'removed',
        });
        await testDb!
            .collection('graph_state')
            .updateMany({}, { $unset: { relationsMigratedAt: '' } });
        await runGraphPass(notebookId);
        expect(await relations.countDocuments({ notebookId, status: 'removed' })).toBe(before);
    });
    // MARK: - Review fixes

    it('copies every older removal first, so it wins over a relation the rules made since', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const { notebookId } = await notebook(['calendar', 'location']);
        const n = (id: string) => node(alex.id, id);
        const [a, b] = [n(followUp.id), n(visit.id)].sort();
        const pair = `${notebookId}|${a}|${b}`;
        const relations = testDb!.collection('graph_relations');
        // The rules already rebuilt the link as active before its removal was copied.
        await relations.insertOne({
            _id: `${pair}|created_at` as never,
            notebookId,
            pair,
            a,
            b,
            kind: 'created_at',
            key: 'created_at',
            confidence: 1,
            evidence: 'Created while at Bright Smiles Dental',
            madeBy: 'rule',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const legacy = (x: string, y: string, fields: Record<string, unknown>) => {
            const [la, lb] = [x, y].sort();
            return {
                _id: `${notebookId}|${la}|${lb}` as never,
                notebookId,
                a: la,
                b: lb,
                kind: 'related',
                confidence: 0.9,
                evidence: 'Old',
                madeBy: 'model',
                status: 'active',
                createdAt: new Date(0),
                updatedAt: new Date(0),
                ...fields,
            };
        };
        await testDb!.collection('graph_links').insertMany([
            legacy(n('mail:1'), n('calendar:1'), {}),
            legacy(n('mail:2'), n('calendar:2'), {}),
            legacy(n('mail:3'), n('calendar:3'), {}),
            // Last in the collection, and already marked copied by an earlier pass.
            legacy(n(followUp.id), n(visit.id), {
                kind: 'created_at',
                madeBy: 'rule',
                status: 'removed',
                removedBy: alex.id,
                migratedAt: new Date(),
            }),
        ]);

        // One small batch: not done yet, but the removal is already in force.
        expect(await migrateLegacyGraphLinks(notebookId, 1, 1)).toBe(false);
        expect(await relations.findOne({ _id: `${pair}|created_at` as never })).toMatchObject({
            status: 'removed',
            blocksPair: true,
            removedBy: alex.id,
        });
        expect(
            await testDb!.collection('graph_links').countDocuments({
                notebookId,
                migratedAt: { $exists: false },
            }),
        ).toBe(2);

        // The pass finishes the copy, and only then marks the notebook migrated.
        await runGraphPass(notebookId);
        expect(
            await testDb!.collection('graph_state').findOne({ _id: notebookId as never }),
        ).toMatchObject({ relationsMigratedAt: expect.any(Date) });
        expect(await relations.countDocuments({ notebookId, pair, status: 'active' })).toBe(0);
        expect(
            between((await graphOf(alex, notebookId)).graph, n(followUp.id), n(visit.id)),
        ).toBeUndefined();
    });

    it("keeps each member's tally apart, and removes both when the reason is removed", async () => {
        const { notebookId } = await notebook([]);
        const tally = (ownerId: string, a: string, b: string) =>
            interactionInput({
                a,
                b,
                ownerId,
                kind: 'messages_with',
                items: [{ id: node(ownerId, 'imessage:1'), at: now, part: 'imessage:dm' }],
            });
        const fromAlex = tally('alex', 'person:alex', 'person:jen');
        const fromJen = tally('jen', 'person:jen', 'person:alex');
        expect(await saveGraphRelations(notebookId, [fromAlex, fromJen])).toBe(2);
        const relations = testDb!.collection('graph_relations');
        expect(await relations.countDocuments({ notebookId, kind: 'messages_with' })).toBe(2);
        expect(
            await removeGraphRelation(notebookId, relationId(notebookId, fromAlex), alex.id),
        ).toBe(true);
        expect(
            await relations.countDocuments({
                notebookId,
                kind: 'messages_with',
                status: 'removed',
            }),
        ).toBe(2);
    });

    it('blocks the pair when a whole line is removed, so no new reason brings it back', async () => {
        await upload(familySources, family);
        const { notebookId } = await notebook(familySources);
        await runGraphPass(notebookId);
        const { line } = meAndJen((await graphOf(alex, notebookId)).graph);
        expect((await remove(notebookId, line!.id)).status).toBe(200);
        const relations = testDb!.collection('graph_relations');
        expect(
            await relations.countDocuments({ notebookId, pair: line!.id, blocksPair: true }),
        ).toBeGreaterThan(0);

        // A new email and a new event together, through both kinds of pass.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await upload(
            [...familySources, 'mail'],
            [
                item('mail:hello', 'mail', {
                    sender: 'Jen Lawrence <jen@example.com>',
                    participants: ['alex@example.com'],
                    occurredAt: now - 10 * 60,
                }),
                item('calendar:lunch@1', 'calendar', {
                    title: 'Lunch',
                    participants: ['jen@example.com'],
                    occurredAt: now - 20 * 60,
                }),
            ],
        );
        await runIncrementalGraphPass(notebookId);
        await runGraphPass(notebookId);
        const after = (await graphOf(alex, notebookId)).graph;
        expect(between(after, line!.source, line!.target)).toBeUndefined();
        expect(
            await relations.countDocuments({ notebookId, pair: line!.id, status: 'active' }),
        ).toBe(0);
    });

    it('drops people no longer found, but keeps one a removal names', async () => {
        await upload(familySources, family);
        const { notebookId } = await notebook(familySources);
        const nodes = testDb!.collection('graph_nodes');
        const relations = testDb!.collection('graph_relations');
        for (const id of ['person:stale', 'person:held'])
            await nodes.insertOne({
                _id: `${notebookId}|${id}` as never,
                notebookId,
                id,
                kind: 'person',
                label: id,
                handles: [`+1999555${id.length}`],
                updatedAt: new Date(0),
            });
        const event = node(alex.id, dinner.id);
        const doc = (b: string, status: string) => {
            const [x, y] = [event, b].sort();
            return {
                _id: `${notebookId}|${x}|${y}|attendee` as never,
                notebookId,
                pair: `${notebookId}|${x}|${y}`,
                a: x,
                b: y,
                kind: 'attendee',
                key: 'attendee',
                confidence: 0.9,
                evidence: 'Was there',
                madeBy: 'model',
                status,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        };
        await relations.insertMany([doc('person:stale', 'active'), doc('person:held', 'removed')]);

        await runGraphPass(notebookId);
        expect(await nodes.findOne({ _id: `${notebookId}|person:stale` as never })).toBeNull();
        expect(await relations.countDocuments({ notebookId, b: 'person:stale' })).toBe(0);
        // Should they come back, their id still carries the removal.
        expect(await nodes.findOne({ _id: `${notebookId}|person:held` as never })).not.toBeNull();
        expect(
            await relations.countDocuments({ notebookId, b: 'person:held', status: 'removed' }),
        ).toBe(1);
    });

    it('counts only the chats a reader sees, for the viewer and for bots', async () => {
        const inChat = (id: string, thread: string, hours: number, others: string[] = []) =>
            item(`imessage:${id}`, 'imessage', {
                thread,
                participants: ['+15185550123', ...others],
                body: id,
                occurredAt: now - hours * HOUR,
            });
        const direct = [5, 4, 3].map((h) => inChat(`dm${h}`, 'Jen Lawrence', h));
        // The five newest are in the group chat: the line's examples are all from there.
        const group = [2.5, 2, 1.5, 1, 0.5].map((h) =>
            inChat(`group${h}`, 'Soccer parents', h, ['+15185550177']),
        );
        await upload(['contacts', 'imessage'], [meCard, jenCard, ...direct, ...group]);
        const { notebookId, pages } = await notebook(['contacts', 'imessage']);
        await runGraphPass(notebookId);
        const messages = async () =>
            meAndJen((await graphOf(alex, notebookId)).graph).line?.reasons.find(
                (r) => r.kind === 'messages_with',
            );
        expect(await messages()).toMatchObject({ count: 8, evidence: '8 messages' });

        await setFilter(pages.imessage!, { chats: [{ name: 'Jen Lawrence' }] });
        // The line stays though none of its examples can be seen, with only the chat's share.
        const seen = await messages();
        expect(seen).toMatchObject({
            count: 3,
            evidence: '3 messages',
            firstAt: now - 5 * HOUR,
            lastAt: now - 3 * HOUR,
        });
        expect(seen!.examples).toBeUndefined();

        const ctx = await getMacDataToolContext(alex.id, notebookId, {
            id: 'bot',
            name: 'Bot',
            ownerId: alex.id,
        });
        const read = JSON.parse(
            await executeMacDataTool(ctx!, 'get_local_item', { id: direct[2]!.id }),
        );
        const jen = (read.linked as Array<{ kind: string; link: string }>).find(
            (l) => l.kind === 'person',
        )!;
        expect(jen.link).toContain('3 messages');
        expect(jen.link).not.toContain('8 messages');
    });

    it('counts events in the future once, whatever order they arrive in', async () => {
        const sources: MacDataSource[] = ['contacts', 'calendar'];
        const event = (id: string, days: number, revision = '1') =>
            item(`calendar:${id}@1`, 'calendar', {
                title: id,
                revision,
                participants: ['jen@example.com'],
                occurredAt: now + days * 24 * HOUR,
            });
        await upload(sources, [meCard, jenCard, event('trip', 10)]);
        const { notebookId } = await notebook(sources);
        await runGraphPass(notebookId);
        const together = async () =>
            (await testDb!
                .collection('graph_relations')
                .findOne({ notebookId, kind: 'met_with' }))!;
        expect((await together()).count).toBe(1);

        // An event sooner than the one already counted still counts.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await upload(sources, [event('dinner', 2)]);
        await runIncrementalGraphPass(notebookId);
        expect((await together()).count).toBe(2);
        // The far one edited and uploaded again isn't counted twice.
        await new Promise((resolve) => setTimeout(resolve, 5));
        await upload(sources, [event('trip', 10, '2')]);
        await runIncrementalGraphPass(notebookId);
        expect((await together()).count).toBe(2);
        // And a full pass agrees.
        await runGraphPass(notebookId);
        expect((await together()).count).toBe(2);
    });

    it('keeps one symmetric relationship per pair, the same way round each pass', async () => {
        const spouses = [
            {
                ...meCard,
                extra: { ...meCard.extra, relations: [{ label: 'spouse', name: 'Jen' }] },
            },
            {
                ...jenCard,
                extra: { ...jenCard.extra, relations: [{ label: 'spouse', name: 'Alex' }] },
            },
        ];
        await upload(['contacts', 'imessage'], [...spouses, ...texts]);
        const { notebookId } = await notebook(['contacts', 'imessage']);
        const stored = () =>
            testDb!
                .collection('graph_relations')
                .find({ notebookId, kind: 'relationship' })
                .toArray();
        await runGraphPass(notebookId);
        const first = await stored();
        expect(first).toHaveLength(1);
        expect(first[0]!.items).toEqual(
            [node(alex.id, meCard.id), node(alex.id, jenCard.id)].sort(),
        );
        expect(first[0]!.from < first[0]!.to).toBe(true);
        await runGraphPass(notebookId);
        const second = await stored();
        expect(second).toHaveLength(1);
        expect(second[0]).toMatchObject({
            from: first[0]!.from,
            to: first[0]!.to,
            evidence: first[0]!.evidence,
        });
    });
});
