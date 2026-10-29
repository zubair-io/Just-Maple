import { getSqliteDatabase } from '../db/client';
import { serverSearchWorker } from './server-search-worker.service';

export async function embedNextDeviceItem(): Promise<boolean> {
    const db = getSqliteDatabase();
    if (!db) return false;
    const job = await db.request<Record<string, unknown> | null>('search.claim', undefined, [
        Date.now(),
    ]);
    if (!job) return false;
    try {
        const { chunks } = await serverSearchWorker.request<{ chunks: string[] }>(
            {
                op: 'chunks',
                header: [job.title, job.metadata].filter(Boolean).join('\n'),
                text: job.body,
            },
            true,
        );
        const vectors: string[] = [];
        for (const text of chunks) {
            const response = await serverSearchWorker.request<{ vector: string }>(
                { op: 'embed', text },
                true,
            );
            vectors.push(response.vector);
        }
        await db.request('search.publish', undefined, [job, vectors]);
    } catch (error) {
        // Worker errors never include source text in persisted/logged diagnostics.
        await db.request('search.fail', undefined, [
            job,
            (error as Error).message.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 100),
        ]);
    }
    return true;
}
export function startServerEmbedding() {
    serverSearchWorker.start();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
        let worked = false;
        if (serverSearchWorker.state === 'ready')
            worked = await embedNextDeviceItem().catch(() => false);
        else serverSearchWorker.start();
        if (!stopped) {
            timer = setTimeout(() => void tick(), worked ? 0 : 1000);
            timer.unref?.();
        }
    };
    timer = setTimeout(() => void tick(), 0);
    timer.unref?.();
    return () => {
        stopped = true;
        clearTimeout(timer);
        serverSearchWorker.close();
    };
}
