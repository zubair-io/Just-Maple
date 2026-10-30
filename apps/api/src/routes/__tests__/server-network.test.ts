import { Elysia } from 'elysia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serverInfoRoutes, serverNetworkSettingsRoutes } from '../server-network';
import { config } from '../../config';
import { createAuthToken, createUserFixture } from '../../__tests__/helpers/fixtures';
import { testDb } from '../../__tests__/setup';

const original = {
    instanceId: config.instanceId,
    publicUrl: config.publicUrl,
    localUrl: config.localUrl,
};
const app = () =>
    new Elysia()
        .use(serverInfoRoutes)
        .use(serverNetworkSettingsRoutes)
        .get('/unrelated', () => 'ok');
let admin: string;
let member: string;
const request = (path: string, token?: string, localUrl?: unknown) =>
    new Request('http://localhost' + path, {
        method: localUrl === undefined ? 'GET' : 'PUT',
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            'content-type': 'application/json',
        },
        ...(localUrl === undefined ? {} : { body: JSON.stringify({ localUrl }) }),
    });
beforeEach(async () => {
    Object.assign(config, {
        instanceId: 'phoebe-test',
        publicUrl: 'https://phoebe.example.com',
        localUrl: 'https://local.example.com',
    });
    const user = await createUserFixture();
    await testDb.collection('users').updateOne({ _id: user._id }, { $set: { admin: true } });
    admin = await createAuthToken(user._id.toString());
    member = await createAuthToken((await createUserFixture())._id.toString());
});
afterEach(() => Object.assign(config, original));

describe('server-owned local network settings', () => {
    it('advertises identity and environment default anonymously without protecting unrelated routes', async () => {
        const api = app();
        const response = await api.handle(request('/api/server-info'));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            instanceId: 'phoebe-test',
            publicUrl: 'https://phoebe.example.com',
            localUrl: 'https://local.example.com',
        });
        expect((await api.handle(request('/unrelated'))).status).toBe(200);
    });
    it('requires an administrator to read or change server network settings', async () => {
        const api = app();
        for (const value of [undefined, 'https://changed.example.com']) {
            expect(
                (await api.handle(request('/api/server/settings/network', undefined, value)))
                    .status,
            ).toBe(401);
            expect(
                (await api.handle(request('/api/server/settings/network', member, value))).status,
            ).toBe(403);
        }
        expect((await api.handle(request('/api/server/settings/network', admin))).status).toBe(200);
    });
    it('persists the administrator setting and advertises it to later clients', async () => {
        const response = await app().handle(
            request('/api/server/settings/network', admin, ' NEW-LOCAL.example.com:443/ '),
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            localUrl: 'https://new-local.example.com',
            source: 'server',
        });
        const persisted = await testDb
            .collection('server_settings')
            .findOne({ _id: 'network' } as any);
        expect(persisted?.localUrl).toBe('https://new-local.example.com');
        expect(await (await app().handle(request('/api/server-info'))).json()).toMatchObject({
            localUrl: 'https://new-local.example.com',
        });
    });
    it('allows disabling discovery even when LOCAL_URL has an environment default', async () => {
        expect(
            (await app().handle(request('/api/server/settings/network', admin, null))).status,
        ).toBe(200);
        expect(await (await app().handle(request('/api/server-info'))).json()).toMatchObject({
            localUrl: null,
        });
    });
    it('rejects unsafe origins without replacing the saved setting', async () => {
        const api = app();
        for (const value of [
            'http://local.example.com',
            'https://user:pass@local.example.com',
            'https://local.example.com/path',
            'https://local.example.com?q=x',
            'https://local.example.com#x',
            'file:///tmp',
            'bad host',
        ]) {
            expect(
                (await api.handle(request('/api/server/settings/network', admin, value))).status,
            ).toBe(400);
        }
        expect(await (await api.handle(request('/api/server-info'))).json()).toMatchObject({
            localUrl: 'https://local.example.com',
        });
    });
    it('refuses to advertise an unconfigured server identity', async () => {
        config.instanceId = '';
        expect((await app().handle(request('/api/server-info'))).status).toBe(503);
    });
});
