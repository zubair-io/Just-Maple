import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// Personal data collected by the user's devices: the Mac reads iMessage, Mail,
// Calendar and Contacts; the iPhone records Location visits and Health summaries.
// Each device ("collector") uploads what it reads; bots and pages use the cloud copy.

export const MacDataSourceSchema = Type.Union([
    Type.Literal('imessage'),
    Type.Literal('mail'),
    Type.Literal('calendar'),
    Type.Literal('contacts'),
    Type.Literal('location'),
    Type.Literal('health'),
    Type.Literal('home'), // Home Assistant, through the Mac: exposed entities only (home.ts)
]);

export type MacDataSource = Static<typeof MacDataSourceSchema>;

// One message, email or calendar occurrence, normalized across sources.
export const MacDataItemSchema = Type.Object({
    id: Type.String(),
    source: MacDataSourceSchema,
    revision: Type.String(),
    occurredAt: Type.Number(), // Seconds since 1970; event start for calendar
    endAt: Type.Optional(Type.Number()),
    title: Type.Optional(Type.String()), // Thread name, email subject or event title
    sender: Type.Optional(Type.String()),
    /** Reader-specific contact display metadata; raw sender/participants remain unchanged. */
    senderName: Type.Optional(Type.String()),
    senderContactId: Type.Optional(Type.String()),
    participants: Type.Array(Type.String()),
    thread: Type.Optional(Type.String()),
    body: Type.String(),
    isFromMe: Type.Optional(Type.Boolean()),
    location: Type.Optional(Type.String()),
    calendar: Type.Optional(Type.String()),
    allDay: Type.Optional(Type.Boolean()),
    mailbox: Type.Optional(Type.String()), // Mailbox for email; service for iMessage
    isRead: Type.Optional(Type.Boolean()),
    // Source-specific fields: a contact's phones and relations, a visit's coordinates,
    // a day's health totals. Small, flat JSON.
    extra: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type MacDataItem = Static<typeof MacDataItemSchema>;

// A local-only page that shows one source inside a notebook. Never synced.
export const MacDataPageSchema = Type.Object({
    id: Type.String(),
    notebookId: Type.String(),
    source: MacDataSourceSchema,
    title: Type.String(),
    createdAt: Type.Number(),
});

export type MacDataPage = Static<typeof MacDataPageSchema>;

export const MacDataSourceStateSchema = Type.Union([
    Type.Literal('off'), // No page has asked for this source yet
    Type.Literal('ready'),
    Type.Literal('syncing'),
    Type.Literal('needsAccess'),
    Type.Literal('error'),
]);

export type MacDataSourceState = Static<typeof MacDataSourceStateSchema>;

export const MacDataSourceStatusSchema = Type.Object({
    source: MacDataSourceSchema,
    state: MacDataSourceStateSchema,
    message: Type.Optional(Type.String()),
    itemCount: Type.Number(),
    lastSyncAt: Type.Optional(Type.Number()),
});

export type MacDataSourceStatus = Static<typeof MacDataSourceStatusSchema>;

export const MacDataQuerySchema = Type.Object({
    source: MacDataSourceSchema,
    search: Type.Optional(Type.String()), // Every word must match
    limit: Type.Optional(Type.Number()),
    offset: Type.Optional(Type.Number()),
    order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
    from: Type.Optional(Type.Number()),
    to: Type.Optional(Type.Number()),
});

export type MacDataQuery = Static<typeof MacDataQuerySchema>;

export const MacDataQueryResultSchema = Type.Object({
    items: Type.Array(MacDataItemSchema),
    total: Type.Number(),
});

export type MacDataQueryResult = Static<typeof MacDataQueryResultSchema>;

// ============================================
// Relay: what the server can ask the user's Mac
// ============================================

export const MacDataNotebookSourcesSchema = Type.Object({
    notebookId: Type.String(),
    sources: Type.Array(MacDataSourceSchema),
});

export type MacDataNotebookSources = Static<typeof MacDataNotebookSourcesSchema>;

// Sent by the Mac when it connects and every 30 seconds after
export const MacDataHostInfoSchema = Type.Object({
    timeZone: Type.String(),
    now: Type.String(), // The Mac's local time, ISO 8601 with offset
    notebooks: Type.Array(MacDataNotebookSourcesSchema),
    pendingEmbeddings: Type.Number(),
});

export type MacDataHostInfo = Static<typeof MacDataHostInfoSchema>;

// One search result as a bot sees it: enough to answer or cite, never the whole body
export const MacDataSearchHitSchema = Type.Object({
    id: Type.String(),
    source: MacDataSourceSchema,
    when: Type.String(), // ISO 8601 in the Mac's time zone
    end: Type.Optional(Type.String()),
    allDay: Type.Optional(Type.Boolean()),
    title: Type.Optional(Type.String()),
    sender: Type.Optional(Type.String()),
    fromMe: Type.Optional(Type.Boolean()), // The user wrote it (a message they sent)
    participants: Type.Optional(Type.Array(Type.String())),
    location: Type.Optional(Type.String()),
    calendar: Type.Optional(Type.String()),
    mailbox: Type.Optional(Type.String()),
    snippet: Type.String(),
    score: Type.Number(),
});

export type MacDataSearchHit = Static<typeof MacDataSearchHitSchema>;

export const MacDataSearchRequestSchema = Type.Object({
    notebookId: Type.String(),
    query: Type.Optional(Type.String()),
    sources: Type.Optional(Type.Array(MacDataSourceSchema)),
    from: Type.Optional(Type.Number()), // Seconds since 1970
    to: Type.Optional(Type.Number()),
    limit: Type.Optional(Type.Number()),
});

export type MacDataSearchRequest = Static<typeof MacDataSearchRequestSchema>;

// Who spoke last in a message's thread, so a bot never says someone is waiting on a
// reply the user already sent. `recent` is the thread's last few messages, oldest first.
export const MacDataConversationSchema = Type.Object({
    lastFromMe: Type.Optional(Type.String()), // ISO 8601 in the Mac's time zone
    lastFromThem: Type.Optional(Type.String()),
    recent: Type.Array(
        Type.Object({
            from: Type.Union([Type.Literal('me'), Type.Literal('them')]),
            when: Type.String(),
            text: Type.String(),
        }),
    ),
});

export type MacDataConversation = Static<typeof MacDataConversationSchema>;

// New or changed items the Mac offers a notebook's proactive bot
export const MacDataChangeBatchSchema = Type.Object({
    notebookId: Type.String(),
    entries: Type.Array(
        Type.Object({
            kind: Type.String(), // 'added' | 'changed'
            item: MacDataSearchHitSchema,
            conversation: Type.Optional(MacDataConversationSchema),
        }),
    ),
});

export type MacDataChangeBatch = Static<typeof MacDataChangeBatchSchema>;

// ============================================
// Collectors: devices that upload personal data
// ============================================

export const CollectorPlatformSchema = Type.Union([Type.Literal('macos'), Type.Literal('ios')]);
export type CollectorPlatform = Static<typeof CollectorPlatformSchema>;

// One signed-in device. `sources` is what it can collect; `activeSources` is what it
// actually uploads. Each source has one active collector per user, so data isn't duplicated.
export const CollectorSchema = Type.Object({
    deviceId: Type.String(),
    platform: CollectorPlatformSchema,
    name: Type.String(),
    sources: Type.Array(MacDataSourceSchema),
    activeSources: Type.Array(MacDataSourceSchema),
    timeZone: Type.Optional(Type.String()),
    lastSeenAt: Type.Optional(Type.String()),
    lastUploadAt: Type.Optional(Type.String()),
    itemCounts: Type.Optional(Type.Record(Type.String(), Type.Number())),
});
export type Collector = Static<typeof CollectorSchema>;

export const RegisterCollectorSchema = Type.Object({
    deviceId: Type.String({ minLength: 8, maxLength: 128 }),
    platform: CollectorPlatformSchema,
    name: Type.String({ minLength: 1, maxLength: 100 }),
    sources: Type.Array(MacDataSourceSchema, { maxItems: 10 }),
    timeZone: Type.Optional(Type.String({ maxLength: 64 })),
});
export type RegisterCollectorInput = Static<typeof RegisterCollectorSchema>;

// Vectors travel as base64 of little-endian float32 values, chunks back to back.
export const DeviceItemVectorsSchema = Type.Object({
    id: Type.String(),
    revision: Type.String(),
    dimensions: Type.Number({ minimum: 1, maximum: 4096 }),
    vectors: Type.String({ maxLength: 200_000 }),
});
export type DeviceItemVectors = Static<typeof DeviceItemVectorsSchema>;

// One upload batch. The cursor is the device's own change-log position; the server
// echoes it back once everything in the batch is stored, and the device resumes from it.
export const UploadDeviceItemsSchema = Type.Object({
    deviceId: Type.String(),
    upserts: Type.Array(MacDataItemSchema, { maxItems: 500 }),
    removals: Type.Array(Type.String(), { maxItems: 2000 }),
    vectors: Type.Optional(Type.Array(DeviceItemVectorsSchema, { maxItems: 500 })),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
});
export type UploadDeviceItemsInput = Static<typeof UploadDeviceItemsSchema>;

export const UploadDeviceItemsResultSchema = Type.Object({
    stored: Type.Number(),
    removed: Type.Number(),
    vectors: Type.Number(),
    // Items for sources this device isn't the active collector for are skipped.
    skipped: Type.Number(),
    cursor: Type.Optional(Type.String()),
});
export type UploadDeviceItemsResult = Static<typeof UploadDeviceItemsResultSchema>;

/**
 * Items older than this are removed, except iMessages, archived contact mail, contacts, ongoing calendar events,
 * and Home entities' current state (only their recorded changes age out).
 */
export const DEVICE_DATA_RETENTION_DAYS = 30;

/** A Home item that holds an entity's current state (`home:<entity_id>`), not one change (`home:<entity_id>@<time>`). */
export function isHomeStateItemId(id: string): boolean {
    return id.startsWith('home:') && !id.includes('@');
}

// ============================================
// Travel time to upcoming events (computed on the iPhone with Apple Maps)
// ============================================

/** An upcoming calendar event with a location, for the iPhone to estimate travel time. */
export const UpcomingEventSchema = Type.Object({
    id: Type.String(),
    title: Type.Optional(Type.String()),
    location: Type.String(),
    start: Type.Number(), // seconds since 1970
    end: Type.Optional(Type.Number()),
});
export type UpcomingEvent = Static<typeof UpcomingEventSchema>;

export const TravelEstimateSchema = Type.Object({
    eventId: Type.String(),
    /** Driving time from where the phone is now, in minutes. */
    minutes: Type.Number({ minimum: 0, maximum: 24 * 60 }),
    /** Where the estimate starts, e.g. a named place ("Home") or an address. */
    origin: Type.Optional(Type.String({ maxLength: 200 })),
    computedAt: Type.String({ format: 'date-time' }),
});
export type TravelEstimate = Static<typeof TravelEstimateSchema>;

export const UploadTravelEstimatesSchema = Type.Object({
    deviceId: Type.String(),
    estimates: Type.Array(TravelEstimateSchema, { maxItems: 50 }),
});
export type UploadTravelEstimatesInput = Static<typeof UploadTravelEstimatesSchema>;
