import Elysia from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { MongoClient, Db, ObjectId, Binary } from 'mongodb';
import * as Y from 'yjs';
import { randomUUID } from 'crypto';

// =====================
// Configuration
// =====================

const config = {
    port: parseInt(process.env.MCP_PORT || '7072'),
    mongodbUri: process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    publicUrl: process.env.MCP_PUBLIC_URL || 'http://localhost:7072',
    // OAuth settings
    oauthClientId: process.env.OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET,
    oauthIssuer: process.env.OAUTH_ISSUER || 'https://justmaple.app',
};

// =====================
// Database Connection
// =====================

let client: MongoClient | null = null;
let db: Db | null = null;

async function connectToDatabase(): Promise<Db> {
    if (db) return db;

    client = new MongoClient(config.mongodbUri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    });

    await client.connect();
    db = client.db();
    console.log('[MCP] Connected to MongoDB');
    return db;
}

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
// Database Operations (same as before, but extracted for reuse)
// =====================

interface NotebookDocument {
    _id: ObjectId;
    type: 'folder';
    value: 'mixed' | 'recordings' | 'notes';
    label: string;
    sharing: {
        sharedWith: Array<{ userId: string; accessLevel: 'read' | 'write' | 'owner' }>;
        isPublic?: boolean;
    };
    createdAt: Date;
    updatedAt: Date;
}

interface PageDocument {
    _id: ObjectId;
    id: string;
    userId: ObjectId;
    type: 'memo' | 'whiteboard' | 'collectable' | 'kanban' | 'message' | 'recording';
    title: string;
    content: {
        type: string;
        content?: unknown[];
        attrs?: Record<string, unknown>;
        text?: string;
    };
    notebookId?: ObjectId;
    isFavorite?: boolean;
    isArchived?: boolean;
    isTrashed?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

interface MemoDocument {
    _id: ObjectId;
    noteId: string;
    state: Binary;
    version: number;
    updatedAt: Date;
}

interface WhiteboardDocument {
    _id: ObjectId;
    id: string;
    state: Binary;
    version: number;
    updatedAt: Date;
}

async function listNotebooks(userId: string) {
    const database = await connectToDatabase();
    const docs = await database
        .collection<NotebookDocument>('notebooks')
        .find({
            $or: [
                { 'sharing.sharedWith.userId': userId },
                { 'sharing.isPublic': true },
                { userId: new ObjectId(userId) },
            ],
        })
        .sort({ label: 1 })
        .toArray();

    return docs.map((doc) => ({
        _id: doc._id.toString(),
        label: doc.label,
        value: doc.value || 'mixed',
        isOwner: doc.sharing?.sharedWith?.some(
            (e) => e.userId === userId && e.accessLevel === 'owner',
        ),
        createdAt: doc.createdAt?.toISOString(),
        updatedAt: doc.updatedAt?.toISOString(),
    }));
}

async function getNotebook(notebookId: string, userId: string) {
    const database = await connectToDatabase();
    const doc = await database.collection<NotebookDocument>('notebooks').findOne({
        _id: new ObjectId(notebookId),
        $or: [
            { 'sharing.sharedWith.userId': userId },
            { 'sharing.isPublic': true },
            { userId: new ObjectId(userId) },
        ],
    });

    if (!doc) return null;

    return {
        _id: doc._id.toString(),
        label: doc.label,
        value: doc.value || 'mixed',
        sharing: doc.sharing,
        createdAt: doc.createdAt?.toISOString(),
        updatedAt: doc.updatedAt?.toISOString(),
    };
}

async function hasNotebookAccess(
    notebookId: string,
    userId: string,
    requiredLevel: 'read' | 'write' = 'read',
): Promise<boolean> {
    const notebook = await getNotebook(notebookId, userId);
    if (!notebook) return false;

    const entry = notebook.sharing?.sharedWith?.find((e) => e.userId === userId);
    if (!entry) return (notebook.sharing?.isPublic ?? false) && requiredLevel === 'read';

    if (requiredLevel === 'read') return true;
    if (requiredLevel === 'write') {
        return entry.accessLevel === 'write' || entry.accessLevel === 'owner';
    }
    return false;
}

async function listPages(
    userId: string,
    options?: { notebookId?: string; type?: string; isTrashed?: boolean },
) {
    const database = await connectToDatabase();

    if (options?.notebookId) {
        const hasAccess = await hasNotebookAccess(options.notebookId, userId, 'read');
        if (!hasAccess) return [];

        const query: Record<string, unknown> = {
            notebookId: new ObjectId(options.notebookId),
            isTrashed: options?.isTrashed ?? { $ne: true },
        };

        if (options?.type) query.type = options.type;

        const docs = await database
            .collection<PageDocument>('pages')
            .find(query)
            .sort({ updatedAt: -1 })
            .toArray();

        return docs.map((doc) => ({
            _id: doc._id.toString(),
            id: doc.id,
            type: doc.type || 'memo',
            title: doc.title,
            notebookId: doc.notebookId?.toString(),
            isFavorite: doc.isFavorite,
            createdAt: doc.createdAt?.toISOString(),
            updatedAt: doc.updatedAt?.toISOString(),
        }));
    }

    const notebooks = await listNotebooks(userId);
    const notebookIds = notebooks
        .filter((n) => ObjectId.isValid(n._id))
        .map((n) => new ObjectId(n._id));

    const query: Record<string, unknown> = {
        isTrashed: options?.isTrashed ?? { $ne: true },
        $or: [
            { notebookId: { $in: notebookIds } },
            { notebookId: { $exists: false }, userId: new ObjectId(userId) },
            { notebookId: null, userId: new ObjectId(userId) },
        ],
    };

    if (options?.type) query.type = options.type;

    const docs = await database
        .collection<PageDocument>('pages')
        .find(query)
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray();

    return docs.map((doc) => ({
        _id: doc._id.toString(),
        id: doc.id,
        type: doc.type || 'memo',
        title: doc.title,
        notebookId: doc.notebookId?.toString(),
        isFavorite: doc.isFavorite,
        createdAt: doc.createdAt?.toISOString(),
        updatedAt: doc.updatedAt?.toISOString(),
    }));
}

async function getPage(pageId: string, userId: string) {
    const database = await connectToDatabase();
    const doc = await database.collection<PageDocument>('pages').findOne({ id: pageId });

    if (!doc) return null;

    if (doc.notebookId) {
        const hasAccess = await hasNotebookAccess(doc.notebookId.toString(), userId, 'read');
        if (!hasAccess) return null;
    } else {
        if (doc.userId.toString() !== userId) return null;
    }

    return {
        _id: doc._id.toString(),
        id: doc.id,
        type: doc.type || 'memo',
        title: doc.title,
        content: doc.content,
        notebookId: doc.notebookId?.toString(),
        isFavorite: doc.isFavorite,
        isArchived: doc.isArchived,
        isTrashed: doc.isTrashed,
        createdAt: doc.createdAt?.toISOString(),
        updatedAt: doc.updatedAt?.toISOString(),
    };
}

async function searchPages(userId: string, query: string, options?: { notebookId?: string }) {
    const database = await connectToDatabase();

    const baseQuery: Record<string, unknown> = {
        isTrashed: { $ne: true },
        $or: [
            { title: { $regex: query, $options: 'i' } },
            { 'content.content.content.text': { $regex: query, $options: 'i' } },
        ],
    };

    if (options?.notebookId) {
        const hasAccess = await hasNotebookAccess(options.notebookId, userId, 'read');
        if (!hasAccess) return [];
        baseQuery.notebookId = new ObjectId(options.notebookId);
    } else {
        const notebooks = await listNotebooks(userId);
        const notebookIds = notebooks
            .filter((n) => ObjectId.isValid(n._id))
            .map((n) => new ObjectId(n._id));

        baseQuery.$and = [
            {
                $or: [
                    { notebookId: { $in: notebookIds } },
                    { notebookId: { $exists: false }, userId: new ObjectId(userId) },
                    { notebookId: null, userId: new ObjectId(userId) },
                ],
            },
        ];
    }

    const docs = await database
        .collection<PageDocument>('pages')
        .find(baseQuery)
        .sort({ updatedAt: -1 })
        .limit(50)
        .toArray();

    return docs.map((doc) => ({
        _id: doc._id.toString(),
        id: doc.id,
        type: doc.type || 'memo',
        title: doc.title,
        notebookId: doc.notebookId?.toString(),
        updatedAt: doc.updatedAt?.toISOString(),
    }));
}

async function createPage(
    userId: string,
    data: {
        type?: 'memo' | 'whiteboard';
        title?: string;
        notebookId?: string;
        content?: unknown;
    },
) {
    const database = await connectToDatabase();

    if (data.notebookId) {
        const hasAccess = await hasNotebookAccess(data.notebookId, userId, 'write');
        if (!hasAccess) {
            throw new Error('No write access to the specified notebook');
        }
    }

    const now = new Date();
    const pageId = randomUUID();
    const pageType = data.type || 'memo';
    const title = data.title || 'Untitled';

    const doc = {
        id: pageId,
        userId: new ObjectId(userId),
        type: pageType,
        title: title,
        content: (data.content as PageDocument['content']) || {
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }],
        },
        notebookId: data.notebookId ? new ObjectId(data.notebookId) : undefined,
        isFavorite: false,
        isArchived: false,
        isTrashed: false,
        createdAt: now,
        updatedAt: now,
    };

    const result = await database.collection<PageDocument>('pages').insertOne(doc as PageDocument);

    return {
        _id: result.insertedId.toString(),
        id: pageId,
        type: pageType,
        title: title,
        notebookId: data.notebookId,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
    };
}

async function updatePage(
    pageId: string,
    userId: string,
    data: {
        title?: string;
        notebookId?: string;
        isFavorite?: boolean;
        isArchived?: boolean;
        isTrashed?: boolean;
    },
) {
    const database = await connectToDatabase();

    const doc = await database.collection<PageDocument>('pages').findOne({ id: pageId });
    if (!doc) return null;

    if (doc.notebookId) {
        const hasAccess = await hasNotebookAccess(doc.notebookId.toString(), userId, 'write');
        if (!hasAccess) return null;
    } else {
        if (doc.userId.toString() !== userId) return null;
    }

    if (data.notebookId && data.notebookId !== doc.notebookId?.toString()) {
        const hasAccess = await hasNotebookAccess(data.notebookId, userId, 'write');
        if (!hasAccess) return null;
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.notebookId !== undefined) {
        updateData.notebookId = data.notebookId ? new ObjectId(data.notebookId) : null;
    }
    if (data.isFavorite !== undefined) updateData.isFavorite = data.isFavorite;
    if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;
    if (data.isTrashed !== undefined) updateData.isTrashed = data.isTrashed;

    const result = await database
        .collection<PageDocument>('pages')
        .findOneAndUpdate({ id: pageId }, { $set: updateData }, { returnDocument: 'after' });

    if (!result) return null;

    return {
        _id: result._id.toString(),
        id: result.id,
        type: result.type || 'memo',
        title: result.title,
        notebookId: result.notebookId?.toString(),
        isFavorite: result.isFavorite,
        isArchived: result.isArchived,
        isTrashed: result.isTrashed,
        updatedAt: result.updatedAt?.toISOString(),
    };
}

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

async function getMemoContent(pageId: string, userId: string) {
    const page = await getPage(pageId, userId);
    if (!page) return null;
    if (page.type !== 'memo') return null;

    const database = await connectToDatabase();
    const doc = await database.collection<MemoDocument>('memos').findOne({ noteId: pageId });

    if (!doc) {
        return {
            pageId: pageId,
            title: page.title,
            text: extractTextFromContent(page.content),
            hasYjsState: false,
        };
    }

    const state = new Uint8Array(doc.state.buffer);
    const text = extractTextFromYDoc(state);

    return {
        pageId: pageId,
        title: page.title,
        text: text || extractTextFromContent(page.content),
        hasYjsState: true,
        version: doc.version,
        updatedAt: doc.updatedAt?.toISOString(),
    };
}

async function updateMemoContent(
    pageId: string,
    userId: string,
    content: string,
): Promise<{ success: boolean; error?: string }> {
    const page = await getPage(pageId, userId);
    if (!page) return { success: false, error: 'Page not found or access denied' };
    if (page.type !== 'memo') return { success: false, error: 'Page is not a memo' };

    const database = await connectToDatabase();

    const ydoc = new Y.Doc();
    const xmlFragment = ydoc.getXmlFragment('prosemirror');

    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(content)]);
    xmlFragment.insert(0, [paragraph]);

    const state = Y.encodeStateAsUpdate(ydoc);
    const now = new Date();

    await database.collection<MemoDocument>('memos').updateOne(
        { noteId: pageId },
        {
            $set: {
                state: new Binary(Buffer.from(state)),
                updatedAt: now,
            },
            $inc: { version: 1 },
            $setOnInsert: { noteId: pageId },
        },
        { upsert: true },
    );

    const prosemirrorContent = {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                content: content ? [{ type: 'text', text: content }] : [],
            },
        ],
    };

    await database.collection('pages').updateOne(
        { id: pageId },
        {
            $set: {
                content: prosemirrorContent,
                updatedAt: now,
            },
        },
    );

    return { success: true };
}

async function getWhiteboardState(pageId: string, userId: string) {
    const page = await getPage(pageId, userId);
    if (!page) return null;
    if (page.type !== 'whiteboard') return null;

    const database = await connectToDatabase();
    const doc = await database
        .collection<WhiteboardDocument>('whiteboards')
        .findOne({ id: pageId });

    if (!doc) {
        return {
            pageId: pageId,
            title: page.title,
            hasState: false,
        };
    }

    const state = new Uint8Array(doc.state.buffer);
    const elements = extractWhiteboardElements(state);

    return {
        pageId: pageId,
        title: page.title,
        hasState: true,
        elements: elements,
        version: doc.version,
        updatedAt: doc.updatedAt?.toISOString(),
    };
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

async function updateWhiteboardState(
    pageId: string,
    userId: string,
    elements: Array<{ type: string; id: string; [key: string]: unknown }>,
): Promise<{ success: boolean; error?: string }> {
    const page = await getPage(pageId, userId);
    if (!page) return { success: false, error: 'Page not found or access denied' };
    if (page.type !== 'whiteboard') return { success: false, error: 'Page is not a whiteboard' };

    const database = await connectToDatabase();

    const ydoc = new Y.Doc();
    const elementsMap = ydoc.getMap('elements');

    for (const element of elements) {
        const { id, ...rest } = element;
        elementsMap.set(id, rest);
    }

    const state = Y.encodeStateAsUpdate(ydoc);
    const now = new Date();

    await database.collection<WhiteboardDocument>('whiteboards').updateOne(
        { id: pageId },
        {
            $set: {
                state: new Binary(Buffer.from(state)),
                updatedAt: now,
            },
            $inc: { version: 1 },
            $setOnInsert: { id: pageId },
        },
        { upsert: true },
    );

    return { success: true };
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
                const notebooks = await listNotebooks(userId);
                return { content: [{ type: 'text', text: JSON.stringify(notebooks, null, 2) }] };
            }

            case 'get_notebook': {
                const { notebookId } = args as { notebookId: string };
                const notebook = await getNotebook(notebookId, userId);
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
                const pages = await listPages(userId, {
                    notebookId,
                    type,
                    isTrashed: includeTrashed,
                });
                return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
            }

            case 'get_page': {
                const { pageId } = args as { pageId: string };
                const page = await getPage(pageId, userId);
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
                const pages = await searchPages(userId, query, { notebookId });
                return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
            }

            case 'create_page': {
                const { title, type, notebookId } = args as {
                    title?: string;
                    type?: 'memo' | 'whiteboard';
                    notebookId?: string;
                };
                const page = await createPage(userId, { title, type, notebookId });
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
                const memo = await getMemoContent(pageId, userId);
                if (!memo) {
                    return {
                        content: [
                            { type: 'text', text: 'Memo not found, access denied, or not a memo' },
                        ],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }] };
            }

            case 'update_memo_content': {
                const { pageId, content } = args as { pageId: string; content: string };
                const result = await updateMemoContent(pageId, userId, content);
                if (!result.success) {
                    return {
                        content: [{ type: 'text', text: result.error || 'Failed to update memo' }],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text', text: 'Memo content updated successfully' }] };
            }

            case 'get_whiteboard': {
                const { pageId } = args as { pageId: string };
                const whiteboard = await getWhiteboardState(pageId, userId);
                if (!whiteboard) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Whiteboard not found, access denied, or not a whiteboard',
                            },
                        ],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text', text: JSON.stringify(whiteboard, null, 2) }] };
            }

            case 'update_whiteboard': {
                const { pageId, elements } = args as {
                    pageId: string;
                    elements: Array<{ type: string; id: string; [key: string]: unknown }>;
                };
                const result = await updateWhiteboardState(pageId, userId, elements);
                if (!result.success) {
                    return {
                        content: [
                            { type: 'text', text: result.error || 'Failed to update whiteboard' },
                        ],
                        isError: true,
                    };
                }
                return {
                    content: [{ type: 'text', text: 'Whiteboard updated successfully' }],
                };
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
        // This is a response, not a request
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
                // Notification, no response needed
                return null;
            }

            case 'tools/list': {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        tools: mcpTools,
                    },
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
                const notebooks = await listNotebooks(session.userId);
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        resources: notebooks.map((notebook) => ({
                            uri: `maple://notebook/${notebook._id}`,
                            name: notebook.label,
                            description: `Notebook: ${notebook.label} (${notebook.value})`,
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
                    const notebook = await getNotebook(notebookId, session.userId);
                    const pages = await listPages(session.userId, { notebookId });

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
// Elysia Server Setup
// =====================

new Elysia()
    .use(
        cors({
            origin: true,
            credentials: true,
            allowedHeaders: [
                'Content-Type',
                'Authorization',
                'Accept',
                'Mcp-Session-Id',
                'Last-Event-Id',
            ],
            exposeHeaders: ['Mcp-Session-Id'],
        }),
    )
    .use(
        jwt({
            name: 'jwt',
            secret: config.jwtSecret,
        }),
    )
    // OAuth Protected Resource Metadata (RFC 9728)
    .get('/.well-known/oauth-protected-resource', () => {
        return {
            resource: config.publicUrl,
            authorization_servers: [config.oauthIssuer],
            bearer_methods_supported: ['header'],
            resource_documentation: `${config.publicUrl}/docs`,
        };
    })
    // OAuth Authorization Server Metadata (for servers that also act as AS)
    .get('/.well-known/oauth-authorization-server', () => {
        return {
            issuer: config.oauthIssuer,
            authorization_endpoint: `${config.oauthIssuer}/oauth/authorize`,
            token_endpoint: `${config.oauthIssuer}/oauth/token`,
            registration_endpoint: `${config.oauthIssuer}/oauth/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        };
    })
    // Health check
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
    // MCP endpoint - POST for sending messages
    .post('/mcp', async ({ request, headers, jwt, set }) => {
        // Validate Origin header for security
        const origin = headers['origin'];
        if (origin && !origin.includes('claude.ai') && !origin.includes('localhost')) {
            console.warn(`[MCP] Suspicious origin: ${origin}`);
        }

        // Check for session
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
            const authHeader = headers['authorization'];
            if (!authHeader?.startsWith('Bearer ')) {
                set.status = 401;
                set.headers['WWW-Authenticate'] =
                    'Bearer realm="mcp", resource_metadata="/.well-known/oauth-protected-resource"';
                return { error: 'Authentication required' };
            }

            const token = authHeader.substring(7);
            try {
                const payload = await jwt.verify(token);
                if (!payload || typeof payload.sub !== 'string') {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }
                session = createSession(payload.sub);
            } catch {
                set.status = 401;
                return { error: 'Invalid token' };
            }
        }

        // Parse message(s)
        const body = await request.json();
        const messages: JsonRpcMessage[] = Array.isArray(body) ? body : [body];

        // Check if any messages are requests (need response)
        const requests = messages.filter((m) => 'id' in m && 'method' in m);

        if (requests.length === 0) {
            // Only notifications/responses, accept without response
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
                // Add session ID to initialize response
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
            set.headers['Content-Type'] = 'text/event-stream';
            set.headers['Cache-Control'] = 'no-cache';
            set.headers['Connection'] = 'keep-alive';

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
    .get('/mcp', async ({ headers, jwt, set }) => {
        const sessionId = headers['mcp-session-id'];
        let session: Session | undefined;

        if (sessionId) {
            session = getSession(sessionId);
        }

        if (!session) {
            const authHeader = headers['authorization'];
            if (!authHeader?.startsWith('Bearer ')) {
                set.status = 401;
                set.headers['WWW-Authenticate'] =
                    'Bearer realm="mcp", resource_metadata="/.well-known/oauth-protected-resource"';
                return { error: 'Authentication required' };
            }

            const token = authHeader.substring(7);
            try {
                const payload = await jwt.verify(token);
                if (!payload || typeof payload.sub !== 'string') {
                    set.status = 401;
                    return { error: 'Invalid token' };
                }
                session = createSession(payload.sub);
            } catch {
                set.status = 401;
                return { error: 'Invalid token' };
            }
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
                // Send initial keepalive
                controller.enqueue(encoder.encode(': keepalive\n\n'));

                // Keep connection open with periodic keepalives
                const interval = setInterval(() => {
                    try {
                        controller.enqueue(encoder.encode(': keepalive\n\n'));
                    } catch {
                        clearInterval(interval);
                    }
                }, 30000);

                // Clean up on close
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
    .delete('/mcp', ({ headers, set }) => {
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

        set.status = 204;
        return;
    })
    .listen(config.port);

console.log(`[MCP] Remote MCP server running at ${config.publicUrl}/mcp`);
console.log(`[MCP] OAuth metadata at ${config.publicUrl}/.well-known/oauth-protected-resource`);

// Initialize database connection
connectToDatabase().catch(console.error);
