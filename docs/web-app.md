# Web App Documentation (SugarMaple)

This guide covers the Angular frontend application, including component architecture, state management, and development patterns.

## Overview

**SugarMaple** is the Angular 21 web application that provides:

- Single-page application (SPA) with routing
- Offline-first data persistence
- Real-time collaboration with Yjs
- Rich text editing with TipTap
- PWA support with service workers

---

## Core Concepts

### Notebooks

Notebooks are the primary organizational unit in Just Maple. They function as folders that contain pages and can be shared with other users.

#### Creating a Notebook

1. Click the **+** button in the sidebar
2. Enter a name for the notebook
3. The notebook appears in the sidebar and is ready to use

#### Notebook Properties

| Property    | Description                                     |
| ----------- | ----------------------------------------------- |
| `label`     | Display name of the notebook                    |
| `value`     | Content type: `mixed`, `recordings`, or `notes` |
| `sharing`   | Access permissions (owner, write, read, public) |
| `createdAt` | Timestamp when notebook was created             |
| `updatedAt` | Timestamp of last modification                  |

#### Sharing & Permissions

Notebooks support granular access control:

| Access Level | Capabilities                                |
| ------------ | ------------------------------------------- |
| **Owner**    | Full control, can delete and manage sharing |
| **Write**    | Can create, edit, and delete pages          |
| **Read**     | Can view pages but not modify               |
| **Public**   | Anyone with the link can view (read-only)   |

To share a notebook:

1. Open the notebook
2. Click the share icon in the header
3. Enter the email of the user to invite
4. Select the access level (Read or Write)

#### Notebook Summary

The notebook summary page (shown when clicking a notebook in the sidebar) displays:

- Total page count
- Page breakdown by type (memos, whiteboards, recordings, etc.)
- Task statistics (total, completed, pending, overdue)

### Page Types

Pages are the content units within notebooks. Each page has a specific type that determines its editor and capabilities.

| Type            | Icon          | Description                                  |
| --------------- | ------------- | -------------------------------------------- |
| **Memo**        | `edit_note`   | Rich text documents with TipTap editor       |
| **Whiteboard**  | `draw`        | Freeform canvas for drawing and diagrams     |
| **Recording**   | `mic`         | Audio recordings with optional transcription |
| **Message**     | `chat`        | Chat-style messages within the notebook      |
| **Kanban**      | `view_kanban` | Kanban board for task management             |
| **Collectable** | `grid_view`   | Collection items (e.g., LEGO sets)           |

#### Memo Pages

Memos are rich text documents powered by TipTap. They support:

- **Formatting**: Bold, italic, strikethrough, code
- **Blocks**: Headings, lists, blockquotes, code blocks
- **Tables**: Full table support with resizable columns
- **Task Lists**: Enhanced todos with priority, color, and due dates
- **Embeds**: Recordings and whiteboards embedded inline
- **Slash Commands**: Type `/` to insert blocks quickly
- **Real-time Collaboration**: Multiple users can edit simultaneously

#### Whiteboard Pages

Whiteboards provide a freeform canvas for:

- Freehand drawing with pressure sensitivity
- Shape tools (rectangles, ellipses, lines)
- Text annotations
- Image uploads
- Real-time collaboration with cursors

#### Recording Pages

Recordings capture audio with optional AI-powered features:

- Audio recording with waveform visualization
- Whisper-based transcription (local processing)
- AI-generated summaries
- Playback controls with speed adjustment

#### Creating Pages

1. Navigate to a notebook
2. Use the sidebar **+** button or slash commands in a memo
3. Select the page type
4. The page opens in the appropriate editor

#### Page Routing

Pages use a hierarchical URL structure:

```
/:notebookId           → Notebook summary
/:notebookId/:pageId   → Page view (type determined by route guard)
```

Route guards (`canMatch`) determine which component loads based on the page type stored in the database.

---

## Project Structure

```
apps/web/src/
├── app/
│   ├── components/
│   │   ├── atoms/              # Basic UI elements
│   │   │   ├── button/
│   │   │   ├── input/
│   │   │   ├── icon/
│   │   │   └── index.ts        # Barrel export
│   │   ├── molecules/          # Composed components
│   │   │   ├── form-field/
│   │   │   ├── editor-toolbar/
│   │   │   └── index.ts
│   │   └── organisms/          # Complex components
│   │       ├── sidebar/
│   │       ├── chat/
│   │       ├── notebook-editor/
│   │       └── index.ts
│   ├── pages/                  # Route components
│   │   ├── login/
│   │   ├── chat-view/
│   │   ├── note-view/
│   │   ├── notebook/
│   │   ├── settings/
│   │   └── notifications/
│   ├── services/               # Business logic
│   │   ├── auth.service.ts
│   │   ├── notebook.service.ts
│   │   ├── page.service.ts
│   │   ├── message.service.ts
│   │   ├── realtime-ws.service.ts
│   │   ├── connectivity.service.ts
│   │   ├── offline-queue.service.ts
│   │   └── native-bridge.service.ts
│   ├── guards/                 # Route guards
│   │   ├── auth.guard.ts
│   │   └── page-type.guard.ts
│   ├── interceptors/           # HTTP interceptors
│   │   └── auth.interceptor.ts
│   ├── layouts/                # Layout components
│   ├── types/                  # TypeScript types
│   └── app.routes.ts           # Route definitions
├── environments/               # Environment configs
│   ├── environment.ts
│   ├── environment.prod.ts
│   └── environment.paperbark.ts
├── styles.scss                 # Global styles
└── index.html                  # Entry point
```

---

## Component Architecture

### Atomic Design Pattern

Components follow the atomic design methodology:

| Level         | Description           | Examples                     |
| ------------- | --------------------- | ---------------------------- |
| **Atoms**     | Basic building blocks | Button, Input, Icon, Badge   |
| **Molecules** | Groups of atoms       | FormField, SearchBar, Avatar |
| **Organisms** | Complex UI sections   | Sidebar, Chat, NoteEditor    |
| **Templates** | Page layouts          | MainLayout, AuthLayout       |
| **Pages**     | Route components      | LoginPage, NotebookPage      |

### Component Structure

Each component has separate files:

```
components/atoms/button/
├── button.component.ts         # Component class
├── button.component.html       # Template
└── button.component.scss       # Styles
```

### Component Example

```typescript
// button.component.ts
import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-button',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './button.component.html',
    styleUrl: './button.component.scss',
})
export class ButtonComponent {
    // Use input() for inputs (Angular 17+ syntax)
    readonly variant = input<'primary' | 'secondary' | 'ghost'>('primary');
    readonly size = input<'sm' | 'md' | 'lg'>('md');
    readonly disabled = input<boolean>(false);
    readonly loading = input<boolean>(false);

    // Use output() for outputs
    readonly clicked = output<void>();

    onClick(): void {
        if (!this.disabled() && !this.loading()) {
            this.clicked.emit();
        }
    }
}
```

```html
<!-- button.component.html -->
<button [class]="buttonClasses()" [disabled]="disabled() || loading()" (click)="onClick()">
    @if (loading()) {
    <app-spinner size="sm" />
    }
    <ng-content />
</button>
```

---

## State Management

### Angular Signals

Use signals for all component state:

```typescript
import { Component, signal, computed } from '@angular/core';

@Component({
    selector: 'app-counter',
    standalone: true,
    template: `
        <p>Count: {{ count() }}</p>
        <p>Doubled: {{ doubled() }}</p>
        <button (click)="increment()">+</button>
    `,
})
export class CounterComponent {
    // Writable signal
    readonly count = signal(0);

    // Computed signal (derived state)
    readonly doubled = computed(() => this.count() * 2);

    increment(): void {
        this.count.update((c) => c + 1);
    }
}
```

### Service State

Services use signals for shared state:

```typescript
// notebook.service.ts
import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NotebookService {
    // Private writable signal
    private readonly _notebooks = signal<Notebook[]>([]);
    private readonly _selectedId = signal<string | null>(null);

    // Public readonly access
    readonly notebooks = this._notebooks.asReadonly();
    readonly selectedId = this._selectedId.asReadonly();

    // Computed values
    readonly selectedNotebook = computed(() => {
        const id = this._selectedId();
        return this._notebooks().find((n) => n._id === id) ?? null;
    });

    // Methods to update state
    setNotebooks(notebooks: Notebook[]): void {
        this._notebooks.set(notebooks);
    }

    selectNotebook(id: string): void {
        this._selectedId.set(id);
    }
}
```

### Do NOT Use

- `BehaviorSubject` for component state
- RxJS operators in components (use in services only)
- NgRx or other external state libraries

---

## Routing

### Route Configuration

```typescript
// app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { pageTypeGuard } from './guards/page-type.guard';

export const routes: Routes = [
    // Public routes
    {
        path: 'login',
        loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
    },

    // Protected routes
    {
        path: '',
        canActivate: [authGuard],
        children: [
            {
                path: '',
                loadComponent: () =>
                    import('./pages/home/home.component').then((m) => m.HomeComponent),
            },
            {
                path: ':notebookId',
                loadComponent: () =>
                    import('./pages/chat-view/chat-view.component').then(
                        (m) => m.ChatViewComponent,
                    ),
            },
            {
                path: ':notebookId/:pageId',
                canMatch: [pageTypeGuard('write')],
                loadComponent: () =>
                    import('./pages/note-view/note-view.component').then(
                        (m) => m.NoteViewComponent,
                    ),
            },
        ],
    },

    // Fallback
    { path: '**', redirectTo: '' },
];
```

### Route Guards

```typescript
// guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (authService.isAuthenticated()) {
        return true;
    }

    return router.createUrlTree(['/login']);
};
```

### Page Component Separation

Each page handles **one concern only**:

```typescript
// Good: Separate components for each view type
// chat-view.component.ts - Only handles chat
// note-view.component.ts - Only handles note editing
// lego-view.component.ts - Only handles lego items
```

Do NOT combine views with conditional rendering:

```typescript
// Bad: Single component handling multiple views
@if (hasNote) {
    <app-note-editor />
} @else {
    <app-chat />
}
```

Use route-level switching with `canMatch` guards instead.

---

## HTTP Requests

### Always Use HttpClient

```typescript
// Good: Use HttpClient with relative URLs
private readonly http = inject(HttpClient);

async getNotebooks(): Promise<Notebook[]> {
    return firstValueFrom(
        this.http.get<Notebook[]>('/api/notebooks')
    );
}
```

```typescript
// Bad: Never use raw fetch
const response = await fetch('/api/notebooks', {
    headers: { Authorization: `Bearer ${token}` },
});
```

### Why HttpClient?

- Uses environment's base URL configuration
- Auth interceptors automatically attach tokens
- Consistent error handling
- Observable-based for better Angular integration

### Auth Interceptor

```typescript
// interceptors/auth.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const authService = inject(AuthService);
    const token = authService.getToken();

    if (token) {
        req = req.clone({
            setHeaders: {
                Authorization: `Bearer ${token}`,
            },
        });
    }

    return next(req);
};
```

---

## Styling

### Tailwind CSS (Primary)

Use Tailwind utility classes for all styling:

```html
<button
    class="px-4 py-2 bg-[var(--color-primary)] text-white rounded-md
           hover:bg-[var(--color-primary-hover)] transition-colors
           disabled:opacity-50 disabled:cursor-not-allowed"
>
    Click me
</button>
```

### Design Tokens

Use CSS variables from `styles.scss`:

```scss
// styles.scss
:root {
    --color-primary: #d94e3b; // Maple red
    --color-primary-hover: #c04433;
    --color-bg: #ffffff;
    --color-bg-secondary: #f5f5f5;
    --color-text-main: #1a1a1a;
    --color-text-muted: #6b7280;
    --color-border: #e5e7eb;
}

[data-theme='dark'] {
    --color-bg: #1a1a1a;
    --color-bg-secondary: #2d2d2d;
    --color-text-main: #ffffff;
    --color-text-muted: #9ca3af;
    --color-border: #404040;
}
```

### SCSS (When Needed)

Only use SCSS for:

- Complex animations
- `::before` / `::after` pseudo-elements
- Styles that can't be expressed in Tailwind

```scss
// button.component.scss
.button {
    &::after {
        content: '';
        position: absolute;
        inset: 0;
        background: currentColor;
        opacity: 0;
        transition: opacity 0.2s;
    }

    &:hover::after {
        opacity: 0.1;
    }
}
```

### Never Use Inline Styles

```html
<!-- Bad -->
<div style="color: red; margin: 10px;">
    <!-- Good -->
    <div class="text-red-500 m-2.5"></div>
</div>
```

---

## Offline Support

### IndexedDB Service

```typescript
// services/indexeddb.service.ts
import { Injectable } from '@angular/core';
import { openDB, IDBPDatabase } from 'idb';

@Injectable({ providedIn: 'root' })
export class IndexedDBService {
    private db: IDBPDatabase | null = null;

    async init(): Promise<void> {
        this.db = await openDB('maple-db', 1, {
            upgrade(db) {
                db.createObjectStore('notebooks', { keyPath: '_id' });
                db.createObjectStore('pages', { keyPath: '_id' });
                db.createObjectStore('messages', { keyPath: '_id' });
                db.createObjectStore('offline-queue', { autoIncrement: true });
            },
        });
    }

    async getAll<T>(store: string): Promise<T[]> {
        return this.db!.getAll(store);
    }

    async put<T>(store: string, value: T): Promise<void> {
        await this.db!.put(store, value);
    }

    async delete(store: string, key: string): Promise<void> {
        await this.db!.delete(store, key);
    }
}
```

### Offline Queue

```typescript
// services/offline-queue.service.ts
import { Injectable, signal } from '@angular/core';

interface QueuedAction {
    id: string;
    type: 'create' | 'update' | 'delete';
    endpoint: string;
    payload: unknown;
    timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
    private readonly _queue = signal<QueuedAction[]>([]);
    readonly queue = this._queue.asReadonly();
    readonly hasQueuedActions = computed(() => this._queue().length > 0);

    enqueue(action: Omit<QueuedAction, 'id' | 'timestamp'>): void {
        this._queue.update((q) => [
            ...q,
            {
                ...action,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
            },
        ]);
        this.persistQueue();
    }

    async processQueue(): Promise<void> {
        const actions = this._queue();
        for (const action of actions) {
            try {
                await this.executeAction(action);
                this._queue.update((q) => q.filter((a) => a.id !== action.id));
            } catch (error) {
                console.error('Failed to process action:', action, error);
            }
        }
        this.persistQueue();
    }
}
```

---

## Real-Time Features

### WebSocket Service

```typescript
// services/realtime-ws.service.ts
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RealtimeWsService {
    private ws: WebSocket | null = null;
    private readonly _connected = signal(false);
    readonly connected = this._connected.asReadonly();

    connect(token: string): void {
        const url = `${environment.wsUrl}/ws/realtime`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this._connected.set(true);
            this.authenticate(token);
        };

        this.ws.onmessage = (event) => {
            this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onclose = () => {
            this._connected.set(false);
            this.scheduleReconnect();
        };
    }

    subscribe(room: string): void {
        this.send({ type: 'subscribe', room });
    }

    private send(message: unknown): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
}
```

### Document Collaboration

```typescript
// services/yjs-document.service.ts
import { Injectable } from '@angular/core';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

@Injectable({ providedIn: 'root' })
export class YjsDocumentService {
    private docs = new Map<string, Y.Doc>();
    private providers = new Map<string, WebsocketProvider>();

    getOrCreateDoc(pageId: string): Y.Doc {
        if (!this.docs.has(pageId)) {
            const doc = new Y.Doc();
            this.docs.set(pageId, doc);

            const provider = new WebsocketProvider(environment.yjsUrl, `page-${pageId}`, doc);
            this.providers.set(pageId, provider);
        }
        return this.docs.get(pageId)!;
    }

    destroyDoc(pageId: string): void {
        this.providers.get(pageId)?.destroy();
        this.docs.get(pageId)?.destroy();
        this.providers.delete(pageId);
        this.docs.delete(pageId);
    }
}
```

---

## Rich Text Editor

### TipTap Integration

```typescript
// components/organisms/note-editor/note-editor.component.ts
import { Component, input, effect } from '@angular/core';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

@Component({
    selector: 'app-note-editor',
    standalone: true,
    templateUrl: './note-editor.component.html',
})
export class NoteEditorComponent {
    readonly pageId = input.required<string>();

    private editor: Editor | null = null;

    constructor() {
        effect(() => {
            const id = this.pageId();
            this.initEditor(id);
        });
    }

    private initEditor(pageId: string): void {
        this.editor?.destroy();

        this.editor = new Editor({
            extensions: [
                StarterKit,
                // Add custom extensions
            ],
            content: '',
            onUpdate: ({ editor }) => {
                this.onContentChange(editor.getJSON());
            },
        });
    }

    ngOnDestroy(): void {
        this.editor?.destroy();
    }
}
```

### Enhanced Todo Feature

The todo/task feature extends TipTap's built-in task list with enhanced attributes for priority, color coding, and due dates.

#### Task Item Attributes

| Attribute  | Type                                  | Description                    |
| ---------- | ------------------------------------- | ------------------------------ |
| `id`       | `string`                              | Unique identifier (UUID-based) |
| `checked`  | `boolean`                             | Completion status              |
| `priority` | `'low' \| 'medium' \| 'high' \| null` | Priority level                 |
| `color`    | `string \| null`                      | Color for visual organization  |
| `dueDate`  | `string \| null`                      | ISO date string for due date   |

#### Extension Files

```
apps/web/src/app/components/organisms/notebook-editor/extensions/
├── enhanced-task-item.ts    # TipTap extension with custom NodeView
├── enhanced-task-list.ts    # Task list container extension
└── ...
```

#### Unique ID Handling

When users press Enter to create new tasks, TipTap copies the previous node's attributes (including the ID). A ProseMirror plugin detects duplicate IDs and assigns new ones:

```typescript
// enhanced-task-item.ts
addProseMirrorPlugins() {
    return [
        new Plugin({
            key: new PluginKey('enhancedTaskItemUniqueIds'),
            appendTransaction(transactions, oldState, newState) {
                if (!transactions.some((tr) => tr.docChanged)) return null;

                const seenIds = new Set<string>();
                const nodesToFix: { pos: number; node: any }[] = [];

                newState.doc.descendants((node, pos) => {
                    if (node.type.name === 'taskItem') {
                        const id = node.attrs['id'];
                        if (seenIds.has(id)) {
                            nodesToFix.push({ pos, node });
                        } else {
                            seenIds.add(id);
                        }
                    }
                    return true;
                });

                if (nodesToFix.length === 0) return null;

                const { tr } = newState;
                nodesToFix.forEach(({ pos, node }) => {
                    tr.setNodeMarkup(pos, undefined, {
                        ...node.attrs,
                        id: generateTodoId(),
                    });
                });
                return tr;
            },
        }),
    ];
}
```

#### Todo Toolbar

The editor toolbar detects when the cursor is inside a task item and shows additional controls:

```typescript
// editor-toolbar.component.ts
private updateActiveTaskItem(editor: Editor): void {
    const { $from } = editor.state.selection;

    for (let d = $from.depth; d >= 0; d--) {
        const node = $from.node(d);
        if (node.type.name === 'taskItem') {
            this.activeTaskItem.set({
                id: node.attrs['id'],
                checked: node.attrs['checked'],
                priority: node.attrs['priority'],
                color: node.attrs['color'],
                dueDate: node.attrs['dueDate'],
                pos: $from.before(d),
            });
            return;
        }
    }
    this.activeTaskItem.set(null);
}
```

The toolbar shows:

- **Priority selector** - Set low/medium/high priority
- **Color picker** - Choose a color for the task
- **Date picker** - Set a due date

#### Styling

Task items use CSS custom properties for dynamic coloring:

```scss
// notebook-editor.component.scss
.todo-item[data-todo-color] {
    border-left: 3px solid var(--todo-color);
}

// Priority colors
.priority-high {
    --priority-color: #dc2626;
}
.priority-medium {
    --priority-color: #f59e0b;
}
.priority-low {
    --priority-color: #3b82f6;
}
```

#### Database Schema

Todo metadata is stored on the `pages` collection for aggregation:

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

The notebook summary endpoint aggregates todo stats:

```typescript
// GET /api/notebooks/:id/summary
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

---

## Native Bridge

### Bridge Service

```typescript
// services/native-bridge.service.ts
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NativeBridgeService {
    private readonly _isNative = signal(false);
    readonly isNative = this._isNative.asReadonly();

    constructor() {
        this._isNative.set(this.detectNativeEnvironment());
    }

    private detectNativeEnvironment(): boolean {
        return !!(window as any).webkit?.messageHandlers?.maple;
    }

    async getPlatform(): Promise<'ios' | 'macos' | 'web'> {
        if (!this.isNative()) return 'web';
        return this.sendMessage('getPlatform');
    }

    async getToken(): Promise<string | null> {
        if (!this.isNative()) {
            return localStorage.getItem('auth_token');
        }
        return this.sendMessage('getToken');
    }

    async saveToken(token: string): Promise<void> {
        if (!this.isNative()) {
            localStorage.setItem('auth_token', token);
            return;
        }
        return this.sendMessage('saveToken', { token });
    }

    private sendMessage<T>(action: string, payload?: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            const callbackId = crypto.randomUUID();
            (window as any)[`maple_callback_${callbackId}`] = (result: T) => {
                delete (window as any)[`maple_callback_${callbackId}`];
                resolve(result);
            };

            (window as any).webkit.messageHandlers.maple.postMessage({
                action,
                callbackId,
                payload,
            });
        });
    }
}
```

---

## Environment Configuration

### Development

```typescript
// environments/environment.ts
export const environment = {
    production: false,
    apiUrl: '/api',
    wsUrl: 'ws://localhost:7071',
    yjsUrl: 'ws://localhost:7071/yjs',
};
```

### Production

```typescript
// environments/environment.prod.ts
export const environment = {
    production: true,
    apiUrl: 'https://api.justmaple.app/api',
    wsUrl: 'wss://api.justmaple.app',
    yjsUrl: 'wss://api.justmaple.app/yjs',
};
```

### Self-Hosted

```typescript
// environments/environment.paperbark.ts
export const environment = {
    production: true,
    apiUrl: '/api',
    wsUrl: '', // Same host
    yjsUrl: '',
};
```

---

## Best Practices Summary

| Do                       | Don't                                 |
| ------------------------ | ------------------------------------- |
| Use signals for state    | Use BehaviorSubject in components     |
| Use input() and output() | Use @Input() and @Output() decorators |
| Use Tailwind classes     | Write custom CSS unless necessary     |
| Separate component files | Use inline templates/styles           |
| Use HttpClient           | Use raw fetch()                       |
| Use design tokens        | Hardcode colors                       |
| One concern per page     | Combine views with conditionals       |

---

## Next Steps

- [API Documentation](./api.md) - Backend development
- [Testing Guide](./testing.md) - Testing Angular components
- [Best Practices](./best-practices.md) - Coding standards
