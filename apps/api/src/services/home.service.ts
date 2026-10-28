import {
    describeHomeCall,
    homeEntityId,
    HOME_CONTROL_DOMAINS,
    HOME_HVAC_MODES,
    HOME_SERVICES,
    isHomeStateItemId,
    isSensitiveHomeEntity,
    type BotUIBlock,
    type BotUIResponse,
    type DeviceActionResult,
    type HomeControlDomain,
    type HomeDeviceAction,
    type HomeProposal,
    type HomeProposalStatus,
    type HomeServiceCall,
    type MacDataItem,
} from '@maple/shared';
import {
    attachHomeProposals,
    completeHomeAction,
    createHomeProposal,
    expireStaleHomeProposals,
    failHomeProposal,
    findHomeProposal,
    findOpenHomeDuplicate,
    HOME_OPEN_STATUSES,
    queueHomeProposal,
    takePendingHomeActions,
    type HomeProposalDocument,
} from '../repositories/home-proposal.repo';
import { findCollector, listCollectors } from '../repositories/collector.repo';
import {
    findDeviceItem,
    findDeviceItems,
    findHomeStateItems,
} from '../repositories/device-item.repo';
import { saveHomeExposure } from '../repositories/home-exposure.repo';
import { bumpDeviceDataVersion } from './device-search.service';
import { homeExposureMatcher, isMemberOf, type DataPageSlice } from './device-data-access.service';
import { broadcastChatEvent } from './realtime.service';
import { macDataRelay } from './mac-data-relay.service';
import type { MacDataToolContext, ToolDefinition } from './mac-data-tools.service';
import { formatInZone, toEpochSeconds } from '../utils/time-zone';

/**
 * Home Assistant, through the user's Mac (see packages/shared/src/schemas/home.ts).
 *
 * Reading: `get_home_states` gives bots the current state and recent changes of the
 * entities the notebook's Home pages share, through each page's filter (which already
 * leaves out entities that are no longer exposed, and who's home unless picked).
 *
 * Changing: bots can only propose (`propose_home_action`). The home's owner taps the card;
 * that queues a `home_service` action for the Mac collecting `home`; the Mac checks the
 * entity is still exposed, calls the service and reports back. Unlocking and garage doors
 * ask twice. Tapped actions the Mac hasn't run within 15 minutes expire.
 */

export const MAX_HOME_PROPOSALS_PER_RUN = 3;
/** After this long without hearing from the Mac, the card says it's waiting for it. */
const DEVICE_OFFLINE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_CHANGES_HOURS = 24;

export class HomeError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

// MARK: - Exposure (the Mac)

/** The Mac's exposed list. Only the device collecting `home` may send it. */
export async function uploadHomeExposure(
    userId: string,
    deviceId: string,
    entityIds: string[],
): Promise<number> {
    const collector = await findCollector(userId, deviceId);
    if (!collector) throw new HomeError(404, 'Register this device first');
    if (collector.platform !== 'macos' || !collector.activeSources.includes('home'))
        throw new HomeError(409, 'This device does not collect Home');
    const saved = await saveHomeExposure(userId, deviceId, entityIds);
    await bumpDeviceDataVersion(userId);
    return saved;
}

// MARK: - Reading (bots)

function homeSlices(ctx: MacDataToolContext): DataPageSlice[] {
    return (ctx.pages ?? []).filter((page) => page.source === 'home');
}

export function canReadHome(ctx: MacDataToolContext): boolean {
    return homeSlices(ctx).length > 0;
}

export const homeStatesTool: ToolDefinition = {
    name: 'get_home_states',
    description:
        'Read the current state of the smart-home devices shared in this notebook (lights, switches, sensors, thermostats, locks…), ' +
        'and what changed recently. Only devices the user exposed in Home Assistant and shared on a Home page are listed.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    'Words in the device name, area or id, e.g. "kitchen" or "thermostat".',
            },
            domain: {
                type: 'string',
                description: 'Only this kind, e.g. light, sensor, climate, lock.',
            },
            changes_since: {
                type: 'string',
                description: `Also list changes after this ISO 8601 time. Defaults to the last ${DEFAULT_CHANGES_HOURS} hours.`,
            },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
    },
};

export async function executeHomeStates(
    ctx: MacDataToolContext,
    input: Record<string, unknown>,
): Promise<string> {
    const slices = homeSlices(ctx);
    if (!slices.length) return 'Unknown tool: get_home_states';
    const words = (typeof input.query === 'string' ? input.query : '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 8);
    const domain = typeof input.domain === 'string' ? input.domain.trim().toLowerCase() : '';
    const limit = Math.min(Math.max(typeof input.limit === 'number' ? input.limit : 50, 1), 100);
    const since =
        toEpochSeconds(input.changes_since, ctx.timeZone, 'start') ??
        Math.floor(Date.now() / 1000) - DEFAULT_CHANGES_HOURS * 3600;
    const wanted = (item: MacDataItem) => {
        const id = homeEntityId(item) ?? '';
        if (domain && id.split('.')[0] !== domain) return false;
        const text = [id, item.title, item.extra?.['area']].join(' ').toLowerCase();
        return words.every((word) => text.includes(word));
    };

    const entities = new Map<string, Record<string, unknown>>();
    const changes: Array<Record<string, unknown>> = [];
    for (const slice of slices) {
        const whose = slice.ownerId !== ctx.userId ? { sharedBy: slice.ownerName } : {};
        for (const item of await findHomeStateItems(slice.ownerId)) {
            if (!slice.match(item) || !wanted(item)) continue;
            const key = `${slice.ownerId}:${item.id}`;
            if (!entities.has(key))
                entities.set(key, {
                    ...stateView(item, ctx.timeZone),
                    page: slice.title,
                    ...whose,
                });
        }
        const { items } = await findDeviceItems(slice.ownerId, {
            sources: ['home'],
            from: since,
            order: 'desc',
            limit: 100,
            match: (item) => !isHomeStateItemId(item.id) && slice.match(item) && wanted(item),
        });
        for (const item of items) changes.push({ ...changeView(item, ctx.timeZone), ...whose });
    }
    const sortedEntities = [...entities.values()]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .slice(0, limit);
    const recent = changes
        .sort((a, b) => String(b.when).localeCompare(String(a.when)))
        .slice(0, limit);
    // States are written by devices, not people, but names can be anything: same caution.
    ctx.readThirdPartyText = true;
    return clip(JSON.stringify({ entities: sortedEntities, changes: recent }));
}

function stateView(item: MacDataItem, timeZone: string): Record<string, unknown> {
    const extra = item.extra ?? {};
    return {
        entity_id: homeEntityId(item),
        name: item.title,
        state: extra['state'],
        ...(extra['unit'] ? { unit: extra['unit'] } : {}),
        ...(extra['area'] ? { area: extra['area'] } : {}),
        ...(extra['deviceClass'] ? { device_class: extra['deviceClass'] } : {}),
        ...(extra['attributes'] ? { attributes: extra['attributes'] } : {}),
        since: formatInZone(new Date(item.occurredAt * 1000), timeZone),
    };
}

function changeView(item: MacDataItem, timeZone: string): Record<string, unknown> {
    const extra = item.extra ?? {};
    return {
        entity_id: homeEntityId(item),
        name: item.title,
        from: extra['from'],
        to: extra['state'],
        ...(extra['unit'] ? { unit: extra['unit'] } : {}),
        when: formatInZone(new Date(item.occurredAt * 1000), timeZone),
    };
}

// MARK: - Proposing (bots)

/** Only the owner's own bot, for their own Home page: the one home a tap can change. */
export function canProposeHome(ctx: MacDataToolContext): boolean {
    return !!ctx.botId && homeSlices(ctx).some((slice) => slice.ownerId === ctx.userId);
}

export const proposeHomeTool: ToolDefinition = {
    name: 'propose_home_action',
    description:
        'Offer to change a smart-home device: turn a light, switch or fan on or off, open or close a cover, set a thermostat, lock or unlock, control a media player, or run a scene or script. ' +
        'This only proposes: a card with a button is attached to your reply and nothing happens until the user taps it. ' +
        'Read the device with get_home_states first and use its entity_id. Do not add your own Button for it.',
    parameters: {
        type: 'object',
        properties: {
            entity_id: { type: 'string', description: 'e.g. light.kitchen' },
            service: {
                type: 'string',
                description:
                    'light/switch: turn_on, turn_off, toggle. fan: turn_on, turn_off, set_percentage. ' +
                    'cover: open_cover, close_cover, stop_cover, set_cover_position. ' +
                    'climate: set_temperature, set_hvac_mode, turn_on, turn_off. lock: lock, unlock. ' +
                    'media_player: turn_on, turn_off, media_play, media_pause, media_stop, media_next_track, media_previous_track, volume_set. ' +
                    'scene/script: turn_on.',
            },
            value: {
                description:
                    'Only for: light turn_on brightness 0–100 (%), set_percentage 0–100, set_cover_position 0–100, ' +
                    `set_temperature in the thermostat's unit, set_hvac_mode one of ${HOME_HVAC_MODES.join(', ')}, volume_set 0–100 (%).`,
            },
        },
        required: ['entity_id', 'service'],
        additionalProperties: false,
    },
};

export async function executeProposeHome(
    ctx: MacDataToolContext,
    input: Record<string, unknown>,
): Promise<string> {
    if (!canProposeHome(ctx)) return 'Unknown tool: propose_home_action';
    if ((ctx.proposedHomeActions?.length ?? 0) >= MAX_HOME_PROPOSALS_PER_RUN)
        return `At most ${MAX_HOME_PROPOSALS_PER_RUN} home actions can be proposed in one reply.`;
    const entityId = typeof input.entity_id === 'string' ? input.entity_id.trim() : '';
    // The entity must be one this run can read: the user's own page, exposed, shared.
    // Exposure is checked again here: it may have changed since the run started.
    const item = entityId ? await findDeviceItem(ctx.userId, `home:${entityId}`) : null;
    const visible =
        !!item &&
        (await homeExposureMatcher(ctx.userId))(item) &&
        homeSlices(ctx).some((slice) => slice.ownerId === ctx.userId && slice.match(item));
    if (!item || !visible)
        return 'Error: no shared, exposed device with that entity_id. Use get_home_states to find it.';
    const call = toCall(item, entityId, input);
    if (typeof call === 'string') return call;
    const duplicate = await findOpenHomeDuplicate(ctx.userId, ctx.notebookId, call);
    const proposal =
        duplicate ??
        (await createHomeProposal({
            userId: ctx.userId,
            notebookId: ctx.notebookId,
            botId: ctx.botId!,
            call,
        }));
    ctx.proposedHomeActions = [...(ctx.proposedHomeActions ?? []), proposal._id];
    return duplicate
        ? 'This action was already proposed and is waiting for the user. The card is attached to your reply again.'
        : `Proposed "${describeHomeCall(call)}". The card is attached to your reply; nothing changes until the user taps it, so do not say it is done.`;
}

/** Checks the service and its value against what the domain allows (HOME_SERVICES). */
function toCall(
    item: MacDataItem,
    entityId: string,
    input: Record<string, unknown>,
): HomeServiceCall | string {
    const domain = entityId.split('.')[0] as HomeControlDomain;
    if (!(HOME_CONTROL_DOMAINS as readonly string[]).includes(domain))
        return `Error: ${domain} devices can only be read, not changed.`;
    const service = typeof input.service === 'string' ? input.service.trim() : '';
    const services = HOME_SERVICES[domain];
    if (!Object.hasOwn(services, service))
        return `Error: ${domain} supports ${Object.keys(services).join(', ')}.`;
    const field = services[service] ?? null;
    let data: HomeServiceCall['data'];
    if (field && input.value !== undefined && input.value !== null) {
        const value = toValue(field, input.value);
        if (typeof value === 'string' && value.startsWith('Error')) return value;
        data = { [field]: value };
    } else if (field && service !== 'turn_on') {
        return `Error: ${service} needs a value.`;
    } else if (!field && input.value !== undefined && input.value !== null) {
        return `Error: ${service} takes no value.`;
    }
    const extra = item.extra ?? {};
    const deviceClass = typeof extra['deviceClass'] === 'string' ? extra['deviceClass'] : '';
    const area = typeof extra['area'] === 'string' ? extra['area'] : undefined;
    // Locks, scenes, scripts, garage doors, gates and their openers: the card asks twice.
    const sensitive = isSensitiveHomeEntity({
        entityId,
        deviceClass,
        name: item.title ?? undefined,
    });
    return {
        entityId,
        domain,
        service,
        ...(data ? { data } : {}),
        ...(item.title ? { name: item.title.slice(0, 200) } : {}),
        ...(area ? { area: area.slice(0, 200) } : {}),
        ...(sensitive ? { sensitive: true } : {}),
    };
}

function toValue(field: string, raw: unknown): number | string {
    const number = typeof raw === 'number' ? raw : Number(raw);
    const percent = (max = 100) =>
        Number.isFinite(number) && number >= 0 && number <= max
            ? Math.round(number)
            : `Error: value must be between 0 and ${max}.`;
    switch (field) {
        case 'brightness_pct':
        case 'percentage':
        case 'position':
            return percent();
        case 'volume_level': {
            // Given as a percentage; Home Assistant takes 0–1.
            const value = percent();
            return typeof value === 'number' ? value / 100 : value;
        }
        case 'temperature':
            return Number.isFinite(number) && number >= -50 && number <= 150
                ? Math.round(number * 2) / 2
                : 'Error: temperature must be a number.';
        case 'hvac_mode': {
            const mode = String(raw).trim().toLowerCase();
            return HOME_HVAC_MODES.includes(mode)
                ? mode
                : `Error: hvac_mode must be one of ${HOME_HVAC_MODES.join(', ')}.`;
        }
        default:
            return 'Error: unsupported value.';
    }
}

/** Cards for the home actions a bot proposed in this run, added to its reply's blocks. */
export async function withHomeProposalCards(
    ui: BotUIResponse | undefined,
    proposalIds: string[],
): Promise<BotUIResponse | undefined> {
    const cards: BotUIBlock[] = [];
    for (const id of [...new Set(proposalIds)]) {
        const doc = await findHomeProposal(id);
        if (doc) cards.push({ type: 'home_proposal', proposalId: doc._id, call: doc.call });
    }
    if (!cards.length) return ui;
    const blocks = [...(ui?.blocks ?? []), ...cards].slice(-30);
    return { version: 1, format: 'openui', blocks };
}

export async function attachHomeProposalCards(
    proposalIds: string[],
    pageId: string,
    messageId: string,
): Promise<void> {
    await attachHomeProposals([...new Set(proposalIds)], pageId, messageId);
}

// MARK: - Cards (people)

export async function getHomeProposalView(
    id: string,
    viewerId: string,
): Promise<HomeProposal | null> {
    const doc = await settled(id);
    if (!doc || !(await isMemberOf(doc.notebookId, viewerId))) return null;
    return toView(doc, viewerId);
}

/**
 * The owner's tap. Sensitive actions (unlocking, garage doors) need `acknowledged`, the
 * card's second tap. The entity must still be exposed, as the Mac last reported.
 */
export async function confirmHomeProposal(
    id: string,
    userId: string,
    options: { acknowledged?: boolean } = {},
): Promise<HomeProposal> {
    const doc = await settled(id);
    if (!doc || !(await isMemberOf(doc.notebookId, userId)))
        throw new HomeError(404, 'Proposal not found');
    if (doc.userId !== userId) throw new HomeError(403, 'Only the owner of this home can do this.');
    if (doc.status === 'expired')
        throw new HomeError(409, 'This proposal expired. Ask the bot again.');
    if (doc.call.sensitive && !options.acknowledged && ['proposed', 'failed'].includes(doc.status))
        throw new HomeError(428, 'Confirm again: this unlocks or opens something.');

    const exposed = await homeExposureMatcher(userId);
    const item = await findDeviceItem(userId, `home:${doc.call.entityId}`);
    if (!item || !exposed(item))
        throw new HomeError(
            409,
            `${doc.call.name ?? doc.call.entityId} is no longer exposed in Home Assistant.`,
        );

    const queued = await queueHomeProposal(id, userId);
    if (!queued) {
        const current = (await findHomeProposal(id))!;
        if (current.status === 'queued') nudge(userId);
        return toView(current, userId);
    }
    if (!(await homeCollector(userId))) {
        const failed = await failHomeProposal(
            id,
            'No Mac is connected to Home Assistant. Open Just Maple on your Mac, set up Home Assistant in Settings → Devices, then try again.',
        );
        await broadcastProposal(failed ?? queued);
        return toView((failed ?? queued)!, userId);
    }
    await broadcastProposal(queued);
    nudge(userId);
    return toView(queued, userId);
}

function nudge(userId: string): void {
    void macDataRelay.request(userId, 'runActions', {}, 5_000).catch(() => {});
}

// MARK: - Action queue (devices)

export async function takeHomeActions(
    userId: string,
    deviceId: string,
): Promise<HomeDeviceAction[]> {
    const collector = await findCollector(userId, deviceId);
    if (!collector || collector.platform !== 'macos' || !collector.activeSources.includes('home'))
        return [];
    await settle(userId);
    const { actions, delivered } = await takePendingHomeActions(userId, deviceId);
    for (const doc of delivered) await broadcastProposal(doc);
    return actions;
}

/** Whether `id` is a home action (the result route serves both queues). */
export async function isHomeAction(id: string): Promise<boolean> {
    return !!(await findHomeProposal(id));
}

export async function reportHomeActionResult(
    userId: string,
    deviceId: string,
    id: string,
    result: DeviceActionResult,
): Promise<HomeProposal> {
    const outcome = await completeHomeAction(userId, deviceId, id, result);
    if (!outcome) throw new HomeError(404, 'Action not found');
    if (outcome.changed) await broadcastProposal(outcome.doc);
    return toView(outcome.doc, userId);
}

// MARK: - Private

async function settle(userId: string): Promise<void> {
    for (const doc of await expireStaleHomeProposals(userId)) await broadcastProposal(doc);
}

async function settled(id: string): Promise<HomeProposalDocument | null> {
    const doc = await findHomeProposal(id);
    if (!doc || !HOME_OPEN_STATUSES.includes(doc.status)) return doc;
    await settle(doc.userId);
    return findHomeProposal(id);
}

async function homeCollector(userId: string) {
    return (
        (await listCollectors(userId)).find(
            (c) => c.platform === 'macos' && c.activeSources.includes('home'),
        ) ?? null
    );
}

function viewStatus(doc: HomeProposalDocument): HomeProposalStatus {
    switch (doc.status) {
        case 'queued':
        case 'delivered':
            return 'running';
        default:
            return doc.status;
    }
}

async function toView(doc: HomeProposalDocument, viewerId: string): Promise<HomeProposal> {
    const status = viewStatus(doc);
    let device: HomeProposal['device'];
    if (status === 'running') {
        const collector = doc.deviceId
            ? await findCollector(doc.userId, doc.deviceId)
            : await homeCollector(doc.userId);
        if (collector) {
            const lastSeenAt = collector.lastSeenAt ?? new Date(0).toISOString();
            device = {
                name: collector.name,
                lastSeenAt,
                offline: Date.now() - Date.parse(lastSeenAt) > DEVICE_OFFLINE_AFTER_MS,
            };
        }
    }
    return {
        id: doc._id,
        notebookId: doc.notebookId,
        ...(doc.pageId ? { pageId: doc.pageId } : {}),
        ...(doc.messageId ? { messageId: doc.messageId } : {}),
        call: doc.call,
        summary: describeHomeCall(doc.call),
        status,
        ...(status === 'failed' && doc.error ? { error: doc.error } : {}),
        ...(device ? { device } : {}),
        canConfirm: doc.userId === viewerId,
        expiresAt: doc.expiresAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

async function broadcastProposal(doc: HomeProposalDocument | null): Promise<void> {
    if (!doc?.pageId) return;
    const { canConfirm: _, ...data } = await toView(doc, '');
    await broadcastChatEvent(doc.notebookId, {
        action: 'home_proposal_updated',
        pageId: doc.pageId,
        notebookId: doc.notebookId,
        userId: doc.userId,
        data,
        timestamp: new Date().toISOString(),
    }).catch((error) => console.error('[HomeProposal] Broadcast failed:', error));
}

function clip(text: string): string {
    return text.length > 12_000 ? `${text.slice(0, 12_000)}…(truncated)` : text;
}
