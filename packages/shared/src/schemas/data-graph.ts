import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { MacDataSourceSchema } from './mac-data';

// The connected-data graph: links between the device items a notebook's data pages show,
// plus people, places, topics and happenings. A graph belongs to one notebook. It is built
// only from what that notebook's data pages share, and nothing in it reaches another
// notebook.
//
// Two nodes are joined by at most one line, and the line carries every reason the two are
// connected ("relations"): Jen and you can be joined because she's your wife, because of
// 214 messages, and because of three events together. Each reason can be removed on its own.

export const DataGraphNodeKindSchema = Type.Union([
    Type.Literal('item'),
    Type.Literal('person'),
    Type.Literal('place'),
    Type.Literal('topic'),
    /** A happening the model found across items (a party, a dinner) with no calendar event. */
    Type.Literal('event'),
]);
export type DataGraphNodeKind = Static<typeof DataGraphNodeKindSchema>;

export const DataGraphRelationKindSchema = Type.Union([
    // Relationships: person to person, lasting (from contact cards and About me).
    /** Spouse, child, friend, dentist… (`type` says which). */
    Type.Literal('relationship'),

    // Interactions: one per pair, with a count and first and last time.
    Type.Literal('messages_with'),
    Type.Literal('emails_with'),
    /** Calendar events you both were in. */
    Type.Literal('met_with'),

    // Item relations.
    /** An event created while a visit was at the event's location. */
    Type.Literal('created_at'),
    /** A visit at an event's location during the event. */
    Type.Literal('attended'),
    /** An item at a place (a visit, or an event whose address is the place). */
    Type.Literal('at_place'),
    /** Driving time to an event, from a place. */
    Type.Literal('travel'),
    /** A person in an event or happening. */
    Type.Literal('attendee'),
    /** Two items about the same thing (the model's judgment). */
    Type.Literal('related'),
    /** An item belongs to a topic. */
    Type.Literal('topic'),
    /** An item is about a happening (a calendar event or one the model found). */
    Type.Literal('part_of'),
    /** Older links: a message, email or contact card with a person. Only removals remain. */
    Type.Literal('person'),
]);
export type DataGraphRelationKind = Static<typeof DataGraphRelationKindSchema>;
/** The kinds a link's strongest reason can have. */
export type DataGraphLinkKind = DataGraphRelationKind;

export type DataGraphRelationFamily = 'relationship' | 'interaction' | 'item';

export function dataGraphRelationFamily(kind: DataGraphRelationKind): DataGraphRelationFamily {
    if (kind === 'relationship') return 'relationship';
    if (kind === 'messages_with' || kind === 'emails_with' || kind === 'met_with')
        return 'interaction';
    return 'item';
}

export const DataGraphMadeBySchema = Type.Union([
    Type.Literal('rule'),
    Type.Literal('model'),
    /** Something the person said (About me). */
    Type.Literal('user'),
]);
export type DataGraphMadeBy = Static<typeof DataGraphMadeBySchema>;

/** An item a reason rests on, when the reader may see it. */
export const DataGraphExampleSchema = Type.Object({
    /** Its node id. */
    id: Type.String(),
    label: Type.String(),
    source: Type.Optional(MacDataSourceSchema),
    itemId: Type.Optional(Type.String()),
    pageId: Type.Optional(Type.String()),
    at: Type.Optional(Type.Number()),
});
export type DataGraphExample = Static<typeof DataGraphExampleSchema>;

/** One reason two nodes are connected. */
export const DataGraphReasonSchema = Type.Object({
    /** Remove it with this id. */
    id: Type.String(),
    kind: DataGraphRelationKindSchema,
    /** Relationships: spouse, child, friend… */
    type: Type.Optional(Type.String()),
    /** Relationships: `to` is `from`'s `type` ("Emma is Alex's daughter"). Node ids. */
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    madeBy: DataGraphMadeBySchema,
    /** 0–1. Rule reasons are 1 (or close to it). */
    confidence: Type.Number(),
    /** Why, in a few words. */
    evidence: Type.String(),
    /** Interactions: how many messages, emails or events. */
    count: Type.Optional(Type.Number()),
    /** Seconds since 1970: the first and last time it happened. */
    firstAt: Type.Optional(Type.Number()),
    lastAt: Type.Optional(Type.Number()),
    /** A few of the items it rests on, newest first. */
    examples: Type.Optional(Type.Array(DataGraphExampleSchema)),
});
export type DataGraphReason = Static<typeof DataGraphReasonSchema>;

export const DataGraphNodeSchema = Type.Object({
    /** `item:<ownerId>:<itemId>`, or a person, place, topic or event id. */
    id: Type.String(),
    kind: DataGraphNodeKindSchema,
    label: Type.String(),
    /** For items. */
    source: Type.Optional(MacDataSourceSchema),
    /** Items, and people with a contact card: the item, and the data page that shows it. */
    itemId: Type.Optional(Type.String()),
    pageId: Type.Optional(Type.String()),
    /** Whose data, when it isn't the viewer's. */
    ownerName: Type.Optional(Type.String()),
    /** Seconds since 1970. */
    at: Type.Optional(Type.Number()),
    endAt: Type.Optional(Type.Number()),
    snippet: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    // People: what their contact card says (only cards the reader may see).
    handles: Type.Optional(Type.Array(Type.String())),
    birthday: Type.Optional(Type.String()),
    organization: Type.Optional(Type.String()),
    jobTitle: Type.Optional(Type.String()),
    /** The card's related names (not in shared notebooks). */
    relations: Type.Optional(
        Type.Array(Type.Object({ label: Type.Optional(Type.String()), name: Type.String() })),
    ),
    /** This person is a member whose data the notebook shows. */
    isOwner: Type.Optional(Type.Boolean()),
});
export type DataGraphNode = Static<typeof DataGraphNodeSchema>;

/** One line between two nodes, with every reason they're connected. */
export const DataGraphLinkSchema = Type.Object({
    /** The pair: `${notebookId}|${a}|${b}`. */
    id: Type.String(),
    source: Type.String(),
    target: Type.String(),
    /** Strongest first. */
    reasons: Type.Array(DataGraphReasonSchema),
    /** More and stronger reasons weigh more (1 is one certain reason). */
    weight: Type.Number(),
    /** The strongest reason's kind, confidence, evidence and maker. */
    kind: DataGraphRelationKindSchema,
    confidence: Type.Number(),
    evidence: Type.String(),
    madeBy: DataGraphMadeBySchema,
});
export type DataGraphLink = Static<typeof DataGraphLinkSchema>;

export const DataGraphStatusSchema = Type.Object({
    /** When the 30-day backfill finished, if it has. */
    backfilledAt: Type.Optional(Type.String()),
    lastRunAt: Type.Optional(Type.String()),
    /** Model links are made (the server has a model key). */
    modelLinks: Type.Boolean(),
});
export type DataGraphStatus = Static<typeof DataGraphStatusSchema>;

export const DataGraphSchema = Type.Object({
    nodes: Type.Array(DataGraphNodeSchema),
    links: Type.Array(DataGraphLinkSchema),
    status: DataGraphStatusSchema,
    /** True when the graph was cut to the newest nodes. */
    truncated: Type.Optional(Type.Boolean()),
});
export type DataGraph = Static<typeof DataGraphSchema>;

/** A notebook's graph page has a fixed id, so a notebook can only ever have one. */
export function graphPageId(notebookId: string): string {
    return `graph-${notebookId}`;
}

/** The node id of one person's device item. */
export function dataGraphItemNodeId(ownerId: string, itemId: string): string {
    return `item:${ownerId}:${itemId}`;
}

/** Splits an item node id; null for people, places, topics and events. */
export function parseDataGraphItemNodeId(id: string): { ownerId: string; itemId: string } | null {
    if (!id.startsWith('item:')) return null;
    const rest = id.slice(5);
    const colon = rest.indexOf(':');
    if (colon <= 0 || colon === rest.length - 1) return null;
    return { ownerId: rest.slice(0, colon), itemId: rest.slice(colon + 1) };
}

/** How much one reason adds to a line's weight. */
export function dataGraphReasonWeight(
    reason: Pick<DataGraphReason, 'kind' | 'confidence' | 'count'>,
): number {
    const base = reason.kind === 'relationship' ? 1.5 : 1;
    const many = reason.count && reason.count > 1 ? Math.min(Math.log10(reason.count), 2) : 0;
    return Math.round((base * reason.confidence + many) * 100) / 100;
}
