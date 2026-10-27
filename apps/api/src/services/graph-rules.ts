import { createHash } from 'crypto';
import type { MacDataItem, MacDataSource, TravelEstimate } from '@maple/shared';
import type { GraphLinkInput, GraphNodeDocument } from '../repositories/graph.repo';
import { linkKey } from '../repositories/graph.repo';

/**
 * Certain ("rule") links for the connected-data graph, and the candidate pairs a model
 * then judges. Pure functions over the items one notebook's data pages share; nothing
 * here reads the database.
 *
 * - Places come from visits: a named place (the iPhone tags visits with its id) or a
 *   ~100 m square. An event whose location matches a place's address or name is at it.
 * - An event created while a visit was at the event's place is linked to that visit; so
 *   is a visit there during the event.
 * - Driving times from the iPhone link an event to where the drive starts (only in
 *   notebooks nobody else can see: it says where someone was).
 * - People: contact cards join a person's phones and emails; messages, email and
 *   invitations link to the people in them.
 */

/** One item a notebook's data page shows: its node id, whose it is, and which page. */
export interface GraphItem {
    nodeId: string;
    ownerId: string;
    pageId: string;
    item: MacDataItem;
}

export type GraphNodeInput = Pick<GraphNodeDocument, 'id' | 'kind' | 'label' | 'addresses'>;

export interface RuleGraph {
    nodes: GraphNodeInput[];
    links: GraphLinkInput[];
    /** Item node → place node, for candidate scoring. */
    placeOf: Map<string, string>;
    /** Item node → person nodes. */
    peopleOf: Map<string, Set<string>>;
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

const shareKey = (a: Set<string>, b: Set<string>) => [...a].some((key) => b.has(key));

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

const isString = (value: string | null): value is string => !!value;

function buildPeople(items: GraphItem[], out: RuleGraph): void {
    const groups = new UnionFind();
    const names = new Map<string, string>(); // handle → name seen
    const byName = new Map<string, string>(); // normalized name → first handle
    const contactOf = new Map<string, GraphItem>(); // handle → contact card
    const texted = new Set<string>(); // handles in iMessage
    const nameHandle = (name: string | null, handle: string | null) => {
        if (!name || !handle) return;
        if (!names.has(handle)) names.set(handle, name);
        const key = name.toLowerCase().replace(/\s+/g, ' ');
        const first = byName.get(key);
        if (first) groups.union(first, handle);
        else byName.set(key, handle);
    };

    for (const entry of items) {
        const { item } = entry;
        if (item.source === 'contacts') {
            if (item.extra?.isMe === true) continue;
            const handles = contactHandles(item);
            for (const handle of handles) {
                groups.union(handles[0]!, handle);
                contactOf.set(handle, entry);
                nameHandle(item.title?.trim() || null, handle);
            }
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

    // A person is someone with a contact card, or someone the user texts with.
    const personOf = new Map<string, string>(); // handle → person node id
    const labels = new Map<string, string>();
    const members = new Map<string, string[]>();
    const allHandles = new Set([...names.keys(), ...contactOf.keys(), ...texted]);
    for (const handle of allHandles) {
        const root = groups.find(handle);
        members.set(root, [...(members.get(root) ?? []), handle]);
    }
    for (const [root, handles] of members) {
        const contact = handles.map((h) => contactOf.get(h)).find(Boolean);
        if (!contact && !handles.some((h) => texted.has(h))) continue;
        const id = `person:${hash(root)}`;
        const label =
            contact?.item.title?.trim() ||
            handles.map((h) => names.get(h)).find(Boolean) ||
            handles[0]!;
        labels.set(id, label);
        for (const handle of handles) personOf.set(handle, id);
    }
    for (const [id, label] of labels) out.nodes.push({ id, kind: 'person', label });

    const link = (entry: GraphItem, person: string, evidence: string) => {
        out.links.push({
            a: entry.nodeId,
            b: person,
            kind: 'person',
            confidence: 1,
            evidence,
            madeBy: 'rule',
        });
        const set = out.peopleOf.get(entry.nodeId) ?? new Set<string>();
        set.add(person);
        out.peopleOf.set(entry.nodeId, set);
    };
    for (const entry of items) {
        const { item } = entry;
        if (item.source === 'contacts') {
            const person = contactHandles(item)
                .map((h) => personOf.get(h))
                .find(Boolean);
            if (person && item.extra?.isMe !== true) link(entry, person, 'Contact card');
            continue;
        }
        const { from, with: others } = itemHandles(item);
        const people = new Map<string, 'from' | 'with'>();
        for (const handle of from) {
            const person = personOf.get(handle);
            if (person) people.set(person, 'from');
        }
        for (const handle of others) {
            const person = personOf.get(handle);
            if (person && !people.has(person)) people.set(person, 'with');
        }
        for (const [person, role] of [...people].slice(0, MAX_PEOPLE_PER_ITEM)) {
            const name = labels.get(person)!;
            const evidence =
                item.source === 'calendar'
                    ? `${name} is invited`
                    : item.source === 'mail'
                      ? role === 'from'
                          ? `Email from ${name}`
                          : `Email to ${name}`
                      : `Message with ${name}`;
            link(entry, person, evidence);
        }
    }
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
        if (item.source !== 'location') continue;
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
        if (!key) continue;
        const id = `place:${hash(key)}`;
        const label =
            (typeof item.extra?.place === 'string' && item.extra.place) ||
            item.title ||
            item.location ||
            'A place';
        let place = places.get(id);
        if (!place) {
            place = {
                id,
                label,
                keys: new Set(),
                addresses: new Set(),
                ...(Number.isFinite(lat) ? { lat, lon } : {}),
            };
            places.set(id, place);
        }
        for (const k of locationKeys(item.location)) place.keys.add(k);
        for (const k of locationKeys(label)) if (k.startsWith('name:')) place.keys.add(k);
        if (item.location) place.addresses.add(normalizeAddressPart(item.location));
        visits.push({ entry, place });
        out.placeOf.set(entry.nodeId, id);
        out.links.push({
            a: entry.nodeId,
            b: id,
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
        const place = [...places.values()].find((p) => shareKey(p.keys, keys));
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
            let place = [...places.values()].find(
                (p) =>
                    normalizeAddressPart(p.label) === normalizeAddressPart(origin) ||
                    shareKey(p.keys, keys),
            );
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
        });
    }
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

/** Every rule link among the items one notebook shares. */
export function ruleGraph(
    items: GraphItem[],
    options: { travel?: Map<string, TravelEstimate>; shared: boolean },
): RuleGraph {
    const out: RuleGraph = { nodes: [], links: [], placeOf: new Map(), peopleOf: new Map() };
    buildPlaces(items, options.travel ?? new Map(), options.shared, out);
    buildPeople(items, out);
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

/** A topic's node id: the same name is the same topic in a notebook. */
export function topicNodeId(name: string): string {
    return `topic:${hash(name.trim().toLowerCase().replace(/\s+/g, ' '))}`;
}
