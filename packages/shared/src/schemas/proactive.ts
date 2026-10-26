import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

// A messages page can have one proactive bot. It answers every message in the
// page without an @mention and posts on its own when new Mac data arrives.

export const ProactiveBotSettingsSchema = Type.Object({
    userBotId: Type.String(),
    // The user's standing guidance; corrections ("he's not doing that anymore") are appended
    instructions: Type.String({ maxLength: 8000 }),
    enabled: Type.Boolean(),
    // Whose Mac supplies iMessage, Mail and Calendar data for this bot
    ownerUserId: Type.String(),
    // A daily brief at this local time ("07:30", the owner's time zone); none when absent
    briefTime: Type.Optional(Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type ProactiveBotSettings = Static<typeof ProactiveBotSettingsSchema>;

export const UpdateProactiveBotSchema = Type.Object({
    userBotId: Type.String(),
    instructions: Type.String({ maxLength: 8000 }),
    enabled: Type.Boolean(),
    // "HH:MM" for a daily brief; null or absent turns it off
    briefTime: Type.Optional(
        Type.Union([Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), Type.Null()]),
    ),
});

export type UpdateProactiveBotInput = Static<typeof UpdateProactiveBotSchema>;
