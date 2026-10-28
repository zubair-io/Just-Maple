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

**Documented exception:** `ApiRequestService` (`services/api-request.service.ts`) uses raw `fetch()` on purpose. It sends requests to arbitrary third-party APIs defined in note content, so the app's auth interceptor must NOT run — it would attach the user's Maple bearer token to every external call and leak it. It uses `credentials: 'omit'` and confirms the destination origin before sending an auth token. Do not convert it to `HttpClient` without an interceptor bypass (e.g. an `HttpContext` flag or `HttpBackend`).

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

One rule keeps the counts honest: **a chat is either read or not.** A message from someone else creates a `message_received` notification for each other member (so do bot-API posts and proactive bot posts; a bot's threaded reply to your own @mention does not). Reading a chat, from anywhere, moves your read marker to now **and** clears that chat's notifications on the server. So the app icon badge is simply the number of unread notifications, on the server (push badge) and in the web app (native badge) alike.

### How a message flows

1. A message is posted. The API broadcasts it, then creates one notification per other member with `data.notebookId` and `data.pageId` (the chat), and sends a push whose badge is that user's unread notification count.
2. Unread message counts per chat are messages newer than your read marker, **excluding your own** (bot posts stored under your id still count). Thread replies count too.
3. Reading a chat (`POST /api/pages/:id/read` or `POST /api/notebooks/:id/read`) runs `markChatAsRead` in `apps/api/src/services/notification.service.ts`: read marker + that chat's notifications. Older notifications without a `pageId` match by notebook. The response includes `unreadNotificationCount`.
4. Marking a `message_received` notification read (`PATCH /api/notifications/:id/read`) reads its chat too. `PATCH /api/notifications/read-all` reads every chat that had notifications.
5. The web app takes `unreadNotificationCount` from each response and sets the native badge from it.

### Architecture

```
apps/web/src/app/services/
├── notification.service.ts  # Centralized notification store (Elf)
├── message.service.ts       # Message handling with unread counts
└── db-stores.ts             # IndexedDB store constants
apps/api/src/services/
└── notification.service.ts  # Create + push, markChatAsRead, describePushSetup
```

### Key Signals

**NotificationService:**

| Signal                    | Type                     | Description                                                                  |
| ------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `notifications`           | `Signal<Notification[]>` | Newest notifications from Elf store (one page, not all)                      |
| `unreadNotificationCount` | `Signal<number>`         | Server's count of ALL unread notifications (local count until first loaded)  |
| `messageUnreadCount`      | `Signal<number>`         | Total message unread count (set by MessageService; informational)            |
| `totalUnreadCount`        | `Signal<number>`         | App badge = `unreadNotificationCount` (messages are NOT added; see Overview) |
| `unreadCount`             | `Signal<number>`         | Legacy alias for `unreadNotificationCount`                                   |

**MessageService:**

| Signal                    | Type                    | Description                   |
| ------------------------- | ----------------------- | ----------------------------- |
| `unreadCounts`            | `Signal<UnreadCount[]>` | Unread counts per page        |
| `totalMessageUnreadCount` | `Signal<number>`        | Sum of all page unread counts |

### Keeping the two in step

- `MessageService.markAsRead` / `markAsReadByPageId` **always** call the API. Do not add a "skip if local count is 0" shortcut: the local count is often stale (not loaded yet, changed on another device), and skipping meant the server never learned the chat was read.
- After a read, `MessageService` calls `NotificationService.markChatNotificationsRead(chat, unreadNotificationCount)`, which marks the chat's notifications read locally (no extra API calls) and takes the server count.
- Realtime `message` and `thread_message` events go through `MessageService.trackUnread`: ignored if you wrote it, marked read if its chat is open, otherwise counted locally and `NotificationService.scheduleUnreadRefresh()` fetches the new badge count.
- When a notification is marked read in the panel, `onMessageNotificationRead` clears the chat's local message count; after mark-all, `onAllNotificationsRead` reloads all message counts.

### Push delivery

`describePushSetup()` reports the method and what is missing; the API prints it at startup (`Push: ...`).

- **Direct APNs** only when `ORIGIN=https://justmaple.app` and `APNS_KEY_ID`, `APNS_TEAM_ID`, plus `APNS_KEY` or `APNS_KEY_PATH` are set. A token from the other APNs environment is retried there and its registration corrected; a token Apple reports as `Unregistered` is removed.
- **Paperbark relay** everywhere else; needs `PAPERBARK_API_KEY` (and `PAPERBARK_URL`). Without it every push fails and the log says so.

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

| Method                        | Description                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| `fetchNotifications()`        | Fetch newest notifications and the total unread count            |
| `refreshUnreadCount()`        | Fetch the unread count (`GET /api/notifications/unread-count`)   |
| `scheduleUnreadRefresh()`     | Debounced refresh after a message from someone else arrives      |
| `markAsRead(id)`              | Mark one notification read (a message one reads its whole chat)  |
| `markAllAsRead()`             | Mark all read, including ones not loaded locally                 |
| `markChatNotificationsRead()` | Mirror a chat read locally and take the server count             |
| `setMessageUnreadCount()`     | Set message unread count (called by MessageService)              |
| `onMessageNotificationRead()` | Register callback for when a message notification is marked read |
| `onAllNotificationsRead()`    | Register callback for after mark-all                             |
| `syncBadgeCount()`            | Sync badge with native app                                       |

**MessageService:**

| Method                    | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `markAsRead(notebookId)`  | Mark a notebook's chat read (always calls API) |
| `markAsReadByPageId()`    | Mark a chat read (always calls API)            |
| `hasUnreadByPageId()`     | Check if page has unread messages              |
| `hasUnreadByNotebookId()` | Check if notebook has unread messages          |
| `loadUnreadCounts()`      | Load all unread counts from server             |

### Test Files

| File                                                        | Coverage                                               |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `apps/web/.../__tests__/notification.service.spec.ts`       | Elf store, server count, badge sync, mark as read      |
| `apps/web/.../__tests__/message.service.spec.ts`            | Message handling, read calls, realtime unread tracking |
| `apps/api/src/routes/__tests__/notifications.test.ts`       | Reading clears notifications, unread counts, mark-all  |
| `apps/api/src/services/__tests__/notification-push.test.ts` | Push result reporting, APNs environment retry          |

---

## Data Page Sharing ("single-player lite")

Data pages (`devicedata`: iMessage, Mail, Calendar, Contacts, Places, Health) show their **creator's** device data.

1. Everyone in the notebook can view a page; only its creator renames, moves, removes or changes it (enforced in `page.repo.ts` `updatePage`/`deletePage` and `routes/pages.ts`, 403 for others).
2. `page.deviceFilter` says what the page shares (calendars, mailboxes, chats, Places time windows and excluded named places, or `includeAll`). It applies to the page view, its search, item lookups and bot tools. `page.description` tells bots what the page is for.
3. No filter (older pages, new pages in private notebooks): the creator sees everything, nobody else sees anything. A new page in a shared notebook starts with `{}`, and moving a page into a shared notebook resets it to `{}`: nothing shared until the creator picks. Saving only a name or description never changes sharing.
4. In a shared notebook the filter applies to **every** reader, the creator's own bots, proactive news (`notifyProactive`) and leave-now reminders included: an unfiltered page there gives bots nothing. Only the creator's own page view shows everything. Private notebooks are unchanged.
5. Trashed or archived pages, and pages whose creator is no longer a member, share nothing (`dataPageView` in `device-data-access.service.ts`). A removed creator's pages are hidden, not deleted; they find them at `GET /api/device-data/pages/left` and can still trash or delete them. Every bot path checks the bot owner is still a member.
6. Calendars and chats match by stable id (`extra.calendarId`, `extra.chatId` from the Mac collector) when both sides have one, else by name. Data pages are never published, and `emptyTrash` skips other people's data pages.
7. Bots: `getMacDataToolContext` gets one slice per visible page (`dataPageSlicesFor`); bots someone outside shared in still get nothing.
8. Adding a notebook's first data page also adds its **About me** and **Graph** (one each per notebook, fixed ids; `addCompanionPages` in `routes/pages.ts`). Nobody creates them by hand, and one someone trashed stays trashed. The web groups them under the Device Data tab, whose **+ Create Device Data** menu picks the source.

Key files: `packages/shared/src/schemas/device-data-filter.ts`, `packages/shared/src/utils/device-data-filter.ts` (matcher, summary), `apps/api/src/services/device-data-access.service.ts`, `routes/device-data.ts` (`PATCH /api/device-data/pages/:id`, `GET .../options`), web `device-data-settings.component.*`.

---

## Add to calendar (bot proposals)

The one thing that flows from the cloud back to a device.

1. A bot that reads the user's own calendar gets `propose_calendar_event`. It saves a proposal (`calendar_proposals`) and the server attaches an `event_proposal` card to the reply. Bots can only propose; the card is built from the saved proposal, never from model output.
2. The calendar's owner taps **Add to calendar** (`POST /api/calendar-proposals/:id/confirm`). Only they can; other members see the card with the button inactive. A second tap does nothing.
3. That queues a `create_event` action for the Mac collecting `calendar`, and nudges it over the relay (`runActions`). The Mac also checks after each upload, on every poll and when it connects: `GET /api/collectors/:deviceId/actions`, then `POST .../actions/:id/result`.
4. The Mac adds the event with EventKit (default calendar, or the one picked in Settings → Devices) and reports the event identifier and its `calendar:<id>@<start>` item id. It saves each success before reporting (failures aren't saved, so Try again really retries) and marks the event with `justmaple://calendar-action/<id>`, so retries never add it twice; the server ignores repeated reports. An action a Mac holds for 15 minutes without reporting, or after it stops collecting the calendar, goes back to the queue; a late success from it still counts.
5. Every change is broadcast as `calendar_proposal_updated`; the card shows proposed → adding (or "will be added when your Mac is next on" after 10 minutes without it) → added (opens the calendar item) / failed (reason, Try again) / expired (7 days). Expiry and stranded actions are caught up whenever a card is read, tapped, proposed or polled, and broadcast. The same event (title and start) is offered once per user across notebooks, and never again once added. Queries on `calendar_proposals` sort in code (Cosmos needs an index for every sort).

Key files: `calendar-proposal.service.ts` / `.repo.ts` / `routes/calendar-proposals.ts` (API), `event-proposal-card` (web), `MacData/CalendarActions.swift` (Mac).

---

## Home Assistant (`home` source)

**Only entities the user exposed to assistants in Home Assistant are ever read, uploaded, shown to bots or controlled.**

1. The Mac connects to Home Assistant's WebSocket with a long-lived token kept in the Keychain only (entered in a native window, never in the web page, never uploaded or logged). `auth_invalid` stops retrying: Home Assistant bans addresses that keep failing.
2. It reads `homeassistant/expose_entity/list` (both the `{assistant: bool}` and older `{should_expose}` formats, at most 10,000), then `subscribe_entities` with `entity_ids` set to exactly that list. Never a subscription to everything, and never one with an empty list (that would mean every entity). The list is read again on every connect, every 5 minutes, whenever the entity registry changes (`entity_registry_updated`; un-exposing writes there, and a registry entry whose `options` show no assistant exposing it counts as un-exposed at once), and right before every action; a change resubscribes. Reads are numbered as sent, so an older one finishing late never overwrites a newer one. Each connection has a generation: work a stopped connection finishes late writes nothing (exposure, sink, uploads, subscription), and only Home Assistant's own refusals of the registries are tolerated, not a closed connection. Messages go out through one ordered queue per connection.
3. The Mac uploads the exposed list (`PUT /api/home/exposure`) before any item. The server hides home items of entities not on it (`homeExposureMatcher`, fails closed) but keeps them, so re-exposing brings them back. Items: `home:<entity>` (current state, kept however old) and `home:<entity>@<time>` (a change, 30 days). Updates are coalesced (`HomeChangeCoalescer`): at most every 10 s, readings like watts at most every 5 minutes, 20 changes an hour per entity. Coordinates never leave the Mac.
4. Page filters pick entities or areas. Who's home needs `includePresence` or picking the entity, and bots never see it on a page without such a filter. The rule is `isHomePresence` in shared: `person.*`, `device_tracker.*`, `zone.*`, groups whose state is home/not_home, `binary_sensor.*_presence`, device class `presence`, device class `occupancy` without an area (a person's, not a room's), and phone sensors that give a place away (geocoded location, SSID/BSSID, Wi-Fi connection). Home is left out of the graph and of proactive news.
5. Bots read with `get_home_states` and propose with `propose_home_action` (light, switch, fan, cover, climate, lock, media_player, scene, script; one value per service, see `HOME_SERVICES`). The owner taps the `home_proposal` card; sensitive actions need a second tap (`428` without `acknowledged`), on the first try and on every retry. Sensitive is `isSensitiveHomeEntity` in shared (mirrored in `HomeServiceRules.isSensitive` on the Mac, which refuses an unmarked one): every lock, scene and script (offered in v1, but always twice, and an autonomy setting may never run them without asking), and covers or switches that are or are named like a garage door, gate, door, lock or opener (`switch.garage_opener`). That queues a `home_service` action on the #293 queue for the Mac collecting `home`, valid 15 minutes. The Mac checks the rules and the exposed list it reads right then before `call_service`. Home actions are always a tap today: they don't go through `decideAutonomy` or the action log yet (when they do, pass `known` from the stored entity). The home page loads current states and changes as separate lists (`homeKind=state|change` on `GET /api/device-data/items`), so changes never crowd devices off it. The token is in the data protection Keychain.

Key files: `packages/shared/src/schemas/home.ts`, `apps/api/src/services/home.service.ts`, `repositories/home-*.repo.ts`, `routes/home.ts`; web `home-view`, `home-proposal-card`; Mac `HomeAssistant/` and `MacData/MacDataEngine+Home.swift`.

---

## Bot action log and autonomy

Every action a bot proposes or performs is one row in `bot_actions`, and its owner decides per bot and per kind whether the bot asks, acts on its own, or never acts.

1. A feature asks `decideAutonomy` (`bot-action.service.ts`) first. The owner's setting (`bot_autonomy`, default **Ask every time**) is lowered by hard floors: `isAlwaysAsk` in `@maple/shared` (sending messages or email, unlocking, opening garage doors or gates, disarming, `notify`) is always Ask, and **Do it and tell me** only applies in the owner's own private notebook; anywhere shared it's Ask. **Never** stays never. Bots never see or change settings (`/api/bot-autonomy/:botId` is for people only).
    - Home Assistant: the domain comes **only from the entity id** (`lock.front` → `lock`); a `domain` or `deviceClass` the bot sends is ignored. `ALWAYS_ASK_HOME_DOMAINS` (`homeassistant`, `script`, `scene`, `button`, `switch`, `valve`, `lock`, `alarm_control_panel`, `cover`) always ask unless the server passes `known: { safe: true }` (from Home Assistant, never the bot). Unlocking, disarming, opening a garage/gate/door (by entity id or a server-known device class), `notify`/`tts`, and everything `isSensitiveHomeEntity` marks (the Home Assistant card's double confirm: every lock, scene and script, and garage/gate/door covers and opener switches, by id, server-known name or device class) ask even then. Pass `known.name` and `known.deviceClass` from Home Assistant.
2. It writes the log through `recordAction` / `updateAction`: proposed / auto / denied → queued → done / failed / undone / expired, with who approved, the result or error. A row never moves back from done, undone, expired or denied. Changes to rows posted in a chat are broadcast as `bot_action_updated`, without parameters. "Never" rows have a fixed id per bot and event, so a bot that keeps finding the same email updates one row; events already offered or added are checked before the setting, so they never log a denied row.
3. Auto actions get an `action_receipt` card ("Done: … · Undo") on the bot's reply (`withActionReceipts`, `attachActions`), added by the server only.
4. Undo is offered to the owner for 24 hours after done (`POST /api/bot-actions/:id/undo`). For `calendar_add` it queues a `delete_event` for the Mac that added the event (or, if that Mac no longer collects the calendar, the one that does, and the row says so with `undo.fallback`), next to `create_event`. The Mac removes the event only if it still carries the `justmaple://calendar-action/<proposal id>` marker. Removed: the proposal reads `removed` and the bot won't offer it again. Nothing found: the Mac reports `outcome: 'not_found'`, the card says "Couldn't find it on your Mac" (not Undone), the proposal reads `not_found`, and the bot may offer the event again.
5. Cancel (`POST /api/bot-actions/:id/cancel`) stops a queued add: before a Mac takes it, the row is denied and the proposal `cancelled`; once a Mac holds it, it's undone as soon as the Mac reports it added. Try again on a failed automatic add is the owner's approval (decision `ask`, approvedBy the owner).
6. Reads: a bot's Activity (its settings, owner only) and a notebook's **Activity** page (one per notebook, from + New). Members see their own actions in full; other people's only if posted in that notebook's chats, and only the summary. Visibility and the kind/status filters run in the query, before the limit; reading one card catches up only that row.

Calendar proposals share their id with their log row; `syncCalendarAction` (`calendar-action.service.ts`) follows every proposal change. **Adding a kind:** add it to `BotActionKindSchema` and `BOT_ACTION_KINDS` (and `isAlwaysAsk` if some calls must always ask), call `decideAutonomy` → `recordAction` → `updateAction` from the feature, and register `settle` / `settleOne` / `cancel` / `undo` / device-queue handlers in `bot-action-kinds.ts` if it has them. Proposals from before the log get their row the first time they change, dated by the proposal's `createdAt`.

Key files: `packages/shared/src/schemas/bot-action.ts`, `bot-action.service.ts` / `bot-activity.service.ts` / `bot-action-kinds.ts` / `calendar-action.service.ts` / `bot-action.repo.ts` / `routes/bot-actions.ts` (API), `action-receipt-card`, `action-log`, `bot-autonomy`, `activity-view` (web).

---

## Drafted replies

A bot drafts a reply in the user's voice; the user sends it themselves. Maple never sends anything.

1. **When.** Only in a run answering a person's chat message (`draftsAllowed`, set for `sourceType: 'message'`). Proactive posts (runs the bot starts itself from new device data) never get `draft_reply`; the prompt also tells the bot to draft only when asked. Even in chat, the bot needs one of the **user's own** iMessage or Mail data pages in the notebook (other members' shared pages don't count), and the message must pass that page's filter.
2. **Voice.** The first call (just `item_id`) returns the message and up to five things the user wrote: in that thread, else elsewhere in what the notebook shares. For email, "the user wrote it" means the sender is one of their own addresses: their account email plus the emails on their "me" contact card (`ownEmailAddresses` / `isMailFromMe` in `packages/shared/src/utils/own-addresses.ts`). Mailbox names ("Sent") are used only when no address is known. The lookup reads at most 200 recent message headers, newest first, without bodies, then loads the bodies of the five it picked.
3. **Saving.** The second call, with `body`, saves a `send_reply` row (status `proposed`, decision `ask`, expires in 7 days). Drafting the same message again replaces a waiting draft only if the user hasn't edited it (`params.editedAt`); it then gets a fresh expiry and the new bot's id and name. An edited draft is kept and a new row is made. With the bot's setting at **Never**, a `denied` row is logged without the text.
4. **Recipient.** Always from the message: an iMessage thread's participants (or its chat id), an email's sender. The bot can't pass one, so text in a message can't redirect a reply. The user's own messages and sent mail are refused.
5. **What others see.** The reply gets a `reply_draft` card carrying only the row id; the card loads the row (`GET /api/bot-actions/:id`), and only the owner gets the details. In a notebook anyone besides the owner can read, a run that drafted posts a fixed line instead of anything the bot wrote ("Drafted a reply — only you can see it.", or a "didn't save it" line if it read the thread but saved nothing; `draftRunNotice`). The tool result there tells the bot not to name anyone. The bot's raw output is also replaced in the stored invocation (`$response` and every variable that held it), and `GET /api/invocations/:id` leaves out `variables` for anyone but the person who started the run. In the owner's private notebook the bot's text is posted as written.
6. **Stranded drafts.** A draft saved in a run whose reply never posted (the run failed, or the card wasn't attached) is marked `expired` at the end of the run (`expireUnpostedDrafts`), so no draft waits without a card.
7. **Owner's actions.** Save edits (`PATCH /api/reply-drafts/:id` with `updatedAt`: refused with 409 if the draft changed since, so an old tab can't overwrite a redraft; the card keeps the user's text and the next save is based on the new version), open (`POST .../open`, returns the link) or discard (`POST .../discard`). Other members get 403, anyone else 404; a `denied` row says drafting is off for that bot. The same Open / Copy / Discard are in the Activity log for waiting drafts. The log: `proposed` → `opened` (again: `result.openCount`) → `discarded`, or `expired`. `send_reply` is always Ask (`isAlwaysAsk`).
8. **Open** is a link (`replyComposeUrl` in `@maple/shared`): `sms:<address>&body=…`, a group `sms:/open?addresses=<a>,<b>&body=…` (every address fully encoded, so "+" stays "+"), or `mailto:<address>?subject=Re: …&body=…` with CRLF line breaks. The user presses send in Messages or Mail. In the native app the web view hands `sms:` and `mailto:` to the system (`ComposeLinks.shouldOpenExternally`) only for a link the person tapped (`linkActivated`), in the main frame, on a page from the app's own server; scripts, redirects, frames and other sites can't open them, and `imessage:` isn't handled. We chose links over a Mac collector action (NSSharingService or Mail AppleScript): AppleScript needs the Apple Events entitlement and a permission prompt, and a Mac action would pop a window on a Mac the user may not be sitting at. Mail can't thread the reply with In-Reply-To (the Mac doesn't upload Message-ID headers); the "Re:" subject keeps it together.

**What is verified:** the links' exact text (shared unit tests), the web view's decision (Swift tests), and everything server-side (API tests). **Not verified on a device:** that Messages fills in the body. iOS reads `sms:…&body=`; macOS Messages may open the conversation with only the recipient filled, and the group form is an iOS one. That's why Copy is always next to Open.

Key files: `packages/shared/src/schemas/reply-draft.ts`, `packages/shared/src/utils/reply-draft.ts`, `reply-draft.service.ts` / `routes/reply-drafts.ts` (API), `reply-draft-card` (web), `ComposeLinks.swift` (Apple).

---

## Proactive Timing ("now or wait")

A proactive bot doesn't post about every batch of device news. It decides whether the user needs to hear it now.

1. Each batch (about 60 seconds of uploads) joins the chat's **pending pile** (`proactive_piles`, one per chat, in the database). The whole pile is then re-scored: one cheap triage call (`proactive-triage.service.ts`, server key, `PROACTIVE_TRIAGE_MODEL`) over short summaries of each item, plus signals found in code (calendar clashes, events changed that start within a day, threads waiting on the user, big piles).
2. **Now** means time-sensitive, a direct question or request, a schedule change or conflict, or something from a close person that needs a reply. A calendar clash is always now. Then the bot writes one message about the whole pile, and the covered items leave it.
3. Otherwise the pile waits: until a later arrival tips it, its oldest item has waited `maxWaitMinutes` (default 2 hours; the scheduler's `flushWaitingNews` sends a summary), or the morning brief takes it in. **Quiet hours** (default 22:00–07:00, owner's zone) and the hour before the brief hold everything except "now".
4. **Revising:** if the bot's latest post in the chat is a news post the **owner** hasn't read (read marker older than its last version), nothing was posted after it, nobody replied in its thread, and it's under 12 hours old, the new message replaces it (`reviseBotMessage`, broadcast as `edited`, shown as "Updated 3:40 PM"). Earlier versions stay in `revisions`. No new notification, unless urgency rose: then one push, "Updated: <what changed>". Briefs, leave reminders and About me questions are never revised.
5. Triage calls are capped per chat per day (`PROACTIVE_TRIAGE_BUDGET`, default 60); past it, or without a key, only the code signals decide (so only clashes go now). **Every item** (`everyItem`) turns all of this off for a chat.

Settings live on `page.proactive` (`maxWaitMinutes`, `quietHours`, `everyItem`), edited in the proactive bot panel. Key files: `proactive-bot.service.ts` ("Now or wait"), `proactive-triage.service.ts`, `proactive-pile.repo.ts`, `proactive-scheduler.service.ts`, `bot-executor.service.ts` (`runProactive` `revise`).

---

## Bot Web Search

Bots can search the web (`web_search`) and read pages (`fetch_page`). Both are our own tools, offered the same way to every provider through `llm-tool-loop.service.ts`; there are no provider-native search tools.

1. The server needs `BRAVE_SEARCH_API_KEY`. Without it the tools are never offered and the settings switch is hidden (`GET /api/user-bots` returns `webSearchAvailable`).
2. Each bot has a switch, `config.webSearch`, **off by default**. Proactive runs also need `config.webSearchProactive`, and even then they only get `web_search`, never `fetch_page`.
3. Searches per bot owner per UTC day are capped by `WEB_SEARCH_DAILY_LIMIT` (default 50), counted in `web_search_usage` (one document per owner per day, `_id` `owner:day`). Each LLM action may run up to 5 searches and 5 page reads; limits and the Sources list start fresh for every action.
4. `fetch_page` only opens a URL exactly as it appeared in that action's search results or in the user's own message (not note content, not fetched text), so injected text can't make the bot send private data out in a URL. URLs with personal details in them are refused too.
5. Every hop (first URL and each redirect) must be http(s) and resolve only to public addresses. The request then connects to the address that was checked, with the original Host header and TLS name (`sendPinned`), so a DNS answer that changes in between is never used, and proxy env vars are ignored. Also: a timeout, a 1 MB read cap, text-only content types, scripts stripped.
6. Search results and page text reach the model NFKC-normalized, with invisible characters and any form of the wrapper name removed, wrapped in `<untrusted_web_content id="…">` with a random id per call. The system prompt says text inside is never an instruction.
7. The prompt forbids personal details in queries. Queries with email addresses, account-like numbers, phone numbers or street addresses are refused.
8. Replies link their sources; if a reply used the web but has no links, a short **Sources** list is appended.

Key files: `apps/api/src/services/web-search.service.ts` (provider interface, Brave, tools, page fetcher), `repositories/web-search-usage.repo.ts`, `bot-executor.service.ts` (tool assembly), web `bots.component.*`.

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
