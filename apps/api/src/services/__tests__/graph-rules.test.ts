import { describe, expect, it } from 'vitest';
import type { MacDataItem, MacDataSource, TravelEstimate } from '@maple/shared';
import {
    incrementalRuleLinks,
    locationKeys,
    modelCandidates,
    normalizeHandle,
    ruleGraph,
    type GraphItem,
    type KnownHubs,
} from '../graph-rules';
import { linkKey } from '../../repositories/graph.repo';

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

    it('joins one person across phone and email through their contact card', () => {
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
        const graph = ruleGraph([card, text, mail], { shared: false });
        const people = graph.nodes.filter((n) => n.kind === 'person');
        expect(people).toHaveLength(1);
        expect(people[0]!.label).toBe('Greyson Lawrence');
        for (const item of [card, text, mail])
            expect(link(graph, item.nodeId, people[0]!.id)?.kind).toBe('person');
        expect(link(graph, mail.nodeId, people[0]!.id)?.evidence).toBe(
            'Email from Greyson Lawrence',
        );
    });

    it('joins a texted handle and an email sender by name without a contacts page', () => {
        const text = entry('imessage:1', 'imessage', {
            sender: 'Coach Dana',
            participants: ['+15185550199'],
        });
        const mail = entry('mail:1', 'mail', { sender: 'Coach Dana <dana@club.org>' });
        const newsletter = entry('mail:2', 'mail', { sender: 'Deals <deals@store.com>' });
        const graph = ruleGraph([text, mail, newsletter], { shared: false });
        const people = graph.nodes.filter((n) => n.kind === 'person');
        expect(people.map((p) => p.label)).toEqual(['Coach Dana']);
        expect(link(graph, mail.nodeId, people[0]!.id)).toBeDefined();
        expect(
            graph.links.some((l) => l.a === newsletter.nodeId || l.b === newsletter.nodeId),
        ).toBe(false);
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
    const empty = { nodes: [], links: [], placeOf: new Map(), peopleOf: new Map() };

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
        for (const node of graph.nodes) {
            if (node.kind !== 'person') continue;
            people.set(node.id, node.label);
            for (const handle of node.handles ?? []) personOf.set(handle, node.id);
        }
        return { personOf, people, places: graph.nodes.filter((n) => n.kind === 'place') };
    };

    it("keeps a person's id when their contact card gains a number", () => {
        const before = ruleGraph([card(['(518) 555-0199']), text], { shared: false });
        const id = before.nodes.find((n) => n.kind === 'person')!.id;
        // The new number sorts first: without the known ids, the person would get a new id.
        const after = ruleGraph([card(['(212) 555-0100', '(518) 555-0199']), text], {
            shared: false,
            known: knownFrom(before),
        });
        const people = after.nodes.filter((n) => n.kind === 'person');
        expect(people.map((p) => p.id)).toEqual([id]);
        expect(people[0]!.handles).toContain('+12125550100');
        expect(
            ruleGraph([card(['(212) 555-0100', '(518) 555-0199']), text], {
                shared: false,
            }).nodes.find((n) => n.kind === 'person')!.id,
        ).not.toBe(id);
    });

    it('keeps one id when two people merge, and lists the other as an alias', () => {
        const other = entry('imessage:2', 'imessage', {
            sender: 'Dana Smith',
            participants: ['+15185550142'],
        });
        const before = ruleGraph([text, other], { shared: false });
        const ids = before.nodes
            .filter((n) => n.kind === 'person')
            .map((n) => n.id)
            .sort();
        expect(ids).toHaveLength(2);
        const after = ruleGraph([card(['(518) 555-0199', '(518) 555-0142']), text, other], {
            shared: false,
            known: knownFrom(before),
        });
        const people = after.nodes.filter((n) => n.kind === 'person');
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
        const person = full.nodes.find((n) => n.kind === 'person')!.id;
        expect(link(update, later.nodeId, place)?.kind).toBe('at_place');
        expect(link(update, reply.nodeId, person)?.evidence).toBe('Message with Coach Dana');
    });
});
