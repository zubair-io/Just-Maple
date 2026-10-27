import { Type, Static } from '@sinclair/typebox';

/**
 * "Add to calendar" proposals.
 *
 * A bot proposes an event; the calendar's owner taps Add; the server queues a
 * `create_event` action for their Mac (the device collecting `calendar`); the Mac adds
 * it with EventKit and reports back. Nothing is added without that tap.
 */

/** The event as the bot proposed it. Times are seconds since 1970. */
export const CalendarEventDraftSchema = Type.Object({
    title: Type.String({ minLength: 1, maxLength: 200 }),
    start: Type.Number(),
    end: Type.Number(),
    allDay: Type.Optional(Type.Boolean()),
    location: Type.Optional(Type.String({ maxLength: 500 })),
    notes: Type.Optional(Type.String({ maxLength: 2000 })),
    /** The owner's time zone when proposed, for showing the times. */
    timeZone: Type.Optional(Type.String({ maxLength: 100 })),
});
export type CalendarEventDraft = Static<typeof CalendarEventDraftSchema>;

/**
 * What the card shows:
 * - `proposed`: waiting for the owner's tap;
 * - `adding`: tapped, waiting for the Mac;
 * - `added`: on the calendar (`itemId` opens it once the Mac uploads it);
 * - `failed`: the Mac couldn't add it (`error` says why); the owner can try again;
 * - `expired`: nobody tapped, or the Mac never picked it up, within 7 days.
 */
export const CalendarProposalStatusSchema = Type.Union([
    Type.Literal('proposed'),
    Type.Literal('adding'),
    Type.Literal('added'),
    Type.Literal('failed'),
    Type.Literal('expired'),
]);
export type CalendarProposalStatus = Static<typeof CalendarProposalStatusSchema>;

export const CalendarProposalSchema = Type.Object({
    id: Type.String(),
    notebookId: Type.String(),
    pageId: Type.Optional(Type.String()),
    messageId: Type.Optional(Type.String()),
    event: CalendarEventDraftSchema,
    status: CalendarProposalStatusSchema,
    error: Type.Optional(Type.String()),
    /** The calendar page item, `calendar:<id>@<start>`, once added. */
    itemId: Type.Optional(Type.String()),
    /** While adding: the Mac it waits for, and whether it has been away over 10 minutes. */
    device: Type.Optional(
        Type.Object({
            name: Type.String(),
            lastSeenAt: Type.String(),
            offline: Type.Boolean(),
        }),
    ),
    /** True only for the calendar's owner, the one person who can tap Add. */
    canConfirm: Type.Boolean(),
    expiresAt: Type.String(),
    updatedAt: Type.String(),
});
export type CalendarProposal = Static<typeof CalendarProposalSchema>;

// MARK: - Collector action queue

/** A pending action for a collector. The id is stable across retries: the device uses it to avoid doing the same thing twice. */
export const DeviceActionSchema = Type.Object({
    id: Type.String(),
    type: Type.Literal('create_event'),
    source: Type.Literal('calendar'),
    event: CalendarEventDraftSchema,
    createdAt: Type.String(),
    expiresAt: Type.String(),
});
export type DeviceAction = Static<typeof DeviceActionSchema>;

export const DeviceActionResultSchema = Type.Object({
    ok: Type.Boolean(),
    /** EventKit's `calendarItemIdentifier`. */
    eventIdentifier: Type.Optional(Type.String({ maxLength: 500 })),
    /** The item id the next calendar upload will use for it. */
    itemId: Type.Optional(Type.String({ maxLength: 600 })),
    error: Type.Optional(Type.String({ maxLength: 500 })),
});
export type DeviceActionResult = Static<typeof DeviceActionResultSchema>;
