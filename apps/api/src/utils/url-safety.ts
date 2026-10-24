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
 * True for servers on the user's own machine or home network: localhost, private and
 * link-local addresses, and names like "nas.local" or a bare "studio". The API never
 * calls these itself; it asks the owner's Mac app to.
 */
export function isLocalHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (isIP(host)) return isPrivateAddress(host);
    return (
        host === 'localhost' ||
        !host.includes('.') ||
        /\.(localhost|local|lan|home\.arpa|internal)$/.test(host)
    );
}

/** True when this server URL is reached through the owner's Mac instead of the API. */
export function isLocalEndpoint(baseUrl: string): boolean {
    return isLocalHost(new URL(baseUrl).hostname);
}

/**
 * Normalizes the API root of an OpenAI-compatible server ("https://host/v1"). Accepts a
 * pasted ".../chat/completions" URL too. No credentials, query or fragment. Public
 * servers must use https; local ones (Ollama, LM Studio) may use http.
 */
export function normalizeEndpointBaseUrl(input: string): string {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new Error('Enter a full URL, like https://openrouter.ai/api/v1');
    }
    if (url.username || url.password) throw new Error('Put the API key in its own field');
    if (url.search || url.hash) throw new Error('The endpoint URL cannot have ? or # parts');
    if (isLocalHost(url.hostname)) {
        if (!['http:', 'https:'].includes(url.protocol))
            throw new Error('The endpoint URL must start with http:// or https://');
    } else {
        if (url.protocol !== 'https:')
            throw new Error(
                'Internet servers must use https://. Local servers like Ollama can use http://.',
            );
        validateUrl(url.toString());
    }
    const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    return `${url.origin}${path}`;
}

/**
 * Normalizes a server URL and checks where it can be reached from. Public servers are
 * resolved to make sure the name doesn't point into a private network; local servers
 * are left to the owner's Mac.
 */
export async function resolveEndpoint(input: string): Promise<{ baseUrl: string; local: boolean }> {
    const baseUrl = normalizeEndpointBaseUrl(input);
    const local = isLocalEndpoint(baseUrl);
    if (!local) await assertPublicHost(baseUrl);
    return { baseUrl, local };
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
