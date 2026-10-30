import type { MacDataItem } from '@maple/shared';
import { getDb, getSqliteDatabase } from '../db/client';

// Cache metadata only. Permission checks are always applied by the service per request.
const metadata = new Map<string, Promise<MacDataItem[]>>();
export function invalidateMessageMetadata(userId: string) {
    metadata.delete(userId);
}
export function messageMetadata(userId: string): Promise<MacDataItem[]> {
    const existing = metadata.get(userId);
    if (existing) return existing;
    if (metadata.size >= 2) metadata.delete(metadata.keys().next().value!);
    const sqlite = getSqliteDatabase();
    const pending = (
        sqlite
            ? sqlite
                  .request<{
                      rows: [string, number, number][];
                      shapes: Omit<MacDataItem, 'id' | 'occurredAt'>[];
                      people: { key: string; name: string; handles: string[] }[];
                  }>('messages.metadata', undefined, [userId])
                  .then(({ rows, shapes, people }) => {
                      const byKey = new Map(people.map((person) => [person.key, person]));
                      for (const item of shapes) {
                          const keys = item.extra?.['archiveMemberKeys'];
                          if (Array.isArray(keys))
                              item.extra!['archiveMembers'] = keys
                                  .map((key) => byKey.get(String(key)))
                                  .filter(Boolean);
                      }
                      return rows.map(([id, occurredAt, index]) => ({
                          ...shapes[index]!,
                          id,
                          occurredAt,
                      }));
                  })
            : getDb()
                  .collection<{ item: MacDataItem }>('device_items')
                  .find({ userId, source: 'imessage' }, { projection: { item: 1 } })
                  .toArray()
                  .then((rows) => rows.map((row) => ({ ...row.item, body: '' })))
    ).catch((error) => {
        metadata.delete(userId);
        throw error;
    });
    metadata.set(userId, pending);
    return pending;
}

export async function matchingMessageIds(
    userId: string,
    search: string,
): Promise<Set<string> | null> {
    const terms = search.trim().split(/\s+/).filter(Boolean).slice(0, 12);
    if (!terms.length) return null;
    const sqlite = getSqliteDatabase();
    const ids = sqlite
        ? await sqlite.request<string[]>('messages.matching', undefined, [
              userId,
              terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND '),
          ])
        : (
              await getDb()
                  .collection<{ id: string; searchText: string }>('device_items')
                  .find({ userId, source: 'imessage' }, { projection: { id: 1, searchText: 1 } })
                  .toArray()
          )
              .filter((row) => terms.every((term) => row.searchText.includes(term.toLowerCase())))
              .map((row) => row.id);
    return new Set(ids);
}
