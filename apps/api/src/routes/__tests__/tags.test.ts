import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createNotebookFixture,
    createUserBotFixture,
    createBotTemplateFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

// Mock notification service
vi.mock('../../services/notification.service', () => ({
    sendNotification: vi.fn().mockResolvedValue(undefined),
}));

describe.runIf(mongoAvailable)('Tag Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    async function getAuthToken(userId: string, email: string) {
        const magicLink = await createMagicLinkFixture({ userId, email });
        const response = await app.handle(
            new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
        );
        const data: any = await response.json();
        return data.accessToken;
    }

    describe('GET /api/notebooks/', () => {
        it('should return user tags', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks/', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebooks).toHaveLength(1);
            expect(data.notebooks[0]._id).toBe(tag._id.toString());
            expect(data.notebooks[0].label).toBe(tag.label);
        });

        it('should not return other users tags', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            await createNotebookFixture({ createdBy: user2._id.toString() });
            const token = await getAuthToken(user1._id.toString(), user1.email);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks/', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebooks).toHaveLength(0);
        });

        it('should return shared tags', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks/', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebooks).toHaveLength(1);
        });

        it('should require authentication', async () => {
            const response = await app.handle(new Request('http://localhost/api/notebooks/'));

            expect(response.status).toBe(401);
        });
    });

    describe('GET /api/notebooks/:id', () => {
        it('should return tag by id', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebook._id).toBe(tag._id.toString());
            expect(data.notebook.label).toBe(tag.label);
        });

        it('should return 404 for non-existent tag', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks/507f1f77bcf86cd799439011', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should not return tag user does not have access to', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('POST /api/notebooks/', () => {
        it('should create a new tag', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks/', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ label: 'New Tag' }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebook.label).toBe('New Tag');
            expect(data.notebook.type).toBe('folder');
            expect(data.notebook.value).toBe('mixed');
            expect(data.notebook.sharing.sharedWith).toHaveLength(1);
            expect(data.notebook.sharing.sharedWith[0].userId).toBe(user._id.toString());
            expect(data.notebook.sharing.sharedWith[0].accessLevel).toBe('owner');
        });

        it('should create tag with value', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks/', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ label: 'Notes Tag', value: 'notes' }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebook.value).toBe('notes');
        });

        it('should require label', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notebooks/', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                }),
            );

            expect(response.status).toBe(422);
        });
    });

    describe('PUT /api/notebooks/:id', () => {
        it('should update tag label', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ label: 'Updated Label' }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebook.label).toBe('Updated Label');
        });

        it('should not allow non-owner to update tag', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'read' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ label: 'Hacked' }),
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/notebooks/:id', () => {
        it('should delete tag', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message).toBe('Notebook deleted successfully');
        });

        it('should not allow non-owner to delete tag', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('GET /api/notebooks/:id/members', () => {
        it('should return tag members', async () => {
            const user1 = await createUserFixture({ displayName: 'User 1' });
            const user2 = await createUserFixture({ displayName: 'User 2' });
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user1._id.toString(), user1.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/members`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.members).toHaveLength(2);
            expect(data.members.some((m: any) => m.userId === user1._id.toString())).toBe(true);
            expect(data.members.some((m: any) => m.userId === user2._id.toString())).toBe(true);
        });
    });

    describe('POST /api/notebooks/:id/share', () => {
        it('should share tag with user', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user1._id.toString() });
            const token = await getAuthToken(user1._id.toString(), user1.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/share`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email: user2.email, accessLevel: 'write' }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebook.sharing.sharedWith).toHaveLength(2);
            expect(
                data.notebook.sharing.sharedWith.some(
                    (u: any) => u.userId === user2._id.toString(),
                ),
            ).toBe(true);
            expect(
                data.notebook.sharing.sharedWith.find((u: any) => u.userId === user2._id.toString())
                    ?.accessLevel,
            ).toBe('write');
        });

        it('should return 404 for non-existent user', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/share`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: 'nonexistent@example.com',
                        accessLevel: 'write',
                    }),
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should not allow non-owner to share tag', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const user3 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/share`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email: user3.email, accessLevel: 'write' }),
                }),
            );

            expect(response.status).toBe(403);
        });
    });

    describe('DELETE /api/notebooks/:id/share/:userId', () => {
        it('should unshare tag from user', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user1._id.toString(), user1.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/notebooks/${tag._id.toString()}/share/${user2._id.toString()}`,
                    {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(
                data.notebook.sharing.sharedWith.some(
                    (u: any) => u.userId === user2._id.toString(),
                ),
            ).toBe(false);
        });

        it('should not allow non-owner to unshare', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const user3 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                    { userId: user3._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/notebooks/${tag._id.toString()}/share/${user3._id.toString()}`,
                    {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(403);
        });
    });

    describe('PUT /api/notebooks/:id/public', () => {
        it('should update public status', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/public`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ isPublic: true }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebook.sharing.isPublic).toBe(true);
        });

        it('should not allow non-owner to change public status', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/public`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ isPublic: true }),
                }),
            );

            expect(response.status).toBe(403);
        });
    });

    describe('GET /api/notebooks/:id/access', () => {
        it('should return owner access level', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/access`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.accessLevel).toBe('owner');
        });

        it('should return write access level for shared user', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const tag = await createNotebookFixture({
                createdBy: user1._id.toString(),
                sharedWith: [
                    { userId: user1._id.toString(), accessLevel: 'owner' },
                    { userId: user2._id.toString(), accessLevel: 'write' },
                ],
            });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/access`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.accessLevel).toBe('write');
        });
    });

    describe('GET /api/notebooks/:id/shared-bots', () => {
        it('should return shared bots', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const template = await createBotTemplateFixture({ name: 'Test Bot' });
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            // First share the bot to the tag (we need to do this via repo since route requires it)
            const { shareBotToNotebook } = await import('../../repositories/notebook.repo');
            await shareBotToNotebook(
                tag._id.toString(),
                user._id.toString(),
                userBot._id.toString(),
            );

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/shared-bots`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.bots).toHaveLength(1);
            expect(data.bots[0]._id).toBe(userBot._id.toString());
        });

        it('should return empty array when no bots shared', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/shared-bots`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.bots).toHaveLength(0);
        });
    });

    describe('POST /api/notebooks/:id/bots', () => {
        it('should share bot to tag', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notebooks/${tag._id.toString()}/bots`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ userBotId: userBot._id.toString() }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notebook.sharing.sharedBots).toBeDefined();
            expect(
                data.notebook.sharing.sharedBots.some(
                    (b: any) => b.userBotId === userBot._id.toString(),
                ),
            ).toBe(true);
        });
    });

    describe('DELETE /api/notebooks/:id/bots/:userBotId', () => {
        it('should remove bot from tag', async () => {
            const user = await createUserFixture();
            const tag = await createNotebookFixture({ createdBy: user._id.toString() });
            const template = await createBotTemplateFixture();
            const userBot = await createUserBotFixture({
                userId: user._id.toString(),
                templateId: template._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            // First share the bot
            const { shareBotToNotebook } = await import('../../repositories/notebook.repo');
            await shareBotToNotebook(
                tag._id.toString(),
                user._id.toString(),
                userBot._id.toString(),
            );

            const response = await app.handle(
                new Request(
                    `http://localhost/api/notebooks/${tag._id.toString()}/bots/${userBot._id.toString()}`,
                    {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(
                data.notebook.sharing.sharedBots?.some(
                    (b: any) => b.userBotId === userBot._id.toString(),
                ) ?? false,
            ).toBe(false);
        });
    });
});
