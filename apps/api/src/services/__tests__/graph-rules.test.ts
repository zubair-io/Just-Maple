import { describe, expect, it } from 'vitest';
import type { MacDataItem, MacDataSource, TravelEstimate } from '@maple/shared';
import {
    aboutMeRelationships,
    happeningNodeId,
    incrementalRuleLinks,
    locationKeys,
    matchPersonByName,
    modelCandidates,
    normalizeHandle,
    normalizeRelationType,
    ruleGraph,
    type GraphItem,
    type KnownHubs,
} from '../graph-rules';
import { linkKey } from '../../repositories/graph.repo';
import { parseJudgement } from '../graph-model.service';

const HOUR = 3600;
const now = 1_790_000_000;

function entry(
    id: string,
    source: MacDataSource,
    fields: Partial<MacDataItem> = {},
    ownerId = 'owner1',
): GraphItem {
    return {
        nodeId: `item:${ownerId}:${id}`,
        ownerId,
        pageId: `page-${source}`,
        item: {
            id,
            source,
            revision: '1',
            occurredAt: now,
            participants: [],
            body: '',
            ...fields,
        },
    };
}

const visit = entry('location:visit:1', 'location', {
    occurredAt: now - 2 * HOUR,
    endAt: now - HOUR,
    title: 'Bright Smiles Dental',
    location: '12 Main St, Albany, NY',
    extra: { lat: 42.65, lon: -73.75, place: 'Bright Smiles Dental' },
});
const followUp = entry('calendar:follow-up@1', 'calendar', {
    occurredAt: now + 14 * 24 * HOUR,
    endAt: now + 14 * 24 * HOUR + HOUR,
    title: 'Dentist',
    location: 'Bright Smiles Dental\n12 Main Street, Albany NY 12207',
    extra: { createdAt: new Date((now - 1.5 * HOUR) * 1000).toISOString() },
});
const cleaning = entry('calendar:cleaning@1', 'calendar', {
    occurredAt: now - 1.75 * HOUR,
    endAt: now - 1.25 * HOUR,
    title: 'Cleaning',
    location: '12 Main St., Albany',
});

const link = (graph: ReturnType<typeof ruleGraph>, a: string, b: string) =>
    graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

describe('graph rules', () => {
    it('links a dental appointment made at the office to the visit, the place and the drive', () => {
        const travel = new Map<string, TravelEstimate>([
            [
                `owner1:${followUp.item.id}`,
                { eventId: followUp.item.id, minutes: 18, origin: 'Home', computedAt: '' },
            ],
        ]);
        const graph = ruleGraph([visit, followUp, cleaning], { travel, shared: false });

        const place = graph.nodes.find(
            (node) => node.kind === 'place' && node.label === 'Bright Smiles Dental',
        );
        expect(place).toBeDefined();
        expect(link(graph, visit.nodeId, place!.id)?.kind).toBe('at_place');
        expect(link(graph, followUp.nodeId, place!.id)?.kind).toBe('at_place');
        expect(link(graph, followUp.nodeId, visit.nodeId)).toMatchObject({
            kind: 'created_at',
            confidence: 1,
            madeBy: 'rule',
            evidence: 'Created while at Bright Smiles Dental',
        });
        expect(link(graph, cleaning.nodeId, visit.nodeId)?.kind).toBe('attended');
        const drive = graph.links.find((l) => l.kind === 'travel');
        expect(drive).toMatchObject({ a: followUp.nodeId, evidence: '18 min drive from Home' });
    });

    it('keeps where someone drove from out of shared notebooks', () => {
        const travel = new Map<string, TravelEstimate>([
            [
                `owner1:${followUp.item.id}`,
                { eventId: followUp.item.id, minutes: 18, origin: 'Home', computedAt: '' },
            ],
        ]);
        const graph = ruleGraph([visit, followUp], { travel, shared: true });
        expect(graph.links.some((l) => l.kind === 'travel')).toBe(false);
        expect(graph.nodes.some((n) => n.label === 'Home')).toBe(false);
    });

    it("doesn't link a visit somewhere else, or one by another person", () => {
        const elsewhere = entry('location:visit:2', 'location', {
            occurredAt: now - 2 * HOUR,
            endAt: now - HOUR,
            title: 'Grocery',
            location: '400 State St, Albany, NY',
            extra: { lat: 42.6, lon: -73.8 },
        });
        const theirs = entry('location:visit:1', 'location', { ...visit.item }, 'owner2');
        const graph = ruleGraph([elsewhere, theirs, followUp], { shared: false });
        expect(link(graph, followUp.nodeId, elsewhere.nodeId)).toBeUndefined();
        expect(link(graph, followUp.nodeId, theirs.nodeId)).toBeUndefined();
    });

    it('joins one person across phone and email through their contact card, which is no node', () => {
        const card = entry('contacts:greyson', 'contacts', {
            title: 'Greyson Lawrence',
            extra: {
                phones: [{ label: 'mobile', value: '(518) 555-0142' }],
                emails: [{ label: 'home', value: 'Greyson@Example.com' }],
            },
        });
        const text = entry('imessage:1', 'imessage', {
            sender: 'Greyson Lawrence',
            participants: ['+15185550142'],
            body: 'Soccer pizza party after the game!',
        });
        const mail = entry('mail:1', 'mail', {
            sender: 'Greyson Lawrence <greyson@example.com>',
            participants: ['me@example.com'],
            title: 'Pizza party',
        });
        const graph = ruleGraph([card, text, mail], {
            shared: false,
            owners: new Map([['owner1', 'Alex']]),
        });
        const people = graph.nodes.filter((n) => n.kind === 'person');
        const greyson = people.find((p) => p.label === 'Greyson Lawrence')!;
        const me = people.find((p) => p.ownerId === 'owner1')!;
        expect(me.label).toBe('Alex');
        expect(people).toHaveLength(2);
        // The card is Greyson's details: no item node, no line to it.
        expect(greyson.contactIds).toEqual([card.nodeId]);
        expect(graph.links.some((l) => l.a === card.nodeId || l.b === card.nodeId)).toBe(false);
        // Messages and email aren't a line each: one interaction per kind for the pair.
        expect(graph.links.some((l) => l.kind === 'person')).toBe(false);
        expect(graph.interactions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    a: me.id,
                    b: greyson.id,
                    kind: 'messages_with',
                    items: [{ id: text.nodeId, at: now }],
                }),
                expect.objectContaining({ a: me.id, b: greyson.id, kind: 'emails_with' }),
            ]),
        );
        expect(graph.peopleOf.get(mail.nodeId)).toEqual(new Set([greyson.id]));
    });

    it('makes the member their own person through their me card', () => {
        const myCard = entry('contacts:me', 'contacts', {
            title: 'Alex Lawrence',
            extra: { isMe: true, emails: [{ label: 'home', value: 'me@example.com' }] },
        });
        const sent = entry('mail:2', 'mail', {
            isFromMe: true,
            sender: 'Alex Lawrence <me@example.com>',
            participants: ['me@example.com', 'Coach Dana <dana@club.org>'],
        });
        const reply = entry('mail:3', 'mail', {
            sender: 'Coach Dana <dana@club.org>',
            participants: ['me@example.com'],
        });
        const graph = ruleGraph([myCard, sent, reply], {
            shared: false,
            owners: new Map([['owner1', 'Alex']]),
        });
        const me = graph.nodes.find((n) => n.ownerId === 'owner1')!;
        expect(me.label).toBe('Alex Lawrence');
        expect(me.contactIds).toEqual([myCard.nodeId]);
        expect(me.handles).toContain('me@example.com');
        // Dana emails, but isn't texted and has no card: no person, so no interaction.
        expect(graph.nodes.find((n) => n.label === 'Coach Dana')).toBeUndefined();
        // Nobody is linked to themselves.
        expect(graph.interactions.every((t) => t.a !== t.b)).toBe(true);
    });

    it('joins a texted handle and an email sender by name without a contacts page', () => {
        const text = entry('imessage:1', 'imessage', {
            sender: 'Coach Dana',
            participants: ['+15185550199'],
        });
        const mail = entry('mail:1', 'mail', {
            sender: 'Coach Dana <dana@club.org>',
        });
        const newsletter = entry('mail:2', 'mail', {
            sender: 'Deals <deals@store.com>',
        });
        const graph = ruleGraph([text, mail, newsletter], { shared: false });
        const people = graph.nodes.filter((n) => n.kind === 'person' && !n.ownerId);
        expect(people.map((p) => p.label)).toEqual(['Coach Dana']);
        const emails = graph.interactions.find((t) => t.kind === 'emails_with')!;
        expect(emails.b).toBe(people[0]!.id);
        expect(emails.items.map((i) => i.id)).toEqual([mail.nodeId]);
    });

    it('makes events hubs their invitees link to, and counts them as time together', () => {
        const card = entry('contacts:greyson', 'contacts', {
            title: 'Greyson',
            extra: { phones: [{ label: 'mobile', value: '(518) 555-0142' }] },
        });
        const jen = entry('contacts:jen', 'contacts', {
            title: 'Jen',
            extra: { emails: [{ label: 'home', value: 'jen@example.com' }] },
        });
        const party = entry('calendar:party@1', 'calendar', {
            title: 'Pizza party',
            participants: ['+15185550142', 'jen@example.com'],
        });
        const graph = ruleGraph([card, jen, party], { shared: false });
        const ids = graph.nodes.filter((n) => n.kind === 'person' && !n.ownerId).map((n) => n.id);
        expect(ids).toHaveLength(2);
        for (const id of ids) expect(link(graph, party.nodeId, id)?.kind).toBe('attendee');
        // The two guests aren't linked to each other: the event joins them.
        expect(link(graph, ids[0]!, ids[1]!)).toBeUndefined();
        expect(graph.interactions.filter((t) => t.kind === 'met_with')).toHaveLength(2);
    });

    it("turns a card's related names into relationships, with their direction", () => {
        const myCard = entry('contacts:me', 'contacts', {
            title: 'Zubair Lawrence',
            extra: {
                isMe: true,
                phones: [{ label: 'mobile', value: '(518) 555-0100' }],
                relations: [{ label: 'spouse', name: 'Julia Lawrence' }],
            },
        });
        const julia = entry('contacts:julia', 'contacts', {
            title: 'Julia Lawrence',
            extra: {
                phones: [{ label: 'mobile', value: '(518) 555-0101' }],
                relations: [
                    { label: 'spouse', name: 'Zubair' },
                    { label: 'daughter', name: 'Emma' },
                ],
            },
        });
        const emma = entry('contacts:emma', 'contacts', { title: 'Emma Lawrence' });
        const graph = ruleGraph([myCard, julia, emma], { shared: false });
        const id = (label: string) => graph.nodes.find((n) => n.label === label)!.id;
        const relationships = graph.links.filter((l) => l.kind === 'relationship');
        expect(
            relationships
                .filter((l) => l.type === 'spouse')
                .map((l) => l.evidence)
                .sort(),
        ).toEqual([
            "Julia Lawrence is Zubair Lawrence's spouse",
            "Zubair Lawrence is Julia Lawrence's spouse",
        ]);
        expect(relationships.find((l) => l.type === 'daughter')).toMatchObject({
            from: id('Julia Lawrence'),
            to: id('Emma Lawrence'),
            madeBy: 'rule',
            items: [julia.nodeId],
        });
        // A card with no phone or email is still someone.
        expect(graph.nodes.find((n) => n.label === 'Emma Lawrence')?.contactIds).toEqual([
            emma.nodeId,
        ]);

        // Relationships are private: none in a shared notebook.
        const shared = ruleGraph([myCard, julia, emma], { shared: true });
        expect(shared.links.some((l) => l.kind === 'relationship')).toBe(false);
    });

    it('reads relationships from About me between people the graph has', () => {
        const people = [
            { id: 'person:me', label: 'Alex', ownerId: 'owner1' },
            {
                id: 'person:emma',
                label: 'Emma Lawrence',
                contactIds: ['item:owner1:contacts:e'],
            },
            { id: 'person:dana', label: 'Dana Smith' },
        ];
        const entity = (id: string, name: string, extra = {}) => ({
            id,
            kind: 'person' as const,
            name,
            aliases: [],
            createdAt: '',
            updatedAt: '',
            ...extra,
        });
        const relations = aboutMeRelationships({
            ownerId: 'owner1',
            people,
            entities: [
                entity('me', 'Alex', { isMe: true }),
                entity('e', 'Em', { contactId: 'contacts:e' }),
                entity('d', 'Dana Smith'),
                entity('x', 'Nobody Here'),
            ],
            relations: [
                { id: 'r1', from: 'me', to: 'e', type: 'child', createdAt: '' },
                { id: 'r2', from: 'me', to: 'd', type: 'Dentist', createdAt: '' },
                { id: 'r3', from: 'me', to: 'x', type: 'friend', createdAt: '' },
            ],
        });
        expect(relations).toEqual([
            expect.objectContaining({
                from: 'person:me',
                to: 'person:emma',
                type: 'child',
                madeBy: 'user',
                evidence: "Emma Lawrence is Alex's child",
            }),
            expect.objectContaining({ to: 'person:dana', type: 'dentist' }),
        ]);
    });

    it('matches names, relation types and happenings', () => {
        const people = [
            { id: 'a', label: 'Zubair Lawrence' },
            { id: 'b', label: 'Julia Lawrence' },
            { id: 'c', label: 'Julia Smith' },
        ];
        expect(matchPersonByName('Zubair', people)).toBe('a');
        expect(matchPersonByName('julia lawrence', people)).toBe('b');
        expect(matchPersonByName('Julia', people)).toBeNull();
        expect(matchPersonByName('Zubair', people, 'a')).toBeNull();
        expect(normalizeRelationType('_$!<Spouse>!$_')).toBe('spouse');
        expect(normalizeRelationType('Best Friend')).toBe('best_friend');
        expect(normalizeRelationType('')).toBe('related');
        const at = 1_790_000_000;
        const first = happeningNodeId('Pizza party', at, []);
        const known = [{ id: first, label: 'Pizza party', at }];
        expect(happeningNodeId('pizza  party', at + 86_400, known)).toBe(first);
        expect(happeningNodeId('Pizza party', at + 30 * 86_400, known)).not.toBe(first);
    });
    it('normalizes handles and locations', () => {
        expect(normalizeHandle('(518) 555-0142')).toBe('+15185550142');
        expect(normalizeHandle('Ann <Ann@Example.com>')).toBe('ann@example.com');
        expect(normalizeHandle('Ann')).toBeNull();
        expect([...locationKeys('Bright Smiles Dental, 12 Main Street')]).toContain(
            'street:12 main st',
        );
    });
});

describe('model candidates', () => {
    const party = entry('mail:party', 'mail', {
        occurredAt: now - 2 * 24 * HOUR,
        title: "Greyson's soccer pizza party",
        body: 'Pizza party at Riverside field after Saturday’s game, 6pm.',
    });
    const event = entry('calendar:party@1', 'calendar', {
        occurredAt: now + 24 * HOUR,
        title: 'Soccer pizza party',
        location: 'Riverside field',
    });
    const unrelated = entry('calendar:taxes@1', 'calendar', {
        occurredAt: now,
        title: 'Quarterly review',
    });
    const fillers = Array.from({ length: 20 }, (_, i) =>
        entry(`imessage:f${i}`, 'imessage', { body: `filler number ${i} about lunch plans` }),
    );
    const items = [party, event, unrelated, ...fillers];
    const empty = {
        nodes: [],
        links: [],
        interactions: [],
        placeOf: new Map(),
        peopleOf: new Map(),
        personOf: new Map(),
        ownerPerson: new Map(),
    };

    it('pairs the party email with its event', () => {
        const found = modelCandidates(
            'nb',
            items,
            new Set([party.nodeId]),
            { rules: empty, decided: new Set() },
            10,
        );
        expect(found[0]).toMatchObject({ a: party, b: event });
        expect(found.some((c) => c.b === unrelated)).toBe(false);
    });

    it('skips pairs already decided (linked, removed or rejected)', () => {
        const decided = new Set([linkKey('nb', party.nodeId, event.nodeId)]);
        const found = modelCandidates(
            'nb',
            items,
            new Set([party.nodeId]),
            { rules: empty, decided },
            10,
        );
        expect(found.some((c) => c.b === event)).toBe(false);
    });

    it('only asks about focus items, and no more than asked', () => {
        expect(
            modelCandidates('nb', items, new Set(), { rules: empty, decided: new Set() }, 10),
        ).toHaveLength(0);
        expect(
            modelCandidates(
                'nb',
                items,
                new Set(items.map((i) => i.nodeId)),
                { rules: empty, decided: new Set() },
                1,
            ),
        ).toHaveLength(1);
    });
});

describe('stable people and places', () => {
    const card = (phones: string[]) =>
        entry('contacts:dana', 'contacts', {
            title: 'Coach Dana',
            extra: { phones: phones.map((value) => ({ label: 'mobile', value })) },
        });
    const text = entry('imessage:1', 'imessage', {
        sender: 'Coach Dana',
        participants: ['+15185550199'],
    });
    const knownFrom = (graph: ReturnType<typeof ruleGraph>): KnownHubs => {
        const personOf = new Map<string, string>();
        const people = new Map<string, string>();
        const ownerPerson = new Map<string, string>();
        for (const node of graph.nodes) {
            if (node.kind !== 'person') continue;
            people.set(node.id, node.label);
            if (node.ownerId) ownerPerson.set(node.ownerId, node.id);
            for (const handle of node.handles ?? []) personOf.set(handle, node.id);
        }
        return {
            personOf,
            people,
            ownerPerson,
            places: graph.nodes.filter((n) => n.kind === 'place'),
        };
    };

    it("keeps a person's id when their contact card gains a number", () => {
        const before = ruleGraph([card(['(518) 555-0199']), text], { shared: false });
        const id = before.nodes.find((n) => n.kind === 'person' && !n.ownerId)!.id;
        // The new number sorts first: without the known ids, the person would get a new id.
        const after = ruleGraph([card(['(212) 555-0100', '(518) 555-0199']), text], {
            shared: false,
            known: knownFrom(before),
        });
        const people = after.nodes.filter((n) => n.kind === 'person' && !n.ownerId);
        expect(people.map((p) => p.id)).toEqual([id]);
        expect(people[0]!.handles).toContain('+12125550100');
        expect(
            ruleGraph([card(['(212) 555-0100', '(518) 555-0199']), text], {
                shared: false,
            }).nodes.find((n) => n.kind === 'person' && !n.ownerId)!.id,
        ).not.toBe(id);
    });

    it('keeps one id when two people merge, and lists the other as an alias', () => {
        const other = entry('imessage:2', 'imessage', {
            sender: 'Dana Smith',
            participants: ['+15185550142'],
        });
        const before = ruleGraph([text, other], { shared: false });
        const ids = before.nodes
            .filter((n) => n.kind === 'person' && !n.ownerId)
            .map((n) => n.id)
            .sort();
        expect(ids).toHaveLength(2);
        const after = ruleGraph([card(['(518) 555-0199', '(518) 555-0142']), text, other], {
            shared: false,
            known: knownFrom(before),
        });
        const people = after.nodes.filter((n) => n.kind === 'person' && !n.ownerId);
        expect(people).toHaveLength(1);
        expect(people[0]!.id).toBe(ids[0]);
        expect(people[0]!.aliases).toEqual([ids[1]]);
    });

    it('matches an event to the same place whatever order the visits came in', () => {
        const named = entry('location:visit:a', 'location', {
            title: 'Riverside Field',
            location: '40 River Rd, Albany, NY',
            extra: { lat: 42.66, lon: -73.73 },
        });
        const nearby = entry('location:visit:b', 'location', {
            title: 'Riverside Field',
            location: 'Riverside Field',
            extra: { lat: 42.7, lon: -73.7 },
        });
        const game = entry('calendar:game@1', 'calendar', {
            title: 'Game',
            location: 'Riverside Field, 40 River Rd, Albany NY',
        });
        const placeOf = (items: GraphItem[]) =>
            ruleGraph(items, { shared: false }).placeOf.get(game.nodeId);
        expect(placeOf([named, nearby, game])).toBe(placeOf([nearby, named, game]));
        // The street address is the stronger match than the name alone.
        expect(placeOf([nearby, named, game])).toBe(
            ruleGraph([named], { shared: false }).placeOf.get(named.nodeId),
        );
    });

    it('links new uploads to the people and places already known', () => {
        const full = ruleGraph([visit, card(['(518) 555-0199']), text], { shared: false });
        const later = entry('calendar:later@1', 'calendar', {
            title: 'Checkup',
            location: '12 Main St, Albany',
        });
        const reply = entry('imessage:3', 'imessage', { participants: ['+15185550199'] });
        const update = incrementalRuleLinks([later, reply], knownFrom(full));
        const place = full.placeOf.get(visit.nodeId)!;
        const person = full.nodes.find((n) => n.kind === 'person' && !n.ownerId)!.id;
        const me = full.nodes.find((n) => n.ownerId === 'owner1')!.id;
        expect(link(update, later.nodeId, place)?.kind).toBe('at_place');
        // The reply adds to the interaction; it isn't a line of its own.
        expect(link(update, reply.nodeId, person)).toBeUndefined();
        expect(update.interactions).toEqual([
            { a: me, b: person, kind: 'messages_with', items: [{ id: reply.nodeId, at: now }] },
        ]);
    });
});

describe('model replies', () => {
    it('reads happenings, dropping items that were not asked about', () => {
        const request = {
            items: [0, 1, 2].map((n) => ({ n, source: 'mail', when: '', text: '' })),
            pairs: [],
            topics: [],
            shared: false,
        };
        const reply = JSON.stringify({
            pairs: [],
            topics: [],
            happenings: [
                { name: ' Pizza  party ', items: [0, 2, 2, 9], people: ['Jen', 3], confidence: 2 },
                { name: 'Alone', items: [1], people: [], confidence: 0.9 },
            ],
        });
        expect(parseJudgement(reply, request)?.happenings).toEqual([
            { name: 'Pizza party', items: [0, 2], people: ['Jen'], confidence: 1 },
        ]);
        // An older reply without happenings still reads.
        expect(parseJudgement('{"pairs":[],"topics":[]}', request)?.happenings).toEqual([]);
    });
});
