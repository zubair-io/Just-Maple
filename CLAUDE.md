# CLAUDE.md - Engineering Style Guide

This file provides guidance to Claude Code and engineers working on Just Maple.

## Project Overview

Just Maple is a note-taking application built as a monorepo using Bun workspaces.

### Structure

```
just-maple/
├── apps/
│   ├── api/          # Elysia backend (Bun + TypeScript)
│   └── web/          # Angular frontend
├── packages/
│   └── shared/       # Shared TypeBox schemas and types
└── designs/          # Figma exports and design specs
```

### Tech Stack

- **Runtime**: Bun
- **API**: Elysia + Azure Cosmos DB (MongoDB API)
- **Web**: Angular 19 + Tailwind CSS
- **Shared**: TypeBox schemas

> **Note**: We use Azure Cosmos DB with MongoDB API, not native MongoDB. Key limitations:
>
> - **Text indexes not supported** - Use regex-based search (`$regex`) instead of `$text`
> - **No `weights` option** - Scoring must be done in application code
> - **`$or` with `.sort()` not supported** - Do sorting in application code after fetching
> - Always check Cosmos DB compatibility before using advanced MongoDB features

---

## Code Formatting

### Prettier (Required)

- **Run on save** - Configure your editor to format on save
- Settings defined in `.prettierrc`:
    - 4-space indentation
    - Single quotes
    - Trailing commas
    - 100 char line width

```bash
# Manual format
bun run format
```

### Do NOT manually format code - let Prettier handle it.

---

## Styling (Web)

### Tailwind CSS (Primary)

Use Tailwind utility classes for all styling:

```html
<button
    class="px-4 py-2 bg-[var(--color-primary)] text-white rounded-md hover:bg-[var(--color-primary-hover)]"
></button>
```

### Design Tokens

Use CSS variables from `styles.scss`:

- `--color-primary` - Maple red (#D94E3B)
- `--color-bg` - Background
- `--color-text-main` - Primary text
- `--color-text-muted` - Secondary text
- `--color-border` - Borders

### SCSS (When Needed)

Only use SCSS for:

- Complex animations
- `::before` / `::after` pseudo-elements
- Styles that can't be expressed in Tailwind

### Never use inline styles in templates.

---

## Angular Conventions

### Component Files (Separate)

Each component must have separate files:

```
components/atoms/button/
├── button.component.ts
├── button.component.html
└── button.component.scss
```

### Component Structure

```typescript
@Component({
    selector: 'app-button',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './button.component.html',
    styleUrl: './button.component.scss',
})
export class ButtonComponent {
    // Use signals for state
    readonly isLoading = signal(false);

    // Use input() and output() functions
    readonly variant = input<'primary' | 'secondary'>('primary');
    readonly clicked = output<void>();
}
```

### Atomic Design Structure

```
components/
├── atoms/           # Button, Input, Icon
├── molecules/       # FormField, SearchBar
├── organisms/       # Sidebar, NoteEditor
├── templates/       # MainLayout
└── index.ts         # Barrel exports
```

### State Management

- Use **Angular signals** (`signal()`, `computed()`)
- Do NOT use BehaviorSubject or RxJS for component state
- Services can use signals for shared state

### HTTP Requests

**Always use Angular's `HttpClient`** for API calls. Never use raw `fetch()`.

**Why:**

- `HttpClient` uses the environment's base URL configuration
- Auth interceptors automatically attach tokens
- Consistent error handling and retry logic
- Observable-based for better integration with Angular

**Do:**

```typescript
private readonly http = inject(HttpClient);

// Use HttpClient with relative URLs
const data = await firstValueFrom(
    this.http.get<{ state: string }>('/api/notebook/state')
);
```

**Don't:**

```typescript
// BAD: Raw fetch bypasses env config and auth
const response = await fetch('/api/notebook/state', {
    headers: { Authorization: `Bearer ${token}` },
});
```

### Routing

- Use ID-based routes: `/:tagId/:id` (page ID)
- Page IDs can be UUID v4 or legacy base58 format
- Keep route params simple and stable

### Page Component Separation

Each page component should handle **one concern only**. Do not combine multiple views into a single component with conditional rendering.

**Do:**

```typescript
// chat-view.component.ts - Only handles chat/messages
// note-view.component.ts - Only handles note editing
// lego-view.component.ts - Only handles lego items
```

**Don't:**

```typescript
// bad: single component handling multiple concerns
@if (hasNote) {
    <app-note-editor />
} @else {
    <app-chat />
}
```

**Use route-level switching**, not component-level:

```typescript
// app.routes.ts
{ path: ':tagId', loadComponent: () => import('./pages/chat-view/...') },
{ path: ':tagId/:id', canMatch: [MemoGuard], loadComponent: () => import('./pages/memo-view/...') },
{ path: ':tagId/:id', canMatch: [WhiteboardGuard], loadComponent: () => import('./pages/whiteboard-view/...') },
```

Route guards (`canMatch`) determine which component loads based on data (e.g., note type). Components should not need to know about other view types.

---

## API Conventions (Elysia)

### File Structure

```
src/
├── routes/          # API endpoints
├── repositories/    # Data access (*.repo.ts)
├── services/        # Business logic
├── middleware/      # Auth, logging
└── db/              # Database connection
```

### Repository Pattern

```typescript
// user.repo.ts
export async function findUserById(id: string): Promise<User | null> {
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    return user ? mapUser(user) : null;
}
```

### Route Handlers

```typescript
export const tagRoutes = new Elysia({ prefix: '/api/tags' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        // Auth logic inline
    })
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }
        return { tags: await findTagsByUserId(auth.user._id) };
    });
```

### Error Responses

```typescript
{ error: 'Not found', message: 'Tag does not exist' }
```

---

## TypeScript

### Strict Mode

TypeScript strict mode is enabled. No exceptions.

### Type Imports

```typescript
import type { Tag, Note } from '@maple/shared';
```

### Avoid `any`

Use `unknown` and narrow types, or define proper interfaces.

### Shared Types

Define types in `@maple/shared` for use across API and Web:

```typescript
// packages/shared/src/schemas/tag.ts
export const TagSchema = Type.Object({
    _id: Type.String(),
    label: Type.String(),
    // ...
});
export type Tag = Static<typeof TagSchema>;
```

---

## File Naming

### kebab-case for files

```
user-profile.component.ts
auth.service.ts
tag.repo.ts
```

### Suffixes

| Type       | Suffix                        |
| ---------- | ----------------------------- |
| Component  | `.component.ts`               |
| Service    | `.service.ts`                 |
| Repository | `.repo.ts`                    |
| Guard      | `.guard.ts`                   |
| Schema     | `.schema.ts` (or in schemas/) |

---

## Git Conventions

### Commit Format

```
type: short description

Longer description if needed.
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructure (no behavior change)
- `docs`: Documentation only
- `test`: Adding/updating tests
- `chore`: Build, deps, tooling

### Examples

```
feat: add tag creation from sidebar
fix: resolve 401 on tags API
refactor: extract auth middleware to separate file
```

---

## Development Commands

```bash
# Start dev servers
bun run dev

# Format code
bun run format

# Run tests
bun run test

# Type check
bun run typecheck
```

---

## Database Migrations

### NEVER Delete Data Without Confirmation

When data appears "orphaned" or mismatched:

1. **First, try to reconnect it** - Create missing references (pages, users, etc.) to link the data
2. **Never assume orphaned data is garbage** - It may be valid data with broken references
3. **Always ask before deleting** - Even if data looks orphaned, confirm with the user first

### Migration Safety Rules

| Do                                                   | Don't                                      |
| ---------------------------------------------------- | ------------------------------------------ |
| Create missing references to reconnect orphaned data | Delete data because IDs don't match        |
| Run read-only reports first to understand the data   | Run destructive migrations without review  |
| Update foreign keys when primary keys change         | Change IDs without updating all references |
| Ask user before any DELETE operation on real data    | Assume "cleanup" is safe                   |

### Example: ID Migration

When migrating IDs (e.g., base58 → UUID):

```typescript
// WRONG: Delete orphaned data
if (!pageIds.has(memo.noteId)) {
    await memos.deleteOne({ _id: memo._id }); // DATA LOSS!
}

// RIGHT: Create missing page to reconnect
if (!pageIds.has(memo.noteId)) {
    await pages.insertOne({
        id: memo.noteId, // Use the memo's reference as page ID
        type: 'memo',
        title: 'Recovered Memo',
        // ...
    });
}
```

### Y.js Content Architecture

- **Pages collection**: Metadata (title, type, userId, tagId), uses `id` field (UUID v4 or legacy base58)
- **Memos collection**: Y.js state, references page via `noteId` field
- **Whiteboards collection**: Y.js state, references page via `id` field
- **Messages collection**: Chat messages, uses `id` field (UUID v4)

When page IDs change, memo/whiteboard references must be updated OR pages must be created with the old IDs.

### ID Scheme

| Collection  | Primary ID Field | Format                           |
| ----------- | ---------------- | -------------------------------- |
| pages       | `id`             | UUID v4 (new) or base58 (legacy) |
| memos       | `noteId`         | References `pages.id`            |
| whiteboards | `id`             | References `pages.id`            |
| messages    | `id`             | UUID v4                          |
| notebooks   | `_id`            | MongoDB ObjectId                 |

**Note**: The `_id` field (MongoDB ObjectId) exists on all documents but is not used for lookups. Use the `id` field instead for pages, memos, whiteboards, and messages.

---

## Enhanced Todo Feature

### Overview

The todo/task feature extends TipTap's built-in task list with enhanced attributes and tracking. Tasks support priority levels, color coding, and due dates.

### Architecture

```
apps/web/src/app/components/organisms/notebook-editor/extensions/
├── enhanced-task-item.ts    # TipTap extension with custom NodeView
├── enhanced-task-list.ts    # Task list container extension
└── ...
```

### Task Item Attributes

| Attribute  | Type                                  | Description                    |
| ---------- | ------------------------------------- | ------------------------------ |
| `id`       | `string`                              | Unique identifier (UUID-based) |
| `checked`  | `boolean`                             | Completion status              |
| `priority` | `'low' \| 'medium' \| 'high' \| null` | Priority level                 |
| `color`    | `string \| null`                      | Color for visual organization  |
| `dueDate`  | `string \| null`                      | ISO date string for due date   |

### Unique ID Handling

When users press Enter to create new tasks, TipTap copies the previous node's attributes (including the ID). A ProseMirror plugin in `enhanced-task-item.ts` detects duplicate IDs and assigns new ones:

```typescript
addProseMirrorPlugins() {
    return [
        new Plugin({
            key: new PluginKey('enhancedTaskItemUniqueIds'),
            appendTransaction(transactions, oldState, newState) {
                // Scan for duplicate IDs and fix them
                const seenIds = new Set<string>();
                newState.doc.descendants((node, pos) => {
                    if (node.type.name === 'taskItem') {
                        const id = node.attrs['id'];
                        if (seenIds.has(id)) {
                            // Duplicate found - will be fixed
                        }
                        seenIds.add(id);
                    }
                });
                // Return transaction with fixed IDs
            },
        }),
    ];
}
```

### Todo Toolbar

When the cursor is inside a task item, the editor toolbar shows additional controls:

- **Priority selector** - Set low/medium/high priority
- **Color picker** - Choose a color for the task
- **Date picker** - Set a due date

The toolbar detects the active task using `editor.state.selection.$from` and traversing up the node tree.

### Database Schema

Tasks are stored as part of memo Y.js content. The `pages` collection stores aggregated todo metadata:

```typescript
interface Page {
    // ... other fields
    todoMeta?: {
        hasTodos: boolean;
        todoCount: number;
        completedCount: number;
        overdueCount: number;
    };
}
```

### API Endpoints

| Endpoint                         | Method | Description                                  |
| -------------------------------- | ------ | -------------------------------------------- |
| `GET /api/notebooks/:id/summary` | GET    | Returns notebook summary including todoStats |

The summary endpoint returns:

```typescript
{
    notebook: Notebook;
    summary: {
        pageCounts: Record<string, number>;
        totalPages: number;
        todoStats: {
            todoCount: number;
            completedCount: number;
            overdueCount: number;
        }
    }
}
```

### Styling

Task items use CSS custom properties for dynamic coloring:

```scss
.todo-item[data-todo-color] {
    --todo-color: attr(data-todo-color);
    border-left-color: var(--todo-color);
}
```

Priority indicators use color coding:

- **High**: Red (`#dc2626`)
- **Medium**: Amber (`#f59e0b`)
- **Low**: Blue (`#3b82f6`)

### Key Files

| File                                       | Purpose                              |
| ------------------------------------------ | ------------------------------------ |
| `enhanced-task-item.ts`                    | TipTap extension with NodeView       |
| `editor-toolbar.component.ts`              | Detects active task, shows controls  |
| `notebook-editor.component.scss`           | Task item styling                    |
| `page.repo.ts` (`getTodoStatsForNotebook`) | Aggregates todo stats from MongoDB   |
| `chat-view.component.ts`                   | Displays notebook summary with todos |

---

## Centralized Notification System

### Overview

The notification system provides a centralized store for all notifications and unread counts. It uses Elf for state management and links notification state with message unread counts for a unified badge count.

### Architecture

```
apps/web/src/app/services/
├── notification.service.ts  # Centralized notification store (Elf)
├── message.service.ts       # Message handling with unread counts
└── db-stores.ts             # IndexedDB store constants
```

### Key Signals

**NotificationService:**

| Signal                    | Type                     | Description                                             |
| ------------------------- | ------------------------ | ------------------------------------------------------- |
| `notifications`           | `Signal<Notification[]>` | All notifications from Elf store                        |
| `unreadNotificationCount` | `Signal<number>`         | Count of unread notifications                           |
| `messageUnreadCount`      | `Signal<number>`         | Total message unread count (set by MessageService)      |
| `totalUnreadCount`        | `Signal<number>`         | Combined count for app badge (notifications + messages) |
| `unreadCount`             | `Signal<number>`         | Legacy alias for `unreadNotificationCount`              |

**MessageService:**

| Signal                    | Type                    | Description                   |
| ------------------------- | ----------------------- | ----------------------------- |
| `unreadCounts`            | `Signal<UnreadCount[]>` | Unread counts per page        |
| `totalMessageUnreadCount` | `Signal<number>`        | Sum of all page unread counts |

### Bidirectional Sync

The notification and message systems are linked bidirectionally:

1. **Message → Notification**: When `MessageService` unread counts change, it updates `NotificationService.setMessageUnreadCount()`, which syncs the badge.

2. **Notification → Message**: When a `message_received` notification is marked as read in the notification panel, it triggers a callback that clears the corresponding message unread count.

```typescript
// MessageService constructor
effect(() => {
    const totalUnread = this.totalMessageUnreadCount();
    this.notificationService.setMessageUnreadCount(totalUnread);
});

this.notificationService.onMessageNotificationRead((notebookId, pageId) => {
    // Clear local unread count when notification is marked read
    this._unreadCounts.update((counts) => counts.filter((c) => c.pageId !== pageId));
});
```

### API Call Optimization

The `markAsRead` methods skip API calls when there are no unread items:

```typescript
// MessageService
markAsReadByPageId(pageId: string): Observable<void> {
    // Skip API call if no unread messages for this page
    if (!this.hasUnreadByPageId(pageId)) {
        return of(undefined);
    }
    // ... make API call
}

// NotificationService
markAsRead(id: string): Observable<void> {
    const notification = this.notifications().find((n) => n._id === id);
    // Skip if already read
    if (notification?.read) {
        return of(void 0);
    }
    // ... make API call
}
```

### Badge Count

The app icon badge uses `totalUnreadCount` which combines notifications and messages:

```typescript
syncBadgeCount(): void {
    if (this.nativeBridge.isNativeApp()) {
        this.nativeBridge.setBadge(this.totalUnreadCount());
    }
}
```

### IndexedDB Persistence

Notifications are persisted to IndexedDB for offline support:

```typescript
const STORE_NAME = DB_STORES.NOTIFICATION; // 'notification'

// Hydrate from cache on init
const cached = await this.indexedDB.getAll<Notification>(STORE_NAME);
this.store.update(setEntities(cached));

// Persist when fetching
await this.indexedDB.putMany(notifications, STORE_NAME);
```

### Key Methods

**NotificationService:**

| Method                         | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| `fetchNotifications()`         | Fetch notifications from server, update store       |
| `markAsRead(id)`               | Mark single notification as read                    |
| `markAllAsRead()`              | Mark all notifications as read                      |
| `markNotebookMessagesAsRead()` | Mark all message notifications for notebook as read |
| `markPageMessagesAsRead()`     | Mark all message notifications for page as read     |
| `setMessageUnreadCount()`      | Set message unread count (called by MessageService) |
| `onMessageNotificationRead()`  | Register callback for when messages are marked read |
| `syncBadgeCount()`             | Sync badge with native app                          |

**MessageService:**

| Method                    | Description                                |
| ------------------------- | ------------------------------------------ |
| `markAsRead(notebookId)`  | Mark notebook as read (skips if no unread) |
| `markAsReadByPageId()`    | Mark page as read (skips if no unread)     |
| `hasUnreadByPageId()`     | Check if page has unread messages          |
| `hasUnreadByNotebookId()` | Check if notebook has unread messages      |
| `loadUnreadCounts()`      | Load all unread counts from server         |

### Test Files

| File                           | Coverage                                           |
| ------------------------------ | -------------------------------------------------- |
| `notification.service.spec.ts` | Elf store, unread counts, badge sync, mark as read |
| `message.service.spec.ts`      | Message handling, notification integration         |

---

## Quick Reference

| Do                             | Don't                               |
| ------------------------------ | ----------------------------------- |
| Use Tailwind classes           | Write custom CSS unless necessary   |
| Use signals for state          | Use BehaviorSubject in components   |
| Separate component files       | Inline templates/styles             |
| Run Prettier on save           | Manually format code                |
| Use `import type`              | Import types without `type` keyword |
| Use design tokens              | Hardcode colors                     |
| One concern per page component | Combine views with conditionals     |
| Route-level view switching     | Component-level type checking       |
| Use HttpClient for API calls   | Use raw fetch()                     |
