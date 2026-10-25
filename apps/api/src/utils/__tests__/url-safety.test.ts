import { describe, expect, it } from 'vitest';
import {
    isLocalEndpoint,
    isPrivateAddress,
    normalizeEndpointBaseUrl,
    validateUrl,
} from '../url-safety';

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
        expect(() => normalizeEndpointBaseUrl('http://openrouter.ai/api/v1')).toThrow('https');
        // Local servers like Ollama may use http; they're reached through the owner's Mac.
        expect(normalizeEndpointBaseUrl('http://localhost:11434/v1/')).toBe(
            'http://localhost:11434/v1',
        );
        expect(normalizeEndpointBaseUrl('http://192.168.1.20:1234/v1')).toBe(
            'http://192.168.1.20:1234/v1',
        );
        expect(normalizeEndpointBaseUrl('http://studio.local:11434/v1')).toBe(
            'http://studio.local:11434/v1',
        );
        expect(() => normalizeEndpointBaseUrl('ftp://localhost/v1')).toThrow();
        expect(() => normalizeEndpointBaseUrl('https://user:pw@host.com/v1')).toThrow();
        expect(() => normalizeEndpointBaseUrl('https://host.com/v1?key=1')).toThrow();
        expect(() => normalizeEndpointBaseUrl('not a url')).toThrow();
    });

    it('tells local servers from internet ones', () => {
        for (const url of [
            'http://localhost:11434/v1',
            'http://127.0.0.1:11434/v1',
            'http://[::1]:11434/v1',
            'http://10.0.0.5/v1',
            'http://nas.local/v1',
            'http://studio:1234/v1',
        ])
            expect(isLocalEndpoint(url)).toBe(true);
        for (const url of ['https://openrouter.ai/api/v1', 'https://8.8.8.8/v1'])
            expect(isLocalEndpoint(url)).toBe(false);
    });
});
