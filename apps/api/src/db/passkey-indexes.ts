import type { Db } from 'mongodb';

export async function ensurePasskeyIndexes(database: Db): Promise<void> {
    // Preserve legacy email metadata while allowing accounts without an email.
    // Fail startup if the migration cannot complete rather than accepting broken signups.
    const users = database.collection('users');
    if (await database.listCollections({ name: 'users' }).hasNext()) {
        for (const index of await users.indexes()) {
            if (index.key.email === 1 && Object.keys(index.key).length === 1 && !index.sparse) {
                try {
                    await users.dropIndex(index.name!);
                } catch (error: any) {
                    // Another replica may have completed the same migration.
                    if (error.code !== 27) throw error;
                }
            }
        }
    }
    await users.createIndex({ email: 1 }, { unique: true, sparse: true });
    await database
        .collection('passkey_challenges')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
