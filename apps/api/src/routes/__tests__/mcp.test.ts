import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createUserFixture,
    createMagicLinkFixture,
    createNotebookFixture,
    createPageFixture,
    createMemoFixture,
    createWhiteboardFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

// Helper to get JWT token for a user
async function getTokenForUser(
    app: ReturnType<typeof createTestApp>,
    userId: string,
    email: string,
): Promise<string> {
    const magicLink = await createMagicLinkFixture({
        userId,
        email,
    });

    const response = await app.handle(
        new Request(`http://localhost/api/auth/verify?token=${magicLink.token}`),
    );

    const { accessToken } = await response.json();
    return accessToken;
}

// Helper to make MCP JSON-RPC requests
async function mcpRequest(
    app: ReturnType<typeof createTestApp>,
    method: string,
    params: Record<string, unknown> = {},
    options: { token?: string; sessionId?: string } = {},
): Promise<{ status: number; body: unknown; sessionId?: string }> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };

    if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
    }

    if (options.sessionId) {
        headers['Mcp-Session-Id'] = options.sessionId;
    }

    const response = await app.handle(
        new Request('http://localhost/mcp', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method,
                params,
            }),
        }),
    );

    const sessionId = response.headers.get('Mcp-Session-Id') ?? undefined;
    let body: unknown;

    try {
        body = await response.json();
    } catch {
        body = null;
    }

    return { status: response.status, body, sessionId };
}

describe.runIf(mongoAvailable)('MCP Routes', () => {
    let app: ReturnType<typeof createTestApp>;

    beforeEach(() => {
        app = createTestApp();
    });

    describe('Authentication', () => {
        it('should return 401 without auth token', async () => {
            const response = await app.handle(
                new Request('http://localhost/mcp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'initialize',
                        params: {},
                    }),
                }),
            );

            expect(response.status).toBe(401);
            const wwwAuth = response.headers.get('WWW-Authenticate');
            expect(wwwAuth).toContain('Bearer');
        });

        it('should return 401 with invalid token', async () => {
            const response = await app.handle(
                new Request('http://localhost/mcp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer invalid-token',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'initialize',
                        params: {},
                    }),
                }),
            );

            expect(response.status).toBe(401);
        });

        it('should authenticate with valid JWT', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const result = await mcpRequest(app, 'initialize', {}, { token });

            expect(result.status).toBe(200);
            expect(result.sessionId).toBeDefined();
        });
    });

    describe('MCP Protocol', () => {
        it('should respond to initialize', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const result = await mcpRequest(app, 'initialize', {}, { token });

            expect(result.status).toBe(200);
            const body = result.body as { result: unknown };
            expect(body.result).toMatchObject({
                protocolVersion: '2025-03-26',
                capabilities: {
                    tools: {},
                    resources: {},
                },
                serverInfo: {
                    name: 'maple-mcp',
                    version: '0.2.0',
                },
            });
        });

        it('should list tools', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            // Initialize first to get session
            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            // List tools
            const result = await mcpRequest(app, 'tools/list', {}, { sessionId });

            expect(result.status).toBe(200);
            const body = result.body as { result: { tools: Array<{ name: string }> } };
            const toolNames = body.result.tools.map((t) => t.name);
            expect(toolNames).toContain('list_notebooks');
            expect(toolNames).toContain('get_notebook');
            expect(toolNames).toContain('list_pages');
            expect(toolNames).toContain('get_page');
            expect(toolNames).toContain('search_pages');
            expect(toolNames).toContain('create_page');
            expect(toolNames).toContain('update_page');
            expect(toolNames).toContain('get_memo_content');
            expect(toolNames).toContain('update_memo_content');
            expect(toolNames).toContain('get_whiteboard');
            expect(toolNames).toContain('update_whiteboard');
        });

        it('should return error for unknown method', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(app, 'unknown/method', {}, { sessionId });

            expect(result.status).toBe(200);
            const body = result.body as { error: { code: number; message: string } };
            expect(body.error).toBeDefined();
            expect(body.error.code).toBe(-32601);
        });

        it('should respond to ping', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(app, 'ping', {}, { sessionId });

            expect(result.status).toBe(200);
            const body = result.body as { result: unknown };
            expect(body.result).toEqual({});
        });
    });

    describe('Session Management', () => {
        it('should create session on initialize', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const result = await mcpRequest(app, 'initialize', {}, { token });

            expect(result.sessionId).toBeDefined();
            expect(typeof result.sessionId).toBe('string');
        });

        it('should use existing session when session ID provided', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            // Use session without token (session should work)
            const result = await mcpRequest(app, 'tools/list', {}, { sessionId });

            expect(result.status).toBe(200);
        });

        it('should return 404 for invalid session ID', async () => {
            const response = await app.handle(
                new Request('http://localhost/mcp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Mcp-Session-Id': 'invalid-session-id',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'tools/list',
                        params: {},
                    }),
                }),
            );

            expect(response.status).toBe(404);
        });

        it('should delete session', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            // Delete session using the session ID
            // Note: Elysia derive runs for all routes, auth may still be checked
            // Need to provide token for derived auth context
            const deleteResponse = await app.handle(
                new Request('http://localhost/mcp', {
                    method: 'DELETE',
                    headers: {
                        'mcp-session-id': sessionId!,
                        Authorization: `Bearer ${token}`,
                    },
                }),
            );

            expect(deleteResponse.status).toBe(204);

            // Session should no longer work
            const result = await mcpRequest(app, 'tools/list', {}, { sessionId });
            expect(result.status).toBe(404);
        });
    });

    describe('Tools: Notebooks', () => {
        it('should list notebooks for user', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            // Create a notebook for the user
            const notebook = await createNotebookFixture({
                label: 'Test Notebook',
                createdBy: user._id.toString(),
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'list_notebooks', arguments: {} },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const notebooks = JSON.parse(body.result.content[0].text);
            expect(notebooks).toHaveLength(1);
            expect(notebooks[0].label).toBe('Test Notebook');
        });

        it('should get notebook by ID', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const notebook = await createNotebookFixture({
                label: 'My Notebook',
                createdBy: user._id.toString(),
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'get_notebook', arguments: { notebookId: notebook._id.toString() } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const notebookData = JSON.parse(body.result.content[0].text);
            expect(notebookData.label).toBe('My Notebook');
        });

        it('should return error for notebook not found', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'get_notebook', arguments: { notebookId: '507f1f77bcf86cd799439011' } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as {
                result: { content: Array<{ text: string }>; isError?: boolean };
            };
            expect(body.result.isError).toBe(true);
            expect(body.result.content[0].text).toContain('not found');
        });
    });

    describe('Tools: Pages', () => {
        it('should list pages for user', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Test Page',
                type: 'memo',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'list_pages', arguments: {} },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const pages = JSON.parse(body.result.content[0].text);
            expect(pages.length).toBeGreaterThanOrEqual(1);
            expect(pages.some((p: { title: string }) => p.title === 'Test Page')).toBe(true);
        });

        it('should filter pages by notebook', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const notebook = await createNotebookFixture({
                createdBy: user._id.toString(),
            });

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Page In Notebook',
                type: 'memo',
                notebookId: notebook._id.toString(),
            });

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Page Without Notebook',
                type: 'memo',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'list_pages', arguments: { notebookId: notebook._id.toString() } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const pages = JSON.parse(body.result.content[0].text);
            expect(pages.every((p: { title: string }) => p.title === 'Page In Notebook')).toBe(
                true,
            );
        });

        it('should filter pages by type', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Memo Page',
                type: 'memo',
            });

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Whiteboard Page',
                type: 'whiteboard',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'list_pages', arguments: { type: 'whiteboard' } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const pages = JSON.parse(body.result.content[0].text);
            expect(pages.every((p: { type: string }) => p.type === 'whiteboard')).toBe(true);
        });

        it('should get page by ID', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'My Page',
                type: 'memo',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'get_page', arguments: { pageId: page.id } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const pageData = JSON.parse(body.result.content[0].text);
            expect(pageData.title).toBe('My Page');
        });

        it('should search pages by title', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Meeting Notes',
                type: 'memo',
            });

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Shopping List',
                type: 'memo',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'search_pages', arguments: { query: 'meeting' } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const pages = JSON.parse(body.result.content[0].text);
            expect(pages.length).toBe(1);
            expect(pages[0].title).toBe('Meeting Notes');
        });

        it('should create a new page', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'create_page', arguments: { title: 'New Page', type: 'memo' } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const page = JSON.parse(body.result.content[0].text);
            expect(page.title).toBe('New Page');
            expect(page.type).toBe('memo');
            expect(page.id).toBeDefined();
        });

        it('should update page metadata', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'Old Title',
                type: 'memo',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                {
                    name: 'update_page',
                    arguments: { pageId: page.id, title: 'New Title', isFavorite: true },
                },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const updatedPage = JSON.parse(body.result.content[0].text);
            expect(updatedPage.title).toBe('New Title');
            expect(updatedPage.isFavorite).toBe(true);
        });
    });

    describe('Tools: Memo Content', () => {
        it('should get memo content', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'My Memo',
                type: 'memo',
                content: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'Hello World' }],
                        },
                    ],
                },
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'get_memo_content', arguments: { pageId: page.id } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const memoData = JSON.parse(body.result.content[0].text);
            expect(memoData.pageId).toBe(page.id);
            expect(memoData.title).toBe('My Memo');
        });

        it('should return error for non-memo page', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'My Whiteboard',
                type: 'whiteboard',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'get_memo_content', arguments: { pageId: page.id } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as {
                result: { content: Array<{ text: string }>; isError?: boolean };
            };
            expect(body.result.isError).toBe(true);
            expect(body.result.content[0].text).toContain('not a memo');
        });

        it('should update memo content', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'My Memo',
                type: 'memo',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                {
                    name: 'update_memo_content',
                    arguments: { pageId: page.id, content: 'Updated content here' },
                },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            expect(body.result.content[0].text).toContain('successfully');
        });
    });

    describe('Tools: Whiteboard', () => {
        it('should get whiteboard state', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'My Whiteboard',
                type: 'whiteboard',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'get_whiteboard', arguments: { pageId: page.id } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            const wbData = JSON.parse(body.result.content[0].text);
            expect(wbData.pageId).toBe(page.id);
            expect(wbData.title).toBe('My Whiteboard');
        });

        it('should return error for non-whiteboard page', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'My Memo',
                type: 'memo',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                { name: 'get_whiteboard', arguments: { pageId: page.id } },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as {
                result: { content: Array<{ text: string }>; isError?: boolean };
            };
            expect(body.result.isError).toBe(true);
            expect(body.result.content[0].text).toContain('not a whiteboard');
        });

        it('should update whiteboard elements', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const page = await createPageFixture({
                userId: user._id.toString(),
                title: 'My Whiteboard',
                type: 'whiteboard',
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'tools/call',
                {
                    name: 'update_whiteboard',
                    arguments: {
                        pageId: page.id,
                        elements: [{ type: 'rectangle', id: 'rect-1', x: 100, y: 100 }],
                    },
                },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { result: { content: Array<{ text: string }> } };
            expect(body.result.content[0].text).toContain('successfully');
        });
    });

    describe('Resources', () => {
        it('should list resources (notebooks)', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            await createNotebookFixture({
                label: 'Resource Notebook',
                createdBy: user._id.toString(),
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(app, 'resources/list', {}, { sessionId });

            expect(result.status).toBe(200);
            const body = result.body as {
                result: { resources: Array<{ uri: string; name: string }> };
            };
            expect(body.result.resources.length).toBeGreaterThanOrEqual(1);
            expect(body.result.resources.some((r) => r.name === 'Resource Notebook')).toBe(true);
        });

        it('should read notebook resource', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const notebook = await createNotebookFixture({
                label: 'Resource Notebook',
                createdBy: user._id.toString(),
            });

            await createPageFixture({
                userId: user._id.toString(),
                title: 'Resource Page',
                type: 'memo',
                notebookId: notebook._id.toString(),
            });

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'resources/read',
                { uri: `maple://notebook/${notebook._id.toString()}` },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as {
                result: { contents: Array<{ uri: string; text: string }> };
            };
            const content = JSON.parse(body.result.contents[0].text);
            expect(content.notebook.label).toBe('Resource Notebook');
            expect(content.pages.some((p: { title: string }) => p.title === 'Resource Page')).toBe(
                true,
            );
        });

        it('should return error for unknown resource URI', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const initResult = await mcpRequest(app, 'initialize', {}, { token });
            const sessionId = initResult.sessionId;

            const result = await mcpRequest(
                app,
                'resources/read',
                { uri: 'maple://unknown/resource' },
                { sessionId },
            );

            expect(result.status).toBe(200);
            const body = result.body as { error: { code: number; message: string } };
            expect(body.error).toBeDefined();
            expect(body.error.message).toContain('Unknown resource');
        });
    });

    describe('OAuth Protected Resource Metadata', () => {
        it('should return metadata at well-known endpoint', async () => {
            const response = await app.handle(
                new Request('http://localhost/mcp/.well-known/oauth-protected-resource'),
            );

            expect(response.status).toBe(200);
            const body = await response.json();
            expect(body.resource).toContain('/mcp');
            expect(body.bearer_methods_supported).toContain('header');
        });
    });

    describe('SSE Transport (GET)', () => {
        it('should return 401 without auth (before SSE check)', async () => {
            const response = await app.handle(
                new Request('http://localhost/mcp', {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                    },
                }),
            );

            // Auth is checked first, so we get 401 before the SSE check
            expect(response.status).toBe(401);
        });

        it('should return 405 without SSE accept header when authenticated', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/mcp', {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                }),
            );

            expect(response.status).toBe(405);
        });

        it('should return SSE stream with proper accept header', async () => {
            const user = await createUserFixture();
            const token = await getTokenForUser(app, user._id.toString(), user.email);

            const response = await app.handle(
                new Request('http://localhost/mcp', {
                    method: 'GET',
                    headers: {
                        Accept: 'text/event-stream',
                        Authorization: `Bearer ${token}`,
                    },
                }),
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('Content-Type')).toBe('text/event-stream');
            expect(response.headers.get('Mcp-Session-Id')).toBeDefined();
        });
    });
});
