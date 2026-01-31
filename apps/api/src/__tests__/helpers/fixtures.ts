import { ObjectId } from 'mongodb';
import { randomBytes, randomUUID } from 'crypto';
import { testDb } from '../setup';

// Generate UUID v4 for page IDs (same as page.repo.ts)
function generatePageId(): string {
    return randomUUID();
}

export interface UserDoc {
    _id: ObjectId;
    email: string;
    displayName?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface MagicLinkDoc {
    _id: ObjectId;
    userId: string;
    email: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
}

export interface PasskeyDoc {
    _id: ObjectId;
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    createdAt: Date;
}

export interface CreateUserOptions {
    email?: string;
    displayName?: string;
}

let emailCounter = 0;

export async function createUserFixture(options: CreateUserOptions = {}): Promise<UserDoc> {
    const now = new Date();
    emailCounter++;
    // Use unique email to avoid conflicts between tests
    const uniqueEmail = `test-${Date.now()}-${emailCounter}-${randomBytes(4).toString('hex')}@example.com`;
    const doc: UserDoc = {
        _id: new ObjectId(),
        email: uniqueEmail.toLowerCase(),
        displayName: options.displayName,
        createdAt: now,
        updatedAt: now,
    };
    await testDb.collection('users').insertOne(doc);
    return doc;
}

export interface CreateMagicLinkOptions {
    userId?: string;
    email?: string;
    token?: string;
    expiresAt?: Date;
}

export async function createMagicLinkFixture(
    options: CreateMagicLinkOptions = {},
): Promise<MagicLinkDoc> {
    const now = new Date();
    const doc: MagicLinkDoc = {
        _id: new ObjectId(),
        userId: options.userId || new ObjectId().toString(),
        email: options.email || `test-${Date.now()}@example.com`,
        token: options.token || randomBytes(32).toString('hex'),
        expiresAt: options.expiresAt || new Date(Date.now() + 15 * 60 * 1000),
        createdAt: now,
    };
    await testDb.collection('magic_links').insertOne(doc);
    return doc;
}

export interface CreatePasskeyOptions {
    userId?: string;
    credentialId?: string;
    publicKey?: string;
    counter?: number;
    deviceType?: string;
    backedUp?: boolean;
}

export async function createPasskeyFixture(
    options: CreatePasskeyOptions = {},
): Promise<PasskeyDoc> {
    const doc: PasskeyDoc = {
        _id: new ObjectId(),
        userId: options.userId || new ObjectId().toString(),
        credentialId: options.credentialId || randomBytes(32).toString('base64url'),
        publicKey: options.publicKey || randomBytes(65).toString('base64url'),
        counter: options.counter || 0,
        deviceType: options.deviceType || 'singleDevice',
        backedUp: options.backedUp || false,
        createdAt: new Date(),
    };
    await testDb.collection('passkeys').insertOne(doc);
    return doc;
}

export function generateToken(): string {
    return randomBytes(32).toString('hex');
}

// ============================================
// Notebook Fixtures
// ============================================

export interface NotebookDoc {
    _id: ObjectId;
    type: 'folder';
    value: 'mixed' | 'recordings' | 'notes';
    label: string;
    sharing: {
        sharedWith: Array<{ userId: string; accessLevel: 'owner' | 'write' | 'read' }>;
        isPublic?: boolean;
        sharedBots?: Array<{ userBotId: string }>;
    };
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateNotebookOptions {
    label?: string;
    value?: 'mixed' | 'recordings' | 'notes';
    createdBy?: string;
    sharedWith?: Array<{ userId: string; accessLevel: 'owner' | 'write' | 'read' }>;
    isPublic?: boolean;
}

export async function createNotebookFixture(
    options: CreateNotebookOptions = {},
): Promise<NotebookDoc> {
    const now = new Date();
    const createdBy = options.createdBy || new ObjectId().toString();

    const doc: NotebookDoc = {
        _id: new ObjectId(),
        type: 'folder',
        value: options.value || 'mixed',
        label: options.label || `test-notebook-${Date.now()}`,
        sharing: {
            sharedWith: options.sharedWith || [{ userId: createdBy, accessLevel: 'owner' }],
            isPublic: options.isPublic ?? false,
            sharedBots: [],
        },
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('notebooks').insertOne(doc);
    return doc;
}

// ============================================
// Bot Template Fixtures
// ============================================

export interface BotTemplateDoc {
    _id: ObjectId;
    name: string;
    handle: string;
    description?: string;
    avatar?: string;
    definition: {
        trigger: { mentionPatterns?: string[] };
        input: { includeContext: Record<string, boolean | number> };
        actions: Array<{ type: string; id: string; config: Record<string, unknown> }>;
        output: Record<string, unknown>;
    };
    requiresConfig: boolean;
    configSchema?: unknown;
    isSystemBot: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateBotTemplateOptions {
    name?: string;
    handle?: string;
    description?: string;
    requiresConfig?: boolean;
    isSystemBot?: boolean;
}

export async function createBotTemplateFixture(
    options: CreateBotTemplateOptions = {},
): Promise<BotTemplateDoc> {
    const now = new Date();
    const handle = options.handle || `test-bot-${Date.now()}-${randomBytes(4).toString('hex')}`;

    const doc: BotTemplateDoc = {
        _id: new ObjectId(),
        name: options.name || 'Test Bot',
        handle: handle.toLowerCase(),
        description: options.description,
        definition: {
            trigger: { mentionPatterns: ['@' + handle] },
            input: { includeContext: { mentionText: true } },
            actions: [{ type: 'reply', id: 'reply', config: { message: 'Hello!' } }],
            output: { chatView: { components: [] } },
        },
        requiresConfig: options.requiresConfig ?? false,
        isSystemBot: options.isSystemBot ?? true,
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('bot_templates').insertOne(doc);
    return doc;
}

// ============================================
// User Bot Fixtures
// ============================================

export interface UserBotDoc {
    _id: ObjectId;
    userId: ObjectId;
    templateId: ObjectId;
    handle: string;
    displayName?: string;
    config?: { apiKey?: string; customSettings?: Record<string, unknown> };
    isEnabled: boolean;
    notebookId?: ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateUserBotOptions {
    userId?: string;
    templateId?: string;
    handle?: string;
    displayName?: string;
    isEnabled?: boolean;
    notebookId?: string;
    config?: { apiKey?: string };
}

export async function createUserBotFixture(
    options: CreateUserBotOptions = {},
): Promise<UserBotDoc> {
    const now = new Date();
    const handle = options.handle || `user-bot-${Date.now()}-${randomBytes(4).toString('hex')}`;

    const doc: UserBotDoc = {
        _id: new ObjectId(),
        userId: options.userId ? new ObjectId(options.userId) : new ObjectId(),
        templateId: options.templateId ? new ObjectId(options.templateId) : new ObjectId(),
        handle: handle.toLowerCase(),
        displayName: options.displayName,
        config: options.config,
        isEnabled: options.isEnabled ?? true,
        notebookId: options.notebookId ? new ObjectId(options.notebookId) : undefined,
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('user_bots').insertOne(doc);
    return doc;
}

// ============================================
// Thread Fixtures
// ============================================

export interface ThreadDoc {
    _id: ObjectId;
    parentMessageId: ObjectId;
    notebookId: ObjectId;
    botInvocationId?: ObjectId;
    messageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateThreadOptions {
    parentMessageId?: string;
    notebookId?: string;
    botInvocationId?: string;
    messageCount?: number;
}

export async function createThreadFixture(options: CreateThreadOptions = {}): Promise<ThreadDoc> {
    const now = new Date();

    const doc: ThreadDoc = {
        _id: new ObjectId(),
        parentMessageId: options.parentMessageId
            ? new ObjectId(options.parentMessageId)
            : new ObjectId(),
        notebookId: options.notebookId ? new ObjectId(options.notebookId) : new ObjectId(),
        botInvocationId: options.botInvocationId
            ? new ObjectId(options.botInvocationId)
            : undefined,
        messageCount: options.messageCount ?? 0,
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('threads').insertOne(doc);
    return doc;
}

// ============================================
// Bot Invocation Fixtures
// ============================================

export interface BotInvocationDoc {
    _id: ObjectId;
    userBotId: ObjectId;
    templateId: ObjectId;
    sourceType: 'message' | 'note';
    sourceId: ObjectId;
    notebookId: ObjectId;
    userId: ObjectId;
    context: Record<string, unknown>;
    variables: Record<string, unknown>;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    output?: unknown;
    error?: { code: string; message: string };
    threadId?: ObjectId;
    responseMessageId?: ObjectId;
    executionTimeMs?: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateBotInvocationOptions {
    userBotId?: string;
    templateId?: string;
    sourceType?: 'message' | 'note';
    sourceId?: string;
    notebookId?: string;
    userId?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    context?: Record<string, unknown>;
}

export async function createBotInvocationFixture(
    options: CreateBotInvocationOptions = {},
): Promise<BotInvocationDoc> {
    const now = new Date();

    const doc: BotInvocationDoc = {
        _id: new ObjectId(),
        userBotId: options.userBotId ? new ObjectId(options.userBotId) : new ObjectId(),
        templateId: options.templateId ? new ObjectId(options.templateId) : new ObjectId(),
        sourceType: options.sourceType || 'message',
        sourceId: options.sourceId ? new ObjectId(options.sourceId) : new ObjectId(),
        notebookId: options.notebookId ? new ObjectId(options.notebookId) : new ObjectId(),
        userId: options.userId ? new ObjectId(options.userId) : new ObjectId(),
        context: options.context || { mentionText: '@bot test' },
        variables: {},
        status: options.status || 'pending',
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('bot_invocations').insertOne(doc);
    return doc;
}

// ============================================
// Page Fixtures
// ============================================

export interface PageDoc {
    _id: ObjectId;
    id: string; // UUID v4 for routing (was documentId)
    userId: ObjectId;
    type: 'memo' | 'collectable' | 'whiteboard' | 'kanban' | 'message' | 'recording';
    title: string;
    content: any;
    version: number;
    notebookId?: ObjectId;
    tags?: string[];
    isFavorite?: boolean;
    isArchived?: boolean;
    isTrashed?: boolean;
    trashedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreatePageOptions {
    userId?: string;
    type?: 'memo' | 'collectable' | 'whiteboard' | 'kanban' | 'message' | 'recording';
    title?: string;
    content?: any;
    id?: string;
    version?: number;
    notebookId?: string;
    tags?: string[];
    isFavorite?: boolean;
    isArchived?: boolean;
    isTrashed?: boolean;
    trashedAt?: Date;
}

export async function createPageFixture(options: CreatePageOptions = {}): Promise<PageDoc> {
    const now = new Date();

    const doc: PageDoc = {
        _id: new ObjectId(),
        id: options.id || generatePageId(),
        userId: options.userId ? new ObjectId(options.userId) : new ObjectId(),
        type: options.type || 'memo',
        title: options.title || 'Test Page',
        content: options.content || { type: 'doc', content: [] },
        version: options.version ?? 1,
        notebookId: options.notebookId ? new ObjectId(options.notebookId) : undefined,
        tags: options.tags,
        isFavorite: options.isFavorite ?? false,
        isArchived: options.isArchived ?? false,
        isTrashed: options.isTrashed ?? false,
        trashedAt: options.trashedAt,
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('pages').insertOne(doc);
    return doc;
}

// ============================================
// Memo Fixtures
// ============================================

export interface MemoDoc {
    _id: ObjectId;
    noteId: string;
    state: Buffer;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateMemoOptions {
    noteId: string;
    state?: Buffer;
}

export async function createMemoFixture(options: CreateMemoOptions): Promise<MemoDoc> {
    const now = new Date();

    const doc: MemoDoc = {
        _id: new ObjectId(),
        noteId: options.noteId,
        state: options.state || Buffer.from([]),
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('memos').insertOne(doc);
    return doc;
}

// ============================================
// Whiteboard Fixtures
// ============================================

export interface WhiteboardDoc {
    _id: ObjectId;
    id: string;
    state: Buffer;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateWhiteboardOptions {
    id: string;
    state?: Buffer;
}

export async function createWhiteboardFixture(
    options: CreateWhiteboardOptions,
): Promise<WhiteboardDoc> {
    const now = new Date();

    const doc: WhiteboardDoc = {
        _id: new ObjectId(),
        id: options.id,
        state: options.state || Buffer.from([]),
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('whiteboards').insertOne(doc);
    return doc;
}

// ============================================
// Message Fixtures
// ============================================

export interface MessageDoc {
    _id: ObjectId;
    id: string;
    pageId: string;
    notebookId: ObjectId;
    threadId?: ObjectId;
    userId: ObjectId;
    senderType?: 'user' | 'bot';
    userBotId?: ObjectId;
    senderDisplayName?: string;
    senderProfilePictureUrl?: string;
    content: any;
    mentions?: Array<{ type: string; id: string; handle: string }>;
    hasThread?: boolean;
    createdAt: Date;
    updatedAt: Date;
    editedAt?: Date;
    deletedAt?: Date;
}

export interface CreateMessageOptions {
    notebookId?: string;
    pageId?: string;
    threadId?: string;
    userId?: string;
    senderType?: 'user' | 'bot';
    userBotId?: string;
    content?: any;
    mentions?: Array<{ type: string; id: string; handle: string }>;
    hasThread?: boolean;
}

export async function createMessageFixture(
    options: CreateMessageOptions = {},
): Promise<MessageDoc> {
    const now = new Date();
    const notebookId = options.notebookId ? new ObjectId(options.notebookId) : new ObjectId();

    // If pageId is not provided, find or create a messages page for the notebook
    let pageId = options.pageId;
    if (!pageId) {
        // Look for existing messages page for this notebook
        const existingPage = await testDb!.collection('pages').findOne({
            notebookId: notebookId,
            type: 'message',
            isTrashed: { $ne: true },
        });

        if (existingPage) {
            pageId = existingPage.id;
        } else {
            // Create a new messages page
            const newPageId = randomUUID();
            await testDb!.collection('pages').insertOne({
                _id: new ObjectId(),
                id: newPageId,
                userId: options.userId ? new ObjectId(options.userId) : new ObjectId(),
                type: 'message',
                title: 'Messages',
                content: { type: 'doc', content: [] },
                notebookId: notebookId,
                isFavorite: false,
                isArchived: false,
                isTrashed: false,
                createdAt: now,
                updatedAt: now,
            });
            pageId = newPageId;
        }
    }

    const doc: MessageDoc = {
        _id: new ObjectId(),
        id: crypto.randomUUID(),
        pageId: pageId,
        notebookId: notebookId,
        threadId: options.threadId ? new ObjectId(options.threadId) : undefined,
        userId: options.userId ? new ObjectId(options.userId) : new ObjectId(),
        senderType: options.senderType || 'user',
        userBotId: options.userBotId ? new ObjectId(options.userBotId) : undefined,
        content: options.content || { type: 'doc', content: [] },
        mentions: options.mentions,
        hasThread: options.hasThread ?? false,
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('messages').insertOne(doc);
    return doc;
}

// ============================================
// Template Fixtures
// ============================================

export interface TemplateDoc {
    _id: ObjectId;
    id: string;
    userId: ObjectId | null;
    title: string;
    description: string;
    category: 'meeting' | 'planning' | 'personal' | 'work' | 'custom';
    content: any;
    icon?: string;
    isSystem: boolean;
    usageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateTemplateOptions {
    userId?: string | null;
    title?: string;
    description?: string;
    category?: 'meeting' | 'planning' | 'personal' | 'work' | 'custom';
    content?: any;
    icon?: string;
    isSystem?: boolean;
    usageCount?: number;
}

export async function createTemplateFixture(
    options: CreateTemplateOptions = {},
): Promise<TemplateDoc> {
    const now = new Date();

    const doc: TemplateDoc = {
        _id: new ObjectId(),
        id: randomUUID(),
        userId: options.userId
            ? new ObjectId(options.userId)
            : options.isSystem
              ? null
              : new ObjectId(),
        title: options.title || `Test Template ${Date.now()}`,
        description: options.description || 'Test template description',
        category: options.category || 'custom',
        content: options.content || { type: 'doc', content: [] },
        icon: options.icon,
        isSystem: options.isSystem ?? false,
        usageCount: options.usageCount ?? 0,
        createdAt: now,
        updatedAt: now,
    };
    await testDb!.collection('templates').insertOne(doc);
    return doc;
}

// ============================================
// Memo Version Fixtures
// ============================================

export interface MemoVersionDoc {
    _id: ObjectId;
    noteId: string;
    state: Buffer;
    version: number;
    byteSize: number;
    compressedSize?: number;
    compressed?: boolean;
    trigger: 'auto-interval' | 'auto-idle' | 'manual' | 'ai-edit' | 'significant-change' | 'import';
    label?: string;
    createdAt: Date;
    contentPreview?: string;
    wordCount?: number;
    headingText?: string;
}

export interface CreateMemoVersionOptions {
    noteId?: string;
    state?: Uint8Array;
    version?: number;
    trigger?:
        | 'auto-interval'
        | 'auto-idle'
        | 'manual'
        | 'ai-edit'
        | 'significant-change'
        | 'import';
    label?: string;
    contentPreview?: string;
    wordCount?: number;
    headingText?: string;
    createdAt?: Date;
}

export async function createMemoVersionFixture(
    options: CreateMemoVersionOptions = {},
): Promise<MemoVersionDoc> {
    const state = options.state || new Uint8Array([1, 2, 3, 4, 5]);

    const doc: MemoVersionDoc = {
        _id: new ObjectId(),
        noteId: options.noteId || generatePageId(),
        state: Buffer.from(state),
        version: options.version ?? 1,
        byteSize: state.length,
        compressed: false,
        trigger: options.trigger || 'auto-interval',
        label: options.label,
        createdAt: options.createdAt || new Date(),
        contentPreview: options.contentPreview,
        wordCount: options.wordCount,
        headingText: options.headingText,
    };
    await testDb!.collection('memo_versions').insertOne(doc);
    return doc;
}
