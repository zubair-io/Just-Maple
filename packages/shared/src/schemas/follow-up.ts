import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';
import { MacDataSourceSchema } from './mac-data';

// Follow-ups: promises and replies owed, in both directions, found in a person's own
// messages and mail. They belong to that person and are read through a notebook's data
// pages: a follow-up shows in a notebook only while its evidence is shared there.

export const FollowUpDirectionSchema = Type.Union([
    /** You said you'd do something ("I'll send you the photos tomorrow"). */
    Type.Literal('you_promised'),
    /** They said they'd do something for you ("I'll get back to you Friday"). */
    Type.Literal('they_owe'),
    /** You asked a question and haven't had an answer. */
    Type.Literal('waiting_reply'),
    /** They asked you something directly and you haven't answered. */
    Type.Literal('owe_reply'),
]);
export type FollowUpDirection = Static<typeof FollowUpDirectionSchema>;

export const FollowUpStatusSchema = Type.Union([
    Type.Literal('open'),
    Type.Literal('done'),
    Type.Literal('dismissed'),
    Type.Literal('snoozed'),
]);
export type FollowUpStatus = Static<typeof FollowUpStatusSchema>;

/** Why a follow-up closed by itself. */
export const FollowUpCloseReasonSchema = Type.Union([
    Type.Literal('reply'),
    Type.Literal('attachment'),
    Type.Literal('calendar'),
]);
export type FollowUpCloseReason = Static<typeof FollowUpCloseReasonSchema>;

export const FollowUpEvidenceSchema = Type.Object({
    itemId: Type.String(),
    source: MacDataSourceSchema,
    /** The data page that shows the item, to open it. */
    pageId: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    /** Seconds since 1970. */
    at: Type.Number(),
});
export type FollowUpEvidence = Static<typeof FollowUpEvidenceSchema>;

export const FollowUpSchema = Type.Object({
    id: Type.String(),
    direction: FollowUpDirectionSchema,
    /** A person's name or handle. */
    who: Type.String(),
    /** What is owed, in a few words. */
    what: Type.String(),
    /** When it was said (seconds since 1970). */
    at: Type.Number(),
    /** A due date, if one was stated (seconds since 1970). */
    dueAt: Type.Optional(Type.Number()),
    status: FollowUpStatusSchema,
    snoozedUntil: Type.Optional(Type.Number()),
    /** 0–1. */
    confidence: Type.Number(),
    evidence: Type.Array(FollowUpEvidenceSchema),
    madeBy: Type.Union([Type.Literal('rule'), Type.Literal('model')]),
    /** Set when it closed by itself. */
    closed: Type.Optional(
        Type.Object({
            reason: FollowUpCloseReasonSchema,
            at: Type.Number(),
            itemId: Type.Optional(Type.String()),
        }),
    ),
});
export type FollowUp = Static<typeof FollowUpSchema>;

export const FollowUpActionSchema = Type.Union([
    Type.Literal('done'),
    Type.Literal('snooze'),
    Type.Literal('dismiss'),
    /** Undoes done, snooze or dismiss. */
    Type.Literal('reopen'),
]);
export type FollowUpAction = Static<typeof FollowUpActionSchema>;

export const FollowUpListSchema = Type.Object({
    followUps: Type.Array(FollowUpSchema),
    status: Type.Object({
        lastRunAt: Type.Optional(Type.String()),
        /** Promises are read by a model (the server has a model key). */
        modelAvailable: Type.Boolean(),
    }),
});
export type FollowUpList = Static<typeof FollowUpListSchema>;

/** "You owe" or "Owed to you". */
export function followUpOwedBy(direction: FollowUpDirection): 'you' | 'them' {
    return direction === 'you_promised' || direction === 'owe_reply' ? 'you' : 'them';
}

/** A notebook's Follow-ups page has a fixed id, so a notebook can only ever have one. */
export function followUpsPageId(notebookId: string): string {
    return `followups-${notebookId}`;
}
