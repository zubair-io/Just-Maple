import type { Collection } from 'mongodb';
import { randomUUID } from 'crypto';
import { getDb } from '../db/client';
import type { DeviceActionResult, HomeDeviceAction, HomeServiceCall } from '@maple/shared';

// Home Assistant action proposals, and the queued `home_service` action each becomes once
// its owner taps. One document per proposal; its id is also the action id the Mac sees.
//
// proposed ──tap──▶ queued ──Mac lists it──▶ delivered ──Mac reports──▶ done | failed
//    │                 │                          │
//    └── 1 hour ───────┴──── 15 min after tap ────┴──▶ expired
//
// failed ──tap again──▶ queued
//
// Home actions are short-lived on purpose: "turn off the lights" shouldn't happen hours
// later when the Mac wakes up. Queries sort in code: Cosmos DB needs an index per sort.

export type StoredHomeStatus = 'proposed' | 'queued' | 'delivered' | 'done' | 'failed' | 'expired';

export interface HomeProposalDocument {
    _id: string;
    /** Whose home: the only person who can confirm it. */
    userId: string;
    notebookId: string;
    pageId?: string;
    messageId?: string;
    botId: string;
    call: HomeServiceCall;
    status: StoredHomeStatus;
    /** The Mac holding the action now. */
    deviceId?: string;
    deliveredTo?: string[];
    error?: string;
    createdAt: Date;
    confirmedAt?: Date;
    deliveredAt?: Date;
    completedAt?: Date;
    expiresAt: Date;
    updatedAt: Date;
}

/** Untapped proposals expire after an hour. */
export const HOME_PROPOSAL_LIFETIME_MS = 60 * 60 * 1000;
/** A tapped action the Mac hasn't run within 15 minutes expires instead of running late. */
export const HOME_ACTION_LIFETIME_MS = 15 * 60 * 1000;
export const HOME_OPEN_STATUSES: StoredHomeStatus[] = ['proposed', 'queued', 'delivered'];

function getCollection(): Collection<HomeProposalDocument> {
    return getDb().collection<HomeProposalDocument>('home_proposals');
}

export async function createHomeProposal(input: {
    userId: string;
    notebookId: string;
    botId: string;
    call: HomeServiceCall;
}): Promise<HomeProposalDocument> {
    const now = new Date();
    const doc: HomeProposalDocument = {
        _id: randomUUID(),
        ...input,
        status: 'proposed',
        createdAt: now,
        expiresAt: new Date(now.getTime() + HOME_PROPOSAL_LIFETIME_MS),
        updatedAt: now,
    };
    await getCollection().insertOne(doc);
    return doc;
}

/** The same call still open in this notebook, so a bot asked twice shows one card. */
export async function findOpenHomeDuplicate(
    userId: string,
    notebookId: string,
    call: HomeServiceCall,
): Promise<HomeProposalDocument | null> {
    const docs = await getCollection()
        .find({ userId, notebookId, 'call.entityId': call.entityId })
        .toArray();
    const same = (a: HomeServiceCall) =>
        a.service === call.service &&
        JSON.stringify(a.data ?? {}) === JSON.stringify(call.data ?? {});
    return docs.find((doc) => HOME_OPEN_STATUSES.includes(doc.status) && same(doc.call)) ?? null;
}

export async function findHomeProposal(id: string): Promise<HomeProposalDocument | null> {
    return getCollection().findOne({ _id: id });
}

export async function attachHomeProposals(
    ids: string[],
    pageId: string,
    messageId: string,
): Promise<void> {
    if (!ids.length) return;
    await getCollection().updateMany(
        { _id: { $in: ids }, messageId: { $exists: false } },
        { $set: { pageId, messageId, updatedAt: new Date() } },
    );
}

/** The owner's tap: from `proposed` or `failed` only, so a double tap never queues twice. */
export async function queueHomeProposal(
    id: string,
    userId: string,
): Promise<HomeProposalDocument | null> {
    const now = new Date();
    return getCollection().findOneAndUpdate(
        { _id: id, userId, status: { $in: ['proposed', 'failed'] } },
        {
            $set: {
                status: 'queued',
                confirmedAt: now,
                expiresAt: new Date(now.getTime() + HOME_ACTION_LIFETIME_MS),
                updatedAt: now,
            },
            $unset: { error: '', deviceId: '', deliveredAt: '' },
        },
        { returnDocument: 'after' },
    );
}

export async function failHomeProposal(
    id: string,
    error: string,
): Promise<HomeProposalDocument | null> {
    return getCollection().findOneAndUpdate(
        { _id: id, status: { $in: ['queued', 'delivered'] } },
        { $set: { status: 'failed', error, updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
}

/**
 * Actions for this device: newly queued ones, and ones it took before but never reported
 * (its own records keep it from running one twice). Oldest tap first, at most 20.
 */
export async function takePendingHomeActions(
    userId: string,
    deviceId: string,
): Promise<{ actions: HomeDeviceAction[]; delivered: HomeProposalDocument[] }> {
    const now = new Date();
    const fresh = byConfirmed(await getCollection().find({ userId, status: 'queued' }).toArray());
    const delivered: HomeProposalDocument[] = [];
    for (const doc of fresh.slice(0, 20)) {
        const updated = await getCollection().findOneAndUpdate(
            { _id: doc._id, status: 'queued' },
            {
                $set: { status: 'delivered', deviceId, deliveredAt: now, updatedAt: now },
                $addToSet: { deliveredTo: deviceId },
            },
            { returnDocument: 'after' },
        );
        if (updated) delivered.push(updated);
    }
    const mine = byConfirmed(
        await getCollection().find({ userId, status: 'delivered', deviceId }).toArray(),
    ).slice(0, 20);
    return { actions: mine.map(toAction), delivered };
}

function byConfirmed(docs: HomeProposalDocument[]): HomeProposalDocument[] {
    const at = (doc: HomeProposalDocument) => (doc.confirmedAt ?? doc.createdAt).getTime();
    return docs.sort((a, b) => at(a) - at(b));
}

/**
 * The device's report. Idempotent: a repeated report returns the stored result. A success
 * wins over a failure or expiry (the service was called). Only the Mac holding it can
 * report a failure. Null when the action was never this device's.
 */
export async function completeHomeAction(
    userId: string,
    deviceId: string,
    id: string,
    result: DeviceActionResult,
): Promise<{ doc: HomeProposalDocument; changed: boolean } | null> {
    const doc = await getCollection().findOne({ _id: id, userId });
    if (!doc || (doc.deviceId !== deviceId && !doc.deliveredTo?.includes(deviceId))) return null;
    if (doc.status === 'done') return { doc, changed: false };
    const now = new Date();
    const updated = result.ok
        ? await getCollection().findOneAndUpdate(
              { _id: id, status: { $ne: 'done' } },
              {
                  $set: { status: 'done', deviceId, completedAt: now, updatedAt: now },
                  $unset: { error: '' },
              },
              { returnDocument: 'after' },
          )
        : await getCollection().findOneAndUpdate(
              { _id: id, status: 'delivered', deviceId },
              {
                  $set: {
                      status: 'failed',
                      error: result.error?.trim() || 'The Mac could not run this action.',
                      updatedAt: now,
                  },
              },
              { returnDocument: 'after' },
          );
    if (updated) return { doc: updated, changed: true };
    return { doc: (await getCollection().findOne({ _id: id }))!, changed: false };
}

/** Open proposals past their date become `expired`. Returns the ones that changed. */
export async function expireStaleHomeProposals(userId: string): Promise<HomeProposalDocument[]> {
    const now = new Date();
    const stale = await getCollection()
        .find({ userId, status: { $in: HOME_OPEN_STATUSES }, expiresAt: { $lte: now } })
        .toArray();
    const expired: HomeProposalDocument[] = [];
    for (const doc of stale) {
        const updated = await getCollection().findOneAndUpdate(
            { _id: doc._id, status: doc.status },
            { $set: { status: 'expired', updatedAt: now } },
            { returnDocument: 'after' },
        );
        if (updated) expired.push(updated);
    }
    return expired;
}

function toAction(doc: HomeProposalDocument): HomeDeviceAction {
    return {
        id: doc._id,
        type: 'home_service',
        source: 'home',
        call: doc.call,
        createdAt: (doc.confirmedAt ?? doc.createdAt).toISOString(),
        expiresAt: doc.expiresAt.toISOString(),
    };
}
