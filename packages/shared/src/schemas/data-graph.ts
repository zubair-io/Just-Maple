import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { MacDataSourceSchema } from './mac-data';

// The connected-data graph: links between the device items a notebook's data pages show,
// plus people, places and topics. A graph belongs to one notebook. It is built only from
// what that notebook's data pages share, and nothing in it reaches another notebook.

export const DataGraphNodeKindSchema = Type.Union([
    Type.Literal('item'),
    Type.Literal('person'),
    Type.Literal('place'),
    Type.Literal('topic'),
]);
export type DataGraphNodeKind = Static<typeof DataGraphNodeKindSchema>;

export const DataGraphLinkKindSchema = Type.Union([
    /** An event created while a visit was at the event's location. */
    Type.Literal('created_at'),
    /** A visit at an event's location during the event. */
    Type.Literal('attended'),
    /** An item at a place (a visit, or an event whose address is the place). */
    Type.Literal('at_place'),
    /** Driving time to an event, from a place. */
    Type.Literal('travel'),
    /** A message, email or contact card from or with a person. */
    Type.Literal('person'),
    /** Two items about the same thing (the model's judgment). */
    Type.Literal('related'),
    /** An item belongs to a topic. */
    Type.Literal('topic'),
]);
export type DataGraphLinkKind = Static<typeof DataGraphLinkKindSchema>;

export const DataGraphNodeSchema = Type.Object({
    /** `item:<ownerId>:<itemId>`, or a person, place or topic id. */
    id: Type.String(),
    kind: DataGraphNodeKindSchema,
    label: Type.String(),
    /** For items. */
    source: Type.Optional(MacDataSourceSchema),
    itemId: Type.Optional(Type.String()),
    /** The data page that shows the item, to open it. */
    pageId: Type.Optional(Type.String()),
    /** Whose data, when it isn't the viewer's. */
    ownerName: Type.Optional(Type.String()),
    /** Seconds since 1970. */
    at: Type.Optional(Type.Number()),
    endAt: Type.Optional(Type.Number()),
    snippet: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
});
export type DataGraphNode = Static<typeof DataGraphNodeSchema>;

export const DataGraphLinkSchema = Type.Object({
    id: Type.String(),
    source: Type.String(),
    target: Type.String(),
    kind: DataGraphLinkKindSchema,
    /** 0–1. Rule links are 1 (or close to it). */
    confidence: Type.Number(),
    /** Why the two are linked, in a few words. */
    evidence: Type.String(),
    madeBy: Type.Union([Type.Literal('rule'), Type.Literal('model')]),
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

/** Splits an item node id; null for people, places and topics. */
export function parseDataGraphItemNodeId(id: string): { ownerId: string; itemId: string } | null {
    if (!id.startsWith('item:')) return null;
    const rest = id.slice(5);
    const colon = rest.indexOf(':');
    if (colon <= 0 || colon === rest.length - 1) return null;
    return { ownerId: rest.slice(0, colon), itemId: rest.slice(colon + 1) };
}
