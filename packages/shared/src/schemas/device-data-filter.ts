import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// What a device data page shares from its creator's data. Everyone in the notebook sees
// the page through this filter, and so do bots there (the creator's too); only the
// creator can change it.
//
// A page without a filter is a page from before filters existed, or one in a notebook
// nobody else can see: its creator sees everything and nobody else sees anything. In a
// shared notebook, bots get nothing from it either. An empty filter shares nothing.

const Name = Type.String({ minLength: 1, maxLength: 200 });

/** Time of day in the creator's time zone, "HH:MM", 24-hour. */
const TimeOfDay = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });

/**
 * A calendar or chat, by its own id (the device's calendar identifier, the chat's GUID)
 * so a rename or a second one with the same name doesn't change what's shared. The name
 * is for display, and matches items uploaded before devices sent ids.
 */
export const DeviceDataChoiceSchema = Type.Object({
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
    name: Name,
});
export type DeviceDataChoice = Static<typeof DeviceDataChoiceSchema>;

/** Visits that start in this window count; end before start runs past midnight. */
export const DeviceDataTimeWindowSchema = Type.Object({
    start: TimeOfDay,
    end: TimeOfDay,
});
export type DeviceDataTimeWindow = Static<typeof DeviceDataTimeWindowSchema>;

export const DeviceDataFilterSchema = Type.Object({
    /** Everything from the source. Contacts and Health have only this; for Places, it shares visits. */
    includeAll: Type.Optional(Type.Boolean()),
    /** Calendar: events from these calendars. */
    calendars: Type.Optional(Type.Array(DeviceDataChoiceSchema, { maxItems: 50 })),
    /** Mail: messages in these mailboxes (or Gmail labels), by name. */
    mailboxes: Type.Optional(Type.Array(Name, { maxItems: 50 })),
    /** iMessage: messages in these chats. */
    chats: Type.Optional(Type.Array(DeviceDataChoiceSchema, { maxItems: 50 })),
    /** Places: only visits that start in one of these windows. Empty or absent: any time. */
    timeWindows: Type.Optional(Type.Array(DeviceDataTimeWindowSchema, { maxItems: 6 })),
    /** Places: never visits at these named places (About me place ids). */
    excludePlaceIds: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 50 })),
});
export type DeviceDataFilter = Static<typeof DeviceDataFilterSchema>;

/** A page's name, description and filter, as its creator edits them. */
export const UpdateDeviceDataPageSchema = Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    description: Type.Optional(Type.String({ maxLength: 300 })),
    deviceFilter: Type.Optional(DeviceDataFilterSchema),
});
export type UpdateDeviceDataPageInput = Static<typeof UpdateDeviceDataPageSchema>;

/** How the signed-in user sees a data page, returned with its items. */
export const DeviceDataAccessSchema = Type.Object({
    /** The signed-in user created the page: they can rename, filter, move and remove it. */
    canManage: Type.Boolean(),
    /** Whose data the page shows. */
    ownerName: Type.String(),
    /** The notebook has other members (or is public). */
    shared: Type.Boolean(),
    /** What the page is for, as its creator described it. */
    description: Type.Optional(Type.String()),
    /** The page has a filter; what it lets through, in words. */
    filterSummary: Type.Optional(Type.String()),
});
export type DeviceDataAccess = Static<typeof DeviceDataAccessSchema>;

/** Choices for the creator's filter panel, from their own data. */
export const DeviceDataFilterOptionsSchema = Type.Object({
    calendars: Type.Array(DeviceDataChoiceSchema),
    mailboxes: Type.Array(Type.String()),
    chats: Type.Array(DeviceDataChoiceSchema),
    places: Type.Array(Type.Object({ id: Type.String(), name: Type.String() })),
});
export type DeviceDataFilterOptions = Static<typeof DeviceDataFilterOptionsSchema>;
