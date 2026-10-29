import type { Db } from 'mongodb';
import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDatabase } from '../db/sqlite/client';

let testDb: Db;
let sqlite: SqliteDatabase;
// Retained as a fixture API name; true means every database test runs on SQLite.
const mongoAvailable = true;

vi.mock('../db/client', () => ({
    getDb: () => testDb,
    getSqliteDatabase: () => sqlite,
    connectToDatabase: async () => testDb,
    closeDatabase: async () => {},
}));

beforeAll(async () => {
    const metadata = JSON.parse(
        readFileSync(join(process.cwd(), '.test-tmp', 'database.json'), 'utf8'),
    ) as { path: string };
    sqlite = new SqliteDatabase(metadata.path);
    await sqlite.ready;
    testDb = sqlite.asRepositoryDatabase();
    const { createIndexes } = await vi.importActual<typeof import('../db/client')>('../db/client');
    await createIndexes(testDb);
});

afterEach(async () => {
    for (const collection of await testDb.listCollections().toArray()) {
        await testDb.collection(collection.name).deleteMany({});
    }
});
afterAll(async () => {
    await sqlite.close();
});

export { testDb, mongoAvailable };
