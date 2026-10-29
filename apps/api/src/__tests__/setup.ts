import type { Db } from 'mongodb';
import { beforeAll, afterAll, afterEach, inject, vi } from 'vitest';
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
    sqlite = new SqliteDatabase(inject('sqliteDatabasePath'));
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
