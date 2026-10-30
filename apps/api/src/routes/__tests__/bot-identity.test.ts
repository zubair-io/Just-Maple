import { Elysia } from 'elysia';
import { describe, it, expect } from 'vitest';
import { botRoutes } from '../bots';
import { customBotRoutes } from '../custom-bots';
import {
    createUserFixture,
    createAuthToken,
    createUserBotFixture,
    createBotTemplateFixture,
} from '../../__tests__/helpers/fixtures';
import {
    createCustomBot,
    findUserBotByHandle,
    findUserBotByIdInternal,
} from '../../repositories/user-bot.repo';

for (const custom of [false, true])
    describe(`${custom ? 'webhook' : 'AI'} bot identity edits`, () => {
        const app = () => new Elysia().use(botRoutes).use(customBotRoutes);
        const create = async (userId: string, handle: string) =>
            custom
                ? (
                      await createCustomBot(userId, {
                          name: 'Original',
                          handle,
                          invokeUrl: 'https://example.com/webhook',
                          permissions: { messages: { read: true, write: true } },
                      })
                  ).bot
                : await createUserBotFixture({
                      userId,
                      handle,
                      templateId: (await createBotTemplateFixture())._id.toString(),
                      config: { apiKey: 'keep-secret', model: 'keep-model' },
                  }).then((doc) => ({ _id: doc._id.toString() }));
        const patch = (server: ReturnType<typeof app>, id: string, token: string, body: object) =>
            server.handle(
                new Request(`http://localhost/api/${custom ? 'custom-bots' : 'user-bots'}/${id}`, {
                    method: 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                }),
            );
        it('renames without replacing IDs, config, webhook secrets or permissions, and resolves only the new handle', async () => {
            const server = app(),
                user = await createUserFixture(),
                owner = user._id.toString();
            const token = await createAuthToken(owner),
                bot = await create(owner, 'old-handle');
            const before = await findUserBotByIdInternal(bot._id);
            const response = await patch(server, bot._id, token, {
                handle: 'New_Handle',
                ...(custom ? { name: ' New name ' } : { displayName: ' New name ' }),
            });
            expect(response.status).toBe(200);
            const after = await findUserBotByIdInternal(bot._id);
            expect(after).toEqual({
                ...before,
                handle: 'new_handle',
                displayName: 'New name',
                updatedAt: expect.any(String),
            });
            expect(await findUserBotByHandle(owner, 'old-handle')).toBeNull();
            expect((await findUserBotByHandle(owner, 'new_handle'))?._id).toBe(bot._id);
            expect((await patch(server, bot._id, token, { handle: 'new_handle' })).status).toBe(
                200,
            );
        });
        it('rejects duplicate, invalid and other-owner edits without changing identity', async () => {
            const server = app(),
                user = await createUserFixture(),
                owner = user._id.toString(),
                token = await createAuthToken(owner);
            const bot = await create(owner, 'original');
            await createUserBotFixture({ userId: owner, handle: 'taken' });
            expect((await patch(server, bot._id, token, { handle: 'TAKEN' })).status).toBe(409);
            for (const handle of ['', 'bad name', '@bad', 'x'.repeat(31)])
                expect((await patch(server, bot._id, token, { handle })).status).toBe(422);
            const stranger = await createUserFixture();
            expect(
                (
                    await patch(server, bot._id, await createAuthToken(stranger._id.toString()), {
                        handle: 'stolen',
                    })
                ).status,
            ).toBe(404);
            expect((await findUserBotByIdInternal(bot._id))?.handle).toBe('original');
            // Handle uniqueness is scoped to the owner, so another account may use the same handle.
            await createUserBotFixture({ userId: stranger._id.toString(), handle: 'elsewhere' });
            expect((await patch(server, bot._id, token, { handle: 'elsewhere' })).status).toBe(200);
        });
        it('keeps the database uniqueness guard when two renames race', async () => {
            const server = app(),
                user = await createUserFixture(),
                owner = user._id.toString(),
                token = await createAuthToken(owner);
            const a = await create(owner, 'a'),
                b = await create(owner, 'b');
            const results = await Promise.all([
                patch(server, a._id, token, { handle: 'same' }),
                patch(server, b._id, token, { handle: 'same' }),
            ]);
            expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        });
    });
