import { deviceItemThreadKey } from '@maple/shared';
import type {
    MacDataChangeBatch,
    MacDataConversation,
    MacDataItem,
    UploadDeviceItemsInput,
    UploadDeviceItemsResult,
} from '@maple/shared';
import {
    collectorTimeZone,
    findCollector,
    sourceActiveSince,
    touchCollector,
} from '../repositories/collector.repo';
import {
    deleteDeviceItems,
    findDeviceItemRevisions,
    findDeviceItemsByIds,
    findRecentMessageHeads,
    purgeExpiredDeviceItems,
    removeDeviceItems,
    setDeviceItemVectors,
    upsertDeviceItems,
} from '../repositories/device-item.repo';
import { findProactivePages } from '../repositories/page.repo';
import { dataPageSlicesFor } from './device-data-access.service';
import { bumpDeviceDataVersion, hit, snippet } from './device-search.service';
import { handleDeviceDataChanges } from './proactive-bot.service';
import { formatInZone } from '../utils/time-zone';

/**
 * Applies one upload from a device. Only sources this device is the active collector for
 * are stored, so two devices reading the same calendar can't duplicate it. New and
 * changed items that are fresh enough to be news go to the user's proactive bots.
 */

/** Older items are backlog (first upload, catch-up after sleep), not news. */
const FRESHNESS_SECONDS = 24 * 60 * 60;
/** New calendar events are news only if they start within this window. */
const UPCOMING_SECONDS = 14 * 24 * 60 * 60;
/** Items uploaded this soon after a source starts on a device are its backlog. */
const BACKFILL_MS = 30 * 60 * 1000;

type NewsEntry = { kind: 'added' | 'changed'; item: MacDataItem };
const MAX_PROACTIVE_ENTRIES = 40;

export class DeviceUploadError extends Error {
    constructor(
        message: string,
        readonly status = 400,
    ) {
        super(message);
    }
}

export async function applyDeviceUpload(
    userId: string,
    input: UploadDeviceItemsInput,
    now = Date.now(),
): Promise<UploadDeviceItemsResult> {
    const collector = await findCollector(userId, input.deviceId);
    if (!collector) throw new DeviceUploadError('Register this device before uploading.', 404);
    const active = new Set(collector.activeSources);
    const upserts = input.upserts.filter((item) => active.has(item.source));
    const skipped = input.upserts.length - upserts.length;

    const previous = await findDeviceItemRevisions(
        userId,
        upserts.map((item) => item.id),
    );
    const changed = upserts.filter((item) => previous.get(item.id) !== item.revision);
    const stored = await upsertDeviceItems(userId, input.deviceId, changed);
    const removed = await removeDeviceItems(userId, input.removals, {
        deviceId: input.deviceId,
        sources: collector.activeSources,
    });
    const vectors = input.vectors?.length ? await setDeviceItemVectors(userId, input.vectors) : 0;

    // A source can move to another device while this upload is in flight ("Collect
    // here"); anything written for a source this device no longer collects goes again.
    const after = await findCollector(userId, input.deviceId);
    for (const source of collector.activeSources) {
        if (!after?.activeSources.includes(source))
            await deleteDeviceItems(userId, { deviceId: input.deviceId, source });
    }

    await touchCollector(userId, input.deviceId, true);
    if (stored || removed || vectors) await bumpDeviceDataVersion(userId);
    const news: NewsEntry[] = [];
    for (const item of changed) {
        const kind = previous.has(item.id) ? 'changed' : 'added';
        if (!isNews(item, kind, now)) continue;
        // The first upload after a source starts here is backlog, not news.
        const since = await sourceActiveSince(userId, input.deviceId, item.source);
        if (!since || now - since.getTime() < BACKFILL_MS) continue;
        news.push({ kind, item });
    }
    if (news.length) queueNews(userId, news);

    return { stored, removed, vectors, skipped, ...(input.cursor ? { cursor: input.cursor } : {}) };
}

/**
 * Recent items worth a proactive look. Your own messages and contact edits aren't news.
 * A new calendar event counts if it starts soon; a changed one if it hasn't ended.
 */
export function isNews(item: MacDataItem, kind: 'added' | 'changed', now = Date.now()): boolean {
    if (item.source === 'contacts' || item.isFromMe) return false;
    const nowSeconds = now / 1000;
    const fresh = nowSeconds - FRESHNESS_SECONDS;
    if (item.source === 'calendar') {
        if ((item.endAt ?? item.occurredAt) < fresh) return false;
        return kind === 'changed' || item.occurredAt <= nowSeconds + UPCOMING_SECONDS;
    }
    return item.occurredAt >= fresh;
}

// MARK: - Batching news

/** Uploads come in batches seconds apart; one proactive run per user per window. */
const NEWS_WINDOW_MS = 60_000;
const pendingNews = new Map<
    string,
    { entries: NewsEntry[]; timer: ReturnType<typeof setTimeout> }
>();

function queueNews(userId: string, entries: NewsEntry[]): void {
    const pending = pendingNews.get(userId);
    if (pending) {
        pending.entries.push(...entries);
        return;
    }
    const timer = setTimeout(() => {
        const batch = pendingNews.get(userId);
        pendingNews.delete(userId);
        if (!batch) return;
        void notifyProactive(userId, latestPerItem(batch.entries)).catch((error) =>
            console.error('[DeviceData] Proactive dispatch failed:', error),
        );
    }, NEWS_WINDOW_MS);
    timer.unref?.();
    pendingNews.set(userId, { entries: [...entries], timer });
}

/** Sends any queued news now (tests, shutdown). */
export async function flushDeviceNews(userId: string): Promise<void> {
    const pending = pendingNews.get(userId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingNews.delete(userId);
    await notifyProactive(userId, latestPerItem(pending.entries));
}

function latestPerItem(entries: NewsEntry[]): NewsEntry[] {
    const byId = new Map<string, NewsEntry>();
    for (const entry of entries) {
        const earlier = byId.get(entry.item.id);
        // An item added and then changed in the same window is still new to the user.
        byId.set(entry.item.id, earlier?.kind === 'added' ? { ...entry, kind: 'added' } : entry);
    }
    return [...byId.values()];
}

/** Groups news by notebook: each proactive notebook only sees sources it has pages for. */
async function notifyProactive(userId: string, news: NewsEntry[]): Promise<void> {
    const proactivePages = await findProactivePages(userId);
    const notebookIds = [...new Set(proactivePages.map((page) => page.notebookId).filter(Boolean))];
    if (notebookIds.length === 0) return;
    const timeZone = (await collectorTimeZone(userId)) ?? 'UTC';
    const batches: MacDataChangeBatch[] = [];
    for (const notebookId of notebookIds as string[]) {
        // The owner's own pages there, each through its filter.
        const pages = (await dataPageSlicesFor(userId, notebookId)).filter(
            (page) => page.ownerId === userId,
        );
        const match = (item: MacDataItem) => pages.some((page) => page.match(item));
        const fresh = news.filter(({ item }) => match(item)).slice(0, MAX_PROACTIVE_ENTRIES);
        const conversations = await conversationsFor(
            userId,
            fresh.map(({ item }) => item),
            match,
            timeZone,
        );
        const entries = fresh.map(({ kind, item }) => {
            const conversation = conversations.get(deviceItemThreadKey(item) ?? '');
            return {
                kind,
                item: hit(item, 0, [], timeZone),
                ...(conversation ? { conversation } : {}),
            };
        });
        if (entries.length) batches.push({ notebookId, entries });
    }
    if (batches.length) await handleDeviceDataChanges(userId, batches);
}

// MARK: - Conversations

/** How far back, and how many messages, a thread summary looks. */
const CONVERSATION_SECONDS = 14 * 24 * 60 * 60;
const CONVERSATION_MESSAGES = 6;

/**
 * For each message's thread: when the user and the others last wrote, and the last few
 * messages from both sides. The user's own messages are never news, so without this a
 * bot sees only the other side and thinks they're still waiting on a reply. Threads are
 * keyed so a person's iMessage, SMS and RCS chats are one; only messages `match` lets
 * through (the pages' filters) are counted.
 */
export async function conversationsFor(
    userId: string,
    items: MacDataItem[],
    match: (item: MacDataItem) => boolean,
    timeZone: string,
    now = Date.now(),
): Promise<Map<string, MacDataConversation>> {
    const wanted = new Set(
        items
            .filter((item) => item.source === 'imessage')
            .map(deviceItemThreadKey)
            .filter((key): key is string => !!key),
    );
    const result = new Map<string, MacDataConversation>();
    if (wanted.size === 0) return result;

    const threads = new Map<string, MacDataItem[]>();
    for (const head of await findRecentMessageHeads(userId, now / 1000 - CONVERSATION_SECONDS)) {
        const key = deviceItemThreadKey(head);
        if (!key || !wanted.has(key) || !match(head)) continue;
        threads.set(key, [...(threads.get(key) ?? []), head]);
    }
    const recentIds = [...threads.values()].flatMap((heads) =>
        heads.slice(0, CONVERSATION_MESSAGES).map((head) => head.id),
    );
    const bodies = new Map(
        (await findDeviceItemsByIds(userId, recentIds)).map((item) => [item.id, item.body]),
    );
    const when = (item: MacDataItem | undefined) =>
        item ? formatInZone(new Date(item.occurredAt * 1000), timeZone) : undefined;
    for (const [key, heads] of threads) {
        // Newest first.
        const lastFromMe = when(heads.find((head) => head.isFromMe));
        const lastFromThem = when(heads.find((head) => !head.isFromMe));
        result.set(key, {
            ...(lastFromMe ? { lastFromMe } : {}),
            ...(lastFromThem ? { lastFromThem } : {}),
            recent: heads
                .slice(0, CONVERSATION_MESSAGES)
                .reverse()
                .map((head) => ({
                    from: head.isFromMe ? ('me' as const) : ('them' as const),
                    when: when(head)!,
                    text: snippet(bodies.get(head.id) ?? '', []).slice(0, 200),
                })),
        });
    }
    return result;
}

/** Removes items past the retention window every hour; devices apply the same rule locally. */
export function startDeviceDataRetention(intervalMs = 60 * 60 * 1000): () => void {
    const run = async () => {
        try {
            for (const userId of await purgeExpiredDeviceItems()) {
                await bumpDeviceDataVersion(userId);
            }
        } catch (error) {
            console.error('[DeviceData] Retention pass failed:', error);
        }
    };
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    void run();
    return () => clearInterval(timer);
}
