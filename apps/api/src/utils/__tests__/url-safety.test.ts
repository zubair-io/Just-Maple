import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isLocalHost,
    isPrivateAddress,
    normalizeEndpointBaseUrl,
    validateUrl,
    resolveEndpoint,
    assertBotRequestUrl,
} from '../url-safety';

afterEach(() => vi.unstubAllEnvs());

describe('url safety', () => {
    it('recognizes private and loopback addresses, in any spelling', () => {
        for (const ip of ['127.0.0.2', '10.0.0.1', '172.20.1.1', '192.168.0.9', '169.254.169.254'])
            expect(isPrivateAddress(ip)).toBe(true);
        for (const ip of [
            '::1',
            '[::1]',
            'fd00::1',
            'fe80::1',
            '::ffff:127.0.0.1',
            '::ffff:7f00:1',
        ])
            expect(isPrivateAddress(ip)).toBe(true);
        expect(isPrivateAddress('93.184.216.34')).toBe(false);
        expect(isPrivateAddress('2606:4700::1111')).toBe(false);
    });

    it('blocks local hosts, including numeric and IPv6 forms', () => {
        for (const url of [
            'http://localhost/x',
            'http://2130706433/',
            'http://0x7f.1/',
            'http://[::ffff:127.0.0.1]/',
            'http://box.internal/',
            'ftp://example.com/',
        ])
            expect(() => validateUrl(url)).toThrow();
        expect(() => validateUrl('https://api.example.com/v1')).not.toThrow();
    });

    it('normalizes a server URL and refuses unsafe ones', () => {
        expect(normalizeEndpointBaseUrl(' https://openrouter.ai/api/v1/ ')).toBe(
            'https://openrouter.ai/api/v1',
        );
        expect(normalizeEndpointBaseUrl('https://api.groq.com/openai/v1/chat/completions')).toBe(
            'https://api.groq.com/openai/v1',
        );
        // The server calls custom AI servers itself: http is allowed for internet hosts…
        expect(normalizeEndpointBaseUrl('http://openrouter.ai/api/v1')).toBe(
            'http://openrouter.ai/api/v1',
        );
        // …but it can't reach the user's own machine or network.
        for (const local of [
            'http://localhost:11434/v1',
            'http://192.168.1.20:1234/v1',
            'http://studio.local:11434/v1',
            'http://studio:1234/v1',
        ])
            expect(() => normalizeEndpointBaseUrl(local)).toThrow('tunnel');
        expect(() => normalizeEndpointBaseUrl('ftp://example.com/v1')).toThrow();
        expect(() => normalizeEndpointBaseUrl('https://user:pw@host.com/v1')).toThrow();
        expect(() => normalizeEndpointBaseUrl('https://host.com/v1?key=1')).toThrow();
        expect(() => normalizeEndpointBaseUrl('not a url')).toThrow();
    });

    it('tells local hosts from internet ones', () => {
        for (const host of ['localhost', '127.0.0.1', '[::1]', '10.0.0.5', 'nas.local', 'studio'])
            expect(isLocalHost(host)).toBe(true);
        for (const host of ['openrouter.ai', '8.8.8.8']) expect(isLocalHost(host)).toBe(false);
    });

    it('allows only the administrator-configured LAN AI root and inference/discovery paths', async () => {
        vi.stubEnv('BOT_ALLOWED_PRIVATE_ENDPOINTS', 'http://10.0.0.9:8080/v1');
        expect(await resolveEndpoint('http://10.0.0.9:8080/v1/chat/completions')).toBe(
            'http://10.0.0.9:8080/v1',
        );
        await expect(
            assertBotRequestUrl('http://10.0.0.9:8080/v1/models'),
        ).resolves.toBeUndefined();
        await expect(
            assertBotRequestUrl('http://10.0.0.9:8080/v1/chat/completions'),
        ).resolves.toBeUndefined();
        for (const url of [
            'http://10.0.0.8:8080/v1/models',
            'http://10.0.0.9:8081/v1/models',
            'http://10.0.0.9:8080/admin',
            'http://10.0.0.9:8080/v1/models?redirect=1',
            'http://10.0.0.9:8080/v1-extra/models',
        ]) {
            await expect(assertBotRequestUrl(url)).rejects.toThrow();
        }
        expect(() => validateUrl('http://10.0.0.9:8080/v1')).toThrow('private');
    });

    it('does not exempt metadata/loopback or retain permission after the allowlist is removed', async () => {
        vi.stubEnv(
            'BOT_ALLOWED_PRIVATE_ENDPOINTS',
            'http://169.254.169.254/v1,http://127.0.0.1/v1,http://10.0.0.9:8080/v1',
        );
        await expect(resolveEndpoint('http://169.254.169.254/v1')).rejects.toThrow();
        await expect(resolveEndpoint('http://127.0.0.1/v1')).rejects.toThrow();
        await resolveEndpoint('http://10.0.0.9:8080/v1');
        vi.stubEnv('BOT_ALLOWED_PRIVATE_ENDPOINTS', '');
        await expect(
            assertBotRequestUrl('http://10.0.0.9:8080/v1/chat/completions'),
        ).rejects.toThrow();
    });
});
