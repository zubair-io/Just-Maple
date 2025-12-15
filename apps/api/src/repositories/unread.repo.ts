import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { UnreadCount, UnreadTracking } from '@maple/shared';
import { countMessagesSince } from './message.repo';

interface UnreadTrackingDocument {
    _id: ObjectId;
    userId: ObjectId;
    tagId: ObjectId;
    lastReadAt: Date;
}

function getCollection(): Collection<UnreadTrackingDocument> {
    return getDb().collection<UnreadTrackingDocument>('unread_tracking');
}

function toUnreadTrackingResponse(doc: UnreadTrackingDocument): UnreadTracking {
    return {
        _id: doc._id.toString(),
        userId: doc.userId.toString(),
        tagId: doc.tagId.toString(),
        lastReadAt: doc.lastReadAt.toISOString(),
    };
}

export async function getLastReadAt(userId: string, tagId: string): Promise<Date | null> {
    try {
        const doc = await getCollection().findOne({
            userId: new ObjectId(userId),
            tagId: new ObjectId(tagId),
        });
        return doc?.lastReadAt || null;
    } catch {
        return null;
    }
}

export async function markAsRead(userId: string, tagId: string): Promise<UnreadTracking> {
    const now = new Date();

    const result = await getCollection().findOneAndUpdate(
        {
            userId: new ObjectId(userId),
            tagId: new ObjectId(tagId),
        },
        {
            $set: {
                lastReadAt: now,
            },
            $setOnInsert: {
                userId: new ObjectId(userId),
                tagId: new ObjectId(tagId),
            },
        },
        {
            upsert: true,
            returnDocument: 'after',
        },
    );

    return toUnreadTrackingResponse(result!);
}

export async function getUnreadCountForTag(userId: string, tagId: string): Promise<number> {
    const lastReadAt = await getLastReadAt(userId, tagId);
    const since = lastReadAt || new Date(0); // If never read, count all messages

    return countMessagesSince(tagId, since);
}

export async function getUnreadCountsForUser(
    userId: string,
    tagIds: string[],
): Promise<UnreadCount[]> {
    const counts: UnreadCount[] = [];

    for (const tagId of tagIds) {
        const count = await getUnreadCountForTag(userId, tagId);
        if (count > 0) {
            counts.push({ tagId, count });
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
