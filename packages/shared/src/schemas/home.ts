import { Type, Static } from '@sinclair/typebox';

/**
 * Home Assistant, through the user's Mac.
 *
 * Home Assistant runs on the home network, which the cloud can't reach, so the Mac
 * connects to it and acts for the server. The one rule: only entities the user exposed
 * to assistants in Home Assistant (Settings → Voice assistants → Expose) are read,
 * uploaded, shown to bots or controlled.
 *
 * 1. The Mac reads the exposed list over Home Assistant's WebSocket, subscribes to exactly
 *    those entities, and uploads their state as `home` items, plus meaningful changes.
 * 2. It also uploads the exposed list itself (`PUT /api/home/exposure`). The server hides
 *    items of entities that are no longer exposed, without deleting them.
 * 3. A bot can only propose a change (`propose_home_action`). The owner taps the card, the
 *    server queues a `home_service` action for the Mac, and the Mac checks the entity is
 *    still exposed right before it calls the service.
 */

/** Home Assistant's entity id: `domain.object_id`, lowercase letters, digits and underscores. */
export const HOME_ENTITY_ID_PATTERN = '^[a-z0-9_]{1,64}\\.[a-z0-9_]{1,190}$';
const EntityId = Type.String({ pattern: HOME_ENTITY_ID_PATTERN, maxLength: 255 });

/** At most this many exposed entities are used (Home Assistant's exposure list is capped here too). */
export const HOME_MAX_EXPOSED = 10_000;

/** The domains a bot may propose changes for. Everything else is read-only. */
export const HOME_CONTROL_DOMAINS = [
    'light',
    'switch',
    'fan',
    'cover',
    'climate',
    'lock',
    'media_player',
    'scene',
    'script',
] as const;
export type HomeControlDomain = (typeof HOME_CONTROL_DOMAINS)[number];

/** Where people are: never shared by default, and hidden from bots unless a page picks them. */
export const HOME_PRESENCE_DOMAINS = ['person', 'device_tracker', 'zone'] as const;

/** What the presence rule looks at: an entity id, and its state, class and area if known. */
export interface HomeEntityFacts {
    entityId: string;
    state?: string;
    deviceClass?: string;
    area?: string;
    name?: string;
}

/**
 * Whether an entity tells where someone is. Off by default everywhere (page filters and
 * bots), so this errs towards presence:
 * - people, device trackers and zones;
 * - groups whose state is home / not_home (a group of people or trackers);
 * - `binary_sensor.*_presence`, and anything with device class `presence`;
 * - device class `occupancy` without an area: not a room's sensor, so a person's;
 * - phone sensors that give a place away: geocoded location, Wi-Fi SSID / BSSID.
 */
export function isHomePresence(entity: HomeEntityFacts): boolean {
    const [domain = '', object = ''] = entity.entityId.split('.');
    if ((HOME_PRESENCE_DOMAINS as readonly string[]).includes(domain)) return true;
    if (domain === 'group' && (entity.state === 'home' || entity.state === 'not_home')) return true;
    if (domain === 'binary_sensor' && /(^|_)presence(_|$)/.test(object)) return true;
    if (entity.deviceClass === 'presence') return true;
    if (entity.deviceClass === 'occupancy' && !entity.area) return true;
    if (domain === 'sensor' && /geocoded_location|(^|_)b?ssid(_|$)|wifi_connection/.test(object))
        return true;
    return false;
}

/** Words that mean an entity opens or unlocks a way into the home. */
const ENTRY_WORDS = new Set([
    'garage',
    'gate',
    'gates',
    'door',
    'doors',
    'lock',
    'locks',
    'opener',
]);

/**
 * Actions that need the owner's second tap, every time (and that an autonomy setting may
 * never run without asking):
 * - every lock;
 * - every scene and script: they can do anything, including unlocking, and Home
 *   Assistant's exposure of a script says nothing about what it touches. In v1 they are
 *   offered, but always as a double-confirm card;
 * - covers with device class garage, gate or door;
 * - covers and switches whose id or name says garage, gate, door, lock or opener
 *   (`switch.garage_opener`, a relay wired to the gate).
 */
export function isSensitiveHomeEntity(entity: HomeEntityFacts): boolean {
    const domain = entity.entityId.split('.')[0] ?? '';
    if (domain === 'lock' || domain === 'scene' || domain === 'script') return true;
    if (domain !== 'cover' && domain !== 'switch') return false;
    if (['garage', 'gate', 'door'].includes(entity.deviceClass ?? '')) return true;
    const words = `${entity.entityId} ${entity.name ?? ''}`.toLowerCase();
    if (words.includes('garage') || words.includes('opener')) return true;
    return words.split(/[^a-z]+/).some((word) => ENTRY_WORDS.has(word));
}

/**
 * The services each domain allows, with the one optional value each takes. The Mac
 * checks the same list (HomeActions.swift) before calling anything.
 */
export const HOME_SERVICES: Record<HomeControlDomain, Record<string, string | null>> = {
    light: { turn_on: 'brightness_pct', turn_off: null, toggle: null },
    switch: { turn_on: null, turn_off: null, toggle: null },
    fan: { turn_on: null, turn_off: null, set_percentage: 'percentage' },
    cover: {
        open_cover: null,
        close_cover: null,
        stop_cover: null,
        set_cover_position: 'position',
    },
    climate: {
        turn_on: null,
        turn_off: null,
        set_temperature: 'temperature',
        set_hvac_mode: 'hvac_mode',
    },
    lock: { lock: null, unlock: null },
    media_player: {
        turn_on: null,
        turn_off: null,
        media_play: null,
        media_pause: null,
        media_stop: null,
        media_next_track: null,
        media_previous_track: null,
        volume_set: 'volume_level',
    },
    scene: { turn_on: null },
    script: { turn_on: null },
};

export const HOME_HVAC_MODES = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];

/** One service call on one entity, as a bot proposed it. */
export const HomeServiceCallSchema = Type.Object({
    entityId: EntityId,
    domain: Type.Union(HOME_CONTROL_DOMAINS.map((domain) => Type.Literal(domain))),
    service: Type.String({ pattern: '^[a-z_]{1,40}$' }),
    /** The one value the service takes, if any (see HOME_SERVICES). */
    data: Type.Optional(
        Type.Record(
            Type.String({ pattern: '^[a-z_]{1,40}$' }),
            Type.Union([Type.Number(), Type.String({ maxLength: 40 })]),
        ),
    ),
    /** For the card: the entity's name and area when proposed. */
    name: Type.Optional(Type.String({ maxLength: 200 })),
    area: Type.Optional(Type.String({ maxLength: 200 })),
    /** Unlocking, or opening a garage door or gate: the card asks twice. */
    sensitive: Type.Optional(Type.Boolean()),
});
export type HomeServiceCall = Static<typeof HomeServiceCallSchema>;

/**
 * What the card shows:
 * - `proposed`: waiting for the owner's tap;
 * - `running`: tapped, waiting for the Mac;
 * - `done`: the Mac called the service;
 * - `failed`: the Mac couldn't (`error` says why, e.g. the entity is no longer exposed);
 * - `expired`: nobody tapped within an hour, or the Mac didn't run it within 15 minutes.
 */
export const HomeProposalStatusSchema = Type.Union([
    Type.Literal('proposed'),
    Type.Literal('running'),
    Type.Literal('done'),
    Type.Literal('failed'),
    Type.Literal('expired'),
]);
export type HomeProposalStatus = Static<typeof HomeProposalStatusSchema>;

export const HomeProposalSchema = Type.Object({
    id: Type.String(),
    notebookId: Type.String(),
    pageId: Type.Optional(Type.String()),
    messageId: Type.Optional(Type.String()),
    call: HomeServiceCallSchema,
    /** "Turn on Kitchen Light (80%)". */
    summary: Type.String(),
    status: HomeProposalStatusSchema,
    error: Type.Optional(Type.String()),
    device: Type.Optional(
        Type.Object({
            name: Type.String(),
            lastSeenAt: Type.String(),
            offline: Type.Boolean(),
        }),
    ),
    /** True only for the home's owner, the one person who can tap. */
    canConfirm: Type.Boolean(),
    expiresAt: Type.String(),
    updatedAt: Type.String(),
});
export type HomeProposal = Static<typeof HomeProposalSchema>;

/** The Mac's exposed list, sent on every change. Replaces the previous one. */
export const UploadHomeExposureSchema = Type.Object({
    deviceId: Type.String({ minLength: 8, maxLength: 128 }),
    entityIds: Type.Array(EntityId, { maxItems: HOME_MAX_EXPOSED }),
});
export type UploadHomeExposureInput = Static<typeof UploadHomeExposureSchema>;

/** The card's text: "Turn on Kitchen Light to 80%". */
export function describeHomeCall(call: HomeServiceCall): string {
    const name = call.name?.trim() || call.entityId;
    const value = call.data ? Object.values(call.data)[0] : undefined;
    const verbs: Record<string, string> = {
        turn_on: 'Turn on',
        turn_off: 'Turn off',
        toggle: 'Toggle',
        open_cover: 'Open',
        close_cover: 'Close',
        stop_cover: 'Stop',
        set_cover_position: 'Set',
        set_percentage: 'Set',
        set_temperature: 'Set',
        set_hvac_mode: 'Set',
        lock: 'Lock',
        unlock: 'Unlock',
        media_play: 'Play',
        media_pause: 'Pause',
        media_stop: 'Stop',
        media_next_track: 'Next track on',
        media_previous_track: 'Previous track on',
        volume_set: 'Set the volume of',
    };
    const verb = verbs[call.service] ?? call.service.replace(/_/g, ' ');
    const activate = call.domain === 'scene' || call.domain === 'script';
    const head = activate ? `Run ${name}` : `${verb} ${name}`;
    if (value === undefined) return head;
    switch (call.service) {
        case 'turn_on':
            return `${head} at ${value}%`;
        case 'set_cover_position':
        case 'set_percentage':
            return `${head} to ${value}%`;
        case 'set_temperature':
            return `${head} to ${value}°`;
        case 'set_hvac_mode':
            return `${head} to ${String(value).replace(/_/g, ' ')}`;
        case 'volume_set':
            return `${head} to ${Math.round(Number(value) * 100)}%`;
        default:
            return head;
    }
}
