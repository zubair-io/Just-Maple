import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config';

/** Exact API root, restricted to RFC1918 literals; metadata/loopback are never exempted. */
function isAllowedPrivateBotRoot(base: string): boolean {
    const url = new URL(base);
    if (isIP(url.hostname) !== 4) return false;
    const [a, b] = url.hostname.split('.').map(Number);
    if (!(a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)))
        return false;
    return config.botAllowedPrivateEndpoints.some((entry) => {
        try {
            const allowed = new URL(entry);
            return (
                !allowed.username &&
                !allowed.password &&
                !allowed.search &&
                !allowed.hash &&
                ['http:', 'https:'].includes(allowed.protocol) &&
                `${allowed.origin}${allowed.pathname.replace(/\/+$/, '')}` === base
            );
        } catch {
            return false;
        }
    });
}

/**
 * Guards for URLs the server fetches on a user's behalf (bot HTTP actions, custom AI
 * endpoints), so a user can't point the server at its own network or cloud metadata.
 */

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
    const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(ip) === 4) {
        const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
        return (
            ip === '168.63.129.16' || // Azure's host endpoint (wireserver: DNS, DHCP, health)
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
            (a === 198 && (b === 18 || b === 19)) || // benchmarking
            a >= 224 // multicast and reserved
        );
    }
    if (isIP(ip) === 6) {
        const groups = ipv6Groups(ip);
        if (!groups) return true; // unparseable: refuse
        // IPv6 forms that carry an IPv4 address are judged by that address:
        // ::a.b.c.d (compatible), ::ffff:a.b.c.d (mapped), ::ffff:0:a.b.c.d (translated),
        // 64:ff9b::a.b.c.d (NAT64).
        const embedsV4 =
            groups.slice(0, 6).every((g) => g === 0) ||
            (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) ||
            (groups.slice(0, 4).every((g) => g === 0) && groups[4] === 0xffff && groups[5] === 0) ||
            (groups[0] === 0x64 &&
                groups[1] === 0xff9b &&
                groups.slice(2, 6).every((g) => g === 0));
        if (embedsV4) {
            if (groups.slice(0, 7).every((g) => g === 0)) return true; // :: and ::1
            const [high = 0, low = 0] = groups.slice(6);
            return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
        }
        const first = groups[0]!;
        return (
            (first & 0xfe00) === 0xfc00 || // unique local
            (first & 0xffc0) === 0xfe80 || // link-local
            (first & 0xff00) === 0xff00 || // multicast
            (first === 0x64 && groups[1] === 0xff9b) // NAT64 local-use
        );
    }
    return false;
}

/** The eight 16-bit groups of an IPv6 address, or null if it doesn't parse. */
function ipv6Groups(ip: string): number[] | null {
    let text = ip.split('%')[0]!;
    const v4 = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4) {
        const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
        text =
            text.slice(0, -v4[0].length) +
            `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const [head = '', tail] = text.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const missing = 8 - left.length - right.length;
    if (tail === undefined ? left.length !== 8 : missing < 0) return null;
    const parts = [...left, ...Array(tail === undefined ? 0 : missing).fill('0'), ...right];
    const groups = parts.map((part) => (/^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : NaN));
    return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
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
 * link-local addresses, and names like "nas.local" or a bare "studio". The API can't
 * reach these unless an exact AI root was explicitly enabled by its administrator.
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

/**
 * Normalizes the API root of an OpenAI-compatible server ("https://host/v1"). Accepts a
 * pasted ".../chat/completions" URL too. The server calls it, so it must be an internet
 * address by default; an exact deployment-owned RFC1918 root may be enabled. HTTP is allowed.
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
    if (!['http:', 'https:'].includes(url.protocol))
        throw new Error('The endpoint URL must start with http:// or https://');
    const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const base = `${url.origin}${path}`;
    if (isAllowedPrivateBotRoot(base)) return base;
    if (isLocalHost(url.hostname))
        throw new Error(
            'This LAN AI endpoint must be enabled by the server administrator. Use an enabled server URL or a public tunnel URL.',
        );
    validateUrl(url.toString());
    return base;
}

/** Normalizes a server URL and checks its name doesn't point into a private network. */
export async function resolveEndpoint(input: string): Promise<string> {
    const baseUrl = normalizeEndpointBaseUrl(input);
    if (!isAllowedPrivateBotRoot(baseUrl)) await assertPublicHost(baseUrl);
    return baseUrl;
}

/** Recheck at the network boundary. The LAN exemption only covers model discovery/inference. */
export async function assertBotRequestUrl(input: string): Promise<void> {
    const url = new URL(input);
    if (url.username || url.password) throw new Error('Put the API key in its own field');
    const suffix = ['/models', '/chat/completions'].find((part) => url.pathname.endsWith(part));
    if (
        suffix &&
        !url.search &&
        !url.hash &&
        isAllowedPrivateBotRoot(`${url.origin}${url.pathname.slice(0, -suffix.length)}`)
    )
        return;
    validateUrl(input);
    await assertPublicHost(input);
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
