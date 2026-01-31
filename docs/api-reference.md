# API Reference

Complete API documentation for Just Maple's backend services.

## Base URL

```
Production: https://api.justmaple.app
Development: http://localhost:3000
```

## Authentication

All authenticated endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

---

## Auth Endpoints

### POST /api/auth/magic-link

Send a magic link to the user's email.

**Request:**

```json
{
    "email": "user@example.com"
}
```

**Response:**

```json
{
    "success": true,
    "message": "Magic link sent"
}
```

### POST /api/auth/verify

Verify a magic link token.

**Request:**

```json
{
    "token": "abc123..."
}
```

**Response:**

```json
{
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": {
        "_id": "507f1f77bcf86cd799439011",
        "email": "user@example.com",
        "name": "John Doe"
    }
}
```

### POST /api/auth/refresh

Refresh an expired access token.

**Request:**

```json
{
    "refreshToken": "eyJ..."
}
```

**Response:**

```json
{
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
}
```

### POST /api/auth/passkey/register/start

Start passkey registration.

**Response:**

```json
{
    "challenge": "base64...",
    "rp": {
        "name": "Just Maple",
        "id": "justmaple.app"
    },
    "user": {
        "id": "base64...",
        "name": "user@example.com",
        "displayName": "John Doe"
    },
    "pubKeyCredParams": [
        { "type": "public-key", "alg": -7 },
        { "type": "public-key", "alg": -257 }
    ]
}
```

### POST /api/auth/passkey/register/finish

Complete passkey registration.

**Request:**

```json
{
    "credential": {
        "id": "base64...",
        "rawId": "base64...",
        "response": {
            "clientDataJSON": "base64...",
            "attestationObject": "base64..."
        },
        "type": "public-key"
    }
}
```

### POST /api/auth/passkey/login/start

Start passkey authentication.

**Request:**

```json
{
    "email": "user@example.com"
}
```

### POST /api/auth/passkey/login/finish

Complete passkey authentication.

**Response:**

```json
{
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { ... }
}
```

---

## User Endpoints

### GET /api/users/me

Get current user profile.

**Response:**

```json
{
    "user": {
        "_id": "507f1f77bcf86cd799439011",
        "email": "user@example.com",
        "name": "John Doe",
        "avatar": "https://...",
        "createdAt": "2024-01-01T00:00:00Z"
    }
}
```

### PUT /api/users/me

Update current user profile.

**Request:**

```json
{
    "name": "Jane Doe",
    "avatar": "https://..."
}
```

---

## Notebook Endpoints

### GET /api/notebooks

List all notebooks for current user.

**Response:**

```json
{
    "notebooks": [
        {
            "_id": "507f1f77bcf86cd799439011",
            "name": "Personal Notes",
            "icon": "book",
            "ownerId": "...",
            "members": [
                {
                    "userId": "...",
                    "role": "owner",
                    "joinedAt": "2024-01-01T00:00:00Z"
                }
            ],
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-15T00:00:00Z"
        }
    ]
}
```

### POST /api/notebooks

Create a new notebook.

**Request:**

```json
{
    "name": "Work Projects",
    "icon": "briefcase"
}
```

**Response:**

```json
{
    "notebook": {
        "_id": "507f1f77bcf86cd799439011",
        "name": "Work Projects",
        ...
    }
}
```

### GET /api/notebooks/:id

Get notebook details.

### PUT /api/notebooks/:id

Update notebook.

**Request:**

```json
{
    "name": "Updated Name",
    "icon": "folder"
}
```

### DELETE /api/notebooks/:id

Delete notebook (owner only).

### GET /api/notebooks/:id/summary

Get notebook summary with statistics.

**Response:**

```json
{
    "notebook": { ... },
    "summary": {
        "pageCounts": {
            "memo": 15,
            "whiteboard": 3,
            "messages": 1
        },
        "totalPages": 19,
        "todoStats": {
            "todoCount": 25,
            "completedCount": 18,
            "overdueCount": 2
        }
    }
}
```

### POST /api/notebooks/:id/members

Add member to notebook.

**Request:**

```json
{
    "email": "collaborator@example.com",
    "role": "editor"
}
```

### DELETE /api/notebooks/:id/members/:userId

Remove member from notebook.

---

## Page Endpoints

### GET /api/notebooks/:notebookId/pages

List pages in a notebook.

**Query Parameters:**

- `type` - Filter by page type (memo, whiteboard, messages)
- `limit` - Number of results (default: 50)
- `offset` - Pagination offset

**Response:**

```json
{
    "pages": [
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "notebookId": "...",
            "type": "memo",
            "title": "Meeting Notes",
            "tags": ["work", "meetings"],
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-15T00:00:00Z"
        }
    ]
}
```

### POST /api/notebooks/:notebookId/pages

Create a new page.

**Request:**

```json
{
    "type": "memo",
    "title": "New Document"
}
```

### GET /api/pages/:id

Get page details.

### PUT /api/pages/:id

Update page metadata.

**Request:**

```json
{
    "title": "Updated Title",
    "tags": ["important"]
}
```

### DELETE /api/pages/:id

Delete page.

---

## Memo Endpoints

### GET /api/memos/:noteId/state

Get memo Y.js state.

**Response:**

```json
{
    "state": "base64-encoded-yjs-state..."
}
```

### PUT /api/memos/:noteId/state

Update memo Y.js state.

**Request:**

```json
{
    "state": "base64-encoded-yjs-state...",
    "vector": "base64-encoded-state-vector..."
}
```

### POST /api/memos/:noteId/sync

Sync memo changes (Automerge).

**Request:**

```json
{
    "changes": ["base64-encoded-change..."],
    "heads": ["hash1", "hash2"]
}
```

**Response:**

```json
{
    "success": true,
    "merged": false,
    "newHeads": ["hash3"]
}
```

---

## Whiteboard Endpoints

### GET /api/whiteboards/:id/state

Get whiteboard state.

### PUT /api/whiteboards/:id/state

Update whiteboard state.

### POST /api/whiteboards/:id/elements

Add element to whiteboard.

**Request:**

```json
{
    "type": "rectangle",
    "x": 100,
    "y": 100,
    "width": 200,
    "height": 100,
    "fill": "#ffffff",
    "stroke": "#000000"
}
```

---

## Message Endpoints

### GET /api/pages/:pageId/messages

Get messages for a chat page.

**Query Parameters:**

- `limit` - Number of messages (default: 50)
- `before` - Message ID for pagination

**Response:**

```json
{
    "messages": [
        {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "pageId": "...",
            "senderId": "...",
            "content": "Hello, world!",
            "threadId": null,
            "createdAt": "2024-01-01T00:00:00Z",
            "thread": {
                "id": "...",
                "messageCount": 5,
                "lastMessageAt": "2024-01-01T12:00:00Z"
            }
        }
    ]
}
```

### POST /api/pages/:pageId/messages

Send a message.

**Request:**

```json
{
    "content": "Hello, team!",
    "replyTo": "optional-message-id"
}
```

### GET /api/messages/:parentId/threads

Get thread replies.

**Response:**

```json
{
    "messages": [...],
    "thread": {
        "id": "...",
        "parentMessageId": "...",
        "messageCount": 5
    }
}
```

### PUT /api/messages/:id

Edit a message.

**Request:**

```json
{
    "content": "Updated message content"
}
```

### DELETE /api/messages/:id

Delete a message (soft delete).

---

## Search Endpoints

### GET /api/search

Search across all user content.

**Query Parameters:**

- `q` - Search query (required)
- `notebookId` - Filter by notebook
- `type` - Filter by page type
- `tags` - Comma-separated tag filter
- `limit` - Number of results (default: 20)
- `offset` - Pagination offset

**Response:**

```json
{
    "results": [
        {
            "pageId": "...",
            "title": "Meeting Notes",
            "snippet": "...discussed the **quarterly** results...",
            "type": "memo",
            "notebookId": "...",
            "tags": ["work"],
            "score": 150
        }
    ]
}
```

### POST /api/search/reindex

Reindex all pages for current user.

**Response:**

```json
{
    "indexed": 42
}
```

### PUT /api/search/:pageId/tags

Update tags for a page in search index.

**Request:**

```json
{
    "tags": ["important", "work"]
}
```

---

## Template Endpoints

### GET /api/templates

List available templates.

**Response:**

```json
{
    "templates": [
        {
            "_id": "...",
            "name": "Meeting Notes",
            "description": "Template for meeting notes",
            "category": "work",
            "isSystem": true,
            "content": "# {{title}}\n\n**Date:** {{date}}\n..."
        }
    ]
}
```

### GET /api/templates/:id

Get template details.

### POST /api/templates

Create custom template.

**Request:**

```json
{
    "name": "My Template",
    "description": "Custom template",
    "content": "# {{title}}\n\nContent here..."
}
```

### POST /api/templates/:id/apply

Apply template to create new page.

**Request:**

```json
{
    "notebookId": "...",
    "variables": {
        "title": "Q1 Planning",
        "date": "2024-01-15"
    }
}
```

**Response:**

```json
{
    "page": {
        "id": "...",
        "title": "Q1 Planning",
        ...
    }
}
```

---

## AI Writing Endpoints

### POST /api/ai/write

Generate AI writing assistance.

**Request:**

```json
{
    "action": "continue",
    "text": "The quick brown fox",
    "context": "A story about animals",
    "options": {
        "tone": "playful",
        "length": "medium"
    }
}
```

**Response (streaming):**

```
data: {"type": "token", "content": " jumps"}
data: {"type": "token", "content": " over"}
data: {"type": "done", "usage": {"inputTokens": 50, "outputTokens": 100}}
```

**Available Actions:**

- `continue` - Continue writing from cursor
- `improve` - Improve selected text
- `simplify` - Simplify complex text
- `expand` - Expand on ideas
- `summarize` - Summarize content
- `fix-grammar` - Fix grammar and spelling
- `translate` - Translate to another language
- `custom` - Custom instruction

### GET /api/ai/usage

Get AI usage statistics.

**Response:**

```json
{
    "usage": {
        "tokensUsed": 15000,
        "tokensLimit": 100000,
        "requestsToday": 25,
        "requestsLimit": 100
    }
}
```

---

## Bot Endpoints

### GET /api/bots/templates

List available bot templates.

**Response:**

```json
{
    "templates": [
        {
            "_id": "...",
            "name": "Claude AI",
            "handle": "claude",
            "description": "AI assistant powered by Claude",
            "requiresConfig": true,
            "icon": "bot"
        }
    ]
}
```

### GET /api/bots/users

List user's configured bots.

### POST /api/bots/users

Create a user bot from template.

**Request:**

```json
{
    "templateId": "...",
    "name": "My Claude",
    "handle": "my-claude",
    "config": {
        "apiKey": "sk-...",
        "systemPrompt": "You are a helpful assistant"
    }
}
```

### PUT /api/bots/users/:id

Update user bot configuration.

### DELETE /api/bots/users/:id

Delete user bot.

### POST /api/bots/invoke

Invoke a bot.

**Request:**

```json
{
    "userBotId": "...",
    "text": "@my-claude What is the weather?",
    "context": "Recent conversation...",
    "sourceType": "chat",
    "sourceId": "message-id"
}
```

**Response:**

```json
{
    "text": "I don't have access to real-time weather data...",
    "metadata": {
        "model": "claude-sonnet-4-20250514",
        "tokens": {
            "input_tokens": 100,
            "output_tokens": 50
        }
    }
}
```

### GET /api/bots/invocations

Get bot invocation history.

**Query Parameters:**

- `userBotId` - Filter by bot
- `limit` - Number of results (default: 50)

---

## Recording Endpoints

### POST /api/recordings

Create a new recording.

**Request (multipart/form-data):**

- `audio` - Audio file (webm, m4a, mp3)
- `pageId` - Associated page ID
- `duration` - Duration in seconds

**Response:**

```json
{
    "recording": {
        "_id": "...",
        "pageId": "...",
        "duration": 120,
        "status": "uploaded",
        "url": "https://..."
    }
}
```

### GET /api/recordings/:id

Get recording details.

### DELETE /api/recordings/:id

Delete recording.

### POST /api/recordings/:id/transcribe

Start transcription.

**Response:**

```json
{
    "status": "processing",
    "estimatedTime": 30
}
```

### GET /api/recordings/:id/transcription

Get transcription result.

**Response:**

```json
{
    "transcription": {
        "text": "Full transcription text...",
        "segments": [
            {
                "start": 0,
                "end": 5.2,
                "text": "Hello, welcome to the meeting."
            }
        ],
        "language": "en",
        "confidence": 0.95
    }
}
```

---

## Link Endpoints

### GET /api/pages/:id/links

Get links from a page.

**Response:**

```json
{
    "outgoing": [
        {
            "targetPageId": "...",
            "targetTitle": "Related Document",
            "context": "...as mentioned in [[Related Document]]..."
        }
    ],
    "incoming": [
        {
            "sourcePageId": "...",
            "sourceTitle": "Another Document",
            "context": "...see [[Current Page]] for details..."
        }
    ]
}
```

### POST /api/pages/:id/links

Create a link.

**Request:**

```json
{
    "targetPageId": "...",
    "context": "Link context"
}
```

---

## Collectibles Endpoints

### GET /api/collectibles

List user's collectibles.

**Query Parameters:**

- `type` - Filter by type (lego, funko, etc.)
- `status` - Filter by status (owned, wishlist, building)

**Response:**

```json
{
    "collectibles": [
        {
            "_id": "...",
            "type": "lego",
            "setNumber": "75192",
            "name": "Millennium Falcon",
            "pieces": 7541,
            "status": "owned",
            "imageUrl": "https://...",
            "purchaseDate": "2024-01-01",
            "notes": "My favorite set!"
        }
    ]
}
```

### POST /api/collectibles

Add a collectible.

### PUT /api/collectibles/:id

Update collectible.

### DELETE /api/collectibles/:id

Delete collectible.

---

## WebSocket Events

### Connection

```javascript
const ws = new WebSocket('wss://api.justmaple.app/ws/realtime');

// Authenticate
ws.send(JSON.stringify({ type: 'auth', token: 'jwt-token' }));
```

### Client Events (Send)

| Event       | Payload                            | Description             |
| ----------- | ---------------------------------- | ----------------------- |
| `auth`      | `{ token }`                        | Authenticate connection |
| `join`      | `{ room }`                         | Join a room             |
| `leave`     | `{ room }`                         | Leave a room            |
| `sync`      | `{ noteId, changes, heads }`       | Sync document changes   |
| `awareness` | `{ room, state }`                  | Update cursor/selection |
| `typing`    | `{ notebookId, isTyping }`         | Typing indicator        |
| `message`   | `{ notebookId, content, replyTo }` | Send chat message       |

### Server Events (Receive)

| Event              | Payload                              | Description                        |
| ------------------ | ------------------------------------ | ---------------------------------- |
| `authSuccess`      | `{}`                                 | Authentication successful          |
| `authError`        | `{ error }`                          | Authentication failed              |
| `joined`           | `{ room }`                           | Successfully joined room           |
| `userJoined`       | `{ room, userId }`                   | Another user joined                |
| `userLeft`         | `{ room, userId }`                   | User left room                     |
| `syncUpdate`       | `{ noteId, changes, sender }`        | Document changes from another user |
| `syncAck`          | `{ noteId, success, merged, heads }` | Sync acknowledgment                |
| `awareness`        | `{ room, userId, state }`            | User cursor/selection update       |
| `awarenessRemoved` | `{ room, userId }`                   | User left (remove cursor)          |
| `newMessage`       | `{ message }`                        | New chat message                   |
| `messageUpdated`   | `{ messageId, content }`             | Message edited                     |
| `messageDeleted`   | `{ messageId }`                      | Message deleted                    |
| `typing`           | `{ userId, isTyping }`               | Typing indicator                   |

### Room Types

| Room Pattern        | Description                 |
| ------------------- | --------------------------- |
| `user:{userId}`     | User-specific notifications |
| `memo:{noteId}`     | Document collaboration      |
| `chat:{notebookId}` | Chat messages               |

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
    "error": "Error type",
    "message": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Description                             |
| ---- | --------------------------------------- |
| 200  | Success                                 |
| 201  | Created                                 |
| 400  | Bad Request - Invalid input             |
| 401  | Unauthorized - Invalid or missing token |
| 403  | Forbidden - Insufficient permissions    |
| 404  | Not Found                               |
| 429  | Too Many Requests - Rate limited        |
| 500  | Internal Server Error                   |

---

## Rate Limits

| Endpoint Category  | Limit                |
| ------------------ | -------------------- |
| Auth endpoints     | 10 requests/minute   |
| AI endpoints       | 100 requests/day     |
| General API        | 1000 requests/minute |
| WebSocket messages | 100 messages/second  |

---

## Related Documentation

- [Architecture](./architecture.md) - System overview
- [Data Model](./data-model.md) - Database schemas
- [Engineering: Auth](./eng-auth.md) - Authentication implementation
- [Engineering: Realtime](./eng-realtime.md) - WebSocket implementation
