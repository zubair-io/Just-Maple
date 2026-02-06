import { Type, Static } from '@sinclair/typebox';

// Priority levels for kanban cards
export const KanbanPrioritySchema = Type.Union([
    Type.Literal('high'),
    Type.Literal('medium'),
    Type.Literal('low'),
]);

export type KanbanPriority = Static<typeof KanbanPrioritySchema>;

// Kanban card - references a memo for content
export const KanbanCardSchema = Type.Object({
    id: Type.String(),
    memoPageId: Type.String(), // Page ID for URL routing
    memoId: Type.Optional(Type.String()), // Memo document ID for content reference

    // Denormalized from memo (synced)
    title: Type.String(),

    // Card attributes
    priority: Type.Optional(KanbanPrioritySchema),
    dueDate: Type.Optional(Type.String({ format: 'date-time' })),
    coverColor: Type.Optional(Type.String()),
    completedAt: Type.Optional(Type.String({ format: 'date-time' })),
    archivedAt: Type.Optional(Type.String({ format: 'date-time' })),
    archivedFrom: Type.Optional(Type.String()), // Lane ID for restore default
});

export type KanbanCard = Static<typeof KanbanCardSchema>;

// Kanban lane (column)
export const KanbanLaneSchema = Type.Object({
    id: Type.String(),
    title: Type.String(),
    position: Type.Number(),
    color: Type.Optional(Type.String()),
    wipLimit: Type.Optional(Type.Number()),
    isDefault: Type.Optional(Type.Boolean()), // Default lane for new cards
    isDoneLane: Type.Optional(Type.Boolean()), // Enables time filtering

    // Cards are stored as IDs, actual card data in separate map
    cardIds: Type.Array(Type.String()),
});

export type KanbanLane = Static<typeof KanbanLaneSchema>;

// Done lane reset period
export const DoneResetPeriodSchema = Type.Union([
    Type.Literal('daily'),
    Type.Literal('weekly'),
    Type.Literal('biweekly'),
    Type.Literal('monthly'),
    Type.Literal('never'),
]);

export type DoneResetPeriod = Static<typeof DoneResetPeriodSchema>;

// Done lane reset configuration
export const DoneResetConfigSchema = Type.Object({
    period: DoneResetPeriodSchema,
    dayOfWeek: Type.Optional(Type.Number({ minimum: 0, maximum: 6 })), // 0-6, for weekly
    dayOfMonth: Type.Optional(Type.Number({ minimum: 1, maximum: 31 })), // 1-31, for monthly
});

export type DoneResetConfig = Static<typeof DoneResetConfigSchema>;

// Card display settings
export const CardDisplaySettingsSchema = Type.Object({
    showDueDate: Type.Boolean({ default: true }),
    showPriority: Type.Boolean({ default: true }),
    showCoverColor: Type.Boolean({ default: false }),
});

export type CardDisplaySettings = Static<typeof CardDisplaySettingsSchema>;

// Kanban board settings
export const KanbanSettingsSchema = Type.Object({
    defaultLaneId: Type.Optional(Type.String()),
    cardDisplay: CardDisplaySettingsSchema,
    doneReset: DoneResetConfigSchema,
});

export type KanbanSettings = Static<typeof KanbanSettingsSchema>;

// Full kanban board document stored in MongoDB
export const KanbanBoardSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(), // Same as page.id - UUID for routing
    pageId: Type.String(), // Links to pages collection
    notebookId: Type.String(), // Denormalized for queries

    // Y.Doc state is stored separately
    state: Type.Optional(Type.Any()), // Y.Doc encoded state (Uint8Array stored as Binary)
    version: Type.Number(), // Increments on each update
    settings: KanbanSettingsSchema,

    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type KanbanBoard = Static<typeof KanbanBoardSchema>;

// For creating a new kanban board
export const CreateKanbanBoardSchema = Type.Object({
    pageId: Type.String(),
    notebookId: Type.String(),
    state: Type.Optional(Type.Any()), // Y.Doc encoded state
});

export type CreateKanbanBoardInput = Static<typeof CreateKanbanBoardSchema>;

// For updating kanban board settings
export const UpdateKanbanBoardSchema = Type.Object({
    settings: Type.Optional(KanbanSettingsSchema),
    state: Type.Optional(Type.Any()),
    version: Type.Optional(Type.Number()),
});

export type UpdateKanbanBoardInput = Static<typeof UpdateKanbanBoardSchema>;

// Y.Doc structure for collaborative editing
// This is what's stored inside the Y.Doc, not in MongoDB directly
export const KanbanYDocSchema = Type.Object({
    lanes: Type.Array(KanbanLaneSchema),
    cards: Type.Record(Type.String(), KanbanCardSchema), // cardId -> card
    archived: Type.Array(KanbanCardSchema),
    settings: KanbanSettingsSchema,
});

export type KanbanYDoc = Static<typeof KanbanYDocSchema>;

// Awareness state for collaborative cursors and drag operations
export const KanbanAwarenessStateSchema = Type.Object({
    user: Type.Optional(
        Type.Object({
            id: Type.String(),
            name: Type.String(),
            color: Type.String(),
        }),
    ),
    // Currently dragging card
    draggingCard: Type.Optional(
        Type.Object({
            cardId: Type.String(),
            fromLaneId: Type.String(),
            position: Type.Object({
                x: Type.Number(),
                y: Type.Number(),
            }),
        }),
    ),
    // Card being hovered over
    hoveredCardId: Type.Optional(Type.String()),
    // Lane being hovered over
    hoveredLaneId: Type.Optional(Type.String()),
});

export type KanbanAwarenessState = Static<typeof KanbanAwarenessStateSchema>;

// Kanban board metadata for SSE events (without heavy binary state)
export const KanbanBoardMetadataSchema = Type.Object({
    id: Type.String(),
    pageId: Type.String(),
    version: Type.Number(),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type KanbanBoardMetadata = Static<typeof KanbanBoardMetadataSchema>;

// Y.Doc update message for real-time sync
export const KanbanYDocUpdateSchema = Type.Object({
    type: Type.Literal('kanban-update'),
    boardId: Type.String(),
    update: Type.String(), // Base64-encoded Y.Doc update
    clientId: Type.String(), // Origin client
    version: Type.Number(),
});

export type KanbanYDocUpdate = Static<typeof KanbanYDocUpdateSchema>;

// Initial state message when client connects
export const KanbanYDocInitSchema = Type.Object({
    type: Type.Literal('kanban-init'),
    boardId: Type.String(),
    state: Type.String(), // Base64-encoded full Y.Doc state
    version: Type.Number(),
});

export type KanbanYDocInit = Static<typeof KanbanYDocInitSchema>;

// Default kanban settings
export const DEFAULT_KANBAN_SETTINGS: KanbanSettings = {
    defaultLaneId: undefined,
    cardDisplay: {
        showDueDate: true,
        showPriority: true,
        showCoverColor: false,
    },
    doneReset: {
        period: 'weekly',
        dayOfWeek: 1, // Monday
    },
};

// Default lane IDs
export const DEFAULT_LANE_IDS = {
    TODO: 'todo',
    IN_PROGRESS: 'in-progress',
    DONE: 'done',
    ARCHIVED: 'archived',
} as const;

// Default lanes for new boards
export const DEFAULT_KANBAN_LANES: KanbanLane[] = [
    {
        id: DEFAULT_LANE_IDS.TODO,
        title: 'To Do',
        position: 0,
        isDefault: true,
        cardIds: [],
    },
    {
        id: DEFAULT_LANE_IDS.IN_PROGRESS,
        title: 'In Progress',
        position: 1,
        cardIds: [],
    },
    {
        id: DEFAULT_LANE_IDS.DONE,
        title: 'Done',
        position: 2,
        isDoneLane: true,
        cardIds: [],
    },
];
