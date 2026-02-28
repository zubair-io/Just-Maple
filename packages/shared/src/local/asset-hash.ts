/**
 * Content-addressed asset hashing using Web Crypto API.
 * Works in both Bun/Node and browser environments.
 */

// globalThis.crypto is available in Bun, Node 19+, and all modern browsers
declare const crypto: { subtle: { digest(algo: string, data: Uint8Array): Promise<ArrayBuffer> } };

/**
 * Compute a SHA-256 hash prefix for an asset's content.
 * Returns the first 6 hex characters.
 */
export async function computeAssetHash(content: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = new Uint8Array(hashBuffer);
    const hex = Array.from(hashArray)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return hex.slice(0, 6);
}

/**
 * Build an asset filename from a hash prefix and file extension.
 * Example: toAssetFilename("3a7f2b", "png") → "3a7f2b.png"
 */
export function toAssetFilename(hash: string, ext: string): string {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    return `${hash}.${cleanExt}`;
}
