import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createNotebookFixture,
    createPageFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
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
import { getDataGraph, graphTick, runGraphPass } from '../../services/graph.service';
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
        await testDb!
            .collection('graph_state')
            .updateOne(
                { _id: b.notebookId as never },
                { $unset: { backfilledAt: '', backfillBefore: '' } },
            );
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

    it('drops links from reads the moment a filter stops sharing an item, then cleans them up', async () => {
        await upload(['calendar', 'location'], [visit, followUp]);
        const { notebookId, pages } = await notebook(['calendar', 'location']);
        await runGraphPass(notebookId);
        const appointment = node(alex.id, followUp.id);
        expect(
            (await graphOf(alex, notebookId)).graph.nodes.some((n) => n.id === appointment),
        ).toBe(true);

        await setFilter(pages.calendar!, { calendars: [{ name: 'Work' }] });
        const after = (await graphOf(alex, notebookId)).graph;
        expect(after.nodes.some((n) => n.id === appointment)).toBe(false);
        expect(after.links.some((l) => l.source === appointment || l.target === appointment)).toBe(
            false,
        );

        // The cleanup runs behind the read.
        await vi.waitFor(async () => {
            const left = await testDb!
                .collection('graph_links')
                .countDocuments({ notebookId, $or: [{ a: appointment }, { b: appointment }] });
            expect(left).toBe(0);
        });
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
});
