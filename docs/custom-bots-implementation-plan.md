# Custom Bots Implementation Plan

## Overview

This plan extends the existing bot system to support **custom bots with webhook invocation**. Users can create bots that receive webhooks from Maple and respond via the API.

### Current vs New Architecture

| Aspect       | Current (Template Bots)                  | New (Custom Bots)                         |
| ------------ | ---------------------------------------- | ----------------------------------------- |
| Definition   | System-defined templates with actions    | User-provided invoke URL                  |
| Execution    | Maple executes actions (llm, http, etc.) | Maple calls webhook, bot responds via API |
| Auth         | Bot access tokens (per-bot)              | Provisioning token → JWT (per-bot)        |
| Capabilities | Fixed by template                        | Full API access with permissions          |

---

## Phase 1: Database & Schema Updates

### 1.1 Extend Bot Schema

**File:** `packages/shared/src/schemas/bot.ts`

Add new fields to support custom bots:

```typescript
// New: Custom Bot Type
export const BotTypeSchema = Type.Union([
    Type.Literal('template'), // Existing template-based bots
    Type.Literal('custom'), // New webhook-based bots
]);

// Extend UserBotSchema
export const UserBotSchema = Type.Object({
    // ... existing fields ...

    // New fields for custom bots
    botType: Type.Optional(BotTypeSchema), // Default 'template' for backward compat
    invokeUrl: Type.Optional(Type.String()), // Webhook URL for custom bots
    webhookSecret: Type.Optional(Type.String()), // HMAC secret for signature verification

    // Permissions for custom bots
    permissions: Type.Optional(
        Type.Object({
            messages: Type.Object({
                read: Type.Boolean(),
                write: Type.Boolean(),
            }),
            memos: Type.Object({
                read: Type.Boolean(),
                write: Type.Boolean(),
            }),
            whiteboards: Type.Object({
                read: Type.Boolean(),
                write: Type.Boolean(),
            }),
        }),
    ),

    // Scope - which resources the bot can access
    scope: Type.Optional(
        Type.Object({
            type: Type.Union([Type.Literal('all'), Type.Literal('specific')]),
            notebookIds: Type.Optional(Type.Array(Type.String())),
        }),
    ),
});
```

### 1.2 New Collection: `bot_provisioning_tokens`

```typescript
interface BotProvisioningToken {
    _id: ObjectId;
    userBotId: ObjectId;
    userId: ObjectId;
    tokenHash: Binary; // SHA-256 hash (never store plaintext)
    createdAt: Date;
    expiresAt: Date; // 30 days default
    usedAt: Date | null; // Set when first used for login
    revoked: boolean;
}
```

### 1.3 New Collection: `bot_sessions`

```typescript
interface BotSession {
    _id: ObjectId;
    userBotId: ObjectId;
    userId: ObjectId;
    jwtId: string; // Unique JWT identifier
    createdAt: Date;
    expiresAt: Date; // 12 hours default
    lastUsedAt: Date;
    ipAddress: string | null;
    revokedAt: Date | null;
}
```

---

## Phase 2: Authentication System

### 2.1 Provisioning Token Generation

**File:** `apps/api/src/repositories/bot-provisioning-token.repo.ts`

```typescript
export async function createProvisioningToken(
    userBotId: string,
    userId: string,
): Promise<{ token: BotProvisioningToken; plaintextToken: string }>;

export async function verifyProvisioningToken(
    plaintextToken: string,
): Promise<BotProvisioningToken | null>;

export async function markTokenUsed(tokenId: string): Promise<void>;

export async function revokeAllTokens(userBotId: string): Promise<void>;
```

### 2.2 Bot JWT Generation

**File:** `apps/api/src/services/bot-jwt.service.ts`

```typescript
interface BotJWTPayload {
    sub: string; // Bot ID (userBotId)
    userId: string; // Owner user ID
    type: 'bot'; // Distinguish from user JWTs
    sessionId: string; // Reference to bot_sessions
    iat: number;
    exp: number;
}

export function generateBotJWT(userBot: UserBot, sessionId: string): string;
export function verifyBotJWT(token: string): BotJWTPayload | null;
```

### 2.3 Bot Auth Routes

**File:** `apps/api/src/routes/bot-auth.ts`

| Endpoint                 | Method | Description                         |
| ------------------------ | ------ | ----------------------------------- |
| `/api/bots/login`        | POST   | Exchange provisioning token for JWT |
| `/api/bots/refresh`      | POST   | Refresh expiring JWT                |
| `/api/bots/logout`       | POST   | Revoke current session              |
| `/api/bots/sessions`     | GET    | List active sessions (owner only)   |
| `/api/bots/sessions/:id` | DELETE | Revoke specific session             |

**Login Flow:**

```
POST /api/bots/login
{
    "provisioning_token": "prov_xxxxxxxx"
}

Response:
{
    "jwt": "eyJ...",
    "expires_at": "2026-02-01T22:30:00Z",
    "bot_id": "bot_abc123",
    "bot_name": "My Custom Bot"
}
```

### 2.4 Bot Auth Middleware Update

**File:** `apps/api/src/middleware/bot-auth.ts`

Extend to support both:

- Existing bot access tokens (for backward compatibility)
- New bot JWTs (for custom bots)

```typescript
export const botAuthMiddleware = new Elysia({ name: 'bot-auth-middleware' }).derive(
    async ({ request, jwt }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { botAuth: null };
        }

        const token = authHeader.slice(7);

        // Try JWT first (custom bots)
        const jwtPayload = await verifyBotJWT(token);
        if (jwtPayload) {
            return { botAuth: { type: 'jwt', ...jwtPayload } };
        }

        // Fall back to access token (template bots)
        const accessToken = await verifyToken(token);
        if (accessToken) {
            return { botAuth: { type: 'token', ...accessToken } };
        }

        return { botAuth: null };
    },
);
```

---

## Phase 3: Custom Bot Management API

### 3.1 Custom Bot CRUD

**File:** `apps/api/src/routes/custom-bots.ts`

| Endpoint                                | Method | Description                     |
| --------------------------------------- | ------ | ------------------------------- |
| `/api/custom-bots`                      | POST   | Create custom bot               |
| `/api/custom-bots`                      | GET    | List user's custom bots         |
| `/api/custom-bots/:id`                  | GET    | Get bot details                 |
| `/api/custom-bots/:id`                  | PATCH  | Update bot settings             |
| `/api/custom-bots/:id`                  | DELETE | Delete bot                      |
| `/api/custom-bots/:id/regenerate-token` | POST   | Generate new provisioning token |
| `/api/custom-bots/:id/webhook-secret`   | POST   | Regenerate webhook secret       |

**Create Custom Bot Request:**

```json
{
    "name": "My Custom Bot",
    "handle": "mybot",
    "description": "A custom bot for automation",
    "invokeUrl": "https://my-server.com/webhook",
    "permissions": {
        "messages": { "read": true, "write": true },
        "memos": { "read": true, "write": false },
        "whiteboards": { "read": false, "write": false }
    },
    "scope": {
        "type": "all"
    }
}
```

**Response (includes one-time provisioning token):**

```json
{
    "bot": {
        "_id": "bot_abc123",
        "name": "My Custom Bot",
        "handle": "mybot",
        "status": "active",
        ...
    },
    "provisioning_token": "prov_xxxxxxxxxxxxxxxx",
    "webhook_secret": "whsec_yyyyyyyyyyyyyyyy"
}
```

### 3.2 Bot Repository Updates

**File:** `apps/api/src/repositories/user-bot.repo.ts`

Add methods:

```typescript
export async function createCustomBot(userId: string, data: CreateCustomBotInput): Promise<UserBot>;
export async function findCustomBotsByUserId(userId: string): Promise<UserBot[]>;
export async function updateBotStatus(
    botId: string,
    status: 'active' | 'disabled' | 'revoked',
): Promise<void>;
```

---

## Phase 4: Webhook Invocation System

### 4.1 Webhook Service

**File:** `apps/api/src/services/webhook.service.ts`

```typescript
interface WebhookPayload {
    event_type: 'thread_mention';
    thread_id: string;
    messages: WebhookMessage[];
    context: {
        notebook_id: string;
        page_id: string;
    };
    timestamp: string;
}

interface WebhookMessage {
    id: string;
    author: {
        id: string;
        name: string;
        type: 'user' | 'bot';
    };
    content: string; // Plain text extracted from ProseMirror
    content_json: PageContent; // Full ProseMirror JSON
    created_at: string;
    attachments: WebhookAttachment[];
}

export async function invokeWebhook(
    userBot: UserBot,
    invocation: BotInvocation,
    messages: Message[],
): Promise<WebhookResponse>;

export function signPayload(payload: string, secret: string): string;
```

### 4.2 Update Bot Executor

**File:** `apps/api/src/services/bot-executor.service.ts`

Add custom bot handling:

```typescript
private async executeCustomBot(
    invocation: BotInvocation,
    userBot: UserBot,
    context: InvocationContext
): Promise<void> {
    // 1. Build webhook payload with thread context
    const payload = await this.buildWebhookPayload(invocation, context);

    // 2. Sign payload with HMAC-SHA256
    const signature = signPayload(JSON.stringify(payload), userBot.webhookSecret);

    // 3. Call webhook URL
    const response = await fetch(userBot.invokeUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Maple-Signature': signature,
            'X-Maple-Timestamp': payload.timestamp,
            'X-Maple-Bot-Id': userBot._id,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),  // 30 second timeout
    });

    // 4. Verify acknowledgment
    if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
    }

    const result = await response.json();
    if (result.status !== 'accepted') {
        throw new Error('Webhook did not acknowledge');
    }

    // 5. Mark invocation as running (bot will respond via API)
    await updateInvocationStatus(invocation._id, 'running');
}
```

### 4.3 Webhook Retry Logic

```typescript
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

async function invokeWithRetry(userBot: UserBot, payload: WebhookPayload): Promise<void> {
    let lastError: Error;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
            await invokeWebhook(userBot, payload);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < RETRY_DELAYS.length) {
                await sleep(RETRY_DELAYS[attempt]);
            }
        }
    }

    throw lastError;
}
```

---

## Phase 5: Bot API Endpoints

### 5.1 Messages API for Bots

**File:** `apps/api/src/routes/bot-api/messages.ts`

| Endpoint                            | Method | Permission | Description              |
| ----------------------------------- | ------ | ---------- | ------------------------ |
| `/api/bots/messages`                | GET    | read       | List accessible messages |
| `/api/bots/threads/:threadId`       | GET    | read       | Get full thread          |
| `/api/bots/threads/:threadId/reply` | POST   | write      | Reply to thread          |
| `/api/bots/messages`                | POST   | write      | Start new conversation   |

**Reply to Thread:**

```
POST /api/bots/threads/:threadId/reply
Authorization: Bearer <bot_jwt>

{
    "content": "Here's my response...",
    "content_type": "text"  // or "prosemirror"
}

Response:
{
    "message_id": "msg_new123",
    "thread_id": "thread_abc",
    "created_at": "2026-02-01T10:35:00Z"
}
```

### 5.2 Memos API for Bots

**File:** `apps/api/src/routes/bot-api/memos.ts`

| Endpoint              | Method | Permission | Description           |
| --------------------- | ------ | ---------- | --------------------- |
| `/api/bots/memos`     | GET    | read       | List accessible memos |
| `/api/bots/memos/:id` | GET    | read       | Get memo content      |
| `/api/bots/memos/:id` | PUT    | write      | Update memo           |
| `/api/bots/memos`     | POST   | write      | Create memo           |

### 5.3 Whiteboards API for Bots (Future)

**File:** `apps/api/src/routes/bot-api/whiteboards.ts`

| Endpoint                    | Method | Permission | Description                 |
| --------------------------- | ------ | ---------- | --------------------------- |
| `/api/bots/whiteboards`     | GET    | read       | List accessible whiteboards |
| `/api/bots/whiteboards/:id` | GET    | read       | Get whiteboard              |
| `/api/bots/whiteboards/:id` | PUT    | write      | Update whiteboard           |
| `/api/bots/whiteboards`     | POST   | write      | Create whiteboard           |

### 5.4 Permission Checking

```typescript
async function checkBotResourceAccess(
    botAuth: BotAuthContext,
    resourceType: 'messages' | 'memos' | 'whiteboards',
    permission: 'read' | 'write',
    notebookId: string,
    set: { status?: number },
): Promise<boolean> {
    // 1. Check permission type
    const userBot = await findUserBotById(botAuth.userBotId);
    if (!userBot.permissions?.[resourceType]?.[permission]) {
        set.status = 403;
        return false;
    }

    // 2. Check notebook scope
    if (userBot.scope?.type === 'specific') {
        if (!userBot.scope.notebookIds?.includes(notebookId)) {
            set.status = 403;
            return false;
        }
    }

    // 3. Verify bot is shared with notebook
    const isShared = await isBotSharedWithNotebook(userBot._id, notebookId);
    if (!isShared) {
        set.status = 403;
        return false;
    }

    return true;
}
```

---

## Phase 6: Frontend Implementation

### 6.1 Custom Bot Creation UI

**File:** `apps/web/src/app/pages/settings/bots/create-custom-bot.component.ts`

**Steps:**

1. Enter bot name and description
2. Configure invoke URL
3. Set permissions (checkboxes)
4. Set scope (all or specific notebooks)
5. Review and create
6. Display provisioning token (one-time modal)

### 6.2 Bot Management Component

**File:** `apps/web/src/app/pages/settings/bots/bot-management.component.ts`

Features:

- List all bots (template + custom)
- Show bot status (active/disabled)
- Edit bot settings
- Regenerate tokens
- View usage stats
- Delete bot

### 6.3 Bot Service Updates

**File:** `apps/web/src/app/services/bot.service.ts`

Add methods:

```typescript
createCustomBot(data: CreateCustomBotInput): Observable<CustomBotResponse>;
updateCustomBot(id: string, data: UpdateCustomBotInput): Observable<UserBot>;
regenerateProvisioningToken(id: string): Observable<{ token: string }>;
regenerateWebhookSecret(id: string): Observable<{ secret: string }>;
getBotSessions(botId: string): Observable<BotSession[]>;
revokeBotSession(botId: string, sessionId: string): Observable<void>;
```

### 6.4 Settings Routes

**File:** `apps/web/src/app/app.routes.ts`

```typescript
{
    path: 'settings/bots',
    loadComponent: () => import('./pages/settings/bots/bot-list.component'),
},
{
    path: 'settings/bots/new',
    loadComponent: () => import('./pages/settings/bots/create-custom-bot.component'),
},
{
    path: 'settings/bots/:id',
    loadComponent: () => import('./pages/settings/bots/bot-detail.component'),
},
```

---

## Phase 7: Security Hardening

### 7.1 Webhook Signature Verification

Bots should verify webhook signatures:

```python
# Bot-side verification (Python example)
import hmac
import hashlib

def verify_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

### 7.2 Rate Limiting by Endpoint

| Endpoint Category | Rate Limit              |
| ----------------- | ----------------------- |
| Login/Refresh     | 10 req/min              |
| Read operations   | 100 req/min             |
| Write operations  | 30 req/min              |
| Webhook retries   | 3 attempts with backoff |

### 7.3 Audit Logging

**File:** `apps/api/src/services/audit-log.service.ts`

Log all bot actions:

```typescript
interface BotAuditLog {
    _id: ObjectId;
    botId: string;
    userId: string;
    action: 'login' | 'read' | 'write' | 'webhook_received';
    resource: string;
    resourceId: string;
    ipAddress: string;
    userAgent: string;
    success: boolean;
    errorCode?: string;
    createdAt: Date;
}
```

### 7.4 SSRF Protection

Reuse existing SSRF protection from `bot-executor.service.ts`:

- Block private IPs
- Block cloud metadata endpoints
- Block internal domains
- Only allow HTTPS in production

---

## Phase 8: Testing & Documentation

### 8.1 Unit Tests

| File                                  | Coverage                                   |
| ------------------------------------- | ------------------------------------------ |
| `bot-provisioning-token.repo.spec.ts` | Token generation, verification, revocation |
| `bot-jwt.service.spec.ts`             | JWT generation, validation, expiration     |
| `webhook.service.spec.ts`             | Payload building, signing, invocation      |
| `custom-bot.routes.spec.ts`           | CRUD operations, validation                |
| `bot-api.routes.spec.ts`              | Permission checks, resource access         |

### 8.2 Integration Tests

- End-to-end bot creation flow
- Webhook invocation with mock server
- Permission boundary testing
- Rate limiting verification

### 8.3 API Documentation

Create OpenAPI spec for bot developers:

- Authentication flow
- Webhook payload format
- API endpoints
- Error codes
- Rate limits

---

## Implementation Order

### Sprint 1: Foundation

1. Schema updates (`packages/shared`)
2. Provisioning token repository
3. Bot session repository
4. Bot JWT service

### Sprint 2: Authentication

5. Bot login/refresh routes
6. Update bot auth middleware
7. Session management routes

### Sprint 3: Bot Management

8. Custom bot CRUD routes
9. Frontend: Bot creation UI
10. Frontend: Bot management UI

### Sprint 4: Webhook System

11. Webhook service
12. Update bot executor
13. Retry logic

### Sprint 5: Bot API

14. Messages API for bots
15. Memos API for bots
16. Permission checking

### Sprint 6: Security & Polish

17. Audit logging
18. Rate limiting updates
19. SSRF hardening
20. Documentation

---

## Database Migrations

### Migration 1: Add custom bot fields

```typescript
// Add new fields to user_bots collection
db.user_bots.updateMany({ botType: { $exists: false } }, { $set: { botType: 'template' } });

// Create indexes
db.bot_provisioning_tokens.createIndex({ tokenHash: 1 }, { unique: true });
db.bot_provisioning_tokens.createIndex({ userBotId: 1 });
db.bot_provisioning_tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

db.bot_sessions.createIndex({ userBotId: 1 });
db.bot_sessions.createIndex({ jwtId: 1 }, { unique: true });
db.bot_sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

---

## File Summary

### New Files

| Path                                                       | Purpose             |
| ---------------------------------------------------------- | ------------------- |
| `packages/shared/src/schemas/custom-bot.ts`                | Custom bot schemas  |
| `apps/api/src/repositories/bot-provisioning-token.repo.ts` | Token management    |
| `apps/api/src/repositories/bot-session.repo.ts`            | Session management  |
| `apps/api/src/services/bot-jwt.service.ts`                 | JWT generation      |
| `apps/api/src/services/webhook.service.ts`                 | Webhook invocation  |
| `apps/api/src/services/audit-log.service.ts`               | Audit logging       |
| `apps/api/src/routes/bot-auth.ts`                          | Auth endpoints      |
| `apps/api/src/routes/custom-bots.ts`                       | Bot management      |
| `apps/api/src/routes/bot-api/messages.ts`                  | Bot messages API    |
| `apps/api/src/routes/bot-api/memos.ts`                     | Bot memos API       |
| `apps/web/src/app/pages/settings/bots/*.ts`                | Frontend components |

### Modified Files

| Path                                            | Changes               |
| ----------------------------------------------- | --------------------- |
| `packages/shared/src/schemas/bot.ts`            | Add custom bot fields |
| `apps/api/src/middleware/bot-auth.ts`           | Support JWT auth      |
| `apps/api/src/services/bot-executor.service.ts` | Add webhook execution |
| `apps/api/src/routes/bots.ts`                   | Integrate custom bots |
| `apps/web/src/app/services/bot.service.ts`      | Custom bot methods    |
| `apps/web/src/app/app.routes.ts`                | Settings routes       |

---

## Open Questions

1. **Webhook timeout**: 30 seconds reasonable for initial response?
2. **JWT expiration**: 12 hours default, or should it be configurable?
3. **Scope granularity**: Should we support page-level scope (vs notebook)?
4. **Whiteboard format**: What format should bots receive/send whiteboard content?
5. **Bot marketplace**: Future feature - allow sharing bots publicly?
