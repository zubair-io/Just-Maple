# API Documentation (PaperbarkMaple)

This guide covers the Elysia backend, including routes, services, repositories, and development patterns.

## Overview

**PaperbarkMaple** is the backend API built with:

- **Runtime:** Bun
- **Framework:** Elysia 1.2
- **Database:** MongoDB
- **Validation:** TypeBox
- **Authentication:** JWT + WebAuthn

---

## Project Structure

```
apps/api/src/
├── index.ts                    # Main server entry point
├── index-e2e.ts               # E2E test server variant
├── config.ts                  # Configuration management
├── db/
│   └── client.ts              # MongoDB connection & indexes
├── routes/                    # API endpoints
│   ├── auth.ts               # Authentication routes
│   ├── notebooks.ts          # Notebook CRUD
│   ├── pages.ts              # Page/document CRUD
│   ├── messages.ts           # Chat messages
│   ├── notifications.ts      # Notifications
│   ├── bots.ts               # AI bot execution
│   ├── collectables.ts       # Collectible items
│   ├── lego.ts               # LEGO database integration
│   ├── memo.ts               # Document storage (Yjs)
│   └── collab.ts             # Collaboration operations
├── repositories/              # Data access layer
│   ├── user.repo.ts
│   ├── notebook.repo.ts
│   ├── page.repo.ts
│   ├── message.repo.ts
│   ├── notification.repo.ts
│   ├── passkey.repo.ts
│   ├── magic-link.repo.ts
│   └── bot-template.repo.ts
├── services/                  # Business logic
│   ├── notification.service.ts
│   ├── realtime.service.ts
│   ├── realtime-ws.service.ts
│   ├── yjs-document.service.ts
│   ├── collab-realtime.service.ts
│   ├── redis.service.ts
│   ├── email.ts
│   ├── storage.service.ts
│   ├── apns.service.ts
│   └── bot-executor.service.ts
├── middleware/                # Middleware functions
│   └── auth.ts
├── utils/                     # Helper functions
├── ws/                        # WebSocket handlers
│   └── realtime.ws.ts
└── __tests__/                 # API tests
```

---

## Configuration

### Environment Variables

Create a `.env` file in `apps/api/`:

```env
# Server
PORT=7071
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/maple

# Authentication
JWT_SECRET=your-secure-secret-key
RP_NAME=Just Maple
RP_ID=localhost
ORIGIN=http://localhost:4200

# CORS
CORS_ORIGINS=http://localhost:4200,http://192.168.1.0/24

# Email (Azure Communication Services)
AZURE_COMMUNICATION_CONNECTION_STRING=endpoint=...
EMAIL_FROM=noreply@justmaple.app

# Push Notifications (APNs)
APNS_KEY_ID=your-key-id
APNS_TEAM_ID=your-team-id
APNS_KEY=-----BEGIN PRIVATE KEY-----...

# Redis (optional, for multi-replica)
REDIS_URL=redis://localhost:6379

# External Services
PAPERBARK_URL=https://paperbark.justmaple.app
REBRICKABLE_API_KEY=your-key
BRIGHT_DATA_API_KEY=your-key
CLAUDE_API_KEY=your-key
```

### Config Module

```typescript
// config.ts
export const config = {
    port: process.env.PORT || 7071,
    mongoUri: process.env.MONGODB_URI!,
    jwtSecret: process.env.JWT_SECRET!,
    rpName: process.env.RP_NAME || 'Just Maple',
    rpId: process.env.RP_ID || 'localhost',
    origin: process.env.ORIGIN || 'http://localhost:4200',
    corsOrigins: (process.env.CORS_ORIGINS || '').split(','),
};
```

---

## API Routes

### Authentication

| Method | Endpoint                     | Auth     | Description              |
| ------ | ---------------------------- | -------- | ------------------------ |
| POST   | `/api/auth/magic-link`       | Public   | Request magic link email |
| POST   | `/api/auth/verify`           | Public   | Verify magic link/code   |
| POST   | `/api/auth/refresh`          | Required | Refresh JWT token        |
| POST   | `/api/auth/passkey-register` | Required | Register passkey         |
| POST   | `/api/auth/passkey-login`    | Public   | Login with passkey       |
| POST   | `/api/auth/logout`           | Required | Clear session            |
| GET    | `/api/auth/me`               | Required | Get current user         |

### Notebooks

| Method | Endpoint                   | Auth     | Description           |
| ------ | -------------------------- | -------- | --------------------- |
| GET    | `/api/notebooks`           | Required | List user's notebooks |
| POST   | `/api/notebooks`           | Required | Create notebook       |
| GET    | `/api/notebooks/:id`       | Required | Get notebook          |
| PUT    | `/api/notebooks/:id`       | Required | Update notebook       |
| DELETE | `/api/notebooks/:id`       | Required | Delete notebook       |
| POST   | `/api/notebooks/:id/share` | Required | Share notebook        |

### Pages

| Method | Endpoint         | Auth     | Description |
| ------ | ---------------- | -------- | ----------- |
| GET    | `/api/pages/:id` | Required | Get page    |
| POST   | `/api/pages`     | Required | Create page |
| PUT    | `/api/pages/:id` | Required | Update page |
| DELETE | `/api/pages/:id` | Required | Delete page |

### Messages

| Method | Endpoint                    | Auth     | Description              |
| ------ | --------------------------- | -------- | ------------------------ |
| GET    | `/api/messages/:notebookId` | Required | Get messages (paginated) |
| POST   | `/api/messages`             | Required | Send message             |
| PUT    | `/api/messages/:id`         | Required | Edit message             |
| DELETE | `/api/messages/:id`         | Required | Delete message           |

### WebSocket

| Endpoint          | Description                                     |
| ----------------- | ----------------------------------------------- |
| `WS /ws/realtime` | Unified WebSocket for chat, docs, notifications |

---

## Route Implementation

### Basic Route Structure

```typescript
// routes/notebooks.ts
import { Elysia, t } from 'elysia';
import { jwtPlugin } from '../middleware/auth';
import { NotebookSchema } from '@maple/shared';
import * as notebookRepo from '../repositories/notebook.repo';

export const notebookRoutes = new Elysia({ prefix: '/api/notebooks' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        // Auth derivation
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null };
        }
        const token = authHeader.slice(7);
        const payload = await jwt.verify(token);
        return { auth: payload };
    })

    // GET /api/notebooks
    .get('/', async ({ auth, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }
        return notebookRepo.findByUserId(auth.userId);
    })

    // POST /api/notebooks
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const notebook = await notebookRepo.create({
                ...body,
                createdBy: auth.userId,
            });

            set.status = 201;
            return notebook;
        },
        {
            body: t.Object({
                name: t.String({ minLength: 1 }),
                description: t.Optional(t.String()),
                color: t.Optional(t.String()),
            }),
        },
    )

    // GET /api/notebooks/:id
    .get('/:id', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const notebook = await notebookRepo.findById(params.id);

        if (!notebook) {
            set.status = 404;
            return { error: 'Not found' };
        }

        // Check membership
        const isMember = notebook.members.some((m) => m.userId === auth.userId);
        if (!isMember) {
            set.status = 403;
            return { error: 'Forbidden' };
        }

        return notebook;
    })

    // DELETE /api/notebooks/:id
    .delete('/:id', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const notebook = await notebookRepo.findById(params.id);

        if (!notebook) {
            set.status = 404;
            return { error: 'Not found' };
        }

        // Check ownership
        if (notebook.createdBy !== auth.userId) {
            set.status = 403;
            return { error: 'Only owner can delete' };
        }

        await notebookRepo.deleteById(params.id);
        set.status = 204;
    });
```

### Request Validation

Use TypeBox schemas for validation:

```typescript
import { t } from 'elysia';

// Inline validation
.post('/', handler, {
    body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        email: t.String({ format: 'email' }),
        age: t.Optional(t.Number({ minimum: 0 })),
    }),
    params: t.Object({
        id: t.String(),
    }),
    query: t.Object({
        limit: t.Optional(t.Number({ default: 20 })),
        offset: t.Optional(t.Number({ default: 0 })),
    }),
})
```

---

## Repository Pattern

### Basic Repository

```typescript
// repositories/notebook.repo.ts
import { ObjectId, type Db } from 'mongodb';
import type { Notebook } from '@maple/shared';
import { getDb } from '../db/client';

const collection = () => getDb().collection<Notebook>('notebooks');

export async function findById(id: string): Promise<Notebook | null> {
    const notebook = await collection().findOne({
        _id: new ObjectId(id) as any,
    });
    return notebook ? mapNotebook(notebook) : null;
}

export async function findByUserId(userId: string): Promise<Notebook[]> {
    const notebooks = await collection()
        .find({ 'members.userId': userId })
        .sort({ updatedAt: -1 })
        .toArray();
    return notebooks.map(mapNotebook);
}

export async function create(
    data: Omit<Notebook, '_id' | 'createdAt' | 'updatedAt'>,
): Promise<Notebook> {
    const now = new Date().toISOString();
    const doc = {
        ...data,
        createdAt: now,
        updatedAt: now,
    };

    const result = await collection().insertOne(doc as any);
    return {
        _id: result.insertedId.toString(),
        ...doc,
    };
}

export async function update(id: string, data: Partial<Notebook>): Promise<Notebook | null> {
    const result = await collection().findOneAndUpdate(
        { _id: new ObjectId(id) as any },
        {
            $set: {
                ...data,
                updatedAt: new Date().toISOString(),
            },
        },
        { returnDocument: 'after' },
    );
    return result ? mapNotebook(result) : null;
}

export async function deleteById(id: string): Promise<boolean> {
    const result = await collection().deleteOne({
        _id: new ObjectId(id) as any,
    });
    return result.deletedCount > 0;
}

// Map MongoDB document to API type
function mapNotebook(doc: any): Notebook {
    return {
        ...doc,
        _id: doc._id.toString(),
    };
}
```

---

## Services

### Notification Service

```typescript
// services/notification.service.ts
import { apnsService } from './apns.service';
import * as userRepo from '../repositories/user.repo';
import * as notificationRepo from '../repositories/notification.repo';

export async function sendPushNotification(
    userId: string,
    notification: {
        type: string;
        notebookId?: string;
        pageId?: string;
        messageId?: string;
    },
): Promise<void> {
    const user = await userRepo.findById(userId);
    if (!user?.pushTokens?.length) return;

    // Store notification
    await notificationRepo.create({
        userId,
        ...notification,
        read: false,
    });

    // Send to all devices
    for (const device of user.pushTokens) {
        if (device.platform === 'ios' || device.platform === 'macos') {
            await apnsService.send(device.token, {
                aps: {
                    'content-available': 1,
                    'mutable-content': 1,
                    sound: 'default',
                },
                data: notification,
            });
        }
    }
}
```

### Real-time Service

```typescript
// services/realtime.service.ts
import type { WebSocket } from 'ws';

interface Connection {
    ws: WebSocket;
    userId: string;
    rooms: Set<string>;
}

class RealtimeService {
    private connections = new Map<string, Connection>();
    private rooms = new Map<string, Set<string>>();

    addConnection(connectionId: string, ws: WebSocket, userId: string): void {
        this.connections.set(connectionId, {
            ws,
            userId,
            rooms: new Set(),
        });
    }

    removeConnection(connectionId: string): void {
        const conn = this.connections.get(connectionId);
        if (conn) {
            for (const room of conn.rooms) {
                this.leaveRoom(connectionId, room);
            }
            this.connections.delete(connectionId);
        }
    }

    joinRoom(connectionId: string, room: string): void {
        const conn = this.connections.get(connectionId);
        if (!conn) return;

        conn.rooms.add(room);

        if (!this.rooms.has(room)) {
            this.rooms.set(room, new Set());
        }
        this.rooms.get(room)!.add(connectionId);
    }

    leaveRoom(connectionId: string, room: string): void {
        const conn = this.connections.get(connectionId);
        if (conn) {
            conn.rooms.delete(room);
        }

        const roomConns = this.rooms.get(room);
        if (roomConns) {
            roomConns.delete(connectionId);
            if (roomConns.size === 0) {
                this.rooms.delete(room);
            }
        }
    }

    broadcast(room: string, message: unknown, excludeConnection?: string): void {
        const roomConns = this.rooms.get(room);
        if (!roomConns) return;

        const data = JSON.stringify(message);
        for (const connId of roomConns) {
            if (connId === excludeConnection) continue;

            const conn = this.connections.get(connId);
            if (conn?.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(data);
            }
        }
    }
}

export const realtimeService = new RealtimeService();
```

---

## WebSocket Handler

```typescript
// ws/realtime.ws.ts
import { Elysia } from 'elysia';
import { realtimeService } from '../services/realtime.service';
import { jwtPlugin } from '../middleware/auth';

export const realtimeWs = new Elysia().use(jwtPlugin).ws('/ws/realtime', {
    async open(ws) {
        // Connection opened, wait for auth message
    },

    async message(ws, message: any) {
        const { type, ...payload } = message;

        switch (type) {
            case 'auth': {
                const { token } = payload;
                const verified = await ws.data.jwt.verify(token);
                if (verified) {
                    ws.data.userId = verified.userId;
                    ws.data.connectionId = crypto.randomUUID();
                    realtimeService.addConnection(ws.data.connectionId, ws.raw, verified.userId);
                    ws.send({ type: 'authenticated' });
                } else {
                    ws.send({ type: 'error', message: 'Invalid token' });
                    ws.close();
                }
                break;
            }

            case 'subscribe': {
                const { room } = payload;
                if (ws.data.connectionId) {
                    realtimeService.joinRoom(ws.data.connectionId, room);
                    ws.send({ type: 'subscribed', room });
                }
                break;
            }

            case 'unsubscribe': {
                const { room } = payload;
                if (ws.data.connectionId) {
                    realtimeService.leaveRoom(ws.data.connectionId, room);
                }
                break;
            }

            case 'message': {
                const { room, data } = payload;
                realtimeService.broadcast(
                    room,
                    {
                        type: 'message',
                        room,
                        data,
                        from: ws.data.userId,
                    },
                    ws.data.connectionId,
                );
                break;
            }
        }
    },

    close(ws) {
        if (ws.data.connectionId) {
            realtimeService.removeConnection(ws.data.connectionId);
        }
    },
});
```

---

## Database

### Connection Setup

```typescript
// db/client.ts
import { MongoClient, type Db } from 'mongodb';
import { config } from '../config';

let client: MongoClient;
let db: Db;

export async function connectDb(): Promise<void> {
    client = new MongoClient(config.mongoUri);
    await client.connect();
    db = client.db();

    // Create indexes
    await createIndexes(db);

    console.log('Connected to MongoDB');
}

export function getDb(): Db {
    if (!db) {
        throw new Error('Database not connected');
    }
    return db;
}

export async function closeDb(): Promise<void> {
    await client?.close();
}

async function createIndexes(db: Db): Promise<void> {
    // Users
    await db.collection('users').createIndex({ email: 1 }, { unique: true });

    // Notebooks
    await db.collection('notebooks').createIndex({ slug: 1 }, { unique: true });
    await db.collection('notebooks').createIndex({ 'members.userId': 1 });
    await db.collection('notebooks').createIndex({ createdBy: 1 });

    // Pages
    await db.collection('pages').createIndex({ notebookId: 1, updatedAt: -1 });
    await db.collection('pages').createIndex({ userId: 1 });

    // Messages
    await db.collection('messages').createIndex({ notebookId: 1, createdAt: -1 });

    // Magic links (TTL)
    await db.collection('magic_links').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // Passkeys
    await db.collection('passkeys').createIndex({ userId: 1 });
    await db.collection('passkeys').createIndex({ credentialId: 1 }, { unique: true });
}
```

---

## Authentication Middleware

```typescript
// middleware/auth.ts
import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';

export const jwtPlugin = new Elysia().use(
    jwt({
        name: 'jwt',
        secret: config.jwtSecret,
        exp: '14d',
    }),
);

// Helper function for routes
export function checkAuth(auth: any, set: any): auth is { userId: string } {
    if (!auth?.userId) {
        set.status = 401;
        return false;
    }
    return true;
}
```

---

## Error Handling

### Standard Error Response

```typescript
// Always return consistent error format
{
    error: 'Short error code',
    message: 'Human-readable description'
}
```

### Error Handler Plugin

```typescript
// plugins/error-handler.ts
import { Elysia } from 'elysia';

export const errorHandler = new Elysia().onError(({ code, error, set }) => {
    console.error(`[${code}]`, error);

    switch (code) {
        case 'VALIDATION':
            set.status = 400;
            return {
                error: 'Validation failed',
                message: error.message,
            };

        case 'NOT_FOUND':
            set.status = 404;
            return {
                error: 'Not found',
                message: 'Resource not found',
            };

        default:
            set.status = 500;
            return {
                error: 'Internal server error',
                message: 'An unexpected error occurred',
            };
    }
});
```

---

## Server Entry Point

```typescript
// index.ts
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { config } from './config';
import { connectDb } from './db/client';
import { errorHandler } from './plugins/error-handler';
import { authRoutes } from './routes/auth';
import { notebookRoutes } from './routes/notebooks';
import { pageRoutes } from './routes/pages';
import { messageRoutes } from './routes/messages';
import { realtimeWs } from './ws/realtime.ws';

async function main() {
    // Connect to database
    await connectDb();

    // Create app
    const app = new Elysia()
        .use(errorHandler)
        .use(
            cors({
                origin: config.corsOrigins,
                credentials: true,
            }),
        )
        // Health check
        .get('/server/info', () => ({
            name: config.rpName,
            version: '1.0.0',
            status: 'ok',
        }))
        // Routes
        .use(authRoutes)
        .use(notebookRoutes)
        .use(pageRoutes)
        .use(messageRoutes)
        // WebSocket
        .use(realtimeWs)
        // Start server
        .listen(config.port);

    console.log(`Server running at http://localhost:${config.port}`);
}

main().catch(console.error);
```

---

## Best Practices

### Repository Pattern

- Keep data access in repository files
- Return typed objects, not MongoDB documents
- Handle ObjectId conversion in repositories

### Route Organization

- Group related routes with prefixes
- Use TypeBox for request validation
- Return consistent error responses

### Authentication

- Use JWT with short expiration (14 days)
- Validate on every protected route
- Never log sensitive data

### Error Handling

- Always return JSON error responses
- Log errors server-side
- Don't expose internal details

### Performance

- Create proper indexes
- Use projection for large documents
- Implement pagination for lists

---

## Next Steps

- [iOS App Documentation](./ios-app.md) - Native app integration
- [Testing Guide](./testing.md) - API testing
- [Deployment Guide](./deployment.md) - Production deployment
