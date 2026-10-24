import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { MacDataHostInfo, MacDataNotebookSources } from '@maple/shared';

// Metadata about a user's Mac data host: which notebooks have Mac pages and the
// Mac's time zone. No message, email or event content is ever stored here.

interface MacDataHostDocument {
    _id: ObjectId;
    userId: ObjectId;
    notebooks: MacDataNotebookSources[];
    timeZone: string;
    lastSeenAt: Date;
}

export interface MacDataHostRecord {
    userId: string;
    notebooks: MacDataNotebookSources[];
    timeZone: string;
    lastSeenAt: string;
}

function getCollection(): Collection<MacDataHostDocument> {
    return getDb().collection<MacDataHostDocument>('mac_data_hosts');
}

export async function upsertMacDataHost(userId: string, info: MacDataHostInfo): Promise<void> {
    await getCollection().updateOne(
        { userId: new ObjectId(userId) },
        {
            $set: {
                notebooks: info.notebooks.slice(0, 500),
                timeZone: info.timeZone,
                lastSeenAt: new Date(),
            },
        },
        { upsert: true },
    );
}

export async function findMacDataHost(userId: string): Promise<MacDataHostRecord | null> {
    const doc = await getCollection().findOne({ userId: new ObjectId(userId) });
    if (!doc) return null;
    return {
        userId: doc.userId.toString(),
        notebooks: doc.notebooks,
        timeZone: doc.timeZone,
        lastSeenAt: doc.lastSeenAt.toISOString(),
    };
}
