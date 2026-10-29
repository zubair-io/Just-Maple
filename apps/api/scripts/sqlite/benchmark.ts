// Staging-only corpus timings. Reports counts/timings, never message text or account identifiers.
import { config } from '../../src/config';
import { connectToDatabase, closeDatabase } from '../../src/db/client';
import { serverSearchWorker } from '../../src/services/server-search-worker.service';
import { searchServerDataPages } from '../../src/services/server-hybrid-search.service';

if (process.env.JUST_MAPLE_STAGING_SMOKE !== 'true' || config.databaseDriver !== 'sqlite') {
    throw new Error('Requires explicit JUST_MAPLE_STAGING_SMOKE=true and SQLite');
}
const db = await connectToDatabase();
try {
    await serverSearchWorker.request({ op: 'ping' });
    const pages = await db
        .collection('pages')
        .find({ type: 'devicedata', isTrashed: { $ne: true } })
        .limit(20)
        .toArray();
    const seen = new Set<string>();
    for (const page of pages) {
        if (!page.notebookId || seen.has(String(page.notebookId))) continue;
        seen.add(String(page.notebookId));
        const ctx = {
            userId: String(page.userId),
            notebookId: String(page.notebookId),
            timeZone: 'UTC',
        };
        for (const query of ['package', 'where is the parcel', 'meeting', 'package']) {
            const start = performance.now();
            const result = await searchServerDataPages(ctx, { query });
            console.log(
                JSON.stringify({
                    sample: seen.size,
                    ms: Math.round(performance.now() - start),
                    count: result.results.length,
                    ...result.search,
                }),
            );
        }
        if (seen.size >= 3) break;
    }
} finally {
    serverSearchWorker.close();
    await closeDatabase();
}
process.exit(0);
