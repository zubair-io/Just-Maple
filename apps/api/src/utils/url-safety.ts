import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guards for URLs the server fetches on a user's behalf (bot HTTP actions, custom AI
 * endpoints), so a user can't point the server at its own network or cloud metadata.
 */

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
    const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    // URLs write IPv4-mapped addresses in hex: ::ffff:7f00:1 is 127.0.0.1.
    const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex?.[1] && hex[2]) {
        const high = parseInt(hex[1], 16);
        const low = parseInt(hex[2], 16);
        return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    if (isIP(ip) === 4) {
        const [a = 0, b = 0] = ip.split('.').map(Number);
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168)
        );
    }
    if (isIP(ip) === 6) {
        return (
            ip === '::' ||
            ip === '::1' ||
            ip.startsWith('fc') ||
            ip.startsWith('fd') ||
            /^fe[89ab]/.test(ip)
        );
    }
    return false;
}

/** Throws if the URL isn't http(s) or names a local, private or internal host. */
export function validateUrl(url: string): void {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only HTTP and HTTPS protocols are allowed');
    }
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error('Access to localhost is not allowed');
    }
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
        throw new Error('Access to cloud metadata endpoints is not allowed');
    }
    if (isPrivateAddress(hostname)) {
        throw new Error('Access to private networks is not allowed');
    }
    if (hostname.endsWith('.internal') || hostname.endsWith('.local')) {
        throw new Error('Access to internal domains is not allowed');
    }
}

/**
 * Normalizes the API root of an OpenAI-compatible server ("https://host/v1"). Accepts a
 * pasted ".../chat/completions" URL too. Only https, and no credentials, query or fragment.
 */
export function normalizeEndpointBaseUrl(input: string): string {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new Error('Enter a full URL, like https://openrouter.ai/api/v1');
    }
    if (url.protocol !== 'https:') throw new Error('The endpoint URL must start with https://');
    if (url.username || url.password) throw new Error('Put the API key in its own field');
    if (url.search || url.hash) throw new Error('The endpoint URL cannot have ? or # parts');
    validateUrl(url.toString());
    const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    return `${url.origin}${path}`;
}

/**
 * Resolves the host and rejects it if any address is private, so a public name that
 * points at an internal address is caught too.
 */
export async function assertPublicHost(url: string): Promise<void> {
    const { hostname } = new URL(url);
    if (isIP(hostname.replace(/^\[|\]$/g, ''))) return; // Literal addresses were checked already.
    let addresses: Array<{ address: string }>;
    try {
        addresses = await lookup(hostname, { all: true });
    } catch {
        throw new Error(`Could not find the server ${hostname}`);
    }
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
        throw new Error('Access to private networks is not allowed');
    }
}
