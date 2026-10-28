import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// A messages page can have one proactive bot. It answers every message in the
// page without an @mention and posts on its own when new Mac data arrives.

const HHMM = { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' };

// Hours (owner's time zone) when only urgent news goes out; the rest waits. The window
// may cross midnight ("22:00" to "07:00").
export const ProactiveQuietHoursSchema = Type.Object({
    enabled: Type.Boolean(),
    start: Type.String(HHMM),
    end: Type.String(HHMM),
});

export type ProactiveQuietHours = Static<typeof ProactiveQuietHoursSchema>;

/** What a proactive bot does when its settings leave a timing option out. */
export const PROACTIVE_TIMING_DEFAULTS: {
    /** Nothing waits in the pile longer than this before a summary goes out. */
    maxWaitMinutes: number;
    quietHours: ProactiveQuietHours;
} = {
    maxWaitMinutes: 120,
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
};

export const ProactiveBotSettingsSchema = Type.Object({
    userBotId: Type.String(),
    // The user's standing guidance; corrections ("he's not doing that anymore") are appended
    instructions: Type.String({ maxLength: 8000 }),
    enabled: Type.Boolean(),
    // Whose Mac supplies iMessage, Mail and Calendar data for this bot
    ownerUserId: Type.String(),
    // A daily brief at this local time ("07:30", the owner's time zone); none when absent
    briefTime: Type.Optional(Type.String(HHMM)),
    // Timing: how long news that isn't urgent may wait, and when only urgent news goes out
    maxWaitMinutes: Type.Optional(Type.Number({ minimum: 5, maximum: 1440 })),
    quietHours: Type.Optional(ProactiveQuietHoursSchema),
    // Escape hatch: tell the user about every batch right away (no waiting, no updates)
    everyItem: Type.Optional(Type.Boolean()),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type ProactiveBotSettings = Static<typeof ProactiveBotSettingsSchema>;

export const UpdateProactiveBotSchema = Type.Object({
    userBotId: Type.String(),
    instructions: Type.String({ maxLength: 8000 }),
    enabled: Type.Boolean(),
    // "HH:MM" for a daily brief; null or absent turns it off
    briefTime: Type.Optional(Type.Union([Type.String(HHMM), Type.Null()])),
    maxWaitMinutes: Type.Optional(Type.Number({ minimum: 5, maximum: 1440 })),
    quietHours: Type.Optional(ProactiveQuietHoursSchema),
    everyItem: Type.Optional(Type.Boolean()),
});

export type UpdateProactiveBotInput = Static<typeof UpdateProactiveBotSchema>;

// What a proactive bot's post is, stored on the message: the kind of post, and for news,
// how urgent it was (0 routine to 3 act now). An unread news post may be revised in place.
export const ProactiveMessageMetaSchema = Type.Object({
    kind: Type.Union([
        Type.Literal('news'),
        Type.Literal('brief'),
        Type.Literal('leave'),
        Type.Literal('question'),
    ]),
    urgency: Type.Optional(Type.Number({ minimum: 0, maximum: 3 })),
});

export type ProactiveMessageMeta = Static<typeof ProactiveMessageMetaSchema>;
