import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createTagFixture,
    createNoteFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('Note Routes', () => {
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

    describe('GET /api/notes/', () => {
        it('should return user notes', async () => {
            const user = await createUserFixture();
            const note1 = await createNoteFixture({
                userId: user._id.toString(),
                title: 'Note 1',
            });
            const note2 = await createNoteFixture({
                userId: user._id.toString(),
                title: 'Note 2',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notes).toHaveLength(2);
            expect(data.notes.some((n: any) => n._id === note1._id.toString())).toBe(true);
            expect(data.notes.some((n: any) => n._id === note2._id.toString())).toBe(true);
        });

        it('should not return other users notes', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            await createNoteFixture({ userId: user2._id.toString() });
            const token = await getAuthToken(user1._id.toString(), user1.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notes).toHaveLength(0);
        });

        it('should filter by tagId', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const note1 = await createNoteFixture({
                userId: user._id.toString(),
                tagId: tag._id.toString(),
            });
            await createNoteFixture({ userId: user._id.toString() }); // No tag
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/?tagId=${tag._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notes).toHaveLength(1);
            expect(data.notes[0]._id).toBe(note1._id.toString());
        });

        it('should filter favorites', async () => {
            const user = await createUserFixture();
            const favorite = await createNoteFixture({
                userId: user._id.toString(),
                isFavorite: true,
            });
            await createNoteFixture({ userId: user._id.toString(), isFavorite: false });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/?favorites=true', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notes).toHaveLength(1);
            expect(data.notes[0]._id).toBe(favorite._id.toString());
        });

        it('should filter trashed notes', async () => {
            const user = await createUserFixture();
            const trashed = await createNoteFixture({
                userId: user._id.toString(),
                isTrashed: true,
                trashedAt: new Date(),
            });
            await createNoteFixture({ userId: user._id.toString(), isTrashed: false });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/?trash=true', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notes).toHaveLength(1);
            expect(data.notes[0]._id).toBe(trashed._id.toString());
        });

        it('should filter archived notes', async () => {
            const user = await createUserFixture();
            const archived = await createNoteFixture({
                userId: user._id.toString(),
                isArchived: true,
            });
            await createNoteFixture({ userId: user._id.toString(), isArchived: false });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/?archived=true', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.notes).toHaveLength(1);
            expect(data.notes[0]._id).toBe(archived._id.toString());
        });

        it('should require authentication', async () => {
            const response = await app.handle(new Request('http://localhost/api/notes/'));

            expect(response.status).toBe(401);
        });
    });

    describe('GET /api/notes/:id', () => {
        it('should return note by id', async () => {
            const user = await createUserFixture();
            const note = await createNoteFixture({
                userId: user._id.toString(),
                title: 'Test Note',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note._id).toBe(note._id.toString());
            expect(data.note.title).toBe('Test Note');
        });

        it('should return 404 for non-existent note', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/507f1f77bcf86cd799439011', {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should not return other users note', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const note = await createNoteFixture({ userId: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('POST /api/notes/', () => {
        it('should create a new note', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title: 'New Note',
                        type: 'write',
                        content: { type: 'doc', content: [] },
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.title).toBe('New Note');
            expect(data.note.type).toBe('write');
            expect(data.note.userId).toBe(user._id.toString());
        });

        it('should create note with tag', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title: 'Tagged Note',
                        tagId: tag._id.toString(),
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.tagId).toBe(tag._id.toString());
        });

        it('should create lego note', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title: 'Lego Note',
                        type: 'lego',
                    }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.type).toBe('lego');
        });

        it('should create note with default values', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({}),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.type).toBe('write');
            expect(data.note.isFavorite).toBe(false);
            expect(data.note.isArchived).toBe(false);
            expect(data.note.isTrashed).toBe(false);
        });
    });

    describe('PUT /api/notes/:id', () => {
        it('should update note title', async () => {
            const user = await createUserFixture();
            const note = await createNoteFixture({ userId: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ title: 'Updated Title' }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.title).toBe('Updated Title');
        });

        it('should update note content', async () => {
            const user = await createUserFixture();
            const note = await createNoteFixture({ userId: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const newContent = { type: 'doc', content: [{ type: 'text', text: 'New content' }] };

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ content: newContent }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.content).toEqual(newContent);
        });

        it('should toggle favorite', async () => {
            const user = await createUserFixture();
            const note = await createNoteFixture({
                userId: user._id.toString(),
                isFavorite: false,
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ isFavorite: true }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.isFavorite).toBe(true);
        });

        it('should move note to different tag', async () => {
            const user = await createUserFixture();
            const tag1 = await createTagFixture({ createdBy: user._id.toString() });
            const tag2 = await createTagFixture({ createdBy: user._id.toString() });
            const note = await createNoteFixture({
                userId: user._id.toString(),
                tagId: tag1._id.toString(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ tagId: tag2._id.toString() }),
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.tagId).toBe(tag2._id.toString());
        });

        it('should not allow updating other users note', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const note = await createNoteFixture({ userId: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ title: 'Hacked' }),
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('POST /api/notes/:id/trash', () => {
        it('should move note to trash', async () => {
            const user = await createUserFixture();
            const note = await createNoteFixture({
                userId: user._id.toString(),
                isTrashed: false,
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}/trash`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.isTrashed).toBe(true);
            expect(data.note.trashedAt).toBeDefined();
        });

        it('should return 404 for non-existent note', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/507f1f77bcf86cd799439011/trash', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('POST /api/notes/:id/restore', () => {
        it('should restore note from trash', async () => {
            const user = await createUserFixture();
            const note = await createNoteFixture({
                userId: user._id.toString(),
                isTrashed: true,
                trashedAt: new Date(),
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}/restore`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.note.isTrashed).toBe(false);
            expect(data.note.trashedAt).toBeUndefined();
        });

        it('should return 404 for non-existent note', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/507f1f77bcf86cd799439011/restore', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/notes/:id', () => {
        it('should permanently delete note', async () => {
            const user = await createUserFixture();
            const note = await createNoteFixture({ userId: user._id.toString() });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.message).toBe('Note deleted permanently');
        });

        it('should return 404 for non-existent note', async () => {
            const user = await createUserFixture();
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/507f1f77bcf86cd799439011', {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should not allow deleting other users note', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            const note = await createNoteFixture({ userId: user1._id.toString() });
            const token = await getAuthToken(user2._id.toString(), user2.email);

            const response = await app.handle(
                new Request(`http://localhost/api/notes/${note._id.toString()}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/notes/trash/empty', () => {
        it('should empty trash', async () => {
            const user = await createUserFixture();
            await createNoteFixture({
                userId: user._id.toString(),
                isTrashed: true,
                trashedAt: new Date(),
            });
            await createNoteFixture({
                userId: user._id.toString(),
                isTrashed: true,
                trashedAt: new Date(),
            });
            await createNoteFixture({
                userId: user._id.toString(),
                isTrashed: false,
            }); // Not trashed
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/trash/empty', {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.count).toBe(2);
            expect(data.message).toContain('Deleted 2 notes');
        });

        it('should only delete current users trashed notes', async () => {
            const user1 = await createUserFixture();
            const user2 = await createUserFixture();
            await createNoteFixture({
                userId: user1._id.toString(),
                isTrashed: true,
                trashedAt: new Date(),
            });
            await createNoteFixture({
                userId: user2._id.toString(),
                isTrashed: true,
                trashedAt: new Date(),
            });
            const token = await getAuthToken(user1._id.toString(), user1.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/trash/empty', {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.count).toBe(1);
        });

        it('should return 0 when no trashed notes', async () => {
            const user = await createUserFixture();
            await createNoteFixture({ userId: user._id.toString(), isTrashed: false });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/notes/trash/empty', {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.count).toBe(0);
        });
    });
});
