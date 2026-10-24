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
    updatedAt: Type.String({ format: 'date-time' }),
});

export type ProactiveBotSettings = Static<typeof ProactiveBotSettingsSchema>;

export const UpdateProactiveBotSchema = Type.Object({
    userBotId: Type.String(),
    instructions: Type.String({ maxLength: 8000 }),
    enabled: Type.Boolean(),
});

export type UpdateProactiveBotInput = Static<typeof UpdateProactiveBotSchema>;
