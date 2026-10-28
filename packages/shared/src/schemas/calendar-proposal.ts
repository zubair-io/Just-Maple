import { Type, Static } from '@sinclair/typebox';
import { HomeServiceCallSchema } from './home';

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
 * - `expired`: nobody tapped, or the Mac never picked it up, within 7 days;
 * - `removed`: added, then undone from the action log; the Mac removed it again;
 * - `not_found`: added, but on Undo the Mac couldn't find it any more (removed by hand,
 *   or moved); the bot may offer it again;
 * - `cancelled`: the owner cancelled an automatic add before the Mac picked it up.
 */
export const CalendarProposalStatusSchema = Type.Union([
    Type.Literal('proposed'),
    Type.Literal('adding'),
    Type.Literal('added'),
    Type.Literal('failed'),
    Type.Literal('expired'),
    Type.Literal('removed'),
    Type.Literal('not_found'),
    Type.Literal('cancelled'),
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
export const CreateEventActionSchema = Type.Object({
    id: Type.String(),
    type: Type.Literal('create_event'),
    source: Type.Literal('calendar'),
    event: CalendarEventDraftSchema,
    createdAt: Type.String(),
    expiresAt: Type.String(),
});

/**
 * Undo of an added event (bot-action log). The Mac removes the event only when it still
 * carries the marker of the `create_event` action `createdBy`, so it never removes an
 * event Just Maple didn't add. Gone already is reported as `outcome: 'not_found'`. `event` is the one that was
 * added, also so Macs from before undo decode the list (and refuse this action).
 */
export const DeleteEventActionSchema = Type.Object({
    id: Type.String(),
    type: Type.Literal('delete_event'),
    source: Type.Literal('calendar'),
    /** EventKit's `calendarItemIdentifier`, as the Mac reported it. */
    eventIdentifier: Type.String(),
    /** The id of the `create_event` action that added it. */
    createdBy: Type.String(),
    event: CalendarEventDraftSchema,
    createdAt: Type.String(),
    expiresAt: Type.String(),
});

/**
 * A Home Assistant service call the owner confirmed (see home.ts). The Mac refuses it after
 * `expiresAt`. Only the Mac collecting `home` gets these, and that Mac's build knows them.
 */
export const HomeDeviceActionSchema = Type.Object({
    id: Type.String(),
    type: Type.Literal('home_service'),
    source: Type.Literal('home'),
    call: HomeServiceCallSchema,
    createdAt: Type.String(),
    expiresAt: Type.String(),
});
export type HomeDeviceAction = Static<typeof HomeDeviceActionSchema>;

export const DeviceActionSchema = Type.Union([
    CreateEventActionSchema,
    DeleteEventActionSchema,
    HomeDeviceActionSchema,
]);
export type DeviceAction = Static<typeof DeviceActionSchema>;
export type CreateEventAction = Static<typeof CreateEventActionSchema>;
export type DeleteEventAction = Static<typeof DeleteEventActionSchema>;

export const DeviceActionResultSchema = Type.Object({
    ok: Type.Boolean(),
    /** EventKit's `calendarItemIdentifier`. */
    eventIdentifier: Type.Optional(Type.String({ maxLength: 500 })),
    /** The item id the next calendar upload will use for it. */
    itemId: Type.Optional(Type.String({ maxLength: 600 })),
    error: Type.Optional(Type.String({ maxLength: 500 })),
    /**
     * `not_found` (with `ok: true`): a `delete_event` found nothing to remove, so nothing
     * was removed. Macs from before this field report a missing event as plain success.
     */
    outcome: Type.Optional(Type.Literal('not_found')),
});
export type DeviceActionResult = Static<typeof DeviceActionResultSchema>;
