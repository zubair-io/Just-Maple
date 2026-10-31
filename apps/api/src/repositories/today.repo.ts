import type { Collection, Filter } from 'mongodb';
import { getDb } from '../db/client';
import type { TodaySection } from '@maple/shared';
import type { FollowUpDocument } from './follow-up.repo';
import type { BotActionDocument } from './bot-action.repo';

async function page<T extends { _id: string }>(
    collection: Collection<T>,
    base: Filter<T>,
    field: 'at' | 'createdAt',
    before: string | undefined,
    limit: number,
): Promise<T[]> {
    const cursor = before ? await collection.findOne({ ...base, _id: before } as Filter<T>) : null;
    if (before && !cursor) return [];
    const at = cursor ? (cursor as unknown as Record<string, unknown>)[field] : undefined;
    return collection
        .find({
            ...base,
            ...(cursor
                ? { $or: [{ [field]: { $lt: at } }, { [field]: at, _id: { $lt: cursor._id } }] }
                : {}),
        } as Filter<T>)
        .sort({ [field]: -1, _id: -1 })
        .limit(limit + 1)
        .toArray() as Promise<T[]>;
}
export function todayFollowUps(
    userId: string,
    section: TodaySection,
    before: string | undefined,
    limit: number,
) {
    if (section !== 'needs-you' && section !== 'recent')
        return Promise.resolve([] as FollowUpDocument[]);
    const now = Math.floor(Date.now() / 1000);
    return page(
        getDb().collection<FollowUpDocument>('follow_ups'),
        {
            userId,
            direction: { $in: ['owe_reply', 'you_promised'] },
            ...(section === 'needs-you'
                ? {
                      $and: [
                          {
                              $or: [
                                  { status: 'open' },
                                  { status: 'snoozed', snoozedUntil: { $lte: now } },
                              ],
                          },
                          {
                              $or: [
                                  { showAfter: { $exists: false } },
                                  { showAfter: { $lte: now } },
                              ],
                          },
                      ],
                  }
                : {
                      status: { $in: ['done', 'dismissed', 'expired'] },
                      updatedAt: { $gte: new Date(Date.now() - 14 * 86400_000) },
                  }),
        },
        'at',
        before,
        limit,
    );
}
export function todayActions(
    userId: string,
    notebookId: string,
    section: TodaySection,
    before: string | undefined,
    limit: number,
) {
    const statuses: BotActionDocument['status'][] =
        section === 'review'
            ? ['proposed', 'opened']
            : section === 'working'
              ? ['queued', 'approved', 'auto']
              : section === 'needs-you'
                ? ['failed']
                : ['done', 'undone', 'expired', 'discarded', 'denied'];
    return page(
        getDb().collection<BotActionDocument>('bot_actions'),
        {
            ownerId: userId,
            notebookId,
            status: { $in: statuses },
            createdAt: { $gte: new Date(Date.now() - 90 * 86400_000) },
        },
        'createdAt',
        before,
        limit,
    );
}
