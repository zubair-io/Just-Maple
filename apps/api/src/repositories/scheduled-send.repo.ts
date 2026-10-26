import type { Collection } from 'mongodb';
import { getDb } from '../db/client';

// Records of scheduled things that were sent (a day's brief, a leave-now reminder), so
// each goes out once even with several API instances ticking at the same time.

interface ScheduledSendDocument {
    _id: string; // e.g. `brief:<pageId>:2026-10-26`
    sentAt: Date;
}

function getCollection(): Collection<ScheduledSendDocument> {
    return getDb().collection<ScheduledSendDocument>('scheduled_sends');
}

/** Claims a send. True for the first caller only; everyone else gets false. */
export async function claimScheduledSend(key: string): Promise<boolean> {
    try {
        await getCollection().insertOne({ _id: key, sentAt: new Date() });
        return true;
    } catch (error) {
        if ((error as { code?: number }).code === 11000) return false;
        throw error;
    }
}
