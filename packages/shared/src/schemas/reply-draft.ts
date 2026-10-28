import { Type, Static } from '@sinclair/typebox';

/**
 * Drafted replies: a bot writes a reply in the user's voice to an iMessage or Mail
 * thread, saved as a `send_reply` row in the action log (bot-action.ts). Maple never
 * sends it. The owner edits it on the card and opens it in Messages or Mail (a
 * prefilled compose), where they press send themselves.
 *
 * Only the owner sees these parameters: everyone else gets the row's summary.
 */

export const ReplyChannelSchema = Type.Union([Type.Literal('messages'), Type.Literal('mail')]);
export type ReplyChannel = Static<typeof ReplyChannelSchema>;

export const ReplyRecipientSchema = Type.Object({
    /** A phone number or email address, from the thread itself (never from the model). */
    address: Type.String({ maxLength: 320 }),
    name: Type.Optional(Type.String({ maxLength: 200 })),
});
export type ReplyRecipient = Static<typeof ReplyRecipientSchema>;

/** The `params` of a `send_reply` row. */
export const ReplyDraftParamsSchema = Type.Object({
    channel: ReplyChannelSchema,
    /** Who the reply goes to: the thread's other participants. */
    recipients: Type.Array(ReplyRecipientSchema, { minItems: 1, maxItems: 20 }),
    /** How the card names them: "Jen" or "Soccer parents". */
    recipientLabel: Type.String({ maxLength: 200 }),
    /** The message being answered (`imessage:…` / `mail:…`). */
    itemId: Type.String({ maxLength: 400 }),
    /** The message being answered, as quoted on the card. */
    quoted: Type.Object({
        from: Type.String({ maxLength: 200 }),
        text: Type.String({ maxLength: 1000 }),
        /** ISO 8601. */
        at: Type.String(),
    }),
    /** Mail only: "Re: …". */
    subject: Type.Optional(Type.String({ maxLength: 300 })),
    /** The draft; the owner's edits replace it. */
    body: Type.String({ maxLength: 5000 }),
});
export type ReplyDraftParams = Static<typeof ReplyDraftParamsSchema>;

/** Draft text limits: a text message is short; an email may be longer. */
export const REPLY_DRAFT_MAX_CHARS: Record<ReplyChannel, number> = {
    messages: 1000,
    mail: 5000,
};

/** Drafts nobody opened or discarded expire after this long. */
export const REPLY_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const UpdateReplyDraftSchema = Type.Object({
    body: Type.String({ minLength: 1, maxLength: 5000 }),
});
export type UpdateReplyDraftInput = Static<typeof UpdateReplyDraftSchema>;

/** What the row's `result` records once the owner opens the draft. */
export interface ReplyDraftResult {
    openedAt: string;
    openCount: number;
}
