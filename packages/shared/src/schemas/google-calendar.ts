import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// Google Calendar event schema (from Google Calendar API)
export const GoogleCalendarEventSchema = Type.Object({
    id: Type.String(),
    summary: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    start: Type.Object({
        dateTime: Type.Optional(Type.String()), // ISO 8601 for timed events
        date: Type.Optional(Type.String()), // YYYY-MM-DD for all-day events
        timeZone: Type.Optional(Type.String()),
    }),
    end: Type.Object({
        dateTime: Type.Optional(Type.String()),
        date: Type.Optional(Type.String()),
        timeZone: Type.Optional(Type.String()),
    }),
    status: Type.Optional(Type.String()), // confirmed, tentative, cancelled
    htmlLink: Type.Optional(Type.String()), // Link to event in Google Calendar
    colorId: Type.Optional(Type.String()),
});

export type GoogleCalendarEvent = Static<typeof GoogleCalendarEventSchema>;

// Calendar list entry (from Google Calendar API)
export const GoogleCalendarEntrySchema = Type.Object({
    id: Type.String(), // Calendar ID (usually email)
    summary: Type.String(), // Calendar name
    description: Type.Optional(Type.String()),
    primary: Type.Optional(Type.Boolean()),
    backgroundColor: Type.Optional(Type.String()),
    foregroundColor: Type.Optional(Type.String()),
    accessRole: Type.Optional(Type.String()), // owner, writer, reader, freeBusyReader
});

export type GoogleCalendarEntry = Static<typeof GoogleCalendarEntrySchema>;

// Google Calendar agenda block configuration (stored in ProseMirror node attrs)
export const GoogleCalendarAgendaConfigSchema = Type.Object({
    id: Type.String(),
    title: Type.String(),
    startDate: Type.String(), // YYYY-MM-DD
    endDate: Type.String(), // YYYY-MM-DD
    calendarId: Type.Optional(Type.String()), // Google Calendar ID
    calendarName: Type.Optional(Type.String()), // Display name
    collapsed: Type.Optional(Type.Boolean()),
});

export type GoogleCalendarAgendaConfig = Static<typeof GoogleCalendarAgendaConfigSchema>;
