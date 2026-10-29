import { Binary, Double, EJSON, Int32, Long, ObjectId } from 'bson';

/** Canonical EJSON preserves legacy ObjectIds, Dates and typed bytes over IPC. */
function bsonBytes(value: unknown): unknown {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return new Binary(value);
    if (Array.isArray(value)) return value.map(bsonBytes);
    if (value && Object.getPrototypeOf(value) === Object.prototype)
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, bsonBytes(item)]),
        );
    return value;
}
export const encode = (value: unknown): string =>
    EJSON.stringify(bsonBytes(value), { relaxed: false }).replace(
        /[\u0085\u2028\u2029]/g,
        (value) => '\\u' + value.charCodeAt(0).toString(16).padStart(4, '0'),
    );
export const decode = <T = unknown>(value: string): T => {
    const numbers = (value: unknown): unknown => {
        if (value instanceof Int32 || value instanceof Double) return value.valueOf();
        if (value instanceof Long && value._bsontype === 'Long') {
            const number = value.toNumber();
            return Number.isSafeInteger(number) ? number : value;
        }
        if (Array.isArray(value)) return value.map(numbers);
        if (value && Object.getPrototypeOf(value) === Object.prototype)
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, numbers(item)]),
            );
        return value;
    };
    return numbers(EJSON.parse(value, { relaxed: false })) as T;
};
export const clone = <T>(value: T): T => decode<T>(encode(value));

export function scalar(value: unknown): string | number | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.getTime();
    if (value instanceof ObjectId) return value.toHexString();
    if (value instanceof Binary) return Buffer.from(value.buffer).toString('base64');
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
}

export function indexValue(value: unknown, path = ''): unknown {
    if (value === undefined) return undefined;
    if (value instanceof Binary || Buffer.isBuffer(value) || value instanceof Uint8Array)
        return path === 'tokenHash'
            ? scalar(value instanceof Binary ? value : new Binary(value))
            : null;
    if (Array.isArray(value)) return value.map((item) => indexValue(item, path));
    if (
        value &&
        typeof value === 'object' &&
        !(value instanceof Date) &&
        !(value instanceof ObjectId) &&
        !(value instanceof Binary)
    ) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                indexValue(item, path ? `${path}.${key}` : key),
            ]),
        );
    }
    // Keep booleans as JSON booleans so array query semantics are retained.
    return typeof value === 'boolean' ? value : scalar(value);
}

export interface StoredBlob {
    path: string[];
    bytes: Uint8Array;
    subtype: number;
}

/** Binary payloads live in SQLite BLOBs, never base64 copies of Yjs state. */
export function splitBlobs(document: Record<string, unknown>): {
    body: string;
    indexData: string;
    blobs: StoredBlob[];
} {
    const blobs: StoredBlob[] = [];
    const visit = (value: unknown, path: string[]): unknown => {
        if (value instanceof Binary || Buffer.isBuffer(value) || value instanceof Uint8Array) {
            const binary = value instanceof Binary ? value : new Binary(value);
            blobs.push({ path, bytes: Uint8Array.from(binary.buffer), subtype: binary.sub_type });
            return null;
        }
        if (Array.isArray(value)) return value.map((item, i) => visit(item, [...path, String(i)]));
        if (value && Object.getPrototypeOf(value) === Object.prototype) {
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, visit(item, [...path, key])]),
            );
        }
        return value;
    };
    return {
        body: encode(visit(document, [])),
        indexData: JSON.stringify(indexValue(document)),
        blobs,
    };
}

export function joinBlobs(body: string, blobs: StoredBlob[]): Record<string, unknown> {
    const doc = decode<Record<string, unknown>>(body);
    for (const blob of blobs) {
        let parent: Record<string, unknown> = doc;
        for (const key of blob.path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
        parent[blob.path.at(-1)!] = new Binary(Uint8Array.from(blob.bytes), blob.subtype);
    }
    return doc;
}
