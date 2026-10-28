import { createHash } from 'crypto';
import {
    dataGraphItemNodeId,
    type MacDataItem,
    type MacDataSource,
    type ProfileEntity,
    type ProfileRelation,
    type TravelEstimate,
} from '@maple/shared';
import type {
    GraphNodeInput,
    GraphRelationInput,
    InteractionTally,
} from '../repositories/graph.repo';
import { linkKey } from '../repositories/graph.repo';

/**
 * Certain ("rule") relations for the connected-data graph, and the candidate pairs a model
 * then judges. Pure functions over the items one notebook's data pages share; nothing
 * here reads the database.
 *
 * - Places come from visits: a named place (the iPhone tags visits with its id) or a
 *   ~100 m square. An event whose location matches a place's address or name is at it.
 * - An event created while a visit was at the event's place is linked to that visit; so
 *   is a visit there during the event.
 * - Driving times from the iPhone link an event to where the drive starts (only in
 *   notebooks nobody else can see: it says where someone was).
 * - People: contact cards join a person's phones and emails and are that person's details;
 *   each member whose data it is is a person too. Messages, emails and events add up to one
 *   interaction per pair (the member and someone); an event's invitees link to the event.
 * - Relationships (spouse, child…) come from contact cards' related names and About me,
 *   only in notebooks nobody else can see.
 */

/** One item a notebook's data page shows: its node id, whose it is, and which page. */
export interface GraphItem {
    nodeId: string;
    ownerId: string;
    pageId: string;
    item: MacDataItem;
}

export type { GraphNodeInput };

/** People and places already in the notebook, so ids stay the same from pass to pass. */
export interface KnownHubs {
    /** Handle → the person id it belongs to. */
    personOf: Map<string, string>;
    /** Person id → name. */
    people: Map<string, string>;
    places: GraphNodeInput[];
    /** Member id → their own person id. */
    ownerPerson?: Map<string, string>;
}

export interface RuleGraph {
    nodes: GraphNodeInput[];
    links: GraphRelationInput[];
    /** Messages, emails and events per pair (the member whose data it is, and someone). */
    interactions: InteractionTally[];
    /** Item node → place node, for candidate scoring. */
    placeOf: Map<string, string>;
    /** Item node → person nodes (besides its owner). */
    peopleOf: Map<string, Set<string>>;
    /** Handle → person, and member → their person. */
    personOf: Map<string, string>;
    ownerPerson: Map<string, string>;
}

/** A visit near an event's time counts as being there for it. */
const ATTEND_SLACK_SECONDS = 30 * 60;
/** An open visit (no departure yet) covers this long. */
const OPEN_VISIT_SECONDS = 12 * 60 * 60;
/** At most this many people per message or event (big group chats, mailing lists). */
const MAX_PEOPLE_PER_ITEM = 8;

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// MARK: - Addresses

const ABBREVIATIONS: Record<string, string> = {
    street: 'st',
    avenue: 'ave',
    road: 'rd',
    drive: 'dr',
    boulevard: 'blvd',
    suite: 'ste',
    lane: 'ln',
    court: 'ct',
    place: 'pl',
    highway: 'hwy',
    parkway: 'pkwy',
    north: 'n',
    south: 's',
    east: 'e',
    west: 'w',
};

/** Lowercase words, punctuation gone, common street words shortened. */
export function normalizeAddressPart(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ABBREVIATIONS[word] ?? word)
        .join(' ');
}

/**
 * Ways to recognize a location: the whole thing, its street line (a part with a number)
 * and its name (a first part without one, e.g. "Bright Smiles Dental").
 */
export function locationKeys(text: string | undefined): Set<string> {
    const keys = new Set<string>();
    if (!text?.trim()) return keys;
    const parts = text
        .split(/[\n,]/)
        .map(normalizeAddressPart)
        .filter((part) => part && part !== 'united states' && part !== 'usa');
    if (parts.length === 0) return keys;
    keys.add(`all:${parts.join(' ')}`);
    const street = parts.find((part) => /\d/.test(part) && part.split(' ').length >= 2);
    if (street) keys.add(`street:${street}`);
    const name = parts[0]!;
    if (!/\d/.test(name) && name.length >= 4) keys.add(`name:${name}`);
    return keys;
}

/** How well two locations match: whole address beats street line beats name. 0 is none. */
function matchStrength(a: Set<string>, b: Set<string>): number {
    let best = 0;
    for (const key of a) {
        if (!b.has(key)) continue;
        best = Math.max(best, key.startsWith('all:') ? 3 : key.startsWith('street:') ? 2 : 1);
    }
    return best;
}

/** The best matching place; ties go to the smaller id, so arrival order doesn't matter. */
function bestPlace<P extends { id: string; keys: Set<string> }>(
    places: Iterable<P>,
    keys: Set<string>,
): P | undefined {
    let best: P | undefined;
    let bestStrength = 0;
    for (const place of places) {
        const strength = matchStrength(place.keys, keys);
        if (
            strength > bestStrength ||
            (strength > 0 && strength === bestStrength && place.id < best!.id)
        ) {
            best = place;
            bestStrength = strength;
        }
    }
    return best;
}

// MARK: - People

/** A phone number or email address as one comparable handle, or null. */
export function normalizeHandle(raw: string | undefined): string | null {
    if (!raw) return null;
    const angle = raw.match(/<([^>]+)>/);
    const text = (angle ? angle[1]! : raw)
        .trim()
        .toLowerCase()
        .replace(/^mailto:/, '');
    if (text.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
    const digits = text.replace(/\D/g, '');
    if (digits.length < 7) return null;
    return `+${digits.length === 10 ? `1${digits}` : digits}`;
}

/** The display name in "Name <address>", or the whole text when it isn't a handle. */
function nameIn(raw: string | undefined): string | null {
    if (!raw) return null;
    const angle = raw.match(/^(.*?)<[^>]+>/);
    const name = (angle ? angle[1]! : raw).trim().replace(/^"|"$/g, '');
    if (!name || name === 'Me' || normalizeHandle(name)) return null;
    return name;
}

function contactHandles(card: MacDataItem): string[] {
    const handles: string[] = [];
    for (const key of ['phones', 'emails']) {
        const list = card.extra?.[key];
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            const value =
                typeof entry === 'string'
                    ? entry
                    : typeof (entry as { value?: unknown })?.value === 'string'
                      ? (entry as { value: string }).value
                      : undefined;
            const handle = normalizeHandle(value);
            if (handle) handles.push(handle);
        }
    }
    return handles;
}

class UnionFind {
    private parent = new Map<string, string>();
    find(x: string): string {
        if (!this.parent.has(x)) this.parent.set(x, x);
        let root = x;
        while (this.parent.get(root) !== root) root = this.parent.get(root)!;
        this.parent.set(x, root);
        return root;
    }
    union(a: string, b: string): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
}

/** The handles an item involves, besides the user. */
function itemHandles(item: MacDataItem): { from: string[]; with: string[] } {
    if (item.source === 'imessage') {
        return { from: [], with: item.participants.map(normalizeHandle).filter(isString) };
    }
    if (item.source === 'mail') {
        const sender = item.isFromMe ? null : normalizeHandle(item.sender);
        return {
            from: sender ? [sender] : [],
            with: item.participants.map(normalizeHandle).filter(isString),
        };
    }
    if (item.source === 'calendar') {
        return { from: [], with: item.participants.map(normalizeHandle).filter(isString) };
    }
    return { from: [], with: [] };
}

const isString = (value: string | null | undefined): value is string => !!value;

/** Handles that aren't a phone or email: a member's own data, or a card with neither. */
const ownerHandle = (ownerId: string) => `owner:${ownerId}`;
const cardHandle = (nodeId: string) => `card:${nodeId}`;
export const isSyntheticHandle = (handle: string) =>
    handle.startsWith('owner:') || handle.startsWith('card:');

/** "_$!<Spouse>!$_", "Spouse " or "best friend" as one comparable type. */
export function normalizeRelationType(raw: string | null | undefined): string {
    const text = (raw ?? '')
        .replace(/^_\$!<|>!\$_$/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30);
    return text || 'related';
}

const normalName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The one person a name means: the same full name, else the only person with that first
 * name (a card says "Spouse: Zubair"). Null when none or several match.
 */
export function matchPersonByName(
    name: string,
    people: Array<{ id: string; label: string; aliases?: string[] }>,
    except?: string,
): string | null {
    const wanted = normalName(name);
    if (!wanted) return null;
    const others = people.filter((person) => person.id !== except);
    const full = others.filter(
        (person) =>
            normalName(person.label) === wanted ||
            (person.aliases ?? []).some((alias) => normalName(alias) === wanted),
    );
    if (full.length === 1) return full[0]!.id;
    if (full.length > 1 || wanted.includes(' ')) return null;
    const first = others.filter((person) => normalName(person.label).split(' ')[0] === wanted);
    return first.length === 1 ? first[0]!.id : null;
}

export function relationshipEvidence(type: string, toLabel: string, fromLabel: string): string {
    return `${toLabel} is ${fromLabel}'s ${type.replace(/_/g, ' ')}`;
}

const INTERACTION_OF: Partial<Record<MacDataSource, InteractionTally['kind']>> = {
    imessage: 'messages_with',
    mail: 'emails_with',
    calendar: 'met_with',
};

/** Who is in an item and how: invitees for events, and a tally per person for the owner. */
function linkPeople(
    items: GraphItem[],
    personOf: Map<string, string>,
    ownerPerson: Map<string, string>,
    labelOf: (id: string) => string,
    out: RuleGraph,
): void {
    const tallies = new Map<string, InteractionTally>();
    for (const entry of items) {
        const { item } = entry;
        if (item.source === 'contacts') continue;
        const me = ownerPerson.get(entry.ownerId);
        const { from, with: others } = itemHandles(item);
        const people: string[] = [];
        for (const handle of [...from, ...others]) {
            const person = personOf.get(handle);
            if (person && person !== me && !people.includes(person)) people.push(person);
        }
        const kept = people.slice(0, MAX_PEOPLE_PER_ITEM);
        if (kept.length === 0) continue;
        out.peopleOf.set(entry.nodeId, new Set(kept));
        for (const person of kept) {
            // An event is a hub: its people link to it, not to each other.
            if (item.source === 'calendar')
                out.links.push({
                    a: entry.nodeId,
                    b: person,
                    kind: 'attendee',
                    confidence: 1,
                    evidence: `${labelOf(person)} is invited`,
                    madeBy: 'rule',
                });
            const kind = INTERACTION_OF[item.source];
            if (!kind || !me) continue;
            const key = `${me}|${person}|${kind}`;
            const tally = tallies.get(key) ?? { a: me, b: person, kind, items: [] };
            tally.items.push({ id: entry.nodeId, at: item.occurredAt });
            tallies.set(key, tally);
        }
    }
    out.interactions.push(...tallies.values());
}

/**
 * People: a contact card's phones and emails are one person, and so is the same name on
 * texts and emails. Each member whose data the notebook shows is a person too (their "me"
 * card joins them). A contact card is its person's details, not a node of its own.
 */
function buildPeople(
    items: GraphItem[],
    known: Map<string, string>,
    options: { owners: Map<string, string>; shared: boolean },
    out: RuleGraph,
): void {
    const groups = new UnionFind();
    const names = new Map<string, string>(); // handle → name seen
    const byName = new Map<string, string>(); // normalized name → first handle
    const cards = new Map<string, GraphItem[]>(); // handle → contact cards
    const cardKeys = new Map<string, string>(); // card node → one of its handles
    const meCards = new Map<string, GraphItem>(); // owner → their "me" card
    const texted = new Set<string>(); // handles in iMessage
    const owners = new Map<string, string>(); // owner handle → owner id
    const nameHandle = (name: string | null, handle: string | null) => {
        if (!name || !handle) return;
        if (!names.has(handle)) names.set(handle, name);
        const key = normalName(name);
        const first = byName.get(key);
        if (first) groups.union(first, handle);
        else byName.set(key, handle);
    };

    for (const ownerId of new Set(items.map((entry) => entry.ownerId))) {
        groups.find(ownerHandle(ownerId));
        owners.set(ownerHandle(ownerId), ownerId);
    }
    for (const entry of items) {
        const { item } = entry;
        if (item.source === 'contacts') {
            const isMe = item.extra?.isMe === true;
            const handles = contactHandles(item);
            if (handles.length === 0) handles.push(cardHandle(entry.nodeId));
            if (isMe) {
                handles.push(ownerHandle(entry.ownerId));
                meCards.set(entry.ownerId, entry);
            }
            for (const handle of handles) {
                groups.union(handles[0]!, handle);
                cards.set(handle, [...(cards.get(handle) ?? []), entry]);
            }
            cardKeys.set(entry.nodeId, handles[0]!);
            // Your own card joins you by its numbers, not by your name on others' cards.
            if (!isMe) nameHandle(item.title?.trim() || null, handles[0]!);
        } else if (item.source === 'imessage') {
            const handles = itemHandles(item).with;
            handles.forEach((handle) => texted.add(handle));
            // In a one-to-one chat the sender's name (from the Mac's contacts) is that handle's.
            if (handles.length === 1 && !item.isFromMe)
                nameHandle(nameIn(item.sender), handles[0]!);
        } else if (item.source === 'mail' && !item.isFromMe) {
            nameHandle(nameIn(item.sender), normalizeHandle(item.sender));
        }
    }

    // A person is someone with a contact card, someone the user texts with, or a member.
    const personOf = new Map<string, string>(); // handle → person node id
    const ownerPerson = new Map<string, string>(); // owner id → person node id
    const labels = new Map<string, string>();
    const members = new Map<string, string[]>();
    const allHandles = new Set([...names.keys(), ...cards.keys(), ...texted, ...owners.keys()]);
    for (const handle of allHandles) {
        const root = groups.find(handle);
        members.set(root, [...(members.get(root) ?? []), handle]);
    }
    // A person keeps the id they had: the oldest id among their handles. A new number on a
    // contact card doesn't make a new person; two people merged keep one id, the other's
    // becomes an alias.
    const taken = new Set<string>();
    const ordered = [...members.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [root, handles] of ordered) {
        const groupCards = [
            ...new Map(
                handles.flatMap((h) => cards.get(h) ?? []).map((card) => [card.nodeId, card]),
            ).values(),
        ];
        const ownerIds = handles
            .map((h) => owners.get(h))
            .filter(isString)
            .sort();
        if (!groupCards.length && !ownerIds.length && !handles.some((h) => texted.has(h))) continue;
        const earlier = [...new Set(handles.map((h) => known.get(h)).filter(isString))]
            .filter((id) => !taken.has(id))
            .sort();
        let id = earlier[0] ?? `person:${hash(root)}`;
        // A split person: the other part gets an id of its own.
        if (taken.has(id)) id = `person:${hash(`${root}|${handles.length}`)}`;
        taken.add(id);
        const ownerId = ownerIds[0];
        const card =
            (ownerId ? meCards.get(ownerId) : undefined) ??
            groupCards.find((c) => c.item.extra?.isMe !== true) ??
            groupCards[0];
        const label =
            card?.item.title?.trim() ||
            (ownerId ? options.owners.get(ownerId) : undefined) ||
            handles.map((h) => names.get(h)).find(Boolean) ||
            handles.find((h) => !isSyntheticHandle(h)) ||
            'Someone';
        labels.set(id, label);
        for (const handle of handles) personOf.set(handle, id);
        for (const owner of ownerIds) ownerPerson.set(owner, id);
        out.nodes.push({
            id,
            kind: 'person',
            label,
            handles: [...handles].sort(),
            aliases: earlier.slice(1),
            contactIds: groupCards.map((c) => c.nodeId).sort(),
            ...(ownerId ? { ownerId } : {}),
        });
    }
    out.personOf = personOf;
    out.ownerPerson = ownerPerson;

    linkPeople(items, personOf, ownerPerson, (id) => labels.get(id)!, out);

    // Relationships from contact cards ("Spouse: Zubair"). They're private: never made in
    // a shared notebook.
    if (options.shared) return;
    const people = [...labels].map(([id, label]) => ({ id, label }));
    for (const entry of items) {
        if (entry.item.source !== 'contacts') continue;
        const from = personOf.get(cardKeys.get(entry.nodeId) ?? '');
        const related = entry.item.extra?.relations;
        if (!from || !Array.isArray(related)) continue;
        for (const raw of related.slice(0, 20)) {
            const relation = raw as { label?: unknown; name?: unknown };
            if (typeof relation?.name !== 'string') continue;
            const to = matchPersonByName(relation.name, people, from);
            if (!to) continue;
            const type = normalizeRelationType(
                typeof relation.label === 'string' ? relation.label : null,
            );
            out.links.push({
                a: from,
                b: to,
                kind: 'relationship',
                type,
                from,
                to,
                confidence: 0.95,
                evidence: relationshipEvidence(type, labels.get(to)!, labels.get(from)!),
                madeBy: 'rule',
                items: [entry.nodeId],
            });
        }
    }
}

/**
 * Relationships someone wrote in About me ("Emma is my daughter"), between people the
 * notebook's data pages already show. Nobody new is added from About me.
 */
export function aboutMeRelationships(input: {
    /** Whose About me. */
    ownerId: string;
    entities: ProfileEntity[];
    relations: ProfileRelation[];
    people: Array<Pick<GraphNodeInput, 'id' | 'label' | 'contactIds' | 'ownerId'>>;
}): GraphRelationInput[] {
    const me = input.people.find((person) => person.ownerId === input.ownerId)?.id;
    const byCard = new Map<string, string>();
    for (const person of input.people)
        for (const card of person.contactIds ?? []) byCard.set(card, person.id);
    const labels = new Map(input.people.map((person) => [person.id, person.label]));
    const personFor = (entity: ProfileEntity | undefined): string | null => {
        if (!entity || entity.kind !== 'person') return null;
        if (entity.isMe) return me ?? null;
        if (entity.contactId) {
            const card = byCard.get(dataGraphItemNodeId(input.ownerId, entity.contactId));
            if (card) return card;
        }
        return (
            matchPersonByName(entity.name, input.people) ??
            entity.aliases.map((alias) => matchPersonByName(alias, input.people)).find(isString) ??
            null
        );
    };
    const entities = new Map(input.entities.map((entity) => [entity.id, entity]));
    const out: GraphRelationInput[] = [];
    for (const relation of input.relations.slice(0, 500)) {
        const from = personFor(entities.get(relation.from));
        const to = personFor(entities.get(relation.to));
        if (!from || !to || from === to) continue;
        const type = normalizeRelationType(relation.type);
        out.push({
            a: from,
            b: to,
            kind: 'relationship',
            type,
            from,
            to,
            confidence: 1,
            evidence: relationshipEvidence(type, labels.get(to)!, labels.get(from)!),
            madeBy: 'user',
        });
    }
    return out;
}
// MARK: - Places

interface Place {
    id: string;
    label: string;
    keys: Set<string>;
    addresses: Set<string>;
    lat?: number;
    lon?: number;
}

const num = (value: unknown) =>
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

/** When a visit started and ended, in seconds (an open one covers a few hours). */
function visitSpan(visit: MacDataItem): [number, number] {
    return [visit.occurredAt, visit.endAt ?? visit.occurredAt + OPEN_VISIT_SECONDS];
}

/** Seconds since 1970 from an ISO date or a number, or null. */
function secondsFrom(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value))
        return value > 1e12 ? value / 1000 : value;
    if (typeof value === 'string' && value) {
        const ms = Date.parse(value);
        return Number.isNaN(ms) ? null : ms / 1000;
    }
    return null;
}

/**
 * Places from visits, joined by named place or ~100 m square, then events matched to
 * them by address or name. Returns visit and event links to their place.
 */
function buildPlaces(
    items: GraphItem[],
    travel: Map<string, TravelEstimate>,
    shared: boolean,
    out: RuleGraph,
): void {
    const places = new Map<string, Place>();
    const visits: Array<{ entry: GraphItem; place: Place }> = [];
    for (const entry of items) {
        const { item } = entry;
        const seen = visitPlace(item);
        if (!seen) continue;
        let place = places.get(seen.id);
        if (!place) {
            place = { ...seen, keys: new Set(), addresses: new Set() };
            places.set(seen.id, place);
        }
        for (const k of seen.keys) place.keys.add(k);
        if (item.location) place.addresses.add(normalizeAddressPart(item.location));
        visits.push({ entry, place });
        out.placeOf.set(entry.nodeId, place.id);
        out.links.push({
            a: entry.nodeId,
            b: place.id,
            kind: 'at_place',
            confidence: 1,
            evidence: `Visit at ${place.label}`,
            madeBy: 'rule',
        });
    }

    // Events at a place: matched to a visited place, or (when two or more events share a
    // location nobody visited) a place of their own.
    const unmatched = new Map<string, { label: string; events: GraphItem[] }>();
    for (const entry of items) {
        const { item } = entry;
        if (item.source !== 'calendar' || !item.location?.trim()) continue;
        const keys = locationKeys(item.location);
        const place = bestPlace(places.values(), keys);
        if (place) {
            out.placeOf.set(entry.nodeId, place.id);
            out.links.push({
                a: entry.nodeId,
                b: place.id,
                kind: 'at_place',
                confidence: 0.95,
                evidence: `Event at ${place.label}`,
                madeBy: 'rule',
            });
            linkVisitsToEvent(entry, place, visits, out);
        } else {
            const key = [...keys].find((k) => k.startsWith('street:')) ?? [...keys][0]!;
            const group = unmatched.get(key) ?? {
                label: item.location.split(/[\n,]/)[0]!.trim(),
                events: [],
            };
            group.events.push(entry);
            unmatched.set(key, group);
        }
    }
    for (const [key, group] of unmatched) {
        if (group.events.length < 2) continue;
        const id = `place:${hash(`loc:${key}`)}`;
        places.set(id, { id, label: group.label, keys: new Set([key]), addresses: new Set() });
        for (const entry of group.events) {
            out.placeOf.set(entry.nodeId, id);
            out.links.push({
                a: entry.nodeId,
                b: id,
                kind: 'at_place',
                confidence: 0.9,
                evidence: `Event at ${group.label}`,
                madeBy: 'rule',
            });
        }
    }

    // Driving time to an event, from where the drive starts. Where someone was stays out
    // of shared notebooks.
    if (!shared) {
        for (const entry of items) {
            if (entry.item.source !== 'calendar') continue;
            const estimate = travel.get(`${entry.ownerId}:${entry.item.id}`);
            if (!estimate) continue;
            const origin = estimate.origin?.trim() || 'where you were';
            const keys = locationKeys(origin);
            let place =
                [...places.values()]
                    .filter((p) => normalizeAddressPart(p.label) === normalizeAddressPart(origin))
                    .sort((x, y) => (x.id < y.id ? -1 : 1))[0] ?? bestPlace(places.values(), keys);
            if (!place) {
                const id = `place:${hash(`origin:${normalizeAddressPart(origin)}`)}`;
                place = { id, label: origin, keys, addresses: new Set() };
                places.set(id, place);
            }
            out.links.push({
                a: entry.nodeId,
                b: place.id,
                kind: 'travel',
                confidence: 1,
                evidence: `${Math.round(estimate.minutes)} min drive from ${place.label}`,
                madeBy: 'rule',
            });
        }
    }

    for (const place of places.values()) {
        if (!out.links.some((link) => link.b === place.id)) continue;
        out.nodes.push({
            id: place.id,
            kind: 'place',
            label: place.label,
            addresses: [...place.addresses],
            keys: [...place.keys],
        });
    }
}

/** The place a visit was at: its named place, or a ~100 m square, or its address. */
function visitPlace(
    item: MacDataItem,
): { id: string; label: string; keys: Set<string>; lat?: number; lon?: number } | null {
    if (item.source !== 'location') return null;
    const lat = num(item.extra?.lat);
    const lon = num(item.extra?.lon);
    const placeId = typeof item.extra?.placeId === 'string' ? item.extra.placeId : null;
    const key = placeId
        ? `np:${placeId}`
        : Number.isFinite(lat) && Number.isFinite(lon)
          ? `geo:${lat.toFixed(3)},${lon.toFixed(3)}`
          : item.location
            ? `addr:${normalizeAddressPart(item.location)}`
            : null;
    if (!key) return null;
    const label =
        (typeof item.extra?.place === 'string' && item.extra.place) ||
        item.title ||
        item.location ||
        'A place';
    const keys = locationKeys(item.location);
    for (const k of locationKeys(label)) if (k.startsWith('name:')) keys.add(k);
    return {
        id: `place:${hash(key)}`,
        label,
        keys,
        ...(Number.isFinite(lat) ? { lat, lon } : {}),
    };
}

/** Visits at the event's place: created there, or there during the event. */
function linkVisitsToEvent(
    event: GraphItem,
    place: Place,
    visits: Array<{ entry: GraphItem; place: Place }>,
    out: RuleGraph,
): void {
    const createdAt = secondsFrom(event.item.extra?.createdAt);
    const start = event.item.occurredAt - ATTEND_SLACK_SECONDS;
    const end = (event.item.endAt ?? event.item.occurredAt) + ATTEND_SLACK_SECONDS;
    for (const visit of visits) {
        if (visit.place.id !== place.id || visit.entry.ownerId !== event.ownerId) continue;
        const [arrived, left] = visitSpan(visit.entry.item);
        if (createdAt !== null && createdAt >= arrived && createdAt <= left) {
            out.links.push({
                a: event.nodeId,
                b: visit.entry.nodeId,
                kind: 'created_at',
                confidence: 1,
                evidence: `Created while at ${place.label}`,
                madeBy: 'rule',
            });
        } else if (!event.item.allDay && arrived <= end && left >= start) {
            out.links.push({
                a: event.nodeId,
                b: visit.entry.nodeId,
                kind: 'attended',
                confidence: 0.98,
                evidence: `At ${place.label} during the event`,
                madeBy: 'rule',
            });
        }
    }
}

const emptyRules = (): RuleGraph => ({
    nodes: [],
    links: [],
    interactions: [],
    placeOf: new Map(),
    peopleOf: new Map(),
    personOf: new Map(),
    ownerPerson: new Map(),
});

/** Every rule relation among the items one notebook shares. */
export function ruleGraph(
    items: GraphItem[],
    options: {
        travel?: Map<string, TravelEstimate>;
        shared: boolean;
        known?: KnownHubs;
        /** Member id → their name, for the members whose data the notebook shows. */
        owners?: Map<string, string>;
    },
): RuleGraph {
    const out = emptyRules();
    buildPlaces(items, options.travel ?? new Map(), options.shared, out);
    buildPeople(
        items,
        options.known?.personOf ?? new Map(),
        { owners: options.owners ?? new Map(), shared: options.shared },
        out,
    );
    return out;
}

/**
 * Rule relations for newly uploaded items only, against the people and places the
 * notebook already has: a visit to its place, an event to a known place and its known
 * invitees, and messages, emails and events added to the owner's interactions with known
 * people. The next full pass adds the rest (visits during events, new people).
 */
export function incrementalRuleLinks(items: GraphItem[], known: KnownHubs): RuleGraph {
    const out = emptyRules();
    const places = known.places.map((place) => ({
        id: place.id,
        label: place.label,
        keys: new Set(place.keys ?? []),
    }));
    const labels = new Map(known.places.map((place) => [place.id, place.label]));
    for (const entry of items) {
        const { item } = entry;
        if (item.source === 'location') {
            const place = visitPlace(item);
            if (!place) continue;
            if (!labels.has(place.id)) {
                labels.set(place.id, place.label);
                out.nodes.push({
                    id: place.id,
                    kind: 'place',
                    label: place.label,
                    keys: [...place.keys],
                });
            }
            out.links.push({
                a: entry.nodeId,
                b: place.id,
                kind: 'at_place',
                confidence: 1,
                evidence: `Visit at ${labels.get(place.id)}`,
                madeBy: 'rule',
            });
            continue;
        }
        if (item.source === 'calendar' && item.location?.trim()) {
            const place = bestPlace(places, locationKeys(item.location));
            if (place)
                out.links.push({
                    a: entry.nodeId,
                    b: place.id,
                    kind: 'at_place',
                    confidence: 0.95,
                    evidence: `Event at ${place.label}`,
                    madeBy: 'rule',
                });
        }
    }
    linkPeople(
        items,
        known.personOf,
        known.ownerPerson ?? new Map(),
        (id) => known.people.get(id) ?? 'Someone',
        out,
    );
    return out;
}

// MARK: - Model candidates

const STOP_WORDS = new Set(
    (
        'the and for you your with this that from have are was were will can our not but all ' +
        'just get got any has had his her him she they them their there what when where who ' +
        'how why out about into than then also its it’s i’m we’re you’re don’t can’t yes yeah ' +
        'ok okay thanks thank please hi hey hello dear re fwd fw sent via iphone email mail ' +
        'message today tomorrow yesterday week day time am pm let know see like one two new ' +
        'more some would could should been being here now come going want need make did does ' +
        'doing done over back good great love sure well very much only via www http https com'
    ).split(' '),
);

/** Words worth matching on: title, location and the start of the text. */
export function itemTokens(item: MacDataItem): Set<string> {
    const text = [item.title, item.location, item.body.slice(0, 400)].filter(Boolean).join(' ');
    const tokens = new Set<string>();
    for (const word of text.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
        const clean = word.replace(/^'+|'+$/g, '').replace(/'s$/, '');
        if (clean.length < 3 || STOP_WORDS.has(clean) || /^\d+$/.test(clean)) continue;
        tokens.add(clean);
    }
    return tokens;
}

/** Sources the model compares: what people wrote and planned. */
const JUDGED: ReadonlySet<MacDataSource> = new Set(['mail', 'imessage', 'calendar']);

export interface Candidate {
    a: GraphItem;
    b: GraphItem;
    score: number;
}

/**
 * Pairs worth asking the model about: at least one of them in `focus`, from different
 * sources, sharing rare words, people, a place or a few days. Pairs already decided
 * (linked, removed or rejected) are skipped. Best first, at most `max`.
 */
export function modelCandidates(
    notebookId: string,
    items: GraphItem[],
    focus: Set<string>,
    context: { rules: RuleGraph; decided: Set<string> },
    max: number,
): Candidate[] {
    const judged = items.filter((entry) => JUDGED.has(entry.item.source));
    const tokens = new Map(judged.map((entry) => [entry.nodeId, itemTokens(entry.item)]));
    const postings = new Map<string, GraphItem[]>();
    for (const entry of judged) {
        for (const token of tokens.get(entry.nodeId)!) {
            postings.set(token, [...(postings.get(token) ?? []), entry]);
        }
    }
    const n = Math.max(judged.length, 2);
    // Smoothed, so a word two items share still counts in a small notebook.
    const idf = (token: string) => Math.log(1 + n / (postings.get(token)?.length ?? n));
    const decided = new Set(context.decided);
    for (const link of context.rules.links) decided.add(linkKey(notebookId, link.a, link.b));

    const byId = new Map(judged.map((entry) => [entry.nodeId, entry]));
    const scores = new Map<string, Candidate>();
    for (const entry of judged) {
        if (!focus.has(entry.nodeId)) continue;
        const near = new Map<string, number>();
        for (const token of tokens.get(entry.nodeId)!) {
            const list = postings.get(token)!;
            // Words in more than 30 items say little about any two of them.
            if (list.length > 30) continue;
            for (const other of list) {
                if (other.nodeId === entry.nodeId || other.item.source === entry.item.source)
                    continue;
                near.set(other.nodeId, (near.get(other.nodeId) ?? 0) + idf(token));
            }
        }
        // People in common count even without shared words.
        const people = context.rules.peopleOf.get(entry.nodeId);
        if (people) {
            for (const other of judged) {
                if (other.item.source === entry.item.source || other.nodeId === entry.nodeId)
                    continue;
                const theirs = context.rules.peopleOf.get(other.nodeId);
                if (theirs && [...people].some((p) => theirs.has(p)) && !near.has(other.nodeId))
                    near.set(other.nodeId, 0);
            }
        }
        for (const [otherId, words] of near) {
            const other = byId.get(otherId)!;
            const key = linkKey(notebookId, entry.nodeId, otherId);
            if (decided.has(key) || scores.has(key)) continue;
            const days = Math.abs(entry.item.occurredAt - other.item.occurredAt) / 86_400;
            const samePerson = [...(people ?? [])].some((p) =>
                context.rules.peopleOf.get(otherId)?.has(p),
            );
            const samePlace =
                !!context.rules.placeOf.get(entry.nodeId) &&
                context.rules.placeOf.get(entry.nodeId) === context.rules.placeOf.get(otherId);
            const score =
                words +
                (samePerson ? 1.5 : 0) +
                (samePlace ? 1.5 : 0) +
                (days <= 3 ? 1 : days <= 14 ? 0.5 : 0);
            const worthAsking =
                words >= 4 || (words >= 2 && days <= 14) || (samePerson && days <= 3);
            if (worthAsking) scores.set(key, { a: entry, b: other, score });
        }
    }
    return [...scores.values()].sort((x, y) => y.score - x.score).slice(0, max);
}

/**
 * A happening's node id. The same name within a week is the same happening (the model can
 * find it again in a later batch); otherwise a new one.
 */
export function happeningNodeId(
    name: string,
    at: number,
    existing: Array<{ id: string; label: string; at?: number }>,
): string {
    const key = normalName(name);
    const same = existing.find(
        (event) =>
            normalName(event.label) === key &&
            event.at !== undefined &&
            Math.abs(event.at - at) <= 7 * 24 * 60 * 60,
    );
    return same?.id ?? `event:${hash(`${key}|${Math.floor(at / 86_400)}`)}`;
}

/** A topic's node id: the same name is the same topic in a notebook. */
export function topicNodeId(name: string): string {
    return `topic:${hash(name.trim().toLowerCase().replace(/\s+/g, ' '))}`;
}
