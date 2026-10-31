import { deviceItemThreadKey, type MacDataItem, type ReplyDraftParams } from '@maple/shared';
import { openedReplyDrafts, updateActionDoc } from '../repositories/bot-action.repo';
import { findDeviceItemsByIds } from '../repositories/device-item.repo';
import { broadcastAction } from './bot-action.service';
const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
/** Only exact outgoing content in the original thread after handoff counts as evidence. */
export async function reconcileReplyReceipts(
    userId: string,
    changed: MacDataItem[],
    now = Date.now(),
): Promise<void> {
    const outgoing = changed
        .filter(
            (item) =>
                item.isFromMe === true &&
                ['mail', 'imessage'].includes(item.source) &&
                item.extra?.['historyBackfill'] !== true &&
                item.occurredAt * 1000 >= now - 86400_000 &&
                item.occurredAt * 1000 <= now + 60_000,
        )
        .slice(0, 1000);
    if (!outgoing.length) return;
    const rows = await openedReplyDrafts(userId);
    if (!rows.length) return;
    const originals = new Map(
        (
            await findDeviceItemsByIds(
                userId,
                rows.map((row) => (row.params as unknown as ReplyDraftParams).itemId),
                100,
            )
        ).map((item) => [item.id, item]),
    );
    for (const row of rows) {
        const params = row.params as unknown as ReplyDraftParams;
        const original = originals.get(params.itemId);
        const thread = original ? deviceItemThreadKey(original) : undefined;
        const text = normalize(params.body || '');
        const openedAt = Date.parse(String(row.result?.openedAt || ''));
        if (!thread || text.length < 12 || !Number.isFinite(openedAt)) continue;
        const sent = outgoing.find(
            (item) =>
                item.id !== original!.id &&
                deviceItemThreadKey(item) === thread &&
                item.occurredAt * 1000 >= openedAt &&
                normalize(item.body) === text,
        );
        if (!sent) continue;
        const updated = await updateActionDoc(
            row._id,
            {
                $set: {
                    status: 'done',
                    completedAt: new Date(sent.occurredAt * 1000),
                    updatedAt: new Date(now),
                    result: {
                        ...row.result,
                        observedSentAt: new Date(sent.occurredAt * 1000).toISOString(),
                        observedItemId: sent.id,
                    },
                },
            },
            { status: 'opened', updatedAt: row.updatedAt },
        );
        if (updated) await broadcastAction(updated);
    }
}
