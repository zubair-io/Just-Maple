import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { UnreadCount, UnreadTracking } from '@maple/shared';
import { countMessagesSince } from './message.repo';

interface UnreadTrackingDocument {
    _id: ObjectId;
    userId: ObjectId;
    notebookId: ObjectId;
    lastReadAt: Date;
}

function getCollection(): Collection<UnreadTrackingDocument> {
    return getDb().collection<UnreadTrackingDocument>('unread_tracking');
}

function toUnreadTrackingResponse(doc: UnreadTrackingDocument): UnreadTracking {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        notebookId: doc.notebookId.toString(),
        lastReadAt: doc.lastReadAt.toISOString(),
    };
}

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

    return toUnreadTrackingResponse(result!);
}

export async function getUnreadCountForNotebook(
    userId: string,
    notebookId: string,
): Promise<number> {
    const lastReadAt = await getLastReadAt(userId, notebookId);
    const since = lastReadAt || new Date(0); // If never read, count all messages

    return countMessagesSince(notebookId, since);
}

export async function getUnreadCountsForUser(
    userId: string,
    notebookIds: string[],
): Promise<UnreadCount[]> {
    const counts: UnreadCount[] = [];

    for (const notebookId of notebookIds) {
        const count = await getUnreadCountForNotebook(userId, notebookId);
        if (count > 0) {
            counts.push({ notebookId, count });
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
