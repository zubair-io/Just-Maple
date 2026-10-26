import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { UnreadCount, UnreadTracking } from '@maple/shared';
import { countMessagesSince, countMessagesSinceByPageId } from './message.repo';

interface UnreadTrackingDocument {
    _id: ObjectId;
    userId: ObjectId;
    pageId?: string; // UUID - messages page ID
    notebookId?: ObjectId; // Deprecated: kept for backward compatibility
    lastReadAt: Date;
}

function getCollection(): Collection<UnreadTrackingDocument> {
    return getDb().collection<UnreadTrackingDocument>('unread_tracking');
}

function toUnreadTrackingResponse(doc: UnreadTrackingDocument): UnreadTracking {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        pageId: doc.pageId || '',
        notebookId: doc.notebookId?.toString(),
        lastReadAt: doc.lastReadAt.toISOString(),
    };
}

// ============================================
// Page-based functions (new)
// ============================================

/**
 * Where page read markers live: one per (user, chat page).
 *
 * Not unread_tracking: on Cosmos DB that collection still enforces its old unique
 * key on (userId, notebookId), which can't be dropped. Page markers have no
 * notebookId, so every user could keep only one of them and every other chat
 * failed to save as read. Markers written there before the move are still read.
 */
interface ReadMarkerDocument {
    _id: ObjectId;
    userId: ObjectId;
    pageId: string;
    lastReadAt: Date;
}

function getReadMarkerCollection(): Collection<ReadMarkerDocument> {
    return getDb().collection<ReadMarkerDocument>('chat_read_markers');
}

export async function getLastReadAtByPageId(userId: string, pageId: string): Promise<Date | null> {
    try {
        const filter = { userId: new ObjectId(userId), pageId };
        const marker = await getReadMarkerCollection().findOne(filter);
        if (marker) return marker.lastReadAt;
        const legacy = await getCollection().findOne(filter);
        return legacy?.lastReadAt || null;
    } catch {
        return null;
    }
}

/**
 * Record that the user has read a chat up to now. Throws when the marker can't be
 * saved, so the caller never reports a read that didn't happen.
 */
export async function markAsReadByPageId(userId: string, pageId: string): Promise<UnreadTracking> {
    const now = new Date();
    const filter = { userId: new ObjectId(userId), pageId };
    const update = { $set: { lastReadAt: now } };

    try {
        await getReadMarkerCollection().updateOne(filter, update, { upsert: true });
    } catch (e: any) {
        // Two reads of the same chat at once can both try to insert; the loser updates.
        if (e?.code !== 11000) throw e;
        await getReadMarkerCollection().updateOne(filter, update);
    }

    const marker = await getReadMarkerCollection().findOne(filter);
    if (!marker) {
        throw new Error(`Read marker for page ${pageId} was not saved`);
    }
    return {
        _id: marker._id.toString(),
        userId,
        pageId,
        lastReadAt: marker.lastReadAt.toISOString(),
    };
}

export async function getUnreadCountForPage(userId: string, pageId: string): Promise<number> {
    const lastReadAt = await getLastReadAtByPageId(userId, pageId);
    const since = lastReadAt || new Date(0); // If never read, count all messages

    return countMessagesSinceByPageId(pageId, since, userId);
}

export async function getUnreadCountsForUserByPageIds(
    userId: string,
    pageIds: string[],
): Promise<UnreadCount[]> {
    const counts: UnreadCount[] = [];

    for (const pageId of pageIds) {
        const count = await getUnreadCountForPage(userId, pageId);
        if (count > 0) {
            counts.push({ pageId, count });
        }
    }

    return counts;
}

// ============================================
// Notebook-based functions (deprecated - for backward compatibility)
// ============================================

/**
 * @deprecated Use getLastReadAtByPageId instead
 */
export async function getLastReadAt(userId: string, notebookId: string): Promise<Date | null> {
    try {
        const doc = await getCollection().findOne({
            userId: new ObjectId(userId),
            notebookId: new ObjectId(notebookId),
        });
        return doc?.lastReadAt || null;
    } catch {
        return null;
    }
}

/**
 * @deprecated Use markAsReadByPageId instead
 */
export async function markAsRead(userId: string, notebookId: string): Promise<UnreadTracking> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        {
            userId: new ObjectId(userId),
            notebookId: new ObjectId(notebookId),
        },
        {
            $set: {
                lastReadAt: now,
            },
            $setOnInsert: {
                userId: new ObjectId(userId),
                notebookId: new ObjectId(notebookId),
            },
        },
        {
            upsert: true,
            returnDocument: 'after',
        },
    );

    if (result) {
        return toUnreadTrackingResponse(result);
    }

    const doc = await getCollection().findOne({
        userId: new ObjectId(userId),
        notebookId: new ObjectId(notebookId),
    });
    if (doc) {
        return toUnreadTrackingResponse(doc);
    }

    return { _id: '', userId, pageId: '', notebookId, lastReadAt: now.toISOString() };
}

/**
 * @deprecated Use getUnreadCountForPage instead
 */
export async function getUnreadCountForNotebook(
    userId: string,
    notebookId: string,
): Promise<number> {
    const lastReadAt = await getLastReadAt(userId, notebookId);
    const since = lastReadAt || new Date(0);

    return countMessagesSince(notebookId, since);
}

/**
 * @deprecated Use getUnreadCountsForUserByPageIds instead
 */
export async function getUnreadCountsForUser(
    userId: string,
    notebookIds: string[],
): Promise<UnreadCount[]> {
    const counts: UnreadCount[] = [];

    for (const notebookId of notebookIds) {
        const count = await getUnreadCountForNotebook(userId, notebookId);
        if (count > 0) {
            counts.push({ pageId: '', notebookId, count });
        }
    }

    return counts;
}

export async function getAllUnreadTrackings(userId: string): Promise<UnreadTracking[]> {
    const docs = await getCollection()
        .find({ userId: new ObjectId(userId) })
        .toArray();

    return docs.map(toUnreadTrackingResponse);
}
