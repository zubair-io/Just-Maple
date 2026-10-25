import type {
    MacDataChangeBatch,
    MacDataItem,
    UploadDeviceItemsInput,
    UploadDeviceItemsResult,
} from '@maple/shared';
import { findCollector, touchCollector, collectorTimeZone } from '../repositories/collector.repo';
import {
    findDeviceItemRevisions,
    purgeExpiredDeviceItems,
    removeDeviceItems,
    setDeviceItemVectors,
    upsertDeviceItems,
} from '../repositories/device-item.repo';
import { findDeviceDataPages, findProactivePages } from '../repositories/page.repo';
import { bumpDeviceDataVersion, hit } from './device-search.service';
import { handleDeviceDataChanges } from './proactive-bot.service';

/**
 * Applies one upload from a device. Only sources this device is the active collector for
 * are stored, so two devices reading the same calendar can't duplicate it. New and
 * changed items that are fresh enough to be news go to the user's proactive bots.
 */

/** Older items are backlog (first upload, catch-up after sleep), not news. */
const FRESHNESS_SECONDS = 24 * 60 * 60;
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
    const removed = await removeDeviceItems(userId, input.removals);
    const vectors = input.vectors?.length ? await setDeviceItemVectors(userId, input.vectors) : 0;

    await touchCollector(userId, input.deviceId, true);
    if (stored || removed || vectors) await bumpDeviceDataVersion(userId);

    const news = changed
        .filter((item) => isNews(item, now))
        .map((item) => ({ kind: previous.has(item.id) ? 'changed' : 'added', item }));
    if (news.length) {
        void notifyProactive(userId, news).catch((error) =>
            console.error('[DeviceData] Proactive dispatch failed:', error),
        );
    }

    return { stored, removed, vectors, skipped, ...(input.cursor ? { cursor: input.cursor } : {}) };
}

/** Recent items worth a proactive look. Your own messages and contact edits aren't news. */
export function isNews(item: MacDataItem, now = Date.now()): boolean {
    if (item.source === 'contacts' || item.isFromMe) return false;
    const fresh = now / 1000 - FRESHNESS_SECONDS;
    if (item.source === 'calendar') return (item.endAt ?? item.occurredAt) >= fresh;
    return item.occurredAt >= fresh;
}

/** Groups news by notebook: each proactive notebook only sees sources it has pages for. */
async function notifyProactive(
    userId: string,
    news: Array<{ kind: string; item: MacDataItem }>,
): Promise<void> {
    const proactivePages = await findProactivePages(userId);
    const notebookIds = [...new Set(proactivePages.map((page) => page.notebookId).filter(Boolean))];
    if (notebookIds.length === 0) return;
    const timeZone = (await collectorTimeZone(userId)) ?? 'UTC';
    const batches: MacDataChangeBatch[] = [];
    for (const notebookId of notebookIds as string[]) {
        const sources = new Set(
            (await findDeviceDataPages(userId, notebookId)).map((page) => page.deviceSource),
        );
        const entries = news
            .filter(({ item }) => sources.has(item.source))
            .slice(0, MAX_PROACTIVE_ENTRIES)
            .map(({ kind, item }) => ({ kind, item: hit(item, 0, [], timeZone) }));
        if (entries.length) batches.push({ notebookId, entries });
    }
    if (batches.length) await handleDeviceDataChanges(userId, batches);
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
