# Bot System Integration Plan

## Executive Summary

This document outlines how to integrate the bot system specification into the existing Just-Maple codebase. The integration focuses on two primary features:

1. **@mentions in Chat** - Bot invocations via mentions, responses in threads
2. **Bots/Widgets in Notes** - Bot invocations in documents, responses as inline widgets

---

## Current Architecture Analysis

### Existing Strengths to Leverage

| Component                | Current State                            | Leverage For                          |
| ------------------------ | ---------------------------------------- | ------------------------------------- |
| **TipTap JSON**          | Messages & notes use `NoteContentSchema` | Add mention nodes, widget nodes       |
| **WebSocket**            | Real-time events via `chatWebSocket`     | Bot invocation status, thread updates |
| **Tag-based Auth**       | `hasAccess()`, sharing model             | Bot scoping, access control           |
| **Notification Service** | Push notifications for messages          | Bot mention notifications             |
| **User Resolution**      | `findUserById`, tag members lookup       | @user mention autocomplete            |

### Key Files to Modify

```
packages/shared/src/schemas/
├── bot.ts           # NEW: Bot, BotInvocation, Action schemas
├── thread.ts        # NEW: Thread schema
├── message.ts       # MODIFY: Add threadId, senderType, mentions
├── note.ts          # MODIFY: Add widgetStates
└── index.ts         # MODIFY: Export new schemas

apps/api/src/
├── repositories/
│   ├── bot.repo.ts        # NEW
│   ├── thread.repo.ts     # NEW
│   └── invocation.repo.ts # NEW
├── routes/
│   ├── bots.ts            # NEW
│   └── messages.ts        # MODIFY: Thread endpoints
├── services/
│   ├── bot-executor.ts    # NEW
│   ├── mention-parser.ts  # NEW
│   └── realtime.service.ts # MODIFY: Bot events
└── ws/
    └── chat.ws.ts         # MODIFY: Thread/bot events

apps/web/src/app/
├── components/
│   ├── atoms/
│   │   └── bot-output/          # NEW: UI component renderer
│   ├── molecules/
│   │   └── mention-suggester/   # NEW: @mention autocomplete
│   └── organisms/
│       ├── chat/
│       │   ├── chat-thread.component.ts  # NEW
│       │   └── chat.component.ts         # MODIFY
│       └── note-editor/
│           └── extensions/
│               ├── mention.extension.ts  # NEW
│               └── bot-widget.extension.ts # NEW
├── services/
│   ├── bot.service.ts           # NEW
│   └── thread.service.ts        # NEW
└── editor/
    └── extensions/              # NEW: Shared TipTap extensions
```

---

## Phase 1: Data Model Extensions

### 1.1 Bot Schema (`packages/shared/src/schemas/bot.ts`)

```typescript
import { Type, Static } from '@sinclair/typebox';

// ============================================
// UI Component Types (Simplified for v1)
// ============================================

export const UIComponentTypeSchema = Type.Union([
    Type.Literal('text'),
    Type.Literal('markdown'),
    Type.Literal('code'),
    Type.Literal('list'),
    Type.Literal('status'),
    Type.Literal('button'),
    Type.Literal('divider'),
    Type.Literal('card'),
]);

export type UIComponentType = Static<typeof UIComponentTypeSchema>;

// Base UI component
export const UIComponentSchema = Type.Recursive((Self) =>
    Type.Object({
        id: Type.String(),
        type: UIComponentTypeSchema,
        condition: Type.Optional(Type.String()),
        // Type-specific properties stored in a flexible way
        props: Type.Optional(Type.Record(Type.String(), Type.Any())),
        children: Type.Optional(Type.Array(Self)),
    }),
);

export type UIComponent = Static<typeof UIComponentSchema>;

// ============================================
// Action Types (v1: LLM, Set, Transform only)
// ============================================

export const ActionTypeSchema = Type.Union([
    Type.Literal('llm'),
    Type.Literal('set'),
    Type.Literal('transform'),
    Type.Literal('http'),
]);

export type ActionType = Static<typeof ActionTypeSchema>;

export const ActionSchema = Type.Object({
    type: ActionTypeSchema,
    id: Type.String(),
    // Type-specific properties
    config: Type.Record(Type.String(), Type.Any()),
    outputVariable: Type.Optional(Type.String()),
});

export type Action = Static<typeof ActionSchema>;

// ============================================
// Bot Definition
// ============================================

export const BotTriggerSchema = Type.Object({
    mentionPatterns: Type.Optional(Type.Array(Type.String())),
});

export type BotTrigger = Static<typeof BotTriggerSchema>;

export const BotInputSchema = Type.Object({
    includeContext: Type.Object({
        mentionText: Type.Optional(Type.Boolean()),
        fullMessage: Type.Optional(Type.Boolean()),
        documentContent: Type.Optional(Type.Boolean()),
        documentTitle: Type.Optional(Type.Boolean()),
        previousMessages: Type.Optional(Type.Number()),
        selection: Type.Optional(Type.Boolean()),
    }),
});

export type BotInput = Static<typeof BotInputSchema>;

export const BotOutputSchema = Type.Object({
    chatView: Type.Optional(
        Type.Object({
            components: Type.Array(UIComponentSchema),
        }),
    ),
    noteView: Type.Optional(
        Type.Object({
            components: Type.Array(UIComponentSchema),
            width: Type.Optional(
                Type.Union([
                    Type.Literal('narrow'),
                    Type.Literal('medium'),
                    Type.Literal('wide'),
                    Type.Literal('full'),
                ]),
            ),
            collapsible: Type.Optional(Type.Boolean()),
        }),
    ),
});

export type BotOutput = Static<typeof BotOutputSchema>;

export const BotDefinitionSchema = Type.Object({
    trigger: BotTriggerSchema,
    input: BotInputSchema,
    actions: Type.Array(ActionSchema),
    output: BotOutputSchema,
    onError: Type.Optional(
        Type.Object({
            retryCount: Type.Optional(Type.Number()),
            fallbackMessage: Type.Optional(Type.String()),
        }),
    ),
});

export type BotDefinition = Static<typeof BotDefinitionSchema>;

// ============================================
// Bot Entity
// ============================================

export const BotSchema = Type.Object({
    _id: Type.String(),
    name: Type.String(),
    handle: Type.String(), // @mention handle (unique)
    description: Type.Optional(Type.String()),
    avatar: Type.Optional(Type.String()), // URL or emoji
    definition: BotDefinitionSchema,
    tagId: Type.Optional(Type.String()), // Scope to tag (null = global)
    createdBy: Type.String(),
    isGlobal: Type.Boolean(),
    isEnabled: Type.Boolean(),
    version: Type.Number(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Bot = Static<typeof BotSchema>;

// ============================================
// Bot Invocation
// ============================================

export const InvocationStatusSchema = Type.Union([
    Type.Literal('pending'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
]);

export type InvocationStatus = Static<typeof InvocationStatusSchema>;

export const BotInvocationSchema = Type.Object({
    _id: Type.String(),
    botId: Type.String(),
    botVersion: Type.Number(),
    sourceType: Type.Union([Type.Literal('message'), Type.Literal('note')]),
    sourceId: Type.String(),
    tagId: Type.String(),
    userId: Type.String(),
    context: Type.Object({
        mentionText: Type.Optional(Type.String()),
        fullContent: Type.Optional(Type.String()),
        documentTitle: Type.Optional(Type.String()),
        selection: Type.Optional(Type.String()),
        previousMessages: Type.Optional(Type.Array(Type.Any())),
    }),
    variables: Type.Record(Type.String(), Type.Any()),
    output: Type.Optional(Type.Any()),
    status: InvocationStatusSchema,
    error: Type.Optional(
        Type.Object({
            code: Type.String(),
            message: Type.String(),
            step: Type.Optional(Type.String()),
        }),
    ),
    threadId: Type.Optional(Type.String()),
    widgetId: Type.Optional(Type.String()),
    executionTimeMs: Type.Optional(Type.Number()),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type BotInvocation = Static<typeof BotInvocationSchema>;
```

### 1.2 Thread Schema (`packages/shared/src/schemas/thread.ts`)

```typescript
import { Type, Static } from '@sinclair/typebox';

export const ThreadSchema = Type.Object({
    _id: Type.String(),
    parentMessageId: Type.String(),
    tagId: Type.String(),
    botInvocationId: Type.Optional(Type.String()),
    messageCount: Type.Number(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Thread = Static<typeof ThreadSchema>;
```

### 1.3 Message Schema Extensions

**Modify `packages/shared/src/schemas/message.ts`:**

```typescript
// Add to existing MessageSchema:

// Parsed mention in content
export const MentionSchema = Type.Object({
    type: Type.Union([Type.Literal('user'), Type.Literal('bot')]),
    id: Type.String(),
    handle: Type.String(),
    startIndex: Type.Number(),
    endIndex: Type.Number(),
});

export type Mention = Static<typeof MentionSchema>;

// Sender types
export const SenderTypeSchema = Type.Union([
    Type.Literal('user'),
    Type.Literal('bot'),
    Type.Literal('system'),
]);

export type SenderType = Static<typeof SenderTypeSchema>;

// Extended MessageSchema with thread and mention support
export const MessageSchema = Type.Object({
    _id: Type.String(),
    tagId: Type.String(),
    threadId: Type.Optional(Type.String()), // NEW: null = top-level
    userId: Type.String(),
    senderType: Type.Optional(SenderTypeSchema), // NEW: defaults to 'user'
    botId: Type.Optional(Type.String()), // NEW: if senderType = 'bot'
    senderEmail: Type.Optional(Type.String()),
    senderDisplayName: Type.Optional(Type.String()),
    senderProfilePictureUrl: Type.Optional(Type.String()),
    content: NoteContentSchema,
    mentions: Type.Optional(Type.Array(MentionSchema)), // NEW: parsed mentions
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
    editedAt: Type.Optional(Type.String({ format: 'date-time' })),
    deletedAt: Type.Optional(Type.String({ format: 'date-time' })),
});

// Add to ChatActionSchema:
export const ChatActionSchema = Type.Union([
    Type.Literal('message'),
    Type.Literal('typing'),
    Type.Literal('edited'),
    Type.Literal('deleted'),
    Type.Literal('thread_created'), // NEW
    Type.Literal('thread_message'), // NEW
    Type.Literal('bot_invocation'), // NEW
    Type.Literal('paper_created'),
    Type.Literal('paper_updated'),
    Type.Literal('paper_deleted'),
]);
```

### 1.4 Note Schema Extensions

**Modify `packages/shared/src/schemas/note.ts`:**

```typescript
// Add widget state tracking
export const WidgetStateSchema = Type.Object({
    type: Type.Literal('bot-output'),
    botId: Type.String(),
    invocationId: Type.String(),
    output: Type.Optional(Type.Any()),
    components: Type.Optional(Type.Array(Type.Any())),
    status: Type.Union([
        Type.Literal('pending'),
        Type.Literal('running'),
        Type.Literal('completed'),
        Type.Literal('failed'),
    ]),
    createdAt: Type.String({ format: 'date-time' }),
});

export type WidgetState = Static<typeof WidgetStateSchema>;

// Add to NoteSchema:
export const NoteSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    type: NoteTypeSchema,
    title: Type.String(),
    content: NoteContentSchema,
    widgetStates: Type.Optional(Type.Record(Type.String(), WidgetStateSchema)), // NEW
    version: Type.Number(),
    tagId: Type.Optional(Type.String()),
    // ... rest unchanged
});
```

---

## Phase 2: @Mention Infrastructure

### 2.1 Mention Parser Utility

**Create `packages/shared/src/utils/mention-parser.ts`:**

```typescript
export interface ParsedMention {
    type: 'user' | 'bot';
    id: string;
    handle: string;
    startIndex: number;
    endIndex: number;
    contextAfter: string;
}

/**
 * Parse mentions from TipTap JSON content
 */
export function parseMentionsFromContent(
    content: any,
    knownBots: Map<string, string>, // handle -> id
    knownUsers: Map<string, string>, // handle -> id
): ParsedMention[] {
    const mentions: ParsedMention[] = [];

    function traverse(node: any, textOffset: number = 0): number {
        if (!node) return textOffset;

        // Check if this is a mention node
        if (node.type === 'mention') {
            const attrs = node.attrs || {};
            mentions.push({
                type: attrs.mentionType || 'user',
                id: attrs.id,
                handle: attrs.handle,
                startIndex: textOffset,
                endIndex: textOffset + (attrs.handle?.length || 0) + 1,
                contextAfter: '', // Will be filled in post-processing
            });
            return textOffset + (attrs.handle?.length || 0) + 1;
        }

        // Handle text nodes
        if (node.type === 'text' && node.text) {
            return textOffset + node.text.length;
        }

        // Recurse into children
        if (node.content && Array.isArray(node.content)) {
            let offset = textOffset;
            for (const child of node.content) {
                offset = traverse(child, offset);
            }
            return offset;
        }

        return textOffset;
    }

    traverse(content);
    return mentions;
}

/**
 * Extract plain text from TipTap JSON content
 */
export function extractTextFromContent(content: any): string {
    if (!content) return '';

    let text = '';

    function traverse(node: any): void {
        if (!node) return;

        if (node.type === 'text' && node.text) {
            text += node.text;
        } else if (node.type === 'mention') {
            text += `@${node.attrs?.handle || ''}`;
        } else if (node.type === 'paragraph' || node.type === 'heading') {
            if (text.length > 0 && !text.endsWith('\n')) {
                text += '\n';
            }
        }

        if (node.content && Array.isArray(node.content)) {
            for (const child of node.content) {
                traverse(child);
            }
        }
    }

    traverse(content);
    return text.trim();
}
```

### 2.2 TipTap Mention Extension

**Create `apps/web/src/app/editor/extensions/mention.extension.ts`:**

```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';

export interface MentionOptions {
    HTMLAttributes: Record<string, any>;
    suggestion: Omit<SuggestionOptions, 'editor'>;
    renderLabel: (props: { options: MentionOptions; node: any }) => string;
}

export interface MentionItem {
    id: string;
    handle: string;
    type: 'user' | 'bot';
    displayName?: string;
    avatar?: string;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        mention: {
            insertMention: (item: MentionItem) => ReturnType;
        };
    }
}

export const Mention = Node.create<MentionOptions>({
    name: 'mention',
    group: 'inline',
    inline: true,
    selectable: false,
    atom: true,

    addOptions() {
        return {
            HTMLAttributes: {},
            renderLabel({ node }) {
                return `@${node.attrs.handle}`;
            },
            suggestion: {
                char: '@',
                pluginKey: new PluginKey('mention'),
                command: ({ editor, range, props }) => {
                    // Insert the mention
                    editor
                        .chain()
                        .focus()
                        .insertContentAt(range, [
                            {
                                type: this.name,
                                attrs: props,
                            },
                            { type: 'text', text: ' ' },
                        ])
                        .run();
                },
            },
        };
    },

    addAttributes() {
        return {
            id: {
                default: null,
                parseHTML: (element) => element.getAttribute('data-id'),
                renderHTML: (attrs) => ({ 'data-id': attrs.id }),
            },
            handle: {
                default: null,
                parseHTML: (element) => element.getAttribute('data-handle'),
                renderHTML: (attrs) => ({ 'data-handle': attrs.handle }),
            },
            mentionType: {
                default: 'user',
                parseHTML: (element) => element.getAttribute('data-type'),
                renderHTML: (attrs) => ({ 'data-type': attrs.mentionType }),
            },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-mention]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const label = this.options.renderLabel({ options: this.options, node });
        const typeClass = node.attrs.mentionType === 'bot' ? 'mention-bot' : 'mention-user';

        return [
            'span',
            mergeAttributes(
                { 'data-mention': '' },
                { class: `mention ${typeClass}` },
                this.options.HTMLAttributes,
                HTMLAttributes,
            ),
            label,
        ];
    },

    renderText({ node }) {
        return this.options.renderLabel({ options: this.options, node });
    },

    addCommands() {
        return {
            insertMention:
                (item: MentionItem) =>
                ({ commands }) => {
                    return commands.insertContent({
                        type: this.name,
                        attrs: {
                            id: item.id,
                            handle: item.handle,
                            mentionType: item.type,
                        },
                    });
                },
        };
    },

    addKeyboardShortcuts() {
        return {
            Backspace: () =>
                this.editor.commands.command(({ tr, state }) => {
                    let isMention = false;
                    const { selection } = state;
                    const { empty, anchor } = selection;

                    if (!empty) return false;

                    state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
                        if (node.type.name === this.name) {
                            isMention = true;
                            tr.insertText('', pos, pos + node.nodeSize);
                            return false;
                        }
                    });

                    return isMention;
                }),
        };
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
        ];
    },
});
```

### 2.3 Mention Suggester Component

**Create `apps/web/src/app/components/molecules/mention-suggester/`:**

```typescript
// mention-suggester.component.ts
import { Component, input, output, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface MentionSuggestion {
    id: string;
    handle: string;
    type: 'user' | 'bot';
    displayName?: string;
    avatar?: string;
    description?: string;
}

@Component({
    selector: 'app-mention-suggester',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './mention-suggester.component.html',
    styleUrl: './mention-suggester.component.scss',
})
export class MentionSuggesterComponent {
    readonly items = input.required<MentionSuggestion[]>();
    readonly selectedIndex = input<number>(0);
    readonly command = output<MentionSuggestion>();

    readonly groupedItems = computed(() => {
        const items = this.items();
        const bots = items.filter((i) => i.type === 'bot');
        const users = items.filter((i) => i.type === 'user');
        return { bots, users };
    });

    selectItem(item: MentionSuggestion): void {
        this.command.emit(item);
    }

    isSelected(index: number): boolean {
        return this.selectedIndex() === index;
    }
}
```

```html
<!-- mention-suggester.component.html -->
<div class="mention-suggester">
    @if (groupedItems().bots.length > 0) {
    <div class="mention-group">
        <div class="mention-group-label">Bots</div>
        @for (item of groupedItems().bots; track item.id; let i = $index) {
        <button class="mention-item" [class.selected]="isSelected(i)" (click)="selectItem(item)">
            <span class="mention-avatar">{{ item.avatar || '🤖' }}</span>
            <span class="mention-handle">@{{ item.handle }}</span>
            @if (item.description) {
            <span class="mention-description">{{ item.description }}</span>
            }
        </button>
        }
    </div>
    } @if (groupedItems().users.length > 0) {
    <div class="mention-group">
        <div class="mention-group-label">People</div>
        @for (item of groupedItems().users; track item.id; let i = $index) {
        <button
            class="mention-item"
            [class.selected]="isSelected(i + groupedItems().bots.length)"
            (click)="selectItem(item)"
        >
            @if (item.avatar) {
            <img [src]="item.avatar" class="mention-avatar-img" />
            } @else {
            <span class="mention-avatar">👤</span>
            }
            <span class="mention-handle">@{{ item.handle }}</span>
            @if (item.displayName) {
            <span class="mention-name">{{ item.displayName }}</span>
            }
        </button>
        }
    </div>
    } @if (items().length === 0) {
    <div class="mention-empty">No matches found</div>
    }
</div>
```

---

## Phase 3: Bot System Core

### 3.1 Bot Repository

**Create `apps/api/src/repositories/bot.repo.ts`:**

```typescript
import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { Bot, BotDefinition } from '@maple/shared';

interface BotDocument {
    _id: ObjectId;
    name: string;
    handle: string;
    description?: string;
    avatar?: string;
    definition: BotDefinition;
    tagId?: ObjectId;
    createdBy: ObjectId;
    isGlobal: boolean;
    isEnabled: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<BotDocument> {
    return getDb().collection<BotDocument>('bots');
}

function toBot(doc: BotDocument): Bot {
    return {
        _id: doc._id.toString(),
        name: doc.name,
        handle: doc.handle,
        description: doc.description,
        avatar: doc.avatar,
        definition: doc.definition,
        tagId: doc.tagId?.toString(),
        createdBy: doc.createdBy.toString(),
        isGlobal: doc.isGlobal,
        isEnabled: doc.isEnabled,
        version: doc.version,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

export async function findBotByHandle(handle: string): Promise<Bot | null> {
    const doc = await getCollection().findOne({
        handle: handle.toLowerCase(),
        isEnabled: true,
    });
    return doc ? toBot(doc) : null;
}

export async function findBotsForTag(tagId: string, userId: string): Promise<Bot[]> {
    const docs = await getCollection()
        .find({
            $or: [
                { isGlobal: true },
                { tagId: new ObjectId(tagId) },
                { createdBy: new ObjectId(userId) },
            ],
            isEnabled: true,
        })
        .toArray();
    return docs.map(toBot);
}

export async function findBotById(id: string): Promise<Bot | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toBot(doc) : null;
    } catch {
        return null;
    }
}

export async function createBot(
    data: Omit<Bot, '_id' | 'createdAt' | 'updatedAt' | 'version'>,
): Promise<Bot> {
    const now = new Date();
    const doc: Omit<BotDocument, '_id'> = {
        name: data.name,
        handle: data.handle.toLowerCase(),
        description: data.description,
        avatar: data.avatar,
        definition: data.definition,
        tagId: data.tagId ? new ObjectId(data.tagId) : undefined,
        createdBy: new ObjectId(data.createdBy),
        isGlobal: data.isGlobal,
        isEnabled: data.isEnabled,
        version: 1,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as BotDocument);
    return toBot({ ...doc, _id: result.insertedId } as BotDocument);
}

export async function searchBots(
    query: string,
    tagId: string,
    userId: string,
    limit: number = 10,
): Promise<Bot[]> {
    const searchRegex = new RegExp(query, 'i');
    const docs = await getCollection()
        .find({
            $or: [
                { isGlobal: true },
                { tagId: new ObjectId(tagId) },
                { createdBy: new ObjectId(userId) },
            ],
            isEnabled: true,
            $or: [{ handle: searchRegex }, { name: searchRegex }],
        })
        .limit(limit)
        .toArray();
    return docs.map(toBot);
}
```

### 3.2 Bot Invocation Repository

**Create `apps/api/src/repositories/invocation.repo.ts`:**

```typescript
import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { BotInvocation, InvocationStatus } from '@maple/shared';

interface InvocationDocument {
    _id: ObjectId;
    botId: ObjectId;
    botVersion: number;
    sourceType: 'message' | 'note';
    sourceId: ObjectId;
    tagId: ObjectId;
    userId: ObjectId;
    context: {
        mentionText?: string;
        fullContent?: string;
        documentTitle?: string;
        selection?: string;
        previousMessages?: any[];
    };
    variables: Record<string, any>;
    output?: any;
    status: InvocationStatus;
    error?: {
        code: string;
        message: string;
        step?: string;
    };
    threadId?: ObjectId;
    widgetId?: string;
    executionTimeMs?: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<InvocationDocument> {
    return getDb().collection<InvocationDocument>('bot_invocations');
}

function toInvocation(doc: InvocationDocument): BotInvocation {
    return {
        _id: doc._id.toString(),
        botId: doc.botId.toString(),
        botVersion: doc.botVersion,
        sourceType: doc.sourceType,
        sourceId: doc.sourceId.toString(),
        tagId: doc.tagId.toString(),
        userId: doc.userId.toString(),
        context: doc.context,
        variables: doc.variables,
        output: doc.output,
        status: doc.status,
        error: doc.error,
        threadId: doc.threadId?.toString(),
        widgetId: doc.widgetId,
        executionTimeMs: doc.executionTimeMs,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

export async function createInvocation(
    data: Omit<BotInvocation, '_id' | 'createdAt' | 'updatedAt'>,
): Promise<BotInvocation> {
    const now = new Date();
    const doc: Omit<InvocationDocument, '_id'> = {
        botId: new ObjectId(data.botId),
        botVersion: data.botVersion,
        sourceType: data.sourceType,
        sourceId: new ObjectId(data.sourceId),
        tagId: new ObjectId(data.tagId),
        userId: new ObjectId(data.userId),
        context: data.context,
        variables: data.variables,
        output: data.output,
        status: data.status,
        error: data.error,
        threadId: data.threadId ? new ObjectId(data.threadId) : undefined,
        widgetId: data.widgetId,
        executionTimeMs: data.executionTimeMs,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as InvocationDocument);
    return toInvocation({ ...doc, _id: result.insertedId } as InvocationDocument);
}

export async function updateInvocationStatus(
    id: string,
    status: InvocationStatus,
    updates?: Partial<
        Pick<
            BotInvocation,
            'output' | 'error' | 'threadId' | 'widgetId' | 'executionTimeMs' | 'variables'
        >
    >,
): Promise<BotInvocation | null> {
    try {
        const updateDoc: any = {
            status,
            updatedAt: new Date(),
        };

        if (updates?.output !== undefined) updateDoc.output = updates.output;
        if (updates?.error !== undefined) updateDoc.error = updates.error;
        if (updates?.threadId) updateDoc.threadId = new ObjectId(updates.threadId);
        if (updates?.widgetId) updateDoc.widgetId = updates.widgetId;
        if (updates?.executionTimeMs !== undefined)
            updateDoc.executionTimeMs = updates.executionTimeMs;
        if (updates?.variables) updateDoc.variables = updates.variables;

        const result = await getCollection().findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: updateDoc },
            { returnDocument: 'after' },
        );

        return result ? toInvocation(result) : null;
    } catch {
        return null;
    }
}

export async function findInvocationById(id: string): Promise<BotInvocation | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toInvocation(doc) : null;
    } catch {
        return null;
    }
}
```

### 3.3 Bot Executor Service

**Create `apps/api/src/services/bot-executor.ts`:**

```typescript
import type { Bot, BotInvocation, Action } from '@maple/shared';
import { findBotById } from '../repositories/bot.repo';
import { findInvocationById, updateInvocationStatus } from '../repositories/invocation.repo';
import { broadcastChatEvent } from './realtime.service';

interface ExecutionContext {
    invocation: BotInvocation;
    bot: Bot;
    variables: Record<string, any>;
}

export class BotExecutor {
    async execute(invocationId: string): Promise<void> {
        const startTime = Date.now();
        const invocation = await findInvocationById(invocationId);
        if (!invocation) throw new Error('Invocation not found');

        const bot = await findBotById(invocation.botId);
        if (!bot) throw new Error('Bot not found');

        const ctx: ExecutionContext = {
            invocation,
            bot,
            variables: {
                // Built-in context variables
                $mentionText: invocation.context.mentionText,
                $content: invocation.context.fullContent,
                $documentTitle: invocation.context.documentTitle,
                $selection: invocation.context.selection,
                $previousMessages: invocation.context.previousMessages,
                $userId: invocation.userId,
                $tagId: invocation.tagId,
                $sourceType: invocation.sourceType,
                $sourceId: invocation.sourceId,
            },
        };

        try {
            // Broadcast running status
            await updateInvocationStatus(invocationId, 'running');
            this.broadcastStatus(invocation, 'running');

            // Execute actions sequentially
            for (const action of bot.definition.actions) {
                await this.executeAction(action, ctx);
            }

            // Calculate execution time
            const executionTimeMs = Date.now() - startTime;

            // Update with completed status and output
            const output = this.prepareOutput(ctx);
            await updateInvocationStatus(invocationId, 'completed', {
                output,
                executionTimeMs,
                variables: ctx.variables,
            });

            // Deliver output based on source type
            await this.deliverOutput(invocation, output, ctx);

            this.broadcastStatus(invocation, 'completed', output);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await updateInvocationStatus(invocationId, 'failed', {
                error: {
                    code: 'EXECUTION_ERROR',
                    message: errorMessage,
                },
                executionTimeMs: Date.now() - startTime,
            });
            this.broadcastStatus(invocation, 'failed', undefined, errorMessage);
            throw error;
        }
    }

    private async executeAction(action: Action, ctx: ExecutionContext): Promise<void> {
        switch (action.type) {
            case 'llm':
                await this.executeLLM(action, ctx);
                break;
            case 'set':
                this.executeSet(action, ctx);
                break;
            case 'transform':
                this.executeTransform(action, ctx);
                break;
            case 'http':
                await this.executeHTTP(action, ctx);
                break;
            default:
                console.warn(`Unknown action type: ${action.type}`);
        }
    }

    private async executeLLM(action: Action, ctx: ExecutionContext): Promise<void> {
        const config = action.config as {
            systemPrompt?: string;
            userPrompt: string;
            model?: string;
            temperature?: number;
            maxTokens?: number;
            outputFormat?: 'text' | 'json' | 'markdown';
            jsonSchema?: any;
        };

        const userPrompt = this.interpolate(config.userPrompt, ctx.variables);
        const systemPrompt = config.systemPrompt
            ? this.interpolate(config.systemPrompt, ctx.variables)
            : undefined;

        // TODO: Integrate with actual LLM service
        // For now, placeholder implementation
        const response = await this.callLLM({
            model: config.model,
            systemPrompt,
            userPrompt,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
        });

        const output = config.outputFormat === 'json' ? JSON.parse(response) : response;

        if (action.outputVariable) {
            ctx.variables[action.outputVariable] = output;
        }
    }

    private executeSet(action: Action, ctx: ExecutionContext): void {
        const config = action.config as { variable: string; value: any };
        const value =
            typeof config.value === 'string'
                ? this.interpolate(config.value, ctx.variables)
                : config.value;
        ctx.variables[config.variable] = value;
    }

    private executeTransform(action: Action, ctx: ExecutionContext): void {
        const config = action.config as {
            input: string;
            operations: Array<{ op: string; args?: any }>;
        };

        let value = this.resolveVariable(config.input, ctx.variables);

        for (const op of config.operations) {
            value = this.applyTransformOperation(value, op);
        }

        if (action.outputVariable) {
            ctx.variables[action.outputVariable] = value;
        }
    }

    private async executeHTTP(action: Action, ctx: ExecutionContext): Promise<void> {
        const config = action.config as {
            method: string;
            url: string;
            headers?: Record<string, string>;
            body?: any;
            timeout?: number;
        };

        const url = this.interpolate(config.url, ctx.variables);
        const headers = config.headers
            ? Object.fromEntries(
                  Object.entries(config.headers).map(([k, v]) => [
                      k,
                      this.interpolate(v, ctx.variables),
                  ]),
              )
            : undefined;

        const response = await fetch(url, {
            method: config.method,
            headers,
            body: config.body
                ? JSON.stringify(this.interpolateObject(config.body, ctx.variables))
                : undefined,
        });

        const data = await response.json();

        if (action.outputVariable) {
            ctx.variables[action.outputVariable] = data;
        }
    }

    private interpolate(template: string, variables: Record<string, any>): string {
        return template.replace(/\{\{(\$?\w+(?:\.\w+)*)\}\}/g, (_, path) => {
            const value = this.getNestedValue(variables, path);
            return value !== undefined ? String(value) : '';
        });
    }

    private interpolateObject(obj: any, variables: Record<string, any>): any {
        if (typeof obj === 'string') {
            return this.interpolate(obj, variables);
        }
        if (Array.isArray(obj)) {
            return obj.map((item) => this.interpolateObject(item, variables));
        }
        if (typeof obj === 'object' && obj !== null) {
            return Object.fromEntries(
                Object.entries(obj).map(([k, v]) => [k, this.interpolateObject(v, variables)]),
            );
        }
        return obj;
    }

    private resolveVariable(ref: string, variables: Record<string, any>): any {
        const match = ref.match(/\{\{(\$?\w+(?:\.\w+)*)\}\}/);
        if (!match) return ref;
        return this.getNestedValue(variables, match[1]);
    }

    private getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((acc, key) => acc?.[key], obj);
    }

    private applyTransformOperation(value: any, op: { op: string; args?: any }): any {
        switch (op.op) {
            case 'map':
                return Array.isArray(value)
                    ? value.map((item: any) => (op.args ? item[op.args] : item))
                    : value;
            case 'filter':
                return Array.isArray(value) ? value.filter((item: any) => item[op.args]) : value;
            case 'slice':
                return Array.isArray(value) ? value.slice(op.args?.start, op.args?.end) : value;
            case 'join':
                return Array.isArray(value) ? value.join(op.args || ', ') : value;
            case 'split':
                return typeof value === 'string' ? value.split(op.args || ',') : value;
            case 'parse_json':
                return typeof value === 'string' ? JSON.parse(value) : value;
            case 'stringify':
                return JSON.stringify(value);
            default:
                return value;
        }
    }

    private prepareOutput(ctx: ExecutionContext): any {
        const outputDef = ctx.bot.definition.output;
        const viewDef =
            ctx.invocation.sourceType === 'message' ? outputDef.chatView : outputDef.noteView;

        if (!viewDef) return null;

        return {
            components: viewDef.components,
            data: ctx.variables,
        };
    }

    private async deliverOutput(
        invocation: BotInvocation,
        output: any,
        ctx: ExecutionContext,
    ): Promise<void> {
        if (invocation.sourceType === 'message') {
            // Create thread reply - handled by caller
        } else {
            // Update note widget - handled by caller
        }
    }

    private broadcastStatus(
        invocation: BotInvocation,
        status: string,
        output?: any,
        error?: string,
    ): void {
        broadcastChatEvent(invocation.tagId, {
            action: 'bot_invocation' as any,
            data: {
                invocationId: invocation._id,
                botId: invocation.botId,
                status,
                output,
                error,
            },
            tagId: invocation.tagId,
            userId: invocation.userId,
            timestamp: new Date().toISOString(),
        }).catch(console.error);
    }

    private async callLLM(params: {
        model?: string;
        systemPrompt?: string;
        userPrompt: string;
        temperature?: number;
        maxTokens?: number;
    }): Promise<string> {
        // TODO: Implement actual LLM integration
        // This is a placeholder that should be replaced with actual API calls
        return `[LLM Response placeholder for: ${params.userPrompt.slice(0, 50)}...]`;
    }
}

export const botExecutor = new BotExecutor();
```

---

## Phase 4: Thread System

### 4.1 Thread Repository

**Create `apps/api/src/repositories/thread.repo.ts`:**

```typescript
import { ObjectId, Collection } from 'mongodb';
import { getDb } from '../db/client';
import type { Thread } from '@maple/shared';

interface ThreadDocument {
    _id: ObjectId;
    parentMessageId: ObjectId;
    tagId: ObjectId;
    botInvocationId?: ObjectId;
    messageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

function getCollection(): Collection<ThreadDocument> {
    return getDb().collection<ThreadDocument>('threads');
}

function toThread(doc: ThreadDocument): Thread {
    return {
        _id: doc._id.toString(),
        parentMessageId: doc.parentMessageId.toString(),
        tagId: doc.tagId.toString(),
        botInvocationId: doc.botInvocationId?.toString(),
        messageCount: doc.messageCount,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

export async function findThreadByParentMessage(messageId: string): Promise<Thread | null> {
    try {
        const doc = await getCollection().findOne({
            parentMessageId: new ObjectId(messageId),
        });
        return doc ? toThread(doc) : null;
    } catch {
        return null;
    }
}

export async function createThread(data: {
    parentMessageId: string;
    tagId: string;
    botInvocationId?: string;
}): Promise<Thread> {
    const now = new Date();
    const doc: Omit<ThreadDocument, '_id'> = {
        parentMessageId: new ObjectId(data.parentMessageId),
        tagId: new ObjectId(data.tagId),
        botInvocationId: data.botInvocationId ? new ObjectId(data.botInvocationId) : undefined,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
    };

    const result = await getCollection().insertOne(doc as ThreadDocument);
    return toThread({ ...doc, _id: result.insertedId } as ThreadDocument);
}

export async function incrementThreadMessageCount(threadId: string): Promise<void> {
    await getCollection().updateOne(
        { _id: new ObjectId(threadId) },
        {
            $inc: { messageCount: 1 },
            $set: { updatedAt: new Date() },
        },
    );
}

export async function findThreadById(id: string): Promise<Thread | null> {
    try {
        const doc = await getCollection().findOne({ _id: new ObjectId(id) });
        return doc ? toThread(doc) : null;
    } catch {
        return null;
    }
}
```

### 4.2 Extended Message Routes

**Modify `apps/api/src/routes/messages.ts` to add:**

```typescript
// Add to imports
import { findThreadByParentMessage, createThread, findThreadById, incrementThreadMessageCount } from '../repositories/thread.repo';
import { findBotByHandle, searchBots } from '../repositories/bot.repo';
import { createInvocation } from '../repositories/invocation.repo';
import { botExecutor } from '../services/bot-executor';
import { parseMentionsFromContent } from '@maple/shared';

// Add new endpoints:

// Get thread for a message
.get(
    '/messages/:id/thread',
    async ({ auth, params, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const message = await findMessageById(params.id, auth.user._id);
        if (!message) {
            set.status = 404;
            return { error: 'Message not found' };
        }

        const thread = await findThreadByParentMessage(params.id);
        if (!thread) {
            set.status = 404;
            return { error: 'Thread not found' };
        }

        return { thread };
    },
    { params: t.Object({ id: t.String() }) }
)

// Get messages in a thread
.get(
    '/threads/:id/messages',
    async ({ auth, params, query, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const thread = await findThreadById(params.id);
        if (!thread) {
            set.status = 404;
            return { error: 'Thread not found' };
        }

        // Verify user has access to the tag
        const tag = await findTagById(thread.tagId, auth.user._id);
        if (!tag) {
            set.status = 403;
            return { error: 'Access denied' };
        }

        const messages = await findMessagesByThreadId(params.id, {
            limit: query.limit ? parseInt(query.limit) : 50,
            before: query.before,
        });

        return { messages };
    },
    {
        params: t.Object({ id: t.String() }),
        query: t.Object({
            limit: t.Optional(t.String()),
            before: t.Optional(t.String()),
        }),
    }
)

// Post message to thread
.post(
    '/threads/:id/messages',
    async ({ auth, params, body, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const thread = await findThreadById(params.id);
        if (!thread) {
            set.status = 404;
            return { error: 'Thread not found' };
        }

        // Verify write access
        const tag = await findTagByIdWithAccess(thread.tagId, auth.user._id, 'write');
        if (!tag) {
            set.status = 403;
            return { error: 'Access denied' };
        }

        // Create message with threadId
        const message = await createMessageInThread(
            thread.tagId,
            params.id,
            auth.user._id,
            body,
            auth.user.email,
            auth.user.displayName,
            auth.user.profilePictureUrl
        );

        await incrementThreadMessageCount(params.id);

        // Broadcast
        const chatEvent: ChatEvent = {
            action: 'thread_message' as any,
            data: { threadId: params.id, message },
            tagId: thread.tagId,
            userId: auth.user._id,
            timestamp: new Date().toISOString(),
        };
        broadcastChatEvent(thread.tagId, chatEvent).catch(console.error);

        return { message };
    },
    {
        params: t.Object({ id: t.String() }),
        body: t.Object({ content: t.Any() }),
    }
)

// Search bots for autocomplete
.get(
    '/tags/:id/bots/search',
    async ({ auth, params, query, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const tag = await findTagById(params.id, auth.user._id);
        if (!tag) {
            set.status = 404;
            return { error: 'Tag not found' };
        }

        const bots = await searchBots(
            query.q || '',
            params.id,
            auth.user._id,
            10
        );

        return { bots };
    },
    {
        params: t.Object({ id: t.String() }),
        query: t.Object({ q: t.Optional(t.String()) }),
    }
)
```

---

## Phase 5: Widget System for Notes

### 5.1 Bot Widget TipTap Extension

**Create `apps/web/src/app/editor/extensions/bot-widget.extension.ts`:**

```typescript
import { Node, mergeAttributes } from '@tiptap/core';

export interface BotWidgetOptions {
    HTMLAttributes: Record<string, any>;
    onWidgetClick?: (widgetId: string) => void;
}

export const BotWidget = Node.create<BotWidgetOptions>({
    name: 'botWidget',
    group: 'block',
    atom: true,
    draggable: false,

    addOptions() {
        return {
            HTMLAttributes: {},
        };
    },

    addAttributes() {
        return {
            widgetId: { default: null },
            botId: { default: null },
            invocationId: { default: null },
            status: { default: 'pending' },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-bot-widget]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'div',
            mergeAttributes(
                { 'data-bot-widget': '' },
                { class: 'bot-widget' },
                this.options.HTMLAttributes,
                HTMLAttributes,
            ),
        ];
    },

    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('div');
            dom.classList.add('bot-widget');
            dom.dataset.widgetId = node.attrs.widgetId;
            dom.dataset.status = node.attrs.status;

            // Widget content will be rendered by Angular component
            // This is a placeholder for the ProseMirror node
            dom.innerHTML = `
                <div class="bot-widget-placeholder">
                    <span class="bot-widget-loading">Loading bot response...</span>
                </div>
            `;

            return { dom };
        };
    },
});
```

### 5.2 Note Widget States Service

**Create `apps/web/src/app/services/widget.service.ts`:**

```typescript
import { Injectable, inject, signal, computed } from '@angular/core';
import type { WidgetState } from '@maple/shared';
import { HttpClient } from '@angular/common/http';
import { RealtimeService } from './realtime.service';

@Injectable({ providedIn: 'root' })
export class WidgetService {
    private http = inject(HttpClient);
    private realtime = inject(RealtimeService);

    private widgetStates = signal<Map<string, WidgetState>>(new Map());

    getWidgetState(widgetId: string) {
        return computed(() => this.widgetStates().get(widgetId));
    }

    updateWidgetState(widgetId: string, state: WidgetState): void {
        this.widgetStates.update((map) => {
            const newMap = new Map(map);
            newMap.set(widgetId, state);
            return newMap;
        });
    }

    loadWidgetStates(noteId: string): void {
        this.http
            .get<{ widgetStates: Record<string, WidgetState> }>(`/api/notes/${noteId}/widgets`)
            .subscribe({
                next: (response) => {
                    const map = new Map(Object.entries(response.widgetStates || {}));
                    this.widgetStates.set(map);
                },
            });
    }

    subscribeToWidgetUpdates(noteId: string): void {
        // Subscribe to realtime widget updates
        this.realtime.onNoteWidgetUpdate(noteId).subscribe((event) => {
            this.updateWidgetState(event.widgetId, event.widgetState);
        });
    }
}
```

---

## Phase 6: Frontend Components

### 6.1 Bot Output Renderer

**Create `apps/web/src/app/components/atoms/bot-output/bot-output.component.ts`:**

```typescript
import { Component, input, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { UIComponent, BotInvocation } from '@maple/shared';
import { HttpClient } from '@angular/common/http';

@Component({
    selector: 'app-bot-output',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './bot-output.component.html',
    styleUrl: './bot-output.component.scss',
})
export class BotOutputComponent {
    private http = inject(HttpClient);

    readonly invocationId = input.required<string>();

    readonly loading = signal(true);
    readonly error = signal<string | null>(null);
    readonly components = signal<UIComponent[]>([]);
    readonly data = signal<Record<string, any>>({});

    constructor() {
        effect(() => {
            this.loadInvocation(this.invocationId());
        });
    }

    async loadInvocation(id: string): Promise<void> {
        this.loading.set(true);
        this.error.set(null);

        this.http.get<{ invocation: BotInvocation }>(`/api/invocations/${id}`).subscribe({
            next: (response) => {
                const inv = response.invocation;
                if (inv.output?.components) {
                    this.components.set(inv.output.components);
                }
                if (inv.variables) {
                    this.data.set(inv.variables);
                }
                this.loading.set(false);
            },
            error: (err) => {
                this.error.set('Failed to load bot response');
                this.loading.set(false);
            },
        });
    }

    interpolate(template: string): string {
        return template.replace(/\{\{(\$?\w+(?:\.\w+)*)\}\}/g, (_, path) => {
            const parts = path.split('.');
            let value: any = this.data();
            for (const part of parts) {
                value = value?.[part];
            }
            return value !== undefined ? String(value) : '';
        });
    }
}
```

```html
<!-- bot-output.component.html -->
<div class="bot-output" [class.loading]="loading()">
    @if (loading()) {
    <div class="bot-output-loading">
        <span class="spinner"></span>
        <span>Processing...</span>
    </div>
    } @else if (error()) {
    <div class="bot-output-error">
        <span class="error-icon">⚠️</span>
        <span>{{ error() }}</span>
    </div>
    } @else { @for (component of components(); track component.id) {
    <ng-container [ngSwitch]="component.type">
        @case ('text') {
        <p [class]="component.props?.['style'] || 'body'">
            {{ interpolate(component.props?.['content'] || '') }}
        </p>
        } @case ('markdown') {
        <div
            class="markdown-content"
            [innerHTML]="interpolate(component.props?.['content'] || '')"
        ></div>
        } @case ('code') {
        <pre><code [class]="'language-' + (component.props?.['language'] || 'text')">{{
                        interpolate(component.props?.['content'] || '')
                    }}</code></pre>
        } @case ('list') {
        <ul>
            @for (item of resolveArray(component.props?.['items']); track $index) {
            <li>{{ item }}</li>
            }
        </ul>
        } @case ('status') {
        <span class="status-badge" [attr.data-status]="component.props?.['value']">
            {{ component.props?.['label'] || component.props?.['value'] }}
        </span>
        } @case ('button') {
        <button
            class="btn"
            [class]="'btn-' + (component.props?.['variant'] || 'secondary')"
            (click)="handleAction(component.props?.['action'])"
        >
            {{ component.props?.['label'] }}
        </button>
        } @case ('divider') {
        <hr class="divider" />
        } @case ('card') {
        <div class="card">
            @if (component.props?.['title']) {
            <h3 class="card-title">{{ component.props?.['title'] }}</h3>
            } @if (component.children) { @for (child of component.children; track child.id) {
            <!-- Recursive rendering would go here -->
            } }
        </div>
        }
    </ng-container>
    } }
</div>
```

### 6.2 Thread Component

**Create `apps/web/src/app/components/organisms/chat/chat-thread.component.ts`:**

```typescript
import { Component, input, output, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThreadService } from '../../../services/thread.service';
import { ChatMessageComponent } from './chat-message.component';
import { BotOutputComponent } from '../../atoms/bot-output/bot-output.component';
import type { Thread, Message } from '@maple/shared';

@Component({
    selector: 'app-chat-thread',
    standalone: true,
    imports: [CommonModule, ChatMessageComponent, BotOutputComponent],
    templateUrl: './chat-thread.component.html',
    styleUrl: './chat-thread.component.scss',
})
export class ChatThreadComponent {
    private threadService = inject(ThreadService);

    readonly thread = input.required<Thread>();
    readonly parentMessage = input.required<Message>();
    readonly close = output<void>();

    readonly messages = signal<Message[]>([]);
    readonly loading = signal(true);

    constructor() {
        effect(() => {
            this.loadThreadMessages(this.thread()._id);
        });
    }

    loadThreadMessages(threadId: string): void {
        this.loading.set(true);
        this.threadService.loadMessages(threadId).subscribe({
            next: (messages) => {
                this.messages.set(messages);
                this.loading.set(false);
            },
        });
    }

    closeThread(): void {
        this.close.emit();
    }
}
```

---

## Database Indexes

Add to `apps/api/src/db/client.ts`:

```typescript
// Bot system indexes
await db.collection('bots').createIndex({ handle: 1 }, { unique: true });
await db.collection('bots').createIndex({ tagId: 1, isEnabled: 1 });
await db.collection('bots').createIndex({ createdBy: 1 });
await db.collection('bots').createIndex({ isGlobal: 1, isEnabled: 1 });

await db.collection('bot_invocations').createIndex({ botId: 1, createdAt: -1 });
await db.collection('bot_invocations').createIndex({ sourceType: 1, sourceId: 1 });
await db.collection('bot_invocations').createIndex({ status: 1, createdAt: -1 });
await db.collection('bot_invocations').createIndex({ userId: 1, createdAt: -1 });

await db.collection('threads').createIndex({ parentMessageId: 1 }, { unique: true });
await db.collection('threads').createIndex({ tagId: 1, createdAt: -1 });

// Update messages index for threads
await db.collection('messages').createIndex({ threadId: 1, createdAt: 1 });
```

---

## WebSocket Events

Add to `apps/api/src/ws/chat.ws.ts` event handling:

```typescript
// New event types to broadcast
type BotEvents =
    | { type: 'bot:invocation:started'; invocationId: string; botId: string }
    | { type: 'bot:invocation:progress'; invocationId: string; step: string }
    | { type: 'bot:invocation:completed'; invocationId: string; output: any }
    | { type: 'bot:invocation:failed'; invocationId: string; error: string }
    | { type: 'thread:created'; threadId: string; parentMessageId: string }
    | { type: 'thread:message'; threadId: string; message: Message }
    | { type: 'note:widget:created'; noteId: string; widgetId: string }
    | { type: 'note:widget:updated'; noteId: string; widgetId: string; state: WidgetState };
```

---

## Testing Strategy

The bot system follows the existing testing patterns in the codebase:

- **API tests**: Vitest with `.test.ts` suffix in `__tests__` folders
- **Web tests**: Vitest + Angular TestBed with `.spec.ts` suffix in `__tests__` folders
- **Shared package tests**: Vitest for pure utility functions

### Test File Structure

```
apps/api/src/
├── repositories/__tests__/
│   ├── bot.repo.test.ts
│   ├── thread.repo.test.ts
│   └── invocation.repo.test.ts
├── routes/__tests__/
│   ├── bots.test.ts
│   └── threads.test.ts
├── services/__tests__/
│   ├── bot-executor.test.ts
│   └── mention-parser.test.ts
└── __tests__/helpers/
    └── fixtures.ts  # Add bot/thread fixtures

apps/web/src/app/
├── services/__tests__/
│   ├── bot.service.spec.ts
│   ├── thread.service.spec.ts
│   └── widget.service.spec.ts
├── components/
│   ├── molecules/mention-suggester/__tests__/
│   │   └── mention-suggester.component.spec.ts
│   ├── atoms/bot-output/__tests__/
│   │   └── bot-output.component.spec.ts
│   └── organisms/chat/__tests__/
│       └── chat-thread.component.spec.ts
└── editor/extensions/__tests__/
    ├── mention.extension.spec.ts
    └── bot-widget.extension.spec.ts

packages/shared/src/
└── utils/__tests__/
    └── mention-parser.test.ts
```

### API Test Examples

#### Bot Repository Tests

**Create `apps/api/src/repositories/__tests__/bot.repo.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest';
import { findBotByHandle, createBot, searchBots, findBotsForTag } from '../bot.repo';
import {
    createBotFixture,
    createUserFixture,
    createTagFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('BotRepo', () => {
    describe('findBotByHandle', () => {
        it('should return bot when handle exists', async () => {
            const user = await createUserFixture();
            const bot = await createBotFixture({
                handle: 'summarize',
                createdBy: user._id.toString(),
            });

            const found = await findBotByHandle('summarize');

            expect(found).not.toBeNull();
            expect(found!.handle).toBe('summarize');
            expect(found!._id).toBe(bot._id.toString());
        });

        it('should return null for disabled bot', async () => {
            const user = await createUserFixture();
            await createBotFixture({
                handle: 'disabled-bot',
                createdBy: user._id.toString(),
                isEnabled: false,
            });

            const found = await findBotByHandle('disabled-bot');

            expect(found).toBeNull();
        });

        it('should be case-insensitive', async () => {
            const user = await createUserFixture();
            await createBotFixture({
                handle: 'mybot',
                createdBy: user._id.toString(),
            });

            const found = await findBotByHandle('MYBOT');

            expect(found).not.toBeNull();
            expect(found!.handle).toBe('mybot');
        });
    });

    describe('findBotsForTag', () => {
        it('should return global bots', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            await createBotFixture({
                handle: 'global-bot',
                isGlobal: true,
                createdBy: user._id.toString(),
            });

            const bots = await findBotsForTag(tag._id.toString(), user._id.toString());

            expect(bots.some((b) => b.handle === 'global-bot')).toBe(true);
        });

        it('should return tag-scoped bots', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            await createBotFixture({
                handle: 'tag-bot',
                tagId: tag._id.toString(),
                isGlobal: false,
                createdBy: user._id.toString(),
            });

            const bots = await findBotsForTag(tag._id.toString(), user._id.toString());

            expect(bots.some((b) => b.handle === 'tag-bot')).toBe(true);
        });

        it('should not return bots from other tags', async () => {
            const user = await createUserFixture();
            const tag1 = await createTagFixture({ createdBy: user._id.toString() });
            const tag2 = await createTagFixture({ createdBy: user._id.toString() });
            await createBotFixture({
                handle: 'other-tag-bot',
                tagId: tag2._id.toString(),
                isGlobal: false,
                createdBy: user._id.toString(),
            });

            const bots = await findBotsForTag(tag1._id.toString(), user._id.toString());

            expect(bots.some((b) => b.handle === 'other-tag-bot')).toBe(false);
        });
    });

    describe('searchBots', () => {
        it('should search by handle', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            await createBotFixture({
                handle: 'summarize',
                name: 'Summarize Bot',
                isGlobal: true,
                createdBy: user._id.toString(),
            });

            const bots = await searchBots('sum', tag._id.toString(), user._id.toString());

            expect(bots.length).toBe(1);
            expect(bots[0].handle).toBe('summarize');
        });

        it('should search by name', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            await createBotFixture({
                handle: 'mybot',
                name: 'Weather Bot',
                isGlobal: true,
                createdBy: user._id.toString(),
            });

            const bots = await searchBots('weather', tag._id.toString(), user._id.toString());

            expect(bots.length).toBe(1);
            expect(bots[0].name).toBe('Weather Bot');
        });
    });
});
```

#### Bot Executor Tests

**Create `apps/api/src/services/__tests__/bot-executor.test.ts`:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotExecutor } from '../bot-executor';
import type { Bot, BotInvocation } from '@maple/shared';

// Mock dependencies
vi.mock('../../repositories/bot.repo', () => ({
    findBotById: vi.fn(),
}));
vi.mock('../../repositories/invocation.repo', () => ({
    findInvocationById: vi.fn(),
    updateInvocationStatus: vi.fn(),
}));
vi.mock('../realtime.service', () => ({
    broadcastChatEvent: vi.fn(),
}));

import { findBotById } from '../../repositories/bot.repo';
import { findInvocationById, updateInvocationStatus } from '../../repositories/invocation.repo';

describe('BotExecutor', () => {
    let executor: BotExecutor;

    const mockBot: Bot = {
        _id: 'bot-1',
        name: 'Test Bot',
        handle: 'test',
        definition: {
            trigger: { mentionPatterns: ['test'] },
            input: { includeContext: { mentionText: true } },
            actions: [
                {
                    type: 'set',
                    id: 'set-result',
                    config: { variable: 'result', value: 'Hello {{$mentionText}}' },
                },
            ],
            output: {
                chatView: {
                    components: [{ id: 'text', type: 'text', props: { content: '{{result}}' } }],
                },
            },
        },
        createdBy: 'user-1',
        isGlobal: true,
        isEnabled: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const mockInvocation: BotInvocation = {
        _id: 'inv-1',
        botId: 'bot-1',
        botVersion: 1,
        sourceType: 'message',
        sourceId: 'msg-1',
        tagId: 'tag-1',
        userId: 'user-1',
        context: { mentionText: 'world' },
        variables: {},
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
        executor = new BotExecutor();
        vi.clearAllMocks();

        vi.mocked(findBotById).mockResolvedValue(mockBot);
        vi.mocked(findInvocationById).mockResolvedValue(mockInvocation);
        vi.mocked(updateInvocationStatus).mockResolvedValue({
            ...mockInvocation,
            status: 'completed',
        });
    });

    describe('execute', () => {
        it('should execute set action and interpolate variables', async () => {
            await executor.execute('inv-1');

            expect(updateInvocationStatus).toHaveBeenCalledWith(
                'inv-1',
                'completed',
                expect.objectContaining({
                    variables: expect.objectContaining({
                        result: 'Hello world',
                    }),
                }),
            );
        });

        it('should update status to running then completed', async () => {
            await executor.execute('inv-1');

            expect(updateInvocationStatus).toHaveBeenCalledWith('inv-1', 'running');
            expect(updateInvocationStatus).toHaveBeenCalledWith(
                'inv-1',
                'completed',
                expect.any(Object),
            );
        });

        it('should handle execution errors', async () => {
            vi.mocked(findBotById).mockResolvedValue(null);

            await expect(executor.execute('inv-1')).rejects.toThrow('Bot not found');

            expect(updateInvocationStatus).toHaveBeenCalledWith(
                'inv-1',
                'failed',
                expect.objectContaining({
                    error: expect.objectContaining({
                        code: 'EXECUTION_ERROR',
                    }),
                }),
            );
        });
    });

    describe('interpolate', () => {
        it('should replace simple variables', () => {
            const result = executor['interpolate']('Hello {{name}}', { name: 'World' });
            expect(result).toBe('Hello World');
        });

        it('should replace nested variables', () => {
            const result = executor['interpolate']('{{user.name}}', {
                user: { name: 'Alice' },
            });
            expect(result).toBe('Alice');
        });

        it('should handle context variables with $ prefix', () => {
            const result = executor['interpolate']('{{$mentionText}}', {
                $mentionText: 'test',
            });
            expect(result).toBe('test');
        });

        it('should handle missing variables gracefully', () => {
            const result = executor['interpolate']('Hello {{missing}}', {});
            expect(result).toBe('Hello ');
        });
    });

    describe('applyTransformOperation', () => {
        it('should map array values', () => {
            const result = executor['applyTransformOperation']([{ name: 'a' }, { name: 'b' }], {
                op: 'map',
                args: 'name',
            });
            expect(result).toEqual(['a', 'b']);
        });

        it('should filter array values', () => {
            const result = executor['applyTransformOperation'](
                [{ active: true }, { active: false }],
                { op: 'filter', args: 'active' },
            );
            expect(result).toEqual([{ active: true }]);
        });

        it('should join array to string', () => {
            const result = executor['applyTransformOperation'](['a', 'b', 'c'], {
                op: 'join',
                args: ', ',
            });
            expect(result).toBe('a, b, c');
        });

        it('should split string to array', () => {
            const result = executor['applyTransformOperation']('a,b,c', {
                op: 'split',
                args: ',',
            });
            expect(result).toEqual(['a', 'b', 'c']);
        });
    });
});
```

#### Thread Repository Tests

**Create `apps/api/src/repositories/__tests__/thread.repo.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest';
import {
    createThread,
    findThreadByParentMessage,
    findThreadById,
    incrementThreadMessageCount,
} from '../thread.repo';
import {
    createUserFixture,
    createTagFixture,
    createMessageFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('ThreadRepo', () => {
    describe('createThread', () => {
        it('should create a thread for a message', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
            });

            const thread = await createThread({
                parentMessageId: message._id.toString(),
                tagId: tag._id.toString(),
            });

            expect(thread._id).toBeDefined();
            expect(thread.parentMessageId).toBe(message._id.toString());
            expect(thread.tagId).toBe(tag._id.toString());
            expect(thread.messageCount).toBe(0);
        });

        it('should include botInvocationId when provided', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
            });

            const thread = await createThread({
                parentMessageId: message._id.toString(),
                tagId: tag._id.toString(),
                botInvocationId: 'inv-123',
            });

            expect(thread.botInvocationId).toBe('inv-123');
        });
    });

    describe('findThreadByParentMessage', () => {
        it('should find thread by parent message id', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const thread = await createThread({
                parentMessageId: message._id.toString(),
                tagId: tag._id.toString(),
            });

            const found = await findThreadByParentMessage(message._id.toString());

            expect(found).not.toBeNull();
            expect(found!._id).toBe(thread._id);
        });

        it('should return null when thread does not exist', async () => {
            const found = await findThreadByParentMessage('507f1f77bcf86cd799439011');

            expect(found).toBeNull();
        });
    });

    describe('incrementThreadMessageCount', () => {
        it('should increment message count', async () => {
            const user = await createUserFixture();
            const tag = await createTagFixture({ createdBy: user._id.toString() });
            const message = await createMessageFixture({
                tagId: tag._id.toString(),
                userId: user._id.toString(),
            });
            const thread = await createThread({
                parentMessageId: message._id.toString(),
                tagId: tag._id.toString(),
            });

            await incrementThreadMessageCount(thread._id);
            await incrementThreadMessageCount(thread._id);

            const updated = await findThreadById(thread._id);
            expect(updated!.messageCount).toBe(2);
        });
    });
});
```

### Fixtures to Add

**Update `apps/api/src/__tests__/helpers/fixtures.ts`:**

```typescript
// Add these fixtures to the existing file

export interface BotDoc {
    _id: ObjectId;
    name: string;
    handle: string;
    description?: string;
    avatar?: string;
    definition: BotDefinition;
    tagId?: ObjectId;
    createdBy: ObjectId;
    isGlobal: boolean;
    isEnabled: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateBotOptions {
    name?: string;
    handle?: string;
    description?: string;
    definition?: Partial<BotDefinition>;
    tagId?: string;
    createdBy: string;
    isGlobal?: boolean;
    isEnabled?: boolean;
}

export async function createBotFixture(options: CreateBotOptions): Promise<BotDoc> {
    const now = new Date();
    const doc: BotDoc = {
        _id: new ObjectId(),
        name: options.name || 'Test Bot',
        handle: options.handle || `bot-${Date.now()}`,
        description: options.description,
        definition: {
            trigger: { mentionPatterns: [options.handle || 'test'] },
            input: { includeContext: { mentionText: true } },
            actions: [],
            output: { chatView: { components: [] } },
            ...options.definition,
        },
        tagId: options.tagId ? new ObjectId(options.tagId) : undefined,
        createdBy: new ObjectId(options.createdBy),
        isGlobal: options.isGlobal ?? true,
        isEnabled: options.isEnabled ?? true,
        version: 1,
        createdAt: now,
        updatedAt: now,
    };
    await testDb.collection('bots').insertOne(doc);
    return doc;
}

export interface TagDoc {
    _id: ObjectId;
    type: 'folder';
    value: 'mixed';
    label: string;
    sharing: { sharedWith: []; isPublic: boolean };
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateTagOptions {
    label?: string;
    createdBy: string;
}

export async function createTagFixture(options: CreateTagOptions): Promise<TagDoc> {
    const now = new Date();
    const doc: TagDoc = {
        _id: new ObjectId(),
        type: 'folder',
        value: 'mixed',
        label: options.label || `Tag ${Date.now()}`,
        sharing: {
            sharedWith: [{ userId: options.createdBy, accessLevel: 'owner' }],
            isPublic: false,
        },
        createdAt: now,
        updatedAt: now,
    };
    await testDb.collection('tags').insertOne(doc);
    return doc;
}

export interface MessageDoc {
    _id: ObjectId;
    tagId: ObjectId;
    userId: ObjectId;
    content: NoteContent;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateMessageOptions {
    tagId: string;
    userId: string;
    content?: NoteContent;
}

export async function createMessageFixture(options: CreateMessageOptions): Promise<MessageDoc> {
    const now = new Date();
    const doc: MessageDoc = {
        _id: new ObjectId(),
        tagId: new ObjectId(options.tagId),
        userId: new ObjectId(options.userId),
        content: options.content || {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test message' }] }],
        },
        createdAt: now,
        updatedAt: now,
    };
    await testDb.collection('messages').insertOne(doc);
    return doc;
}

export interface ThreadDoc {
    _id: ObjectId;
    parentMessageId: ObjectId;
    tagId: ObjectId;
    botInvocationId?: ObjectId;
    messageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateThreadOptions {
    parentMessageId: string;
    tagId: string;
    botInvocationId?: string;
}

export async function createThreadFixture(options: CreateThreadOptions): Promise<ThreadDoc> {
    const now = new Date();
    const doc: ThreadDoc = {
        _id: new ObjectId(),
        parentMessageId: new ObjectId(options.parentMessageId),
        tagId: new ObjectId(options.tagId),
        botInvocationId: options.botInvocationId
            ? new ObjectId(options.botInvocationId)
            : undefined,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
    };
    await testDb.collection('threads').insertOne(doc);
    return doc;
}
```

### Web Component Tests

#### Mention Suggester Component Tests

**Create `apps/web/src/app/components/molecules/mention-suggester/__tests__/mention-suggester.component.spec.ts`:**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MentionSuggesterComponent, MentionSuggestion } from '../mention-suggester.component';

describe('MentionSuggesterComponent', () => {
    let component: MentionSuggesterComponent;
    let fixture: ComponentFixture<MentionSuggesterComponent>;

    const mockBots: MentionSuggestion[] = [
        { id: 'bot-1', handle: 'summarize', type: 'bot', description: 'Summarize content' },
        { id: 'bot-2', handle: 'translate', type: 'bot', description: 'Translate text' },
    ];

    const mockUsers: MentionSuggestion[] = [
        { id: 'user-1', handle: 'alice', type: 'user', displayName: 'Alice Smith' },
        { id: 'user-2', handle: 'bob', type: 'user', displayName: 'Bob Jones' },
    ];

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MentionSuggesterComponent],
        }).compileComponents();

        fixture = TestBed.createComponent(MentionSuggesterComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        fixture.componentRef.setInput('items', []);
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    it('should group items by type', () => {
        fixture.componentRef.setInput('items', [...mockBots, ...mockUsers]);
        fixture.detectChanges();

        const grouped = component.groupedItems();
        expect(grouped.bots.length).toBe(2);
        expect(grouped.users.length).toBe(2);
    });

    it('should show bots section when bots exist', () => {
        fixture.componentRef.setInput('items', mockBots);
        fixture.detectChanges();

        const botsSection = fixture.nativeElement.querySelector('.mention-group-label');
        expect(botsSection.textContent).toContain('Bots');
    });

    it('should show users section when users exist', () => {
        fixture.componentRef.setInput('items', mockUsers);
        fixture.detectChanges();

        const usersSection = fixture.nativeElement.querySelector('.mention-group-label');
        expect(usersSection.textContent).toContain('People');
    });

    it('should emit command on item select', () => {
        fixture.componentRef.setInput('items', mockBots);
        fixture.detectChanges();

        const emitSpy = spyOn(component.command, 'emit');
        component.selectItem(mockBots[0]);

        expect(emitSpy).toHaveBeenCalledWith(mockBots[0]);
    });

    it('should highlight selected item', () => {
        fixture.componentRef.setInput('items', mockBots);
        fixture.componentRef.setInput('selectedIndex', 1);
        fixture.detectChanges();

        expect(component.isSelected(1)).toBeTrue();
        expect(component.isSelected(0)).toBeFalse();
    });

    it('should show empty message when no items', () => {
        fixture.componentRef.setInput('items', []);
        fixture.detectChanges();

        const emptyMessage = fixture.nativeElement.querySelector('.mention-empty');
        expect(emptyMessage).toBeTruthy();
        expect(emptyMessage.textContent).toContain('No matches found');
    });
});
```

#### Bot Output Component Tests

**Create `apps/web/src/app/components/atoms/bot-output/__tests__/bot-output.component.spec.ts`:**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { BotOutputComponent } from '../bot-output.component';
import type { BotInvocation, UIComponent } from '@maple/shared';

describe('BotOutputComponent', () => {
    let component: BotOutputComponent;
    let fixture: ComponentFixture<BotOutputComponent>;
    let httpMock: HttpTestingController;

    const mockInvocation: BotInvocation = {
        _id: 'inv-1',
        botId: 'bot-1',
        botVersion: 1,
        sourceType: 'message',
        sourceId: 'msg-1',
        tagId: 'tag-1',
        userId: 'user-1',
        context: {},
        variables: { result: 'Hello World' },
        output: {
            components: [{ id: 'text-1', type: 'text', props: { content: '{{result}}' } }],
        },
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [BotOutputComponent, HttpClientTestingModule],
        }).compileComponents();

        httpMock = TestBed.inject(HttpTestingController);
        fixture = TestBed.createComponent(BotOutputComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('should create', () => {
        fixture.componentRef.setInput('invocationId', 'inv-1');
        fixture.detectChanges();

        const req = httpMock.expectOne('/api/invocations/inv-1');
        req.flush({ invocation: mockInvocation });

        expect(component).toBeTruthy();
    });

    it('should load invocation on init', () => {
        fixture.componentRef.setInput('invocationId', 'inv-1');
        fixture.detectChanges();

        const req = httpMock.expectOne('/api/invocations/inv-1');
        expect(req.request.method).toBe('GET');
        req.flush({ invocation: mockInvocation });

        expect(component.loading()).toBeFalse();
        expect(component.components().length).toBe(1);
    });

    it('should show loading state initially', () => {
        fixture.componentRef.setInput('invocationId', 'inv-1');
        fixture.detectChanges();

        expect(component.loading()).toBeTrue();

        const loadingEl = fixture.nativeElement.querySelector('.bot-output-loading');
        expect(loadingEl).toBeTruthy();

        const req = httpMock.expectOne('/api/invocations/inv-1');
        req.flush({ invocation: mockInvocation });
    });

    it('should show error state on failure', () => {
        fixture.componentRef.setInput('invocationId', 'inv-1');
        fixture.detectChanges();

        const req = httpMock.expectOne('/api/invocations/inv-1');
        req.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });

        expect(component.error()).toBe('Failed to load bot response');
    });

    it('should interpolate variables in content', () => {
        fixture.componentRef.setInput('invocationId', 'inv-1');
        fixture.detectChanges();

        const req = httpMock.expectOne('/api/invocations/inv-1');
        req.flush({ invocation: mockInvocation });

        const result = component.interpolate('{{result}}');
        expect(result).toBe('Hello World');
    });

    it('should handle nested variable paths', () => {
        const nestedInvocation = {
            ...mockInvocation,
            variables: { user: { name: 'Alice' } },
        };

        fixture.componentRef.setInput('invocationId', 'inv-1');
        fixture.detectChanges();

        const req = httpMock.expectOne('/api/invocations/inv-1');
        req.flush({ invocation: nestedInvocation });

        const result = component.interpolate('Hello {{user.name}}');
        expect(result).toBe('Hello Alice');
    });
});
```

#### Bot Service Tests

**Create `apps/web/src/app/services/__tests__/bot.service.spec.ts`:**

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { BotService } from '../bot.service';
import type { Bot } from '@maple/shared';

describe('BotService', () => {
    let service: BotService;
    let httpMock: HttpTestingController;

    const mockBot: Bot = {
        _id: 'bot-1',
        name: 'Summarize',
        handle: 'summarize',
        description: 'Summarizes content',
        definition: {
            trigger: { mentionPatterns: ['summarize', 'sum'] },
            input: { includeContext: { mentionText: true } },
            actions: [],
            output: { chatView: { components: [] } },
        },
        createdBy: 'user-1',
        isGlobal: true,
        isEnabled: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [BotService],
        });

        service = TestBed.inject(BotService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    describe('searchBots', () => {
        it('should search bots by query', (done) => {
            service.searchBots('tag-1', 'sum').subscribe((bots) => {
                expect(bots.length).toBe(1);
                expect(bots[0].handle).toBe('summarize');
                done();
            });

            const req = httpMock.expectOne('/api/tags/tag-1/bots/search?q=sum');
            expect(req.request.method).toBe('GET');
            req.flush({ bots: [mockBot] });
        });

        it('should handle empty results', (done) => {
            service.searchBots('tag-1', 'xyz').subscribe((bots) => {
                expect(bots).toEqual([]);
                done();
            });

            const req = httpMock.expectOne('/api/tags/tag-1/bots/search?q=xyz');
            req.flush({ bots: [] });
        });
    });

    describe('invokeBot', () => {
        it('should create bot invocation', (done) => {
            const invocationData = {
                botId: 'bot-1',
                sourceType: 'message' as const,
                sourceId: 'msg-1',
                context: { mentionText: 'hello' },
            };

            service.invokeBot('tag-1', invocationData).subscribe((result) => {
                expect(result.invocationId).toBe('inv-1');
                done();
            });

            const req = httpMock.expectOne('/api/tags/tag-1/bots/bot-1/invoke');
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({
                sourceType: 'message',
                sourceId: 'msg-1',
                context: { mentionText: 'hello' },
            });
            req.flush({ invocationId: 'inv-1' });
        });
    });

    describe('getInvocation', () => {
        it('should fetch invocation by id', (done) => {
            service.getInvocation('inv-1').subscribe((inv) => {
                expect(inv._id).toBe('inv-1');
                expect(inv.status).toBe('completed');
                done();
            });

            const req = httpMock.expectOne('/api/invocations/inv-1');
            expect(req.request.method).toBe('GET');
            req.flush({
                invocation: {
                    _id: 'inv-1',
                    status: 'completed',
                    // ... other fields
                },
            });
        });
    });
});
```

### Shared Package Tests

**Create `packages/shared/src/utils/__tests__/mention-parser.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest';
import { parseMentionsFromContent, extractTextFromContent } from '../mention-parser';

describe('mention-parser', () => {
    describe('parseMentionsFromContent', () => {
        it('should parse mention nodes from TipTap content', () => {
            const content = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Hello ' },
                            {
                                type: 'mention',
                                attrs: { id: 'bot-1', handle: 'summarize', mentionType: 'bot' },
                            },
                            { type: 'text', text: ' please help' },
                        ],
                    },
                ],
            };

            const knownBots = new Map([['summarize', 'bot-1']]);
            const knownUsers = new Map();

            const mentions = parseMentionsFromContent(content, knownBots, knownUsers);

            expect(mentions.length).toBe(1);
            expect(mentions[0].type).toBe('bot');
            expect(mentions[0].handle).toBe('summarize');
            expect(mentions[0].id).toBe('bot-1');
        });

        it('should parse multiple mentions', () => {
            const content = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            {
                                type: 'mention',
                                attrs: { id: 'bot-1', handle: 'summarize', mentionType: 'bot' },
                            },
                            { type: 'text', text: ' and ' },
                            {
                                type: 'mention',
                                attrs: { id: 'user-1', handle: 'alice', mentionType: 'user' },
                            },
                        ],
                    },
                ],
            };

            const mentions = parseMentionsFromContent(content, new Map(), new Map());

            expect(mentions.length).toBe(2);
            expect(mentions[0].type).toBe('bot');
            expect(mentions[1].type).toBe('user');
        });

        it('should handle empty content', () => {
            const content = { type: 'doc', content: [] };
            const mentions = parseMentionsFromContent(content, new Map(), new Map());
            expect(mentions).toEqual([]);
        });
    });

    describe('extractTextFromContent', () => {
        it('should extract plain text from TipTap content', () => {
            const content = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Hello ' },
                            {
                                type: 'mention',
                                attrs: { handle: 'summarize' },
                            },
                            { type: 'text', text: ' world' },
                        ],
                    },
                ],
            };

            const text = extractTextFromContent(content);

            expect(text).toBe('Hello @summarize world');
        });

        it('should handle multiple paragraphs', () => {
            const content = {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Line 1' }],
                    },
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Line 2' }],
                    },
                ],
            };

            const text = extractTextFromContent(content);

            expect(text).toBe('Line 1\nLine 2');
        });

        it('should handle null/undefined content', () => {
            expect(extractTextFromContent(null)).toBe('');
            expect(extractTextFromContent(undefined)).toBe('');
        });
    });
});
```

### Test Setup Updates

**Update `apps/api/src/__tests__/setup.ts` to add bot indexes:**

```typescript
// Add to the beforeAll block after existing indexes:

// Bot system indexes
await testDb.collection('bots').createIndex({ handle: 1 }, { unique: true });
await testDb.collection('bots').createIndex({ tagId: 1, isEnabled: 1 });
await testDb.collection('bots').createIndex({ isGlobal: 1, isEnabled: 1 });

await testDb.collection('bot_invocations').createIndex({ botId: 1, createdAt: -1 });
await testDb.collection('bot_invocations').createIndex({ sourceType: 1, sourceId: 1 });

await testDb.collection('threads').createIndex({ parentMessageId: 1 }, { unique: true });
await testDb.collection('threads').createIndex({ tagId: 1, createdAt: -1 });

await testDb.collection('messages').createIndex({ threadId: 1, createdAt: 1 });
```

### Test Commands

Add to `package.json` scripts:

```json
{
    "scripts": {
        "test": "bun run test:shared && bun run test:api && bun run test:web",
        "test:shared": "cd packages/shared && vitest run",
        "test:api": "cd apps/api && vitest run",
        "test:web": "cd apps/web && vitest run",
        "test:watch": "vitest",
        "test:coverage": "vitest run --coverage"
    }
}
```

### Test Coverage Goals

| Component             | Target Coverage |
| --------------------- | --------------- |
| Bot Repository        | 90%             |
| Thread Repository     | 90%             |
| Invocation Repository | 85%             |
| Bot Executor          | 80%             |
| Mention Parser        | 95%             |
| Bot Service (Web)     | 85%             |
| Mention Suggester     | 80%             |
| Bot Output Component  | 80%             |

### E2E Testing (Future)

For end-to-end testing of the complete bot flow:

```typescript
// Future: apps/e2e/tests/bot-mention.spec.ts
import { test, expect } from '@playwright/test';

test('should invoke bot via @mention in chat', async ({ page }) => {
    // Login
    await page.goto('/login');
    // ... auth flow

    // Navigate to a tag
    await page.click('[data-testid="tag-item"]');

    // Type @mention in chat
    await page.fill('[data-testid="chat-input"]', '@summarize hello world');

    // Wait for suggester
    await expect(page.locator('.mention-suggester')).toBeVisible();

    // Select bot
    await page.click('[data-testid="mention-item-summarize"]');

    // Send message
    await page.keyboard.press('Enter');

    // Wait for thread indicator
    await expect(page.locator('[data-testid="thread-indicator"]')).toBeVisible();

    // Open thread
    await page.click('[data-testid="thread-indicator"]');

    // Verify bot response
    await expect(page.locator('.bot-message')).toBeVisible();
});
```

---

## Implementation Order

### Sprint 1: Foundation (Week 1-2)

1. Add Bot, Thread, Invocation schemas to `@maple/shared`
2. Extend Message and Note schemas
3. Create repositories (bot, thread, invocation)
4. Add database indexes

### Sprint 2: @Mentions Core (Week 3-4)

5. Create TipTap Mention extension
6. Create Mention Suggester component
7. Integrate mention extension into chat editor
8. Add bot/user search API endpoints

### Sprint 3: Bot Execution (Week 5-6)

9. Create Bot Executor service
10. Implement LLM action handler
11. Implement Set and Transform actions
12. Add bot invocation API endpoints

### Sprint 4: Thread System (Week 7-8)

13. Create thread repository and routes
14. Add thread message endpoints
15. Create ChatThread component
16. Integrate threads into chat UI

### Sprint 5: Note Widgets (Week 9-10)

17. Create BotWidget TipTap extension
18. Add widget state to notes
19. Create BotOutput component
20. Integrate widgets into note editor

### Sprint 6: Polish (Week 11-12)

21. Add WebSocket events for real-time updates
22. Error handling and retry logic
23. Loading states and animations
24. Testing and bug fixes

---

## Key Integration Points

### Chat Flow

```
User types @bot → Mention extension triggers → Suggester shows options
→ User selects bot → Mention node inserted → Message sent
→ Server parses mentions → Creates invocation → Executes bot
→ Creates thread → Posts response → Broadcasts to clients
→ UI shows thread indicator → User can view thread
```

### Note Flow

```
User types @bot in note → Mention extension triggers → Suggester shows
→ User selects bot → Mention node + Widget placeholder inserted
→ Note saved → Server detects bot mention → Creates invocation
→ Executes bot → Updates widget state → Broadcasts update
→ Note reloads widget → Shows bot output inline
```

---

_Document created: December 2024_
_Last updated: December 2024_
