import { testDb } from '../setup';

export function getTestDb() {
    return testDb;
}

export async function clearCollection(name: string) {
    await testDb.collection(name).deleteMany({});
}

export async function clearAllCollections() {
    const collections = await testDb.listCollections().toArray();
    for (const col of collections) {
        await testDb.collection(col.name).deleteMany({});
    }
}
