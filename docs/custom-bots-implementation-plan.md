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

### Flow Diagram

```
User @mybot → Maple POSTs webhook → Bot acknowledges (200 OK)
                                  → Bot calls Maple API to:
                                      - Reply to thread
                                      - Start new message
```

### Design Decisions

- **Webhook timeout**: 30 seconds for acknowledgment
- **JWT expiration**: 12 hours default (configurable per bot)
- **Scope**: Notebook-level (bot added to notebooks like Claude bot)
- **Phase 1 scope**: Messages only (memos/whiteboards deferred to Phase 2)

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

    // Permissions for custom bots (Phase 1: messages only)
    permissions: Type.Optional(
        Type.Object({
            messages: Type.Object({
                read: Type.Boolean(),
                write: Type.Boolean(),
            }),
            // Future: memos, whiteboards
        }),
    ),

    // JWT expiration configuration (hours)
    jwtExpirationHours: Type.Optional(Type.Number({ default: 12 })),
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
    expiresAt: Date; // Configurable, default 12 hours
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

export function generateBotJWT(
    userBot: UserBot,
    sessionId: string,
    expirationHours?: number,
): string;
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
        "messages": { "read": true, "write": true }
    },
    "jwtExpirationHours": 12
}
```

**Response (includes one-time provisioning token):**

```json
{
    "bot": {
        "_id": "bot_abc123",
        "name": "My Custom Bot",
        "handle": "mybot",
        "status": "active"
    },
    "provisioning_token": "prov_xxxxxxxxxxxxxxxx",
    "webhook_secret": "whsec_yyyyyyyyyyyyyyyy"
}
```

### 3.2 Bot Sharing (Notebook Access)

Custom bots use the existing notebook sharing system:

```typescript
// Share bot with notebook (same as Claude bot)
POST /api/notebooks/:notebookId/bots
{
    "userBotId": "bot_abc123"
}

// List bots in notebook
GET /api/notebooks/:notebookId/bots
```

### 3.3 Bot Repository Updates

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
    thread_id: string | null; // null for top-level message
    parent_message_id: string; // Message that triggered the bot
    page_id: string;
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

    // 3. Call webhook URL with retry
    await this.invokeWithRetry(userBot, payload, signature);

    // 4. Mark invocation as running (bot will respond via API)
    await updateInvocationStatus(invocation._id, 'running');
}

private async invokeWithRetry(
    userBot: UserBot,
    payload: WebhookPayload,
    signature: string
): Promise<void> {
    const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s
    let lastError: Error;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
            const response = await fetch(userBot.invokeUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Maple-Signature': `sha256=${signature}`,
                    'X-Maple-Timestamp': payload.timestamp,
                    'X-Maple-Bot-Id': userBot._id,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(30000), // 30 second timeout
            });

            if (!response.ok) {
                throw new Error(`Webhook failed: ${response.status}`);
            }

            const result = await response.json();
            if (result.status !== 'accepted') {
                throw new Error('Webhook did not acknowledge');
            }

            return; // Success
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

## Phase 5: Bot API Endpoints (Messages)

### 5.1 Messages API for Bots

**File:** `apps/api/src/routes/bot-api/messages.ts`

| Endpoint                            | Method | Permission | Description           |
| ----------------------------------- | ------ | ---------- | --------------------- |
| `/api/bots/pages/:pageId/messages`  | GET    | read       | List messages in page |
| `/api/bots/threads/:threadId`       | GET    | read       | Get full thread       |
| `/api/bots/threads/:threadId/reply` | POST   | write      | Reply to thread       |
| `/api/bots/pages/:pageId/messages`  | POST   | write      | Start new message     |

### 5.2 Reply to Thread

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

### 5.3 Start New Message

```
POST /api/bots/pages/:pageId/messages
Authorization: Bearer <bot_jwt>

{
    "content": "Bot-initiated message...",
    "content_type": "text"
}

Response:
{
    "message_id": "msg_new456",
    "page_id": "page_xyz",
    "created_at": "2026-02-01T10:40:00Z"
}
```

### 5.4 Permission Checking

```typescript
async function checkBotResourceAccess(
    botAuth: BotAuthContext,
    permission: 'read' | 'write',
    notebookId: string,
    set: { status?: number },
): Promise<boolean> {
    // 1. Get bot and check permission
    const userBot = await findUserBotById(botAuth.userBotId);
    if (!userBot.permissions?.messages?.[permission]) {
        set.status = 403;
        return false;
    }

    // 2. Verify bot is shared with notebook (like Claude bot)
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

1. Enter bot name, handle, and description
2. Configure invoke URL
3. Set permissions (checkboxes for messages read/write)
4. Set JWT expiration (optional, default 12h)
5. Review and create
6. Display provisioning token (one-time modal with copy button)

### 6.2 Bot Management Component

**File:** `apps/web/src/app/pages/settings/bots/bot-management.component.ts`

Features:

- List all bots (template + custom)
- Show bot status (active/disabled)
- Edit bot settings (invoke URL, permissions)
- Regenerate provisioning token
- Regenerate webhook secret
- View active sessions
- Revoke sessions
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

```typescript
// Bot-side verification (TypeScript example)
import { createHmac, timingSafeEqual } from 'crypto';

function verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
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
    action: 'login' | 'read' | 'write' | 'webhook_sent';
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

- Block private IPs (10.x, 172.16.x, 192.168.x, 127.x)
- Block cloud metadata endpoints (169.254.169.254)
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
12. Update bot executor for custom bots
13. Retry logic with exponential backoff

### Sprint 5: Bot API (Messages)

14. Messages read API for bots
15. Thread reply API for bots
16. New message API for bots
17. Permission checking

### Sprint 6: Security & Polish

18. Audit logging
19. Rate limiting updates
20. SSRF hardening
21. Documentation

---

## Database Migrations

### Migration 1: Add custom bot fields

```typescript
// Add new fields to user_bots collection
db.user_bots.updateMany({ botType: { $exists: false } }, { $set: { botType: 'template' } });

// Create indexes for bot_provisioning_tokens
db.bot_provisioning_tokens.createIndex({ tokenHash: 1 }, { unique: true });
db.bot_provisioning_tokens.createIndex({ userBotId: 1 });
db.bot_provisioning_tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Create indexes for bot_sessions
db.bot_sessions.createIndex({ userBotId: 1 });
db.bot_sessions.createIndex({ jwtId: 1 }, { unique: true });
db.bot_sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

---

## File Summary

### New Files

| Path                                                       | Purpose            |
| ---------------------------------------------------------- | ------------------ |
| `packages/shared/src/schemas/custom-bot.ts`                | Custom bot schemas |
| `apps/api/src/repositories/bot-provisioning-token.repo.ts` | Token management   |
| `apps/api/src/repositories/bot-session.repo.ts`            | Session management |
| `apps/api/src/services/bot-jwt.service.ts`                 | JWT generation     |
| `apps/api/src/services/webhook.service.ts`                 | Webhook invocation |
| `apps/api/src/services/audit-log.service.ts`               | Audit logging      |
| `apps/api/src/routes/bot-auth.ts`                          | Auth endpoints     |
| `apps/api/src/routes/custom-bots.ts`                       | Bot management     |
| `apps/api/src/routes/bot-api/messages.ts`                  | Bot messages API   |
| `apps/web/src/app/pages/settings/bots/*.ts`                | Frontend UI        |

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

## Future Phases

### Phase 2: Memos & Whiteboards

- Add memo read/write permissions
- Add whiteboard read/write permissions
- Memo API for bots (`/api/bots/memos`)
- Whiteboard API for bots (`/api/bots/whiteboards`)

### Phase 3: Advanced Features

- Bot marketplace (share bots publicly)
- Webhook health monitoring dashboard
- Bot analytics (usage metrics)
- Improved error messages and debugging tools

---

## Appendix: Error Codes

| Code                            | Description                                        |
| ------------------------------- | -------------------------------------------------- |
| `auth/invalid_token`            | Provisioning token is invalid or expired           |
| `auth/jwt_expired`              | JWT has expired, refresh required                  |
| `auth/insufficient_permissions` | Bot lacks required permission                      |
| `rate_limit/exceeded`           | Rate limit exceeded                                |
| `resource/not_found`            | Requested resource doesn't exist or not accessible |
| `webhook/timeout`               | Bot's invoke URL didn't respond in 30s             |
| `webhook/invalid_response`      | Bot returned malformed response                    |
| `webhook/connection_failed`     | Could not connect to bot's invoke URL              |

---

## Appendix: Example Bot Implementation

```python
from flask import Flask, request, jsonify
import requests
import threading
import hmac
import hashlib

app = Flask(__name__)

MAPLE_API = "https://maple.app/api/bots"
PROVISIONING_TOKEN = "prov_xxx"  # Store securely!
WEBHOOK_SECRET = "whsec_xxx"     # Store securely!
jwt_token = None

def verify_signature(payload: bytes, signature: str) -> bool:
    """Verify webhook signature from Maple."""
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)

def ensure_authenticated():
    """Exchange provisioning token for JWT."""
    global jwt_token
    if not jwt_token:
        resp = requests.post(f"{MAPLE_API}/login", json={
            "provisioning_token": PROVISIONING_TOKEN
        })
        jwt_token = resp.json()["jwt"]
    return jwt_token

def process_and_reply(thread_id, parent_message_id, page_id, messages):
    """Process messages and post reply asynchronously."""
    try:
        # Your bot logic here
        response_text = generate_response(messages)

        token = ensure_authenticated()

        if thread_id:
            # Reply to existing thread
            requests.post(
                f"{MAPLE_API}/threads/{thread_id}/reply",
                headers={"Authorization": f"Bearer {token}"},
                json={"content": response_text, "content_type": "text"}
            )
        else:
            # Create new thread by replying to parent message
            requests.post(
                f"{MAPLE_API}/threads/{parent_message_id}/reply",
                headers={"Authorization": f"Bearer {token}"},
                json={"content": response_text, "content_type": "text"}
            )
    except Exception as e:
        print(f"Error processing request: {e}")

def generate_response(messages):
    """Your bot logic here."""
    return "Hello from my custom bot!"

@app.route("/webhook", methods=["POST"])
def handle_webhook():
    """Receive webhook from Maple."""
    # Verify signature
    signature = request.headers.get("X-Maple-Signature", "")
    if not verify_signature(request.data, signature):
        return jsonify({"error": "Invalid signature"}), 401

    data = request.json

    if data["event_type"] == "thread_mention":
        # Process in background thread
        thread = threading.Thread(
            target=process_and_reply,
            args=(
                data.get("thread_id"),
                data["parent_message_id"],
                data["page_id"],
                data["messages"]
            )
        )
        thread.start()

    # Always acknowledge immediately
    return jsonify({"status": "accepted"})

if __name__ == "__main__":
    app.run(port=8080)
```

```typescript
// TypeScript/Bun example
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';

const app = new Hono();

const MAPLE_API = 'https://maple.app/api/bots';
const PROVISIONING_TOKEN = process.env.PROVISIONING_TOKEN!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;
let jwtToken: string | null = null;

function verifySignature(payload: string, signature: string): boolean {
    const expected = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function ensureAuthenticated(): Promise<string> {
    if (!jwtToken) {
        const resp = await fetch(`${MAPLE_API}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provisioning_token: PROVISIONING_TOKEN }),
        });
        const data = await resp.json();
        jwtToken = data.jwt;
    }
    return jwtToken!;
}

app.post('/webhook', async (c) => {
    const signature = c.req.header('X-Maple-Signature') || '';
    const body = await c.req.text();

    if (!verifySignature(body, signature)) {
        return c.json({ error: 'Invalid signature' }, 401);
    }

    const data = JSON.parse(body);

    if (data.event_type === 'thread_mention') {
        // Process async
        processAndReply(data).catch(console.error);
    }

    return c.json({ status: 'accepted' });
});

async function processAndReply(data: any) {
    const token = await ensureAuthenticated();
    const response = generateResponse(data.messages);

    const endpoint = data.thread_id
        ? `${MAPLE_API}/threads/${data.thread_id}/reply`
        : `${MAPLE_API}/threads/${data.parent_message_id}/reply`;

    await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: response, content_type: 'text' }),
    });
}

function generateResponse(messages: any[]): string {
    return 'Hello from my custom bot!';
}

export default app;
```
