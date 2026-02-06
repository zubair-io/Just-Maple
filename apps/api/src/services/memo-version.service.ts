import * as Y from 'yjs';
import {
    createMemoVersion,
    getLatestMemoVersion,
    listMemoVersions,
    getMemoVersionState,
    deleteMemoVersions,
    getVersionsOlderThan,
    countMemoVersions,
    getVersionStorageSize,
} from '../repositories/memo-version.repo';
import { findMemoById } from '../repositories/memo.repo';
import type { VersionTrigger, MemoVersionListItem } from '@maple/shared';

// Configuration
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_VERSIONS_PER_MEMO = 200;
const MAX_STORAGE_PER_MEMO = 50 * 1024 * 1024; // 50MB

// Track last snapshot time per noteId (in-memory cache)
const lastSnapshotTime = new Map<string, number>();

/**
 * Check if we should create a snapshot and create one if needed
 * Called after each document save
 */
export async function maybeCreateSnapshot(noteId: string, ydoc: Y.Doc): Promise<void> {
    const now = Date.now();
    const lastSnapshot = lastSnapshotTime.get(noteId) ?? 0;

    // Check if enough time has passed
    if (now - lastSnapshot < SNAPSHOT_INTERVAL_MS) {
        return;
    }

    // Check for deduplication - don't create if state hasn't changed
    const latestVersion = await getLatestMemoVersion(noteId);
    if (latestVersion) {
        const latestState = await getMemoVersionState(noteId, latestVersion._id);
        if (latestState) {
            const currentStateVector = Y.encodeStateVector(ydoc);
            const latestStateVector = Y.encodeStateVectorFromUpdate(latestState);
            if (arraysEqual(currentStateVector, latestStateVector)) {
                // No meaningful changes, skip
                lastSnapshotTime.set(noteId, now);
                return;
            }
        }
    }

    await createSnapshot(noteId, ydoc, 'auto-interval');
    lastSnapshotTime.set(noteId, now);
}

/**
 * Create a version snapshot
 */
export async function createSnapshot(
    noteId: string,
    ydoc: Y.Doc,
    trigger: VersionTrigger,
    label?: string,
): Promise<MemoVersionListItem> {
    // Enforce storage limits before creating new version
    await enforceStorageLimits(noteId);

    const state = Y.encodeStateAsUpdate(ydoc);
    const memo = await findMemoById(noteId);
    const version = memo?.version ?? 1;

    // Extract metadata for display
    const textContent = extractTextFromYDoc(ydoc);
    const contentPreview = textContent.slice(0, 200);
    const wordCount = countWords(textContent);
    const headingText = extractFirstHeading(ydoc);

    const result = await createMemoVersion({
        noteId,
        state,
        version,
        trigger,
        label,
        contentPreview: contentPreview || undefined,
        wordCount: wordCount || undefined,
        headingText: headingText || undefined,
    });

    console.log(
        `[MemoVersion] Created ${trigger} snapshot for ${noteId} (v${version}, ${state.length} bytes)`,
    );

    return result;
}

/**
 * Create a snapshot from raw state (for restore operations)
 */
export async function createSnapshotFromState(
    noteId: string,
    state: Uint8Array,
    trigger: VersionTrigger,
    label?: string,
): Promise<MemoVersionListItem> {
    await enforceStorageLimits(noteId);

    const memo = await findMemoById(noteId);
    const version = memo?.version ?? 1;

    // Create a temporary Y.Doc to extract metadata
    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, state);

    const textContent = extractTextFromYDoc(tempDoc);
    const contentPreview = textContent.slice(0, 200);
    const wordCount = countWords(textContent);
    const headingText = extractFirstHeading(tempDoc);

    tempDoc.destroy();

    const result = await createMemoVersion({
        noteId,
        state,
        version,
        trigger,
        label,
        contentPreview: contentPreview || undefined,
        wordCount: wordCount || undefined,
        headingText: headingText || undefined,
    });

    console.log(
        `[MemoVersion] Created ${trigger} snapshot from state for ${noteId} (v${version}, ${state.length} bytes)`,
    );

    return result;
}

/**
 * Enforce storage limits for a memo's versions
 */
async function enforceStorageLimits(noteId: string): Promise<void> {
    const count = await countMemoVersions(noteId);

    // Check version count limit
    if (count >= MAX_VERSIONS_PER_MEMO) {
        const toDelete = count - MAX_VERSIONS_PER_MEMO + 10; // Delete 10 extra to avoid frequent cleanup
        await pruneOldestVersions(noteId, toDelete);
    }

    // Check storage size limit
    const storageSize = await getVersionStorageSize(noteId);
    if (storageSize >= MAX_STORAGE_PER_MEMO) {
        // Delete oldest until under 80% of limit
        const targetSize = MAX_STORAGE_PER_MEMO * 0.8;
        await pruneUntilUnderSize(noteId, targetSize);
    }
}

/**
 * Delete the oldest N versions for a memo
 */
async function pruneOldestVersions(noteId: string, count: number): Promise<void> {
    const { versions } = await listMemoVersions(noteId, 1000);
    const oldest = versions.slice(-count);
    if (oldest.length > 0) {
        const ids = oldest.map((v) => v._id);
        await deleteMemoVersions(ids);
        console.log(`[MemoVersion] Pruned ${ids.length} oldest versions for ${noteId}`);
    }
}

/**
 * Delete oldest versions until storage is under target size
 */
async function pruneUntilUnderSize(noteId: string, targetSize: number): Promise<void> {
    const { versions } = await listMemoVersions(noteId, 1000);
    const toDelete: string[] = [];
    let currentSize = await getVersionStorageSize(noteId);

    // Start from oldest
    for (let i = versions.length - 1; i >= 0 && currentSize > targetSize; i--) {
        const v = versions[i];
        toDelete.push(v._id);
        currentSize -= v.byteSize;
    }

    if (toDelete.length > 0) {
        await deleteMemoVersions(toDelete);
        console.log(
            `[MemoVersion] Pruned ${toDelete.length} versions for storage limit on ${noteId}`,
        );
    }
}

/**
 * Apply retention policy for a memo
 * Call this periodically (e.g., daily) to clean up old versions
 */
export async function applyRetentionPolicy(noteId: string): Promise<number> {
    const now = new Date();
    const { versions } = await listMemoVersions(noteId, 1000);
    const toDelete: string[] = [];

    // Group versions by time buckets
    for (const version of versions) {
        const createdAt = new Date(version.createdAt);
        const ageMs = now.getTime() - createdAt.getTime();
        const ageHours = ageMs / (1000 * 60 * 60);
        const ageDays = ageHours / 24;

        // Keep all from last 24 hours
        if (ageDays <= 1) continue;

        // 1-7 days: keep 1 per hour
        if (ageDays <= 7) {
            if (!isFirstInHour(version, versions)) {
                toDelete.push(version._id);
            }
            continue;
        }

        // 7-30 days: keep 1 per day
        if (ageDays <= 30) {
            if (!isFirstInDay(version, versions)) {
                toDelete.push(version._id);
            }
            continue;
        }

        // 30-90 days: keep 1 per week
        if (ageDays <= 90) {
            if (!isFirstInWeek(version, versions)) {
                toDelete.push(version._id);
            }
            continue;
        }

        // > 90 days: delete
        toDelete.push(version._id);
    }

    if (toDelete.length > 0) {
        await deleteMemoVersions(toDelete);
        console.log(
            `[MemoVersion] Retention policy deleted ${toDelete.length} versions for ${noteId}`,
        );
    }

    return toDelete.length;
}

// Helper functions for retention policy
function isFirstInHour(version: MemoVersionListItem, all: MemoVersionListItem[]): boolean {
    const vDate = new Date(version.createdAt);
    const hourStart = new Date(
        vDate.getFullYear(),
        vDate.getMonth(),
        vDate.getDate(),
        vDate.getHours(),
    );
    const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

    const inHour = all.filter((v) => {
        const d = new Date(v.createdAt);
        return d >= hourStart && d < hourEnd;
    });

    // Keep the newest in each hour
    return inHour.length === 0 || inHour[0]._id === version._id;
}

function isFirstInDay(version: MemoVersionListItem, all: MemoVersionListItem[]): boolean {
    const vDate = new Date(version.createdAt);
    const dayStart = new Date(vDate.getFullYear(), vDate.getMonth(), vDate.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const inDay = all.filter((v) => {
        const d = new Date(v.createdAt);
        return d >= dayStart && d < dayEnd;
    });

    return inDay.length === 0 || inDay[0]._id === version._id;
}

function isFirstInWeek(version: MemoVersionListItem, all: MemoVersionListItem[]): boolean {
    const vDate = new Date(version.createdAt);
    const dayOfWeek = vDate.getDay();
    const weekStart = new Date(vDate.getFullYear(), vDate.getMonth(), vDate.getDate() - dayOfWeek);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const inWeek = all.filter((v) => {
        const d = new Date(v.createdAt);
        return d >= weekStart && d < weekEnd;
    });

    return inWeek.length === 0 || inWeek[0]._id === version._id;
}

// Text extraction helpers
function extractTextFromYDoc(ydoc: Y.Doc): string {
    try {
        const fragment = ydoc.getXmlFragment('prosemirror');
        return xmlFragmentToText(fragment);
    } catch {
        return '';
    }
}

function xmlFragmentToText(fragment: Y.XmlFragment): string {
    const parts: string[] = [];

    fragment.forEach((child) => {
        if (child instanceof Y.XmlText) {
            parts.push(child.toString());
        } else if (child instanceof Y.XmlElement) {
            parts.push(xmlElementToText(child));
        }
    });

    return parts.join(' ').trim();
}

function xmlElementToText(element: Y.XmlElement): string {
    const parts: string[] = [];

    element.forEach((child) => {
        if (child instanceof Y.XmlText) {
            parts.push(child.toString());
        } else if (child instanceof Y.XmlElement) {
            parts.push(xmlElementToText(child));
        }
    });

    return parts.join(' ');
}

function extractFirstHeading(ydoc: Y.Doc): string | undefined {
    try {
        const fragment = ydoc.getXmlFragment('prosemirror');
        for (const child of fragment.toArray()) {
            if (child instanceof Y.XmlElement) {
                const nodeName = child.nodeName;
                if (nodeName === 'heading' || nodeName.startsWith('heading')) {
                    return xmlElementToText(child).trim() || undefined;
                }
            }
        }
    } catch {
        // Ignore errors
    }
    return undefined;
}

function countWords(text: string): number {
    if (!text) return 0;
    return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
