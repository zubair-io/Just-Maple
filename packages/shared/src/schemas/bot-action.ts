import { Type, Static } from '@sinclair/typebox';
import { isSensitiveHomeEntity } from './home';

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
    /** Queued actions of this kind can be cancelled before they're done. */
    cancellable?: boolean;
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
        cancellable: true,
        icon: 'calendar_add_on',
        doneLabel: 'Added to your calendar',
    },
    home_service: {
        label: 'Control your home',
        description:
            'Lights, fans and other Home Assistant devices. Locks, doors, gates, scenes and scripts always ask.',
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

/**
 * Home Assistant domains whose calls are always Ask unless the server knows the entity is
 * safe: they can run anything (`homeassistant.*`, scripts, scenes, buttons), switch
 * something we can't see (switches, valves), or open the house (locks, alarms, covers).
 * Shared on purpose so the Home Assistant connector can use the same list.
 */
export const ALWAYS_ASK_HOME_DOMAINS: readonly string[] = [
    'homeassistant',
    'script',
    'scene',
    'button',
    'switch',
    'valve',
    'lock',
    'alarm_control_panel',
    'cover',
];

/** Domains that send a message somewhere: always Ask, whatever the server knows. */
export const MESSAGE_HOME_DOMAINS: readonly string[] = ['notify', 'tts'];

/**
 * What the server itself knows about an entity (from Home Assistant, never from the bot).
 * `safe: true` lets an `ALWAYS_ASK_HOME_DOMAINS` entity follow the setting; unlocking,
 * disarming, opening a garage, gate or door, and anything `isSensitiveHomeEntity` marks
 * (the Home Assistant card's double confirm) still always ask.
 */
export interface KnownHomeEntity {
    safe?: boolean;
    deviceClass?: string | null;
    /** The entity's name in Home Assistant, so a relay named "Gate opener" counts. */
    name?: string | null;
}

/** The domain of a Home Assistant call, taken only from its entity id (`lock.front_door`). */
export function homeEntityDomain(params: unknown): string {
    const p = (params ?? {}) as Record<string, unknown>;
    const entity = p['entityId'] ?? p['entity_id'];
    if (typeof entity !== 'string') return '';
    const dot = entity.indexOf('.');
    return dot > 0 ? entity.slice(0, dot).toLowerCase() : '';
}

/**
 * Home Assistant calls that are never automatic. The domain comes only from the entity id,
 * and a device class only from `known` (the server): whatever else the bot sends (`domain`,
 * `deviceClass`) is ignored.
 */
export function isSensitiveHomeService(params: unknown, known?: KnownHomeEntity): boolean {
    const p = (params ?? {}) as Record<string, unknown>;
    const domain = homeEntityDomain(p);
    if (!domain) return true; // Can't tell what it is
    const rawEntity = p['entityId'] ?? p['entity_id'];
    const entity = typeof rawEntity === 'string' ? rawEntity.toLowerCase() : '';
    const service = typeof p['service'] === 'string' ? p['service'].toLowerCase() : '';
    const deviceClass = (known?.deviceClass ?? '').toLowerCase();
    if (MESSAGE_HOME_DOMAINS.includes(domain)) return true;
    // Never safe, whatever the server knows. One rule with the Home Assistant card: every
    // call it asks twice for (locks, scenes, scripts, garage/gate/door covers and their
    // opener switches) is always Ask here too.
    if (
        isSensitiveHomeEntity({
            entityId: entity,
            deviceClass: deviceClass || undefined,
            name: known?.name ?? undefined,
        })
    )
        return true;
    if (domain === 'lock' && service !== 'lock') return true; // unlock, open
    if (domain === 'alarm_control_panel' && service.includes('disarm')) return true;
    if (domain === 'cover') {
        const opens =
            service.startsWith('open') || service === 'toggle' || service.startsWith('set_cover');
        const door =
            ['garage', 'gate', 'door'].includes(deviceClass) || /garage|gate|door/.test(entity);
        if (opens && door) return true;
    }
    if (ALWAYS_ASK_HOME_DOMAINS.includes(domain)) return known?.safe !== true;
    return false;
}

/**
 * The hard floors: actions that are always Ask, whatever the setting says. Sending
 * messages or email, unlocking locks or opening garage doors, and Home Assistant calls
 * the server can't vouch for (`known`, see `isSensitiveHomeService`).
 */
export function isAlwaysAsk(
    kind: BotActionKind,
    params?: unknown,
    known?: KnownHomeEntity,
): boolean {
    if (!BOT_ACTION_KINDS[kind]?.autoAllowed) return true;
    if (kind === 'home_service') return isSensitiveHomeService(params, known);
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
        /** The Mac couldn't find the event: nothing was removed. */
        Type.Literal('not_found'),
    ]),
    error: Type.Optional(Type.String()),
    requestedAt: Type.String(),
    completedAt: Type.Optional(Type.String()),
    /** The Mac asked to remove it. */
    deviceName: Type.Optional(Type.String()),
    /**
     * True when the Mac that added it no longer collects the calendar, so another one
     * was asked instead.
     */
    fallback: Type.Optional(Type.Boolean()),
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
    /** The owner can still cancel it: queued, and no device has started on it. */
    canCancel: Type.Optional(Type.Boolean()),
    /** The owner cancelled it while a device was already on it: undone once it's done. */
    cancelRequestedAt: Type.Optional(Type.String()),
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
    'isOwner' | 'params' | 'result' | 'error' | 'undo' | 'canUndo' | 'canCancel'
>;

/** A notebook's Activity page has a fixed id, so a notebook can only ever have one. */
export function activityPageId(notebookId: string): string {
    return `activity-${notebookId}`;
}
