#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MongoClient, Db, ObjectId, Binary } from 'mongodb';
import * as Y from 'yjs';

// Configuration
const config = {
    mongodbUri: process.env.MONGODB_URI || 'mongodb://192.168.0.244:27017/justmaple',
    userId: process.env.MCP_USER_ID || process.env.USER_ID,
};

// Database connection
let client: MongoClient | null = null;
let db: Db | null = null;

async function connectToDatabase(): Promise<Db> {
    if (db) return db;

    client = new MongoClient(config.mongodbUri, {
        maxPoolSize: 5,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    });

    await client.connect();
    db = client.db();
    return db;
}

async function closeDatabase(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}

// Helper to get user ID
function getUserId(): string {
    if (!config.userId) {
        throw new Error('User ID not configured. Set MCP_USER_ID or USER_ID environment variable.');
    }
    return config.userId;
}

// =====================
// Notebook Operations
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

// =====================
// Page Operations
// =====================

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

    // Get all notebooks user has access to
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

    // Check access
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

    // Build base query
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

    // Verify notebook access if provided
    if (data.notebookId) {
        const hasAccess = await hasNotebookAccess(data.notebookId, userId, 'write');
        if (!hasAccess) {
            throw new Error('No write access to the specified notebook');
        }
    }

    const now = new Date();
    const pageId = crypto.randomUUID();
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

    // Get page and check access
    const doc = await database.collection<PageDocument>('pages').findOne({ id: pageId });
    if (!doc) return null;

    if (doc.notebookId) {
        const hasAccess = await hasNotebookAccess(doc.notebookId.toString(), userId, 'write');
        if (!hasAccess) return null;
    } else {
        if (doc.userId.toString() !== userId) return null;
    }

    // If moving to new notebook, verify access
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

// =====================
// Memo Operations
// =====================

interface MemoDocument {
    _id: ObjectId;
    noteId: string;
    state: Binary;
    version: number;
    updatedAt: Date;
}

function extractTextFromYDoc(state: Uint8Array): string {
    try {
        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, state);

        // Try to get text from common Y.js shared types
        const xmlFragment = ydoc.getXmlFragment('prosemirror');
        if (xmlFragment.length > 0) {
            return xmlFragmentToText(xmlFragment);
        }

        // Try default text type
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

async function getMemoContent(pageId: string, userId: string) {
    // Verify page access
    const page = await getPage(pageId, userId);
    if (!page) return null;
    if (page.type !== 'memo') return null;

    const database = await connectToDatabase();
    const doc = await database.collection<MemoDocument>('memos').findOne({ noteId: pageId });

    if (!doc) {
        // Return page content if no memo document exists
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

async function updateMemoContent(
    pageId: string,
    userId: string,
    content: string,
): Promise<{ success: boolean; error?: string }> {
    // Verify page access
    const page = await getPage(pageId, userId);
    if (!page) return { success: false, error: 'Page not found or access denied' };
    if (page.type !== 'memo') return { success: false, error: 'Page is not a memo' };

    const database = await connectToDatabase();

    // Create Y.Doc with content
    const ydoc = new Y.Doc();
    const xmlFragment = ydoc.getXmlFragment('prosemirror');

    // Create a simple paragraph with the text content
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

    // Also update the page's content field for search
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

// =====================
// Whiteboard Operations
// =====================

interface WhiteboardDocument {
    _id: ObjectId;
    id: string;
    state: Binary;
    version: number;
    updatedAt: Date;
}

async function getWhiteboardState(pageId: string, userId: string) {
    // Verify page access
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

    // Extract whiteboard elements from Y.Doc
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

        // Try to get elements from Y.Map
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
    // Verify page access
    const page = await getPage(pageId, userId);
    if (!page) return { success: false, error: 'Page not found or access denied' };
    if (page.type !== 'whiteboard') return { success: false, error: 'Page is not a whiteboard' };

    const database = await connectToDatabase();

    // Create Y.Doc with elements
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
// MCP Server Setup
// =====================

const server = new Server(
    {
        name: 'maple-mcp',
        version: '0.1.0',
    },
    {
        capabilities: {
            tools: {},
            resources: {},
        },
    },
);

// Define tools
const tools = [
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
                notebookId: {
                    type: 'string',
                    description: 'The notebook ID',
                },
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
                notebookId: {
                    type: 'string',
                    description: 'Filter by notebook ID (optional)',
                },
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
                pageId: {
                    type: 'string',
                    description: 'The page ID (UUID)',
                },
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
                query: {
                    type: 'string',
                    description: 'Search query string',
                },
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
                title: {
                    type: 'string',
                    description: 'Page title',
                },
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
                pageId: {
                    type: 'string',
                    description: 'The page ID to update',
                },
                title: {
                    type: 'string',
                    description: 'New title (optional)',
                },
                notebookId: {
                    type: 'string',
                    description: 'Move to different notebook (optional)',
                },
                isFavorite: {
                    type: 'boolean',
                    description: 'Set favorite status (optional)',
                },
                isArchived: {
                    type: 'boolean',
                    description: 'Set archived status (optional)',
                },
                isTrashed: {
                    type: 'boolean',
                    description: 'Move to/from trash (optional)',
                },
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
                pageId: {
                    type: 'string',
                    description: 'The memo page ID',
                },
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
                pageId: {
                    type: 'string',
                    description: 'The memo page ID',
                },
                content: {
                    type: 'string',
                    description: 'The new text content',
                },
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
                pageId: {
                    type: 'string',
                    description: 'The whiteboard page ID',
                },
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
                pageId: {
                    type: 'string',
                    description: 'The whiteboard page ID',
                },
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

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const userId = getUserId();

    try {
        switch (name) {
            case 'list_notebooks': {
                const notebooks = await listNotebooks(userId);
                return {
                    content: [{ type: 'text', text: JSON.stringify(notebooks, null, 2) }],
                };
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
                return {
                    content: [{ type: 'text', text: JSON.stringify(notebook, null, 2) }],
                };
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
                return {
                    content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }],
                };
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
                return {
                    content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
                };
            }

            case 'search_pages': {
                const { query, notebookId } = args as { query: string; notebookId?: string };
                const pages = await searchPages(userId, query, { notebookId });
                return {
                    content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }],
                };
            }

            case 'create_page': {
                const { title, type, notebookId } = args as {
                    title?: string;
                    type?: 'memo' | 'whiteboard';
                    notebookId?: string;
                };
                const page = await createPage(userId, { title, type, notebookId });
                return {
                    content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
                };
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
                return {
                    content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
                };
            }

            case 'get_memo_content': {
                const { pageId } = args as { pageId: string };
                const memo = await getMemoContent(pageId, userId);
                if (!memo) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Memo not found, access denied, or not a memo type',
                            },
                        ],
                        isError: true,
                    };
                }
                return {
                    content: [{ type: 'text', text: JSON.stringify(memo, null, 2) }],
                };
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
                return {
                    content: [{ type: 'text', text: 'Memo content updated successfully' }],
                };
            }

            case 'get_whiteboard': {
                const { pageId } = args as { pageId: string };
                const whiteboard = await getWhiteboardState(pageId, userId);
                if (!whiteboard) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'Whiteboard not found, access denied, or not a whiteboard type',
                            },
                        ],
                        isError: true,
                    };
                }
                return {
                    content: [{ type: 'text', text: JSON.stringify(whiteboard, null, 2) }],
                };
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
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
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
});

// Handle list resources request (expose notebooks as resources)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
        const userId = getUserId();
        const notebooks = await listNotebooks(userId);

        return {
            resources: notebooks.map((notebook) => ({
                uri: `maple://notebook/${notebook._id}`,
                name: notebook.label,
                description: `Notebook: ${notebook.label} (${notebook.value})`,
                mimeType: 'application/json',
            })),
        };
    } catch {
        return { resources: [] };
    }
});

// Handle read resource request
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const userId = getUserId();

    const notebookMatch = uri.match(/^maple:\/\/notebook\/(.+)$/);
    if (notebookMatch && notebookMatch[1]) {
        const notebookId = notebookMatch[1];
        const notebook = await getNotebook(notebookId, userId);
        const pages = await listPages(userId, { notebookId });

        return {
            contents: [
                {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify({ notebook, pages }, null, 2),
                },
            ],
        };
    }

    throw new Error(`Unknown resource: ${uri}`);
});

// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        await closeDatabase();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await closeDatabase();
        process.exit(0);
    });
}

main().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
});
