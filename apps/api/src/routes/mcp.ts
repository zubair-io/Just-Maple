import { Elysia } from 'elysia';
import { randomUUID } from 'crypto';
import * as Y from 'yjs';
import { jwtPlugin, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findNotebooksByUserId, findNotebookById } from '../repositories/notebook.repo';
import { findPagesByUserId, findPageById, createPage, updatePage } from '../repositories/page.repo';
import { findMemoById, upsertMemo } from '../repositories/memo.repo';
import {
    findWhiteboard,
    updateWhiteboardState as updateWhiteboardInDb,
    createWhiteboard,
} from '../repositories/whiteboard.repo';
import { config } from '../config';
import type { JWTPayload } from '@maple/shared';

// =====================
// Session Management
// =====================

interface Session {
    id: string;
    userId: string;
    createdAt: Date;
    lastActivity: Date;
    initialized: boolean;
}

const sessions = new Map<string, Session>();

function createSession(userId: string): Session {
    const session: Session = {
        id: randomUUID(),
        userId,
        createdAt: new Date(),
        lastActivity: new Date(),
        initialized: false,
    };
    sessions.set(session.id, session);
    return session;
}

function getSession(sessionId: string): Session | undefined {
    const session = sessions.get(sessionId);
    if (session) {
        session.lastActivity = new Date();
    }
    return session;
}

function deleteSession(sessionId: string): boolean {
    return sessions.delete(sessionId);
}

// Clean up old sessions every 30 minutes
setInterval(
    () => {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        for (const [id, session] of sessions) {
            if (now - session.lastActivity.getTime() > maxAge) {
                sessions.delete(id);
            }
        }
    },
    30 * 60 * 1000,
);

// =====================
// MCP Protocol Types
// =====================

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// =====================
// Y.js Helpers
// =====================

function extractTextFromYDoc(state: Uint8Array): string {
    try {
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, state);

        const xmlFragment = ydoc.getXmlFragment('prosemirror');
        if (xmlFragment.length > 0) {
            return xmlFragmentToText(xmlFragment);
        }

        const text = ydoc.getText('content');
        if (text.length > 0) {
            return text.toString();
        }

        return '';
    } catch {
        return '';
    }
}

function xmlFragmentToText(fragment: Y.XmlFragment): string {
    const parts: string[] = [];

    for (const item of fragment.toArray()) {
        if (item instanceof Y.XmlText) {
            parts.push(item.toString());
        } else if (item instanceof Y.XmlElement) {
            const tagName = item.nodeName.toLowerCase();
            const childText = xmlElementToText(item);

            if (tagName === 'paragraph' || tagName === 'heading') {
                parts.push(childText + '\n');
            } else {
                parts.push(childText);
            }
        }
    }

    return parts.join('').trim();
}

function xmlElementToText(element: Y.XmlElement): string {
    const parts: string[] = [];

    for (const item of element.toArray()) {
        if (item instanceof Y.XmlText) {
            parts.push(item.toString());
        } else if (item instanceof Y.XmlElement) {
            parts.push(xmlElementToText(item));
        }
    }

    return parts.join('');
}

function extractTextFromContent(content: unknown): string {
    if (!content || typeof content !== 'object') return '';

    const parts: string[] = [];

    function traverse(node: unknown): void {
        if (!node || typeof node !== 'object') return;

        const n = node as Record<string, unknown>;

        if (n.type === 'text' && typeof n.text === 'string') {
            parts.push(n.text);
        }

        if (Array.isArray(n.content)) {
            for (const child of n.content) {
                traverse(child);
            }
        }

        if (n.type === 'paragraph' || n.type === 'heading') {
            parts.push('\n');
        }
    }

    traverse(content);
    return parts.join('').trim();
}

function extractWhiteboardElements(
    state: Uint8Array,
): Array<{ type: string; id: string; [key: string]: unknown }> {
    try {
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, state);

        const elements: Array<{ type: string; id: string; [key: string]: unknown }> = [];

        const elementsMap = ydoc.getMap('elements');
        elementsMap.forEach((value, key) => {
            if (value && typeof value === 'object') {
                elements.push({ id: key, ...(value as object) } as {
                    type: string;
                    id: string;
                    [key: string]: unknown;
                });
            }
        });

        return elements;
    } catch {
        return [];
    }
}

// =====================
// MCP Tools Definition
// =====================

const mcpTools = [
    {
        name: 'list_notebooks',
        description: 'List all notebooks the user has access to',
        inputSchema: {
            type: 'object' as const,
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_notebook',
        description: 'Get details of a specific notebook by ID',
        inputSchema: {
            type: 'object' as const,
            properties: {
                notebookId: { type: 'string', description: 'The notebook ID' },
            },
            required: ['notebookId'],
        },
    },
    {
        name: 'list_pages',
        description: 'List pages, optionally filtered by notebook or type',
        inputSchema: {
            type: 'object' as const,
            properties: {
                notebookId: { type: 'string', description: 'Filter by notebook ID (optional)' },
                type: {
                    type: 'string',
                    enum: ['memo', 'whiteboard'],
                    description: 'Filter by page type (optional)',
                },
                includeTrashed: {
                    type: 'boolean',
                    description: 'Include trashed pages (default: false)',
                },
            },
            required: [],
        },
    },
    {
        name: 'get_page',
        description: 'Get details of a specific page by ID',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'The page ID (UUID)' },
            },
            required: ['pageId'],
        },
    },
    {
        name: 'search_pages',
        description: 'Search pages by title or content',
        inputSchema: {
            type: 'object' as const,
            properties: {
                query: { type: 'string', description: 'Search query string' },
                notebookId: {
                    type: 'string',
                    description: 'Limit search to a specific notebook (optional)',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'create_page',
        description: 'Create a new page (memo or whiteboard)',
        inputSchema: {
            type: 'object' as const,
            properties: {
                title: { type: 'string', description: 'Page title' },
                type: {
                    type: 'string',
                    enum: ['memo', 'whiteboard'],
                    description: 'Page type (default: memo)',
                },
                notebookId: {
                    type: 'string',
                    description: 'Notebook to create the page in (optional)',
                },
            },
            required: [],
        },
    },
    {
        name: 'update_page',
        description: 'Update page metadata (title, notebook, favorite, archive, trash)',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'The page ID to update' },
                title: { type: 'string', description: 'New title (optional)' },
                notebookId: {
                    type: 'string',
                    description: 'Move to different notebook (optional)',
                },
                isFavorite: { type: 'boolean', description: 'Set favorite status (optional)' },
                isArchived: { type: 'boolean', description: 'Set archived status (optional)' },
                isTrashed: { type: 'boolean', description: 'Move to/from trash (optional)' },
            },
            required: ['pageId'],
        },
    },
    {
        name: 'get_memo_content',
        description: 'Get the text content of a memo page',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'The memo page ID' },
            },
            required: ['pageId'],
        },
    },
    {
        name: 'update_memo_content',
        description: 'Update the text content of a memo page',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'The memo page ID' },
                content: { type: 'string', description: 'The new text content' },
            },
            required: ['pageId', 'content'],
        },
    },
    {
        name: 'get_whiteboard',
        description: 'Get the state of a whiteboard page including its elements',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'The whiteboard page ID' },
            },
            required: ['pageId'],
        },
    },
    {
        name: 'update_whiteboard',
        description: 'Update the elements of a whiteboard page',
        inputSchema: {
            type: 'object' as const,
            properties: {
                pageId: { type: 'string', description: 'The whiteboard page ID' },
                elements: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            id: { type: 'string' },
                        },
                        required: ['type', 'id'],
                    },
                    description: 'Array of whiteboard elements',
                },
            },
            required: ['pageId', 'elements'],
        },
    },
];

// =====================
// MCP Tool Handler
// =====================

async function handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
    userId: string,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    try {
        switch (toolName) {
            case 'list_notebooks': {
                const notebooks = await findNotebooksByUserId(userId);
                return { content: [{ type: 'text', text: JSON.stringify(notebooks, null, 2) }] };
            }

            case 'get_notebook': {
                const { notebookId } = args as { notebookId: string };
                const notebook = await findNotebookById(notebookId, userId);
                if (!notebook) {
                    return {
                        content: [{ type: 'text', text: 'Notebook not found or access denied' }],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text', text: JSON.stringify(notebook, null, 2) }] };
            }

            case 'list_pages': {
                const { notebookId, type, includeTrashed } = args as {
                    notebookId?: string;
                    type?: string;
                    includeTrashed?: boolean;
                };
                const pages = await findPagesByUserId(userId, {
                    notebookId,
                    isTrashed: includeTrashed,
                });
                // Filter by type if specified
                const filtered = type ? pages.filter((p) => p.type === type) : pages;
                return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
            }

            case 'get_page': {
                const { pageId } = args as { pageId: string };
                const page = await findPageById(pageId, userId);
                if (!page) {
                    return {
                        content: [{ type: 'text', text: 'Page not found or access denied' }],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
            }

            case 'search_pages': {
                const { query, notebookId } = args as { query: string; notebookId?: string };
                const allPages = await findPagesByUserId(userId, { notebookId });
                // Simple text search in title
                const matches = allPages.filter(
                    (p) =>
                        p.title?.toLowerCase().includes(query.toLowerCase()) ||
                        extractTextFromContent(p.content)
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                );
                return { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] };
            }

            case 'create_page': {
                const { title, type, notebookId } = args as {
                    title?: string;
                    type?: 'memo' | 'whiteboard';
                    notebookId?: string;
                };
                const page = await createPage(userId, {
                    title: title || 'Untitled',
                    type: type || 'memo',
                    notebookId,
                });
                return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
            }

            case 'update_page': {
                const { pageId, title, notebookId, isFavorite, isArchived, isTrashed } = args as {
                    pageId: string;
                    title?: string;
                    notebookId?: string;
                    isFavorite?: boolean;
                    isArchived?: boolean;
                    isTrashed?: boolean;
                };
                const page = await updatePage(pageId, userId, {
                    title,
                    notebookId,
                    isFavorite,
                    isArchived,
                    isTrashed,
                });
                if (!page) {
                    return {
                        content: [{ type: 'text', text: 'Page not found or access denied' }],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
            }

            case 'get_memo_content': {
                const { pageId } = args as { pageId: string };
                const page = await findPageById(pageId, userId);
                if (!page) {
                    return {
                        content: [{ type: 'text', text: 'Page not found or access denied' }],
                        isError: true,
                    };
                }
                if (page.type !== 'memo') {
                    return {
                        content: [{ type: 'text', text: 'Page is not a memo' }],
                        isError: true,
                    };
                }

                const memo = await findMemoById(pageId);
                let text = '';
                if (memo?.state) {
                    const state = new Uint8Array(
                        memo.state.buffer instanceof ArrayBuffer
                            ? memo.state.buffer
                            : (memo.state as unknown as Buffer),
                    );
                    text = extractTextFromYDoc(state);
                }
                if (!text) {
                    text = extractTextFromContent(page.content);
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    pageId,
                                    title: page.title,
                                    text,
                                    hasYjsState: !!memo,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            }

            case 'update_memo_content': {
                const { pageId, content } = args as { pageId: string; content: string };
                const page = await findPageById(pageId, userId);
                if (!page) {
                    return {
                        content: [{ type: 'text', text: 'Page not found or access denied' }],
                        isError: true,
                    };
                }
                if (page.type !== 'memo') {
                    return {
                        content: [{ type: 'text', text: 'Page is not a memo' }],
                        isError: true,
                    };
                }

                // Create Y.Doc with content
                const ydoc = new Y.Doc();
                const xmlFragment = ydoc.getXmlFragment('prosemirror');
                const paragraph = new Y.XmlElement('paragraph');
                paragraph.insert(0, [new Y.XmlText(content)]);
                xmlFragment.insert(0, [paragraph]);

                const state = Y.encodeStateAsUpdate(ydoc);
                await upsertMemo(pageId, pageId, Buffer.from(state));

                // Also update page content for search
                await updatePage(pageId, userId, {
                    content: {
                        type: 'doc',
                        content: [
                            {
                                type: 'paragraph',
                                content: content ? [{ type: 'text', text: content }] : [],
                            },
                        ],
                    },
                } as any);

                return { content: [{ type: 'text', text: 'Memo content updated successfully' }] };
            }

            case 'get_whiteboard': {
                const { pageId } = args as { pageId: string };
                const page = await findPageById(pageId, userId);
                if (!page) {
                    return {
                        content: [{ type: 'text', text: 'Page not found or access denied' }],
                        isError: true,
                    };
                }
                if (page.type !== 'whiteboard') {
                    return {
                        content: [{ type: 'text', text: 'Page is not a whiteboard' }],
                        isError: true,
                    };
                }

                const whiteboard = await findWhiteboard(pageId);
                let elements: Array<{ type: string; id: string; [key: string]: unknown }> = [];
                if (whiteboard?.state) {
                    const state = new Uint8Array(
                        whiteboard.state.buffer instanceof ArrayBuffer
                            ? whiteboard.state.buffer
                            : (whiteboard.state as unknown as Buffer),
                    );
                    elements = extractWhiteboardElements(state);
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    pageId,
                                    title: page.title,
                                    hasState: !!whiteboard,
                                    elements,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            }

            case 'update_whiteboard': {
                const { pageId, elements } = args as {
                    pageId: string;
                    elements: Array<{ type: string; id: string; [key: string]: unknown }>;
                };
                const page = await findPageById(pageId, userId);
                if (!page) {
                    return {
                        content: [{ type: 'text', text: 'Page not found or access denied' }],
                        isError: true,
                    };
                }
                if (page.type !== 'whiteboard') {
                    return {
                        content: [{ type: 'text', text: 'Page is not a whiteboard' }],
                        isError: true,
                    };
                }

                // Create Y.Doc with elements
                const ydoc = new Y.Doc();
                const elementsMap = ydoc.getMap('elements');
                for (const element of elements) {
                    const { id, ...rest } = element;
                    elementsMap.set(id, rest);
                }

                const state = Y.encodeStateAsUpdate(ydoc);

                // Check if whiteboard exists, create or update
                const existingWhiteboard = await findWhiteboard(pageId);
                if (existingWhiteboard) {
                    await updateWhiteboardInDb(pageId, state);
                } else {
                    await createWhiteboard(pageId, state);
                }

                return { content: [{ type: 'text', text: 'Whiteboard updated successfully' }] };
            }

            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
                    isError: true,
                };
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text', text: `Error: ${message}` }],
            isError: true,
        };
    }
}

// =====================
// MCP Request Handler
// =====================

async function handleMcpRequest(
    message: JsonRpcMessage,
    session: Session,
): Promise<JsonRpcResponse | null> {
    if (!('method' in message)) {
        return null;
    }

    const request = message as JsonRpcRequest;
    const { method, params, id } = request;

    try {
        switch (method) {
            case 'initialize': {
                session.initialized = true;
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: '2025-03-26',
                        capabilities: {
                            tools: {},
                            resources: {},
                        },
                        serverInfo: {
                            name: 'maple-mcp',
                            version: '0.2.0',
                        },
                    },
                };
            }

            case 'initialized': {
                return null;
            }

            case 'tools/list': {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { tools: mcpTools },
                };
            }

            case 'tools/call': {
                const { name, arguments: args } = params as {
                    name: string;
                    arguments: Record<string, unknown>;
                };
                const result = await handleToolCall(name, args || {}, session.userId);
                return {
                    jsonrpc: '2.0',
                    id,
                    result,
                };
            }

            case 'resources/list': {
                const notebooks = await findNotebooksByUserId(session.userId);
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        resources: notebooks.map((notebook) => ({
                            uri: `maple://notebook/${notebook._id}`,
                            name: notebook.label,
                            description: `Notebook: ${notebook.label} (${notebook.value || 'mixed'})`,
                            mimeType: 'application/json',
                        })),
                    },
                };
            }

            case 'resources/read': {
                const { uri } = params as { uri: string };
                const notebookMatch = uri.match(/^maple:\/\/notebook\/(.+)$/);
                if (notebookMatch && notebookMatch[1]) {
                    const notebookId = notebookMatch[1];
                    const notebook = await findNotebookById(notebookId, session.userId);
                    const pages = await findPagesByUserId(session.userId, { notebookId });

                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            contents: [
                                {
                                    uri,
                                    mimeType: 'application/json',
                                    text: JSON.stringify({ notebook, pages }, null, 2),
                                },
                            ],
                        },
                    };
                }
                return {
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32602,
                        message: `Unknown resource: ${uri}`,
                    },
                };
            }

            case 'ping': {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {},
                };
            }

            default: {
                return {
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${method}`,
                    },
                };
            }
        }
    } catch (error) {
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code: -32603,
                message: error instanceof Error ? error.message : 'Internal error',
            },
        };
    }
}

// =====================
// MCP Routes
// =====================

export const mcpRoutes = new Elysia({ prefix: '/mcp' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }
        const token = authHeader.slice(7);
        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    // OAuth Protected Resource Metadata (RFC 9728)
    .get('/.well-known/oauth-protected-resource', ({ request }) => {
        const url = new URL(request.url);
        const baseUrl = `${url.protocol}//${url.host}`;
        return {
            resource: `${baseUrl}/mcp`,
            authorization_servers: [config.origin || 'https://justmaple.app'],
            bearer_methods_supported: ['header'],
            resource_documentation: `${baseUrl}/mcp/docs`,
        };
    })

    // MCP endpoint - POST for sending messages
    .post('/', async ({ request, headers, auth, set }) => {
        // Validate Origin header for security
        const origin = headers['origin'];
        if (origin && !origin.includes('claude.ai') && !origin.includes('localhost')) {
            console.warn(`[MCP] Request from origin: ${origin}`);
        }

        // Check for existing session
        const sessionId = headers['mcp-session-id'];
        let session: Session | undefined;

        if (sessionId) {
            session = getSession(sessionId);
            if (!session) {
                set.status = 404;
                return { error: 'Session not found' };
            }
        }

        // If no session, authenticate and create one
        if (!session) {
            if (!auth) {
                set.status = 401;
                set.headers['WWW-Authenticate'] =
                    'Bearer realm="mcp", resource_metadata="/.well-known/oauth-protected-resource"';
                return { error: 'Authentication required' };
            }
            session = createSession(auth.user._id);
        }

        // Parse message(s)
        const body = await request.json();
        const messages: JsonRpcMessage[] = Array.isArray(body) ? body : [body];

        // Check if any messages are requests (need response)
        const requests = messages.filter((m) => 'id' in m && 'method' in m);

        if (requests.length === 0) {
            set.status = 202;
            return;
        }

        // Check Accept header
        const accept = headers['accept'] || '';
        const wantsSSE = accept.includes('text/event-stream');
        const wantsJSON = accept.includes('application/json');

        // Process requests and collect responses
        const responses: JsonRpcResponse[] = [];
        for (const message of messages) {
            const response = await handleMcpRequest(message, session);
            if (response) {
                if ('result' in response && (message as JsonRpcRequest).method === 'initialize') {
                    set.headers['Mcp-Session-Id'] = session.id;
                }
                responses.push(response);
            }
        }

        if (responses.length === 0) {
            set.status = 202;
            return;
        }

        // Return as SSE or JSON based on Accept header
        if (wantsSSE && !wantsJSON) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    for (const response of responses) {
                        const data = `data: ${JSON.stringify(response)}\n\n`;
                        controller.enqueue(encoder.encode(data));
                    }
                    controller.close();
                },
            });

            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Mcp-Session-Id': session.id,
                },
            });
        }

        // Return JSON
        set.headers['Mcp-Session-Id'] = session.id;
        return responses.length === 1 ? responses[0] : responses;
    })

    // MCP endpoint - GET for server-initiated SSE stream
    .get('/', async ({ headers, auth, set }) => {
        const sessionId = headers['mcp-session-id'];
        let session: Session | undefined;

        if (sessionId) {
            session = getSession(sessionId);
        }

        if (!session) {
            if (!auth) {
                set.status = 401;
                set.headers['WWW-Authenticate'] =
                    'Bearer realm="mcp", resource_metadata="/.well-known/oauth-protected-resource"';
                return { error: 'Authentication required' };
            }
            session = createSession(auth.user._id);
        }

        // Check Accept header
        const accept = headers['accept'] || '';
        if (!accept.includes('text/event-stream')) {
            set.status = 405;
            return { error: 'SSE not supported without text/event-stream Accept header' };
        }

        // Return SSE stream (keep-alive for server notifications)
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(': keepalive\n\n'));

                const interval = setInterval(() => {
                    try {
                        controller.enqueue(encoder.encode(': keepalive\n\n'));
                    } catch {
                        clearInterval(interval);
                    }
                }, 30000);

                return () => {
                    clearInterval(interval);
                };
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
                'Mcp-Session-Id': session.id,
            },
        });
    })

    // MCP endpoint - DELETE for session termination
    .delete('/', ({ headers, set }) => {
        const sessionId = headers['mcp-session-id'];
        if (!sessionId) {
            set.status = 400;
            return { error: 'Session ID required' };
        }

        const deleted = deleteSession(sessionId);
        if (!deleted) {
            set.status = 404;
            return { error: 'Session not found' };
        }

        // Return empty response for 204 No Content
        return new Response(null, { status: 204 });
    });
