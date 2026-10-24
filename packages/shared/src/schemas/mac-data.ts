import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// Data that lives only on the user's Mac (iMessage, Mail, Calendar).
// The Mac app owns the database; the web app reads it through the
// `macData` script message handler. Nothing here is stored in the cloud.

export const MacDataSourceSchema = Type.Union([
    Type.Literal('imessage'),
    Type.Literal('mail'),
    Type.Literal('calendar'),
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
    participants: Type.Array(Type.String()),
    thread: Type.Optional(Type.String()),
    body: Type.String(),
    isFromMe: Type.Optional(Type.Boolean()),
    location: Type.Optional(Type.String()),
    calendar: Type.Optional(Type.String()),
    allDay: Type.Optional(Type.Boolean()),
    mailbox: Type.Optional(Type.String()), // Mailbox for email; service for iMessage
    isRead: Type.Optional(Type.Boolean()),
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
