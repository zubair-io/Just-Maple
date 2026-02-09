import { Type, Static } from '@sinclair/typebox';

// Gmail filter types for customized views per notebook
export const GmailFilterTypeSchema = Type.Union([
    Type.Literal('all'), // Show all emails
    Type.Literal('label'), // Gmail label/folder
    Type.Literal('sender'), // Specific email addresses
    Type.Literal('search'), // Gmail search query
]);

export type GmailFilterType = Static<typeof GmailFilterTypeSchema>;

// Individual filter configuration
export const GmailFilterSchema = Type.Object({
    id: Type.String(), // UUID for the filter
    name: Type.String(), // Display name (e.g., "Work", "VIP")
    type: GmailFilterTypeSchema,
    value: Type.Union([Type.String(), Type.Array(Type.String())]), // Label name, email list, or search query
    icon: Type.Optional(Type.String()), // Emoji or icon identifier
    color: Type.Optional(Type.String()), // Color for visual organization
    order: Type.Optional(Type.Number()), // Display order in filter list
});

export type GmailFilter = Static<typeof GmailFilterSchema>;

// Sync depth options
export const GmailSyncDepthSchema = Type.Union([
    Type.Literal('7d'),
    Type.Literal('30d'),
    Type.Literal('90d'),
]);

export type GmailSyncDepth = Static<typeof GmailSyncDepthSchema>;

// Gmail page configuration (synced to server)
export const GmailConfigSchema = Type.Object({
    connected: Type.Boolean(), // Whether Gmail is connected
    email: Type.Optional(Type.String()), // Connected email address
    syncDepth: Type.Optional(GmailSyncDepthSchema), // How far back to sync (default 30d)
    defaultFilterId: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Default filter to show
    filters: Type.Optional(Type.Array(GmailFilterSchema)), // User-defined filters
});

export type GmailConfig = Static<typeof GmailConfigSchema>;

// Email address with optional name
export const EmailAddressSchema = Type.Object({
    email: Type.String(),
    name: Type.Optional(Type.String()),
});

export type EmailAddress = Static<typeof EmailAddressSchema>;

// Email attachment metadata
export const EmailAttachmentSchema = Type.Object({
    id: Type.String(), // Gmail attachment ID
    filename: Type.String(),
    mimeType: Type.String(),
    size: Type.Number(), // Size in bytes
});

export type EmailAttachment = Static<typeof EmailAttachmentSchema>;

// Cached email structure (stored in IndexedDB)
export const CachedEmailSchema = Type.Object({
    id: Type.String(), // Gmail message ID
    threadId: Type.String(), // Gmail thread ID for grouping
    accountEmail: Type.String(), // Which Gmail account this belongs to

    from: EmailAddressSchema,
    to: Type.Array(EmailAddressSchema),
    cc: Type.Optional(Type.Array(EmailAddressSchema)),
    bcc: Type.Optional(Type.Array(EmailAddressSchema)),
    replyTo: Type.Optional(EmailAddressSchema),

    subject: Type.String(),
    snippet: Type.String(), // Preview text
    bodyText: Type.Optional(Type.String()), // Plain text body
    bodyHtml: Type.Optional(Type.String()), // HTML body

    labelIds: Type.Array(Type.String()), // Gmail label IDs
    isRead: Type.Boolean(),
    isStarred: Type.Boolean(),

    hasAttachments: Type.Boolean(),
    attachments: Type.Optional(Type.Array(EmailAttachmentSchema)),

    date: Type.String({ format: 'date-time' }), // RFC 2822 date
    internalDate: Type.Number(), // Gmail internal timestamp (ms since epoch)
    cachedAt: Type.String({ format: 'date-time' }), // When cached locally
});

export type CachedEmail = Static<typeof CachedEmailSchema>;

// Sync state for tracking Gmail sync progress
export const GmailSyncStateSchema = Type.Object({
    accountEmail: Type.String(),
    lastSyncAt: Type.Optional(Type.String({ format: 'date-time' })),
    historyId: Type.Optional(Type.String()), // Gmail history ID for incremental sync
    watchExpiration: Type.Optional(Type.String({ format: 'date-time' })), // Push notification expiry
    status: Type.Union([Type.Literal('idle'), Type.Literal('syncing'), Type.Literal('error')]),
    error: Type.Optional(Type.String()), // Error message if status is 'error'
});

export type GmailSyncState = Static<typeof GmailSyncStateSchema>;

// OAuth tokens (encrypted storage)
export const GmailTokensSchema = Type.Object({
    accountEmail: Type.String(),
    accessToken: Type.String(), // Will be encrypted at rest
    refreshToken: Type.String(), // Will be encrypted at rest
    expiresAt: Type.String({ format: 'date-time' }),
    tokenType: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
});

export type GmailTokens = Static<typeof GmailTokensSchema>;

// Local draft for composing emails
export const GmailDraftSchema = Type.Object({
    id: Type.String(), // Local draft ID
    pageId: Type.String(), // Associated Gmail page
    replyToId: Type.Optional(Type.String()), // Gmail message ID if reply
    replyToAll: Type.Optional(Type.Boolean()), // Reply to all recipients
    to: Type.Array(Type.String()), // Recipient emails
    cc: Type.Optional(Type.Array(Type.String())),
    bcc: Type.Optional(Type.Array(Type.String())),
    subject: Type.String(),
    body: Type.String(), // HTML body content
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type GmailDraft = Static<typeof GmailDraftSchema>;

// Gmail thread (group of related emails)
export const GmailThreadSchema = Type.Object({
    id: Type.String(), // Thread ID
    snippet: Type.String(), // Latest message snippet
    historyId: Type.String(),
    messages: Type.Array(CachedEmailSchema),
});

export type GmailThread = Static<typeof GmailThreadSchema>;

// Gmail API message list response
export const GmailMessageListResponseSchema = Type.Object({
    messages: Type.Optional(
        Type.Array(
            Type.Object({
                id: Type.String(),
                threadId: Type.String(),
            }),
        ),
    ),
    nextPageToken: Type.Optional(Type.String()),
    resultSizeEstimate: Type.Optional(Type.Number()),
});

export type GmailMessageListResponse = Static<typeof GmailMessageListResponseSchema>;

// Email composition input
export const ComposeEmailInputSchema = Type.Object({
    to: Type.Array(Type.String()),
    cc: Type.Optional(Type.Array(Type.String())),
    bcc: Type.Optional(Type.Array(Type.String())),
    subject: Type.String(),
    body: Type.String(), // HTML content
    replyToMessageId: Type.Optional(Type.String()), // For threading
    threadId: Type.Optional(Type.String()), // For threading
});

export type ComposeEmailInput = Static<typeof ComposeEmailInputSchema>;

// Gmail action types for batch operations
export const GmailActionTypeSchema = Type.Union([
    Type.Literal('markRead'),
    Type.Literal('markUnread'),
    Type.Literal('star'),
    Type.Literal('unstar'),
    Type.Literal('archive'),
    Type.Literal('trash'),
    Type.Literal('delete'),
]);

export type GmailActionType = Static<typeof GmailActionTypeSchema>;
