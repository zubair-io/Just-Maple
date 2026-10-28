import { Type, Static } from '@sinclair/typebox';

/**
 * The action log and per-bot autonomy.
 *
 * Every action a bot proposes or performs gets one row (`BotAction`): what it was, who
 * approved it, and how it ended. The bot's owner picks, per bot and per kind of action,
 * whether the bot asks every time, does it and says so (with Undo), or never does it.
 * Bots only propose; the server decides ask versus auto, and some actions are always Ask.
 *
 * Adding a kind of action:
 * 1. add its literal to `BotActionKindSchema` and an entry to `BOT_ACTION_KINDS`;
 * 2. if some of its actions must always be confirmed, say so in `isAlwaysAsk`;
 * 3. on the server, call `recordAction` / `updateAction` (bot-action.service) as it moves,
 *    and register undo / settle handlers in `bot-action-kinds.ts` if it has them.
 */

export const BotActionKindSchema = Type.Union([
    Type.Literal('calendar_add'), // "Add to calendar" (calendar-proposal.service)
    Type.Literal('home_service'), // A Home Assistant service call
    Type.Literal('send_reply'), // Sending a drafted message or email reply
]);
export type BotActionKind = Static<typeof BotActionKindSchema>;

/**
 * proposed ──tap──▶ approved ─┐
 *    │  └──setting: auto──▶ auto ─┼─▶ queued ──▶ done ──Undo (24 h)──▶ undone
 *    │                            │      └──────▶ failed ──tap again──▶ queued
 *    ├──setting: never──▶ denied  │
 *    └──── nobody acted in time ──┴──▶ expired
 */
export const BotActionStatusSchema = Type.Union([
    Type.Literal('proposed'), // Waiting for the owner's tap
    Type.Literal('approved'), // The owner tapped; about to be queued
    Type.Literal('denied'), // Not done: the owner said no, or the bot may never do this
    Type.Literal('auto'), // Approved by the owner's "Do it and tell me" setting
    Type.Literal('queued'), // Waiting for a device (or a service) to do it
    Type.Literal('done'),
    Type.Literal('failed'),
    Type.Literal('undone'),
    Type.Literal('expired'),
]);
export type BotActionStatus = Static<typeof BotActionStatusSchema>;

/** Not finished yet: these can still expire. */
export const OPEN_BOT_ACTION_STATUSES: BotActionStatus[] = [
    'proposed',
    'approved',
    'auto',
    'queued',
];

/**
 * - `ask`: the bot proposes and the owner taps (the default);
 * - `auto`: "Do it and tell me": done without a tap, then a "Done: … · Undo" card;
 * - `never`: the bot can't do it at all.
 */
export const BotAutonomySchema = Type.Union([
    Type.Literal('ask'),
    Type.Literal('auto'),
    Type.Literal('never'),
]);
export type BotAutonomy = Static<typeof BotAutonomySchema>;

export const DEFAULT_BOT_AUTONOMY: BotAutonomy = 'ask';

/** Undo is offered this long after an action is done. */
export const BOT_ACTION_UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface BotActionKindInfo {
    /** For settings: "Add calendar events". */
    label: string;
    /** One line under the label. */
    description: string;
    /** False: always Ask, whatever is saved (a hard floor). */
    autoAllowed: boolean;
    /** Done actions of this kind can be undone (within `BOT_ACTION_UNDO_WINDOW_MS`). */
    undoable: boolean;
    /** Material symbol for lists. */
    icon: string;
    /** What a "Done" card says: "Added to your calendar". */
    doneLabel: string;
}

export const BOT_ACTION_KINDS: Record<BotActionKind, BotActionKindInfo> = {
    calendar_add: {
        label: 'Add calendar events',
        description: 'Events the bot finds in your mail and messages.',
        autoAllowed: true,
        undoable: true,
        icon: 'calendar_add_on',
        doneLabel: 'Added to your calendar',
    },
    home_service: {
        label: 'Control your home',
        description:
            'Lights, scenes and other Home Assistant devices. Unlocking and opening doors always asks.',
        autoAllowed: true,
        undoable: false,
        icon: 'home',
        doneLabel: 'Done',
    },
    send_reply: {
        label: 'Send messages and email',
        description: 'Always asks before anything is sent.',
        autoAllowed: false,
        undoable: false,
        icon: 'send',
        doneLabel: 'Sent',
    },
};

export const BOT_ACTION_KIND_IDS = Object.keys(BOT_ACTION_KINDS) as BotActionKind[];

/** Home Assistant calls that send messages, unlock, open or disarm: never automatic. */
export function isSensitiveHomeService(params: unknown): boolean {
    const p = (params ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');
    const entity = text(p['entityId'] ?? p['entity_id']);
    const domain = text(p['domain']) || entity.split('.')[0] || '';
    const service = text(p['service']);
    const deviceClass = text(p['deviceClass'] ?? p['device_class']);
    if (domain === 'notify' || domain === 'tts') return true; // Sends a message
    if (domain === 'lock') return service !== 'lock'; // unlock, open
    if (domain === 'alarm_control_panel') return service.includes('disarm');
    if (domain === 'cover') {
        const opens =
            service.startsWith('open') || service === 'toggle' || service.startsWith('set_cover');
        const door =
            ['garage', 'gate', 'door'].includes(deviceClass) || /garage|gate|door/.test(entity);
        return opens && door;
    }
    // Anything that can't be told apart is treated as sensitive.
    return !domain;
}

/**
 * The hard floors: actions that are always Ask, whatever the setting says. Sending
 * messages or email, and unlocking locks or opening garage doors.
 */
export function isAlwaysAsk(kind: BotActionKind, params?: unknown): boolean {
    if (!BOT_ACTION_KINDS[kind]?.autoAllowed) return true;
    if (kind === 'home_service') return isSensitiveHomeService(params);
    return false;
}

/** The settings a person can save for a kind: `auto` only where the floor allows it. */
export function autonomyChoices(kind: BotActionKind): BotAutonomy[] {
    return BOT_ACTION_KINDS[kind]?.autoAllowed ? ['ask', 'auto', 'never'] : ['ask', 'never'];
}

// MARK: - API shapes

export const BotAutonomySettingsSchema = Type.Record(Type.String(), BotAutonomySchema);
export type BotAutonomySettings = Partial<Record<BotActionKind, BotAutonomy>>;

export const UpdateBotAutonomySchema = Type.Object({
    kind: BotActionKindSchema,
    autonomy: BotAutonomySchema,
});
export type UpdateBotAutonomyInput = Static<typeof UpdateBotAutonomySchema>;

export const BotActionUndoSchema = Type.Object({
    state: Type.Union([
        Type.Literal('queued'),
        Type.Literal('delivered'),
        Type.Literal('done'),
        Type.Literal('failed'),
    ]),
    error: Type.Optional(Type.String()),
    requestedAt: Type.String(),
    completedAt: Type.Optional(Type.String()),
});
export type BotActionUndo = Static<typeof BotActionUndoSchema>;

/**
 * One row of the log as a person sees it. Only the owner gets `params`, `result`,
 * `error` and `undo`; other members of a shared notebook see the summary of actions
 * posted in that chat.
 */
export const BotActionSchema = Type.Object({
    id: Type.String(),
    kind: BotActionKindSchema,
    /** True when the viewer is the person the action was for. */
    isOwner: Type.Boolean(),
    ownerId: Type.String(),
    botId: Type.String(),
    botName: Type.Optional(Type.String()),
    notebookId: Type.String(),
    pageId: Type.Optional(Type.String()),
    messageId: Type.Optional(Type.String()),
    /** "Add “Pizza party” to the calendar, Wed, Oct 28, 3:00 – 4:00 PM". */
    summary: Type.String(),
    status: BotActionStatusSchema,
    /** How it was decided: the owner's tap, their setting, or the floor. */
    decision: Type.Optional(
        Type.Union([Type.Literal('ask'), Type.Literal('auto'), Type.Literal('never')]),
    ),
    approvedBy: Type.Optional(Type.String()),
    approvedAt: Type.Optional(Type.String()),
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    result: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    error: Type.Optional(Type.String()),
    undo: Type.Optional(BotActionUndoSchema),
    /** The owner can undo it now. */
    canUndo: Type.Boolean(),
    /** While done and undoable: until when. */
    undoableUntil: Type.Optional(Type.String()),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    completedAt: Type.Optional(Type.String()),
    expiresAt: Type.Optional(Type.String()),
});
export type BotAction = Static<typeof BotActionSchema>;

/** What the chat hears when an action changes: no parameters, everyone gets it. */
export type BotActionUpdate = Omit<
    BotAction,
    'isOwner' | 'params' | 'result' | 'error' | 'undo' | 'canUndo'
>;

/** A notebook's Activity page has a fixed id, so a notebook can only ever have one. */
export function activityPageId(notebookId: string): string {
    return `activity-${notebookId}`;
}
