import type { Database } from 'bun:sqlite';

export const SEARCH_GENERATION = 'bge-m3-5617a9f-cls-l2-512-v1';
export function createSearchStore(db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS search_state(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL);
        INSERT OR IGNORE INTO search_state VALUES(1,0);
        INSERT OR IGNORE INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
        CREATE TEMP TABLE IF NOT EXISTS authorized_search(id TEXT PRIMARY KEY);`);
    const bump = () => db.query('UPDATE search_state SET epoch=epoch+1 WHERE id=1').run();
    return {
        bump,
        run(op: string, args: unknown[]): unknown {
            if (op === 'search.epoch')
                return db.query('SELECT epoch FROM search_state WHERE id=1').get();
            if (op === 'search.versions') {
                const ids = args[0] as string[];
                return ids.length
                    ? db
                          .query(
                              `SELECT id,content_hash AS contentHash FROM search_documents WHERE id IN (${ids.map(() => '?').join(',')})`,
                          )
                          .all(...ids)
                    : [];
            }
            if (op === 'search.hardFilter') {
                const [required, excluded, ids] = args as [string, string, string[]];
                db.exec('DELETE FROM authorized_search');
                const insert = db.query('INSERT OR IGNORE INTO authorized_search(id) VALUES(?)');
                ids.forEach((id) => insert.run(id));
                const clauses: string[] = [],
                    bindings: string[] = [];
                if (required) {
                    clauses.push(
                        'd.row_id IN (SELECT rowid FROM device_search_fts WHERE device_search_fts MATCH ?)',
                    );
                    bindings.push(required);
                }
                if (excluded) {
                    clauses.push(
                        'd.row_id NOT IN (SELECT rowid FROM device_search_fts WHERE device_search_fts MATCH ?)',
                    );
                    bindings.push(excluded);
                }
                return db
                    .query(
                        `SELECT d.id FROM search_documents d JOIN authorized_search a ON a.id=d.id
                    WHERE ${clauses.join(' AND ') || '1'}`,
                    )
                    .all(...bindings);
            }
            if (op === 'search.lexical') {
                const [expression, ids, limit] = args as [string, string[], number];
                db.exec('DELETE FROM authorized_search');
                const insert = db.query('INSERT OR IGNORE INTO authorized_search(id) VALUES(?)');
                ids.forEach((id) => insert.run(id));
                return db
                    .query(
                        `SELECT d.id,bm25(device_search_fts,3.0,2.0,1.0) AS score
                    FROM device_search_fts JOIN search_documents d ON d.row_id=device_search_fts.rowid
                    JOIN authorized_search a ON a.id=d.id WHERE device_search_fts MATCH ?
                    ORDER BY score,d.id LIMIT ?`,
                    )
                    .all(expression, limit);
            }
            if (op === 'search.claim') {
                const now = Number(args[0]);
                const job = db
                    .query(
                        `SELECT j.*,d.title,d.metadata,d.body FROM embedding_jobs j
                    JOIN search_documents d ON j.id=d.id WHERE retry_at<=? AND lease_until<=?
                    ORDER BY retry_at,j.rowid DESC LIMIT 1`,
                    )
                    .get(now, now) as Record<string, unknown> | null;
                if (!job) return null;
                const lease = now + 300_000;
                db.query('UPDATE embedding_jobs SET lease_until=? WHERE id=?').run(
                    lease,
                    String(job.id),
                );
                return { ...job, lease_until: lease };
            }
            if (op === 'search.publish') {
                const [job, vectors] = args as [Record<string, unknown>, string[]];
                const current = db
                    .query(
                        `SELECT d.id FROM search_documents d JOIN embedding_jobs j ON j.id=d.id
                    WHERE d.id=? AND d.user_id=? AND d.revision=? AND d.content_hash=?
                    AND j.generation=? AND j.lease_until=?`,
                    )
                    .get(
                        String(job.id),
                        String(job.user_id),
                        String(job.revision),
                        String(job.content_hash),
                        SEARCH_GENERATION,
                        Number(job.lease_until),
                    );
                if (!current) return false;
                if (!vectors.length || vectors.length > 256) throw new Error('Invalid chunk count');
                const decoded = vectors.map((base64) => {
                    const bytes = Buffer.from(base64, 'base64');
                    if (bytes.length !== 4096) throw new Error('Invalid bge-m3 vector dimensions');
                    for (let offset = 0; offset < bytes.length; offset += 4)
                        if (!Number.isFinite(bytes.readFloatLE(offset)))
                            throw new Error('Non-finite embedding');
                    return bytes;
                });
                db.query('DELETE FROM search_embeddings WHERE id=?').run(String(job.id));
                const insert = db.query(
                    'INSERT INTO search_embeddings(id,chunk,user_id,revision,content_hash,generation,dimensions,vector) VALUES(?,?,?,?,?,?,1024,?)',
                );
                decoded.forEach((bytes, chunk) =>
                    insert.run(
                        String(job.id),
                        chunk,
                        String(job.user_id),
                        String(job.revision),
                        String(job.content_hash),
                        SEARCH_GENERATION,
                        bytes,
                    ),
                );
                db.query('DELETE FROM embedding_jobs WHERE id=?').run(String(job.id));
                bump();
                return true;
            }
            if (op === 'search.fail') {
                const [job, reason] = args as [Record<string, unknown>, string];
                const delay = Math.min(3_600_000, 5000 * 2 ** Math.min(10, Number(job.attempts)));
                db.query(
                    `UPDATE embedding_jobs SET attempts=attempts+1,retry_at=?,lease_until=0,last_error=?
                    WHERE id=? AND revision=? AND lease_until=?`,
                ).run(
                    Date.now() + delay,
                    reason.slice(0, 200),
                    String(job.id),
                    String(job.revision),
                    Number(job.lease_until),
                );
                return true;
            }
            if (op === 'search.vectorBatch') {
                const [owner, after] = args as [string, { id: string; chunk: number } | null];
                const rows = db
                    .query(
                        `SELECT e.id,e.chunk,e.revision,e.content_hash AS contentHash,e.vector FROM search_embeddings e INDEXED BY search_embeddings_scan
                    JOIN search_documents d INDEXED BY sqlite_autoindex_search_documents_1 ON d.id=e.id
                    WHERE e.user_id=? AND e.generation=? AND (e.id,e.chunk)>(?,?)
                    AND e.revision=d.revision AND e.content_hash=d.content_hash
                    ORDER BY e.id,e.chunk LIMIT 128`,
                    )
                    .all(owner, SEARCH_GENERATION, after?.id ?? '', after?.chunk ?? -1) as Array<{
                    id: string;
                    chunk: number;
                    revision: string;
                    contentHash: string;
                    vector: Uint8Array;
                }>;
                return rows.map((row) => ({
                    id: JSON.stringify([row.id, row.chunk]),
                    documentId: row.id,
                    chunk: row.chunk,
                    revision: row.revision,
                    contentHash: row.contentHash,
                    vector: Buffer.from(row.vector).toString('base64'),
                }));
            }
            if (op === 'search.stats') {
                const pending = db.query('SELECT count(*) AS count FROM embedding_jobs').get() as {
                    count: number;
                };
                const embedded = db
                    .query(
                        'SELECT count(DISTINCT id) AS count FROM search_embeddings WHERE generation=?',
                    )
                    .get(SEARCH_GENERATION) as { count: number };
                return {
                    pending: pending.count,
                    embedded: embedded.count,
                    generation: SEARCH_GENERATION,
                };
            }
            throw new Error('Unknown search operation');
        },
    };
}
