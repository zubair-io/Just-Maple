import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { config } from '../config';

/** Prevent writes into an empty mountpoint when required external storage is absent. */
export async function assertLocalStorageReady(): Promise<void> {
    if (!config.localStorageRequired) return;
    try {
        const marker = await readFile(
            join(config.localStoragePath, '.just-maple-instance'),
            'utf8',
        );
        if (!config.instanceId || marker.trim() !== config.instanceId)
            throw new Error('Wrong store');
    } catch {
        throw new Error('Required media storage is unavailable');
    }
}

/** Public app assets only; never expose arbitrary paths beneath the media store. */
export function publicAssetPath(relative: string): string {
    if (
        relative.split('/').some((part) => !part || part === '.' || part === '..') ||
        relative.includes('\\') ||
        relative.includes('\0')
    ) {
        throw new Error('Invalid asset path');
    }
    const root = resolve(config.localStoragePath, 'assets');
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) throw new Error('Invalid asset path');
    return path;
}
