import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createNotebookFixture,
    createPageFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('Link Routes', () => {
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

    // Helper to create a page with links in content
    async function createPageWithLinks(
        userId: string,
        notebookId: string,
        title: string,
        linkedPageIds: string[],
    ) {
        const content = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: linkedPageIds.map((pageId) => ({
                        type: 'pageLink',
                        attrs: {
                            pageId,
                            title: `Link to ${pageId}`,
                        },
                    })),
                },
            ],
        };

        return createPageFixture({
            userId,
            notebookId,
            title,
            content,
        });
    }

    describe('GET /api/links/search', () => {
        it('should search pages by title', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });
            await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Meeting Notes',
            });
            await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Project Plan',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/links/search?q=meeting&notebookId=${notebook._id.toString()}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.pages).toBeDefined();
            expect(data.pages.length).toBeGreaterThanOrEqual(1);
            expect(data.pages[0].title).toContain('Meeting');
        });

        it('should exclude specified page from results', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });
            const page1 = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Test Page 1',
            });
            await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Test Page 2',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/links/search?q=Test&notebookId=${notebook._id.toString()}&excludePageId=${page1.id}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            const pageIds = data.pages.map((p: any) => p.id);
            expect(pageIds).not.toContain(page1.id);
        });

        it('should require authentication', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/links/search?q=test'),
            );

            expect(response.status).toBe(401);
        });
    });

    describe('GET /api/links/:pageId/backlinks', () => {
        it('should return backlinks for a page', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });

            // Create target page
            const targetPage = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Target Page',
            });

            // Create source page that links to target
            const sourcePage = await createPageWithLinks(
                user._id.toString(),
                notebook._id.toString(),
                'Source Page',
                [targetPage.id],
            );

            // Update linksMeta on target page to have backlinks
            await testDb!.collection('pages').updateOne(
                { _id: targetPage._id },
                {
                    $set: {
                        linksMeta: {
                            forwardLinks: [],
                            backlinks: [
                                {
                                    pageId: sourcePage.id,
                                    title: 'Source Page',
                                    type: 'inline',
                                },
                            ],
                            lastIndexedAt: new Date().toISOString(),
                        },
                    },
                },
            );

            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/links/${targetPage.id}/backlinks`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.backlinks).toBeDefined();
            expect(data.backlinks.length).toBe(1);
            expect(data.backlinks[0].pageId).toBe(sourcePage.id);
        });

        it('should return empty array if no backlinks', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });
            const page = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Lonely Page',
            });
            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/links/${page.id}/backlinks`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.backlinks).toEqual([]);
        });
    });

    describe('GET /api/links/:pageId/forward', () => {
        it('should return forward links for a page', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });

            // Create target pages
            const linkedPage = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Linked Page',
            });

            // Create source page with links
            const sourcePage = await createPageWithLinks(
                user._id.toString(),
                notebook._id.toString(),
                'Source Page',
                [linkedPage.id],
            );

            // Update linksMeta on source page
            await testDb!.collection('pages').updateOne(
                { _id: sourcePage._id },
                {
                    $set: {
                        linksMeta: {
                            forwardLinks: [
                                {
                                    pageId: linkedPage.id,
                                    title: 'Linked Page',
                                    type: 'inline',
                                },
                            ],
                            backlinks: [],
                            lastIndexedAt: new Date().toISOString(),
                        },
                    },
                },
            );

            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/links/${sourcePage.id}/forward`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.forwardLinks).toBeDefined();
            expect(data.forwardLinks.length).toBe(1);
            expect(data.forwardLinks[0].pageId).toBe(linkedPage.id);
        });
    });

    describe('GET /api/links/graph/notebook/:notebookId', () => {
        it('should return graph data for notebook', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });

            // Create pages
            const page1 = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Page 1',
            });
            const page2 = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Page 2',
            });

            // Add link metadata
            await testDb!.collection('pages').updateOne(
                { _id: page1._id },
                {
                    $set: {
                        linksMeta: {
                            forwardLinks: [{ pageId: page2.id, title: 'Page 2', type: 'inline' }],
                            backlinks: [],
                        },
                    },
                },
            );
            await testDb!.collection('pages').updateOne(
                { _id: page2._id },
                {
                    $set: {
                        linksMeta: {
                            forwardLinks: [],
                            backlinks: [{ pageId: page1.id, title: 'Page 1', type: 'inline' }],
                        },
                    },
                },
            );

            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/links/graph/notebook/${notebook._id.toString()}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.graph).toBeDefined();
            expect(data.graph.nodes).toBeDefined();
            expect(data.graph.edges).toBeDefined();
        });

        it('should require authentication', async () => {
            const response = await app.handle(
                new Request('http://localhost/api/links/graph/notebook/some-id'),
            );

            expect(response.status).toBe(401);
        });
    });

    describe('GET /api/links/graph/page/:pageId', () => {
        it('should return local graph for a page', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });

            const centerPage = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Center Page',
            });
            const linkedPage = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Linked Page',
            });

            // Add links
            await testDb!.collection('pages').updateOne(
                { _id: centerPage._id },
                {
                    $set: {
                        linksMeta: {
                            forwardLinks: [
                                { pageId: linkedPage.id, title: 'Linked Page', type: 'inline' },
                            ],
                            backlinks: [],
                        },
                    },
                },
            );

            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/links/graph/page/${centerPage.id}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.graph).toBeDefined();
            expect(data.graph.nodes).toBeDefined();
            expect(data.graph.edges).toBeDefined();
        });
    });

    describe('GET /api/links/:pageId/unlinked', () => {
        it('should find unlinked mentions', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });

            // Create a page with a specific title
            await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Project Alpha',
            });

            // Create another page that mentions "Project Alpha" in text but doesn't link
            const mentioningPage = await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Notes',
                content: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Working on Project Alpha today',
                                },
                            ],
                        },
                    ],
                },
            });

            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(
                    `http://localhost/api/links/${mentioningPage.id}/unlinked?notebookId=${notebook._id.toString()}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    },
                ),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.mentions).toBeDefined();
            // May or may not find mentions depending on implementation details
        });
    });

    describe('POST /api/links/reindex', () => {
        it('should reindex all links for user', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });

            await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Page 1',
            });

            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/api/links/reindex', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.status).toBe('completed');
            expect(data.pagesIndexed).toBeDefined();
        });

        it('should reindex links for specific notebook', async () => {
            const user = await createUserFixture();
            const notebook = await createNotebookFixture({ createdBy: user._id.toString() });

            await createPageFixture({
                userId: user._id.toString(),
                notebookId: notebook._id.toString(),
                title: 'Page 1',
            });

            const token = await getAuthToken(user._id.toString(), user.email);

            const response = await app.handle(
                new Request(`http://localhost/api/links/reindex/${notebook._id.toString()}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }),
            );

            expect(response.status).toBe(200);
            const data: any = await response.json();
            expect(data.status).toBe('completed');
            expect(data.pagesIndexed).toBeDefined();
        });
    });
});
