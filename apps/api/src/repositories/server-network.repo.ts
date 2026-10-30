import { config } from '../config';
import { getDb } from '../db/client';

interface NetworkDocument {
    _id: string;
    localUrl: string | null;
    updatedAt: Date;
}

/** Origins only. This setting advertises an existing HTTPS listener; it does not configure DNS/TLS. */
export function normalizeLocalAddress(input: string | null): string | null {
    if (input === null || !input.trim()) return null;
    const text = input.trim();
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.pathname !== '' && url.pathname !== '/') ||
        (url.protocol !== 'https:' &&
            !(
                url.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            ))
    )
        throw new Error(
            'Enter a hostname or HTTPS origin without credentials, a path, query or fragment.',
        );
    return url.origin;
}

export async function getServerNetworkSettings() {
    const saved = await getDb()
        .collection<NetworkDocument>('server_settings')
        .findOne({ _id: 'network' });
    let localUrl: string | null = null;
    try {
        localUrl = normalizeLocalAddress(saved ? saved.localUrl : config.localUrl);
    } catch {
        /* Do not advertise an invalid operator value. */
    }
    return { publicUrl: config.publicUrl, localUrl, source: saved ? 'server' : 'environment' };
}

export async function setServerLocalAddress(input: string | null) {
    const localUrl = normalizeLocalAddress(input);
    await getDb()
        .collection<NetworkDocument>('server_settings')
        .updateOne(
            { _id: 'network' },
            { $set: { localUrl, updatedAt: new Date() } },
            { upsert: true },
        );
    return getServerNetworkSettings();
}
