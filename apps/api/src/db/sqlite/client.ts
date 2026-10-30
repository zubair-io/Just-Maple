import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Db, Document, Collection, FindOptions, Filter } from 'mongodb';
import { decode, encode } from './codec';

interface Reply {
    id: number;
    value?: unknown;
    error?: { message: string; code?: number | string };
}
interface Pending {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Transitional repository boundary. All storage and atomic mutations execute in
 * a dedicated SQLite process; Mongo's driver is used only for existing type contracts.
 * The process never connects to Mongo and never retries an uncertain write.
 */
export class SqliteDatabase {
    private child: ChildProcessWithoutNullStreams;
    private pending = new Map<number, Pending>();
    private nextId = 0;
    private collections = new Map<string, Collection<Document>>();
    private closed = false;
    readonly ready: Promise<unknown>;

    constructor(readonly path: string) {
        const entry =
            process.env.SQLITE_WORKER_PATH ||
            fileURLToPath(
                new URL(
                    import.meta.url.endsWith('.ts') ? './worker.ts' : './sqlite-worker.js',
                    import.meta.url,
                ),
            );
        this.child = spawn(process.env.BUN_EXEC_PATH || 'bun', [entry, path], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
        });
        this.child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
        createInterface({ input: this.child.stdout }).on('line', (line) => {
            let reply: Reply;
            try {
                reply = decode<Reply>(line);
            } catch {
                this.fail(new Error('Invalid SQLite worker response'));
                return;
            }
            const pending = this.pending.get(reply.id);
            if (!pending) return;
            this.pending.delete(reply.id);
            clearTimeout(pending.timer);
            if (reply.error) {
                pending.reject(
                    Object.assign(new Error(reply.error.message), { code: reply.error.code }),
                );
            } else pending.resolve(reply.value);
        });
        this.child.on('error', (error) => this.fail(error));
        this.child.on('exit', (code, signal) =>
            this.fail(new Error(`SQLite worker stopped (${signal || code})`)),
        );
        this.ready = this.request('ping');
    }

    private fail(error: Error): void {
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
        this.child.kill();
    }

    request<T = unknown>(operation: string, collection?: string, args: unknown[] = []): Promise<T> {
        if (this.closed) return Promise.reject(new Error('SQLite database is closed'));
        const id = ++this.nextId;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    this.fail(
                        new Error(
                            `SQLite worker deadline exceeded (${operation}${collection ? `: ${collection}` : ''}); write outcome may be unknown`,
                        ),
                    ),
                60_000,
            );
            timer.unref?.();
            this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
            this.child.stdin.write(encode({ id, operation, collection, args }) + '\n', (error) => {
                if (error) this.fail(error);
            });
        });
    }

    collection<T extends Document = Document>(name: string): Collection<T> {
        const existing = this.collections.get(name);
        if (existing) return existing as unknown as Collection<T>;
        const request = <R>(op: string, args: unknown[] = []) => this.request<R>(op, name, args);
        const cursor = (
            filter: unknown,
            options: Record<string, unknown> = {},
            pipeline?: unknown[],
        ) => {
            let skip = 0,
                limit = 0,
                projection = options.projection,
                sort = options.sort;
            let values: unknown[] | undefined;
            let position = 0;
            const all = async () =>
                (values ??= await request<unknown[]>(
                    pipeline ? 'aggregate' : 'find',
                    pipeline ? [pipeline] : [filter, { ...options, skip, limit, projection, sort }],
                ));
            const view = {
                sort(value: unknown) {
                    sort = value;
                    return view;
                },
                project(value: unknown) {
                    projection = value;
                    return view;
                },
                skip(value: number) {
                    skip = value;
                    return view;
                },
                limit(value: number) {
                    limit = value;
                    return view;
                },
                hint() {
                    return view;
                },
                async toArray() {
                    return all();
                },
                async next() {
                    return (await all())[position++] ?? null;
                },
                async hasNext() {
                    return position < (await all()).length;
                },
                async *[Symbol.asyncIterator]() {
                    for (const item of await all()) yield item;
                },
            };
            return view;
        };
        const collection = {
            find: (filter: Filter<T> = {}, options: FindOptions = {}) =>
                cursor(filter, { ...options }),
            findOne: (filter: unknown = {}, options: unknown = {}) =>
                request('findOne', [filter, options]),
            aggregate: (pipeline: unknown[]) => cursor({}, {}, pipeline),
            insertOne: (doc: unknown) => request('insertOne', [doc]),
            insertMany: (docs: unknown[], options?: unknown) =>
                request('insertMany', [docs, options]),
            updateOne: (filter: unknown, update: unknown, options?: unknown) =>
                request('updateOne', [filter, update, options]),
            updateMany: (filter: unknown, update: unknown, options?: unknown) =>
                request('updateMany', [filter, update, options]),
            replaceOne: (filter: unknown, update: unknown, options?: unknown) =>
                request('replaceOne', [filter, update, options]),
            findOneAndUpdate: (filter: unknown, update: unknown, options?: unknown) =>
                request('findOneAndUpdate', [filter, update, options]),
            findOneAndDelete: (filter: unknown, options?: unknown) =>
                request('findOneAndDelete', [filter, options]),
            deleteOne: (filter: unknown) => request('deleteOne', [filter]),
            deleteMany: (filter: unknown) => request('deleteMany', [filter]),
            countDocuments: (filter: unknown = {}) => request('countDocuments', [filter]),
            estimatedDocumentCount: () => request('countDocuments', [{}]),
            distinct: (field: string, filter: unknown = {}) => request('distinct', [field, filter]),
            bulkWrite: (operations: unknown[], options?: unknown) =>
                request('bulkWrite', [operations, options]),
            createIndex: (key: unknown, options?: unknown) =>
                request('createIndex', [key, options]),
            indexes: () => request('indexes'),
            listIndexes: () => ({ toArray: () => request('indexes') }),
            dropIndex: (index: string) => request('dropIndex', [index]),
            drop: () => request('dropCollection'),
        };
        // Deliberately bounded, audited surface; unsupported operations are absent.
        this.collections.set(name, collection as unknown as Collection<Document>);
        return collection as unknown as Collection<T>;
    }

    listCollections(filter: { name?: string } = {}) {
        const read = () =>
            this.request<Array<{ name: string }>>('listCollections', undefined, [filter]);
        return { toArray: read, hasNext: async () => (await read()).length > 0 };
    }
    async createCollection(name: string) {
        await this.request('createCollection', name);
        return this.collection(name);
    }
    dropCollection(name: string) {
        return this.request<boolean>('dropCollection', name);
    }
    dropDatabase() {
        return this.request('dropDatabase');
    }
    command(command: Record<string, unknown>) {
        if (command.ping) return this.request('ping');
        throw new Error('Unsupported SQLite database command');
    }
    /** Only the existing repository interface is cast; persistence remains SQLite. */
    asRepositoryDatabase(): Db {
        return this as unknown as Db;
    }
    async close() {
        if (this.closed) return;
        await this.request('close');
        this.closed = true;
        this.child.stdin.end();
    }
}
