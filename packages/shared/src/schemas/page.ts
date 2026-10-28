import { Type, Static } from '@sinclair/typebox';
import { ProactiveBotSettingsSchema } from './proactive';
import { PageTodoMetaSchema } from './todo';
import { PageLinksMetaSchema } from './link';
import { GmailConfigSchema } from './gmail';
import { MacDataSourceSchema } from './mac-data';
import { DeviceDataFilterSchema } from './device-data-filter';

export const PageContentSchema = Type.Object({
    type: Type.String(),
    content: Type.Optional(Type.Array(Type.Any())),
    attrs: Type.Optional(Type.Record(Type.String(), Type.Any())),
    text: Type.Optional(Type.String()),
});

export type PageContent = Static<typeof PageContentSchema>;

export const SyncStatusSchema = Type.Union([
    Type.Literal('pending'),
    Type.Literal('syncing'),
    Type.Literal('synced'),
    Type.Literal('failed'),
    Type.Literal('conflict'),
]);

export type SyncStatus = Static<typeof SyncStatusSchema>;

// Page type - determines the editor/view used
export const PageTypeSchema = Type.Union([
    Type.Literal('memo'), // Default (was 'write')
    Type.Literal('collectable'),
    Type.Literal('whiteboard'),
    Type.Literal('kanban'),
    Type.Literal('message'), // Chat messages container
    Type.Literal('recording'),
    Type.Literal('gmail'), // Gmail integration - owner-only, local email storage
    Type.Literal('json'), // JSON data document - API-editable structured data
    Type.Literal('canvas'), // Widget canvas - AI-generated reactive widgets
    Type.Literal('devicedata'), // A table of one source of the owner's device data (Messages, Mail…)
    Type.Literal('aboutme'), // What bots know about each member, per notebook (one per notebook)
    Type.Literal('graph'), // Links between the notebook's data page items (one per notebook)
    Type.Literal('activity'), // What bots did and proposed in the notebook (one per notebook)
    Type.Literal('followups'), // Promises and replies owed, from messages and mail (one per notebook)
]);

export type PageType = Static<typeof PageTypeSchema>;

export const PageSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(), // UUID v4 for routing (was documentId)
    userId: Type.String(),
    type: PageTypeSchema,
    title: Type.String(),
    content: PageContentSchema, // ProseMirror JSON format
    notebookId: Type.Optional(Type.String()), // Associated notebook/folder
    headerImageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Header/cover image URL
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    trashedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // Todo metadata for efficient querying across memos
    todoMeta: Type.Optional(PageTodoMetaSchema),
    // Link metadata for bi-directional linking
    linksMeta: Type.Optional(PageLinksMetaSchema),
    // Tags extracted from content (e.g., #work, #ideas)
    tags: Type.Optional(Type.Array(Type.String())),
    // Gmail page configuration (only for type: 'gmail')
    gmailConfig: Type.Optional(GmailConfigSchema),
    // Messages pages only: the bot that answers every message and posts proactively
    proactive: Type.Optional(ProactiveBotSettingsSchema),
    // Device data pages only: which of the owner's sources the page shows
    deviceSource: Type.Optional(MacDataSourceSchema),
    // Device data pages only: what the page shares and what it's for (bots read both)
    deviceFilter: Type.Optional(DeviceDataFilterSchema),
    description: Type.Optional(Type.String()),
    // Public publishing fields
    isPublished: Type.Optional(Type.Boolean()),
    publishedSlug: Type.Optional(Type.String()),
    publishedAt: Type.Optional(Type.String({ format: 'date-time' })),
    publishedOrder: Type.Optional(Type.Number()),
    publishedContent: Type.Optional(PageContentSchema), // Snapshot of content at last publish
    publishedTitle: Type.Optional(Type.String()), // Snapshot of title at last publish
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Page = Static<typeof PageSchema>;

export const CreatePageSchema = Type.Object({
    type: Type.Optional(PageTypeSchema),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    content: Type.Optional(PageContentSchema),
    notebookId: Type.Optional(Type.String()),
    id: Type.Optional(Type.String()), // UUID v4 for routing (was documentId)
    deviceSource: Type.Optional(MacDataSourceSchema), // Required for type 'devicedata'
    deviceFilter: Type.Optional(DeviceDataFilterSchema), // Set by the server in shared notebooks
});

export type CreatePageInput = Static<typeof CreatePageSchema>;

export const UpdatePageSchema = Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    content: Type.Optional(PageContentSchema),
    notebookId: Type.Optional(Type.String()),
    headerImageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Header/cover image URL (null to remove)
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    todoMeta: Type.Optional(PageTodoMetaSchema), // Todo metadata for efficient querying
    linksMeta: Type.Optional(PageLinksMetaSchema), // Link metadata for bi-directional linking
    tags: Type.Optional(Type.Array(Type.String())), // Tags extracted from content
    gmailConfig: Type.Optional(GmailConfigSchema), // Gmail page configuration
    description: Type.Optional(Type.String({ maxLength: 300 })), // Device data pages only
    deviceFilter: Type.Optional(DeviceDataFilterSchema), // Device data pages only
});

export type UpdatePageInput = Static<typeof UpdatePageSchema>;

// Publish page input
export const PublishPageSchema = Type.Object({
    isPublished: Type.Optional(Type.Boolean()),
    publishedOrder: Type.Optional(Type.Number()),
});

export type PublishPageInput = Static<typeof PublishPageSchema>;

// Default empty page content - starts with H1 heading as title
export const DEFAULT_PAGE_CONTENT: PageContent = {
    type: 'doc',
    content: [
        {
            type: 'heading',
            attrs: { level: 1 },
            content: [],
        },
        {
            type: 'paragraph',
            content: [],
        },
    ],
};
