# Custom Bots API Reference

This document describes the API for creating and managing custom bots in Just Maple.

## Overview

Custom bots allow you to extend Just Maple with your own webhook-powered automations. When mentioned in chat, your bot receives a webhook call and can respond via the Bot API.

## Authentication Flow

### 1. Create a Custom Bot

Use the Just Maple web interface to create a custom bot. You'll receive:

- **Provisioning Token**: One-time displayed token to authenticate your bot
- **Webhook Secret**: Used to verify webhook signatures

### 2. Exchange Token for JWT

```bash
POST /api/bots/login
Content-Type: application/json

{
  "provisioning_token": "prov_abc123..."
}
```

Response:

```json
{
    "jwt": "eyJhbGciOiJIUzI1NiIs...",
    "expires_at": "2024-01-15T12:00:00Z",
    "bot_id": "abc123",
    "bot_name": "My Bot"
}
```

### 3. Use JWT for API Calls

Include the JWT in the Authorization header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### 4. Refresh Token Before Expiration

```bash
POST /api/bots/refresh
Authorization: Bearer <current-jwt>
```

---

## Webhook Invocation

When your bot is mentioned (e.g., `@my-bot help`), Just Maple calls your webhook:

```bash
POST https://your-server.com/webhook
Content-Type: application/json
X-Maple-Signature: sha256=abc123...
X-Maple-Timestamp: 1705312800

{
  "event": "bot.invoked",
  "bot_id": "abc123",
  "invocation_id": "inv_xyz789",
  "source": {
    "type": "message",
    "message_id": "msg_123",
    "page_id": "page_456",
    "notebook_id": "nb_789",
    "thread_id": "thread_abc"
  },
  "context": {
    "mention_text": "help",
    "full_content": "Hey @my-bot help with this",
    "document_title": "Meeting Notes"
  },
  "user": {
    "id": "user_123",
    "name": "John Doe"
  }
}
```

### Verifying Webhook Signatures

Verify the signature to ensure the request came from Just Maple:

```typescript
import crypto from 'crypto';

function verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const provided = signature.replace('sha256=', '');

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
```

### Responding to Webhooks

Return `200 OK` immediately to acknowledge receipt. Then use the Bot API to send your response.

---

## Bot API Endpoints

### Messages

#### List Messages

```bash
GET /api/bots/pages/:pageId/messages
Authorization: Bearer <jwt>
```

Query parameters:

- `limit`: Max messages to return (default: 50)
- `before`: Message ID for pagination

Response:

```json
{
  "messages": [
    {
      "id": "msg_123",
      "content": { "type": "doc", "content": [...] },
      "sender_id": "user_123",
      "sender_name": "John Doe",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

#### Get Thread

```bash
GET /api/bots/threads/:threadId
Authorization: Bearer <jwt>
```

Response:

```json
{
  "thread": {
    "id": "thread_abc",
    "parent_message_id": "msg_123",
    "page_id": "page_456"
  },
  "messages": [...]
}
```

#### Reply to Thread

```bash
POST /api/bots/threads/:parentMessageId/reply
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Hello! Here's my response." }
        ]
      }
    ]
  }
}
```

Response:

```json
{
    "message": {
        "id": "msg_new123",
        "thread_id": "thread_abc",
        "created_at": "2024-01-15T10:05:00Z"
    }
}
```

#### Create New Message

Start a new message (not in a thread):

```bash
POST /api/bots/pages/:pageId/messages
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Proactive message from bot" }
        ]
      }
    ]
  }
}
```

---

## Bot Management API

These endpoints require user authentication (not bot JWT).

### List Custom Bots

```bash
GET /api/custom-bots
Authorization: Bearer <user-jwt>
```

### Create Custom Bot

```bash
POST /api/custom-bots
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "name": "My Custom Bot",
  "handle": "my-bot",
  "description": "A helpful automation bot",
  "invokeUrl": "https://my-server.com/webhook",
  "permissions": {
    "messages": {
      "read": true,
      "write": true
    }
  },
  "jwtExpirationHours": 12
}
```

Response includes:

- `bot`: The created bot object
- `provisioning_token`: One-time token (save this!)
- `webhook_secret`: For signature verification (save this!)

### Update Custom Bot

```bash
PATCH /api/custom-bots/:id
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "name": "Updated Name",
  "invokeUrl": "https://new-server.com/webhook"
}
```

### Delete Custom Bot

```bash
DELETE /api/custom-bots/:id
Authorization: Bearer <user-jwt>
```

### Regenerate Provisioning Token

Invalidates all previous tokens:

```bash
POST /api/custom-bots/:id/regenerate-token
Authorization: Bearer <user-jwt>
```

### Regenerate Webhook Secret

```bash
POST /api/custom-bots/:id/webhook-secret
Authorization: Bearer <user-jwt>
```

### Update Bot Status

```bash
POST /api/custom-bots/:id/status
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "status": "active" | "disabled" | "revoked"
}
```

### List Bot Sessions

```bash
GET /api/custom-bots/:id/sessions
Authorization: Bearer <user-jwt>
```

### Revoke All Sessions

```bash
DELETE /api/custom-bots/:id/sessions
Authorization: Bearer <user-jwt>
```

---

## Message Content Format

Messages use ProseMirror JSON format (TipTap compatible):

```json
{
    "type": "doc",
    "content": [
        {
            "type": "paragraph",
            "content": [
                { "type": "text", "text": "Hello " },
                { "type": "text", "marks": [{ "type": "bold" }], "text": "world" },
                { "type": "text", "text": "!" }
            ]
        },
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{ "type": "text", "text": "Item 1" }]
                        }
                    ]
                }
            ]
        }
    ]
}
```

### Supported Node Types

- `paragraph`: Text paragraph
- `heading`: Headings (attrs: `level: 1-6`)
- `bulletList`: Unordered list
- `orderedList`: Numbered list
- `listItem`: List item
- `codeBlock`: Code block (attrs: `language`)
- `blockquote`: Quote block
- `horizontalRule`: Horizontal divider

### Supported Marks

- `bold`: **Bold text**
- `italic`: _Italic text_
- `code`: `Inline code`
- `link`: Hyperlink (attrs: `href`)
- `strike`: ~~Strikethrough~~

---

## Error Responses

All errors follow this format:

```json
{
    "error": "error/code",
    "message": "Human-readable description"
}
```

### Common Error Codes

| Code                   | Status | Description                 |
| ---------------------- | ------ | --------------------------- |
| `auth/missing_token`   | 401    | No Authorization header     |
| `auth/invalid_token`   | 401    | Invalid or expired token    |
| `auth/jwt_expired`     | 401    | JWT has expired             |
| `auth/session_revoked` | 401    | Session was revoked         |
| `auth/bot_inactive`    | 401    | Bot is disabled/revoked     |
| `permission/denied`    | 403    | Missing required permission |
| `resource/not_found`   | 404    | Resource doesn't exist      |
| `validation/invalid`   | 400    | Invalid request body        |

---

## Rate Limits

| Endpoint          | Limit      |
| ----------------- | ---------- |
| Bot Login         | 10/minute  |
| Webhook (per bot) | 60/minute  |
| Message Read      | 100/minute |
| Message Write     | 30/minute  |

Rate limit headers:

- `X-RateLimit-Limit`: Request limit
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Example Bot Implementation

### Node.js + Express

```typescript
import express from 'express';
import crypto from 'crypto';

const app = express();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const BOT_JWT = process.env.BOT_JWT;
const MAPLE_API = 'https://api.justmaple.app';

// Verify webhook signature
function verifySignature(payload: string, signature: string): boolean {
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
    return `sha256=${expected}` === signature;
}

// Webhook endpoint
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-maple-signature'] as string;

    if (!verifySignature(req.body.toString(), signature)) {
        return res.status(401).send('Invalid signature');
    }

    // Acknowledge immediately
    res.status(200).send('OK');

    // Parse event
    const event = JSON.parse(req.body.toString());

    if (event.event === 'bot.invoked') {
        // Process and respond
        await handleBotInvocation(event);
    }
});

async function handleBotInvocation(event: any) {
    const response = {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                content: [{ type: 'text', text: `You said: ${event.context.mention_text}` }],
            },
        ],
    };

    // Reply to the thread
    await fetch(`${MAPLE_API}/api/bots/threads/${event.source.message_id}/reply`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${BOT_JWT}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: response }),
    });
}

app.listen(3000);
```

---

## Security Best Practices

1. **Always verify webhook signatures** - Never process requests without signature verification
2. **Store secrets securely** - Use environment variables or secret managers
3. **Handle token refresh** - Refresh JWTs before expiration
4. **Use HTTPS** - All webhook URLs must use HTTPS
5. **Implement idempotency** - Webhooks may be retried; use invocation_id to deduplicate
6. **Set appropriate permissions** - Request only the permissions your bot needs
