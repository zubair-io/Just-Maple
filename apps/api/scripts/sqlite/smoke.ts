// Operator-only staging verification. Never exposes the short-lived authentication token.
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { SignJWT } from 'jose';
import { config } from '../../src/config';
import { connectToDatabase, closeDatabase, getSqliteDatabase } from '../../src/db/client';
import { upsertDeviceItems } from '../../src/repositories/device-item.repo';
import { serverSearchWorker } from '../../src/services/server-search-worker.service';
import { embedNextDeviceItem } from '../../src/services/server-embedding.service';
import { searchServerDataPages } from '../../src/services/server-hybrid-search.service';
import { executeMacDataTool } from '../../src/services/mac-data-tools.service';
import { dataPageSlicesFor } from '../../src/services/device-data-access.service';
import type { MacDataItem } from '@maple/shared';

if (process.env.JUST_MAPLE_STAGING_SMOKE !== 'true' || config.databaseDriver !== 'sqlite') {
    throw new Error('Requires explicit JUST_MAPLE_STAGING_SMOKE=true and SQLite');
}
const mode = process.argv[2];
assert(['http', 'search'].includes(mode), 'Choose http or search');
const db = await connectToDatabase();
const user = new ObjectId();
const stranger = new ObjectId();
const notebook = new ObjectId();
const page = crypto.randomUUID();
const userId = user.toHexString();
const now = new Date();
let httpNotebook: string | undefined;
try {
    for (const _id of [user, stranger]) {
        await db.collection('users').insertOne({
            _id,
            email: `smoke-${_id}@example.invalid`,
            displayName: 'Staging smoke fixture',
            createdAt: now,
            updatedAt: now,
        });
    }
    if (mode === 'http') {
        const base = process.env.SMOKE_API_URL || 'http://127.0.0.1:7071';
        const token = await new SignJWT({ sub: userId })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(new TextEncoder().encode(config.jwtSecret));
        const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
        assert.equal((await fetch(`${base}/api/notebooks`)).status, 401);
        const create = await fetch(`${base}/api/notebooks`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ label: 'Staging smoke fixture' }),
        });
        assert.equal(create.status, 200);
        const created = (await create.json()) as { notebook: { _id: string } };
        httpNotebook = created.notebook._id;
        const updated = await fetch(`${base}/api/notebooks/${httpNotebook}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ label: 'Staging smoke updated' }),
        });
        assert.equal(updated.status, 200);
        const read = await fetch(`${base}/api/notebooks/${httpNotebook}`, { headers });
        assert.equal(
            ((await read.json()) as { notebook: { label: string } }).notebook.label,
            'Staging smoke updated',
        );
        const dev = await fetch(`${base}/api/auth/dev-token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'http://localhost:7073' },
            body: JSON.stringify({ email: 'smoke@example.invalid', token: 'invalid' }),
        });
        assert.equal(dev.status, 404, 'Production must hide development authentication');
        console.log(
            JSON.stringify({
                http: 'passed',
                checks: [
                    'anonymous denied',
                    'authenticated notebook create/update/read',
                    'development auth disabled',
                ],
            }),
        );
    } else {
        await db.collection('notebooks').insertOne({
            _id: notebook,
            type: 'folder',
            value: 'mixed',
            label: 'Staging search smoke',
            sharing: { sharedWith: [{ userId, accessLevel: 'owner' }] },
            createdAt: now,
            updatedAt: now,
        });
        await db.collection('pages').insertOne({
            id: page,
            userId: user,
            notebookId: notebook,
            type: 'devicedata',
            deviceSource: 'imessage',
            title: 'Staging messages',
            createdAt: now,
            updatedAt: now,
        });
        const item = (id: string, body: string): MacDataItem => ({
            id: `imessage:smoke-${id}`,
            source: 'imessage',
            revision: '1',
            occurredAt: 1000,
            title: 'Message',
            participants: [],
            body,
        });
        await upsertDeviceItems(userId, 'staging-smoke', [
            item('delivery', 'The courier left your parcel with the receptionist in the lobby.'),
            item('dinner', 'Tonight we are cooking pasta with tomato sauce.'),
        ]);
        await upsertDeviceItems(String(stranger), 'staging-smoke', [
            item('delivery', 'A private message about collecting a package.'),
        ]);
        await serverSearchWorker.request({ op: 'ping' });
        const sqlite = getSqliteDatabase()!;
        for (let attempt = 0; attempt < 8; attempt++) {
            const count = await sqlite.request<Array<{ count: number }>>('sql', undefined, [
                'SELECT count(DISTINCT id) AS count FROM search_embeddings WHERE user_id IN (?,?)',
                [userId, String(stranger)],
            ]);
            if (count[0]!.count === 3) break;
            assert(await embedNextDeviceItem(), 'Expected queued smoke embeddings');
        }
        const ctx = { userId, notebookId: String(notebook), timeZone: 'UTC' };
        const started = performance.now();
        const result = await searchServerDataPages(ctx, {
            query: 'where can I collect my package',
        });
        assert.equal(result.search.mode, 'hybrid', JSON.stringify(result.search));
        assert.equal(result.results[0]?.id, 'imessage:smoke-delivery');
        assert(result.results.every((hit) => !hit.snippet.includes('private')));
        const toolCtx = {
            ...ctx,
            sources: ['imessage'] as const,
            pages: await dataPageSlicesFor(userId, String(notebook)),
            now: now.toISOString(),
        };
        const detail = await executeMacDataTool(
            { ...toolCtx, sources: ['imessage'] },
            'get_local_item',
            { id: result.results[0]!.reference },
        );
        assert(detail.includes('receptionist'));
        await db
            .collection('notebooks')
            .updateOne({ _id: notebook }, { $set: { 'sharing.sharedWith': [] } });
        const revoked = await executeMacDataTool(
            { ...toolCtx, sources: ['imessage'] },
            'get_local_item',
            { id: result.results[0]!.reference },
        );
        assert(!revoked.includes('receptionist'), 'Revoked membership must deny cached references');
        assert.equal((await searchServerDataPages(ctx, { query: 'parcel' })).results.length, 0);
        console.log(
            JSON.stringify({
                nativeSearch: 'passed',
                queryMs: Math.round(performance.now() - started),
                checks: [
                    'server embeddings',
                    'semantic paraphrase',
                    'owner isolation',
                    'opaque reference hydration',
                    'sharing revocation',
                ],
            }),
        );
    }
} finally {
    // Only records generated by this run are removed; imported staging data is untouched.
    await db.collection('device_items').deleteMany({ userId: { $in: [userId, String(stranger)] } });
    await db.collection('pages').deleteOne({ id: page });
    await db.collection('notebooks').deleteMany({
        _id: { $in: [notebook, ...(httpNotebook ? [new ObjectId(httpNotebook)] : [])] },
    });
    await db.collection('users').deleteMany({ _id: { $in: [user, stranger] } });
    serverSearchWorker.close();
    await closeDatabase();
}
// Imported application services own housekeeping intervals. All smoke resources
// and fixture writes are closed above; this one-shot operator command is finished.
process.exit(0);
