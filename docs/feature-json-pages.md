# Feature: JSON Pages

JSON pages are a structured data page type that stores arbitrary JSON payloads. Unlike memos (rich text via Y.js), JSON pages store raw JSON objects with optional schema validation, versioned updates, and optimistic concurrency control.

JSON data can be referenced live inside memo documents using **JSON Reference** and **JSON Loop** editor blocks.

---

## UI Guide

### Creating a JSON Page

1. Open a notebook
2. Click the dropdown arrow on the **New Note** button
3. Select **New JSON Page**
4. The page opens with an empty JSON editor

### Editing JSON Data

The JSON page view has three sections:

- **Code Editor** - Edit the raw JSON data directly
- **Form Builder** - Visual key/value editing (auto-generated from the data structure)
- **Schema** (optional) - Attach a JSON Schema to validate edits

Changes are saved with optimistic concurrency (version numbers). If another user edits the same document simultaneously, you'll be prompted to refresh.

### Using JSON Data in Memos

JSON pages become powerful when their data is referenced live inside memo documents.

#### JSON Reference (Inline Value)

Displays a single live value from a JSON page inline in your text.

1. Open a memo in the same notebook
2. Type `/` to open the slash command menu
3. Select **JSON Reference**
4. In the modal:
    - Pick a JSON page from the dropdown
    - Browse the data tree and click to select a path (e.g., `user.name`)
    - Click **Insert**
5. The value appears inline as a styled chip (e.g., `John Doe`)
6. **Click** the reference to re-configure it (change page or path)
7. Values update in real-time when the JSON data changes

#### JSON Loop (Table / List)

Renders a JSON array as a table or bulleted list.

1. Open a memo in the same notebook
2. Type `/` to open the slash command menu
3. Select **JSON Table**
4. In the modal:
    - Pick a JSON page
    - Select a path that points to an array (e.g., `users` or `items`)
    - Choose **Table** or **List** rendering
    - For tables: optionally specify column names (comma-separated, or leave empty for auto-detect)
    - For lists: provide a template string using `{{fieldName}}` placeholders
5. Click **Insert**
6. **Double-click** the block to re-configure it
7. Data updates in real-time

**Template variables (list mode):**

| Variable        | Description                            |
| --------------- | -------------------------------------- |
| `{{fieldName}}` | Value of a field on each item          |
| `{{$index}}`    | Zero-based index                       |
| `{{$index1}}`   | One-based index                        |
| `{{.}}`         | The entire item (for primitive arrays) |

---

## Bot API

Bots can read and write JSON page data using the JSON Documents REST API.

### Authentication

JSON document endpoints use **user JWT authentication** (the standard `Authorization: Bearer <jwt>` header from `/api/auth/login`).

> **Note:** Bot JWT/access token auth is not currently supported for JSON document endpoints. Bots that need JSON access should authenticate with the user JWT of their owner, or use the Bot Memos API to write JSON data into memo documents instead.

### Base URL

```
/api/json-documents
```

### Endpoints

#### Get JSON Document

```
GET /api/json-documents/:pageId
```

Returns the JSON document for a page. Auto-creates an empty document if the page exists but the document hasn't been initialized yet.

**Response:**

```json
{
    "document": {
        "_id": "670f1a2b3c4d5e6f7a8b9c0d",
        "id": "0a49baac-6662-4144-a15c-bcdf000d5e76",
        "pageId": "0a49baac-6662-4144-a15c-bcdf000d5e76",
        "notebookId": "670f1a2b3c4d5e6f7a8b9c0e",
        "data": {
            "name": "Project Alpha",
            "status": "active",
            "members": [
                { "name": "Alice", "role": "lead" },
                { "name": "Bob", "role": "dev" }
            ]
        },
        "schema": null,
        "version": 3,
        "createdAt": "2025-02-14T10:00:00.000Z",
        "updatedAt": "2025-02-14T12:30:00.000Z"
    }
}
```

---

#### Replace JSON Data (PUT)

```
PUT /api/json-documents/:pageId/data
```

Replaces the entire JSON data payload. Requires the current `version` for optimistic concurrency.

**Request:**

```json
{
    "data": {
        "name": "Project Alpha",
        "status": "completed",
        "members": []
    },
    "version": 3
}
```

**Success Response (200):**

```json
{
    "document": {
        "data": { "name": "Project Alpha", "status": "completed", "members": [] },
        "version": 4,
        "updatedAt": "2025-02-14T13:00:00.000Z"
    }
}
```

**Version Conflict (409):**

```json
{
    "error": "Version conflict",
    "message": "The document has been modified since you last fetched it. Please refresh and try again."
}
```

---

#### Patch JSON Data (PATCH)

```
PATCH /api/json-documents/:pageId/data
```

Applies a [JSON Merge Patch (RFC 7396)](https://datatracker.ietf.org/doc/html/rfc7396) to the existing data. Set a key to `null` to remove it.

**Request:**

```json
{
    "patch": {
        "status": "archived",
        "archivedAt": "2025-02-14T13:00:00Z",
        "members": null
    },
    "version": 4
}
```

**Result:** `status` updated, `archivedAt` added, `members` removed. Other fields unchanged.

---

#### Set JSON Schema (PUT)

```
PUT /api/json-documents/:pageId/schema
```

Attaches a JSON Schema that validates future data writes. The schema itself is validated before being stored.

**Request:**

```json
{
    "schema": {
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "status": { "type": "string", "enum": ["active", "completed", "archived"] }
        },
        "required": ["name", "status"]
    }
}
```

When a schema is set, `PUT /data` requests are validated against it before writing. Invalid data returns **422**:

```json
{
    "error": "Schema validation failed",
    "details": [
        { "instancePath": "/status", "message": "must be equal to one of the allowed values" }
    ]
}
```

---

#### Remove JSON Schema (DELETE)

```
DELETE /api/json-documents/:pageId/schema
```

Removes the schema. Future writes will no longer be validated.

---

### Real-Time Updates

When JSON data is updated, a WebSocket event is broadcast to all users with access to the notebook:

```json
{
  "type": "json.updated",
  "pageId": "0a49baac-...",
  "version": 5,
  "data": { ... },
  "notebookId": "670f1a2b..."
}
```

Clients subscribed to the notebook's WebSocket channel receive this event and update any live JSON references or loop blocks in open memos automatically.

---

### Creating a JSON Page via API

JSON pages are created using the standard Pages API:

```
POST /api/pages
```

```json
{
    "type": "json",
    "title": "My Data Page",
    "notebookId": "670f1a2b3c4d5e6f7a8b9c0e"
}
```

The JSON document is auto-created (with empty `{}` data) on the first `GET /api/json-documents/:pageId` call.

---

### Typical Bot Workflow

```
1. POST /api/pages              -> Create a JSON page (type: "json")
2. GET  /api/json-documents/:id -> Fetch the document (auto-creates if needed)
3. PUT  /api/json-documents/:id/data -> Write structured data
4. (Users insert JSON references in their memos pointing to this page)
5. PATCH /api/json-documents/:id/data -> Bot updates data; memo references update live
```

**Example: A bot that tracks build status**

```bash
# 1. Create the page
curl -X POST https://app.example.com/api/pages \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "json",
    "title": "Build Status",
    "notebookId": "NOTEBOOK_ID"
  }'

# 2. Get the document (returns version 1, empty data)
curl https://app.example.com/api/json-documents/PAGE_ID \
  -H "Authorization: Bearer $JWT"

# 3. Write initial data
curl -X PUT https://app.example.com/api/json-documents/PAGE_ID/data \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "branch": "main",
      "status": "passing",
      "lastRun": "2025-02-14T12:00:00Z",
      "tests": { "passed": 142, "failed": 0, "skipped": 3 }
    },
    "version": 1
  }'

# 4. Later, patch just the status
curl -X PATCH https://app.example.com/api/json-documents/PAGE_ID/data \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "patch": {
      "status": "failing",
      "tests": { "passed": 140, "failed": 2, "skipped": 3 }
    },
    "version": 2
  }'
```

Users can then insert `{{status}}`, `{{tests.passed}}`, etc. as live inline references in their memos.

---

## Data Model

### Pages Collection

JSON pages use the standard `pages` collection with `type: "json"`.

### JSON Documents Collection (`json_documents`)

| Field        | Type           | Description                                        |
| ------------ | -------------- | -------------------------------------------------- |
| `_id`        | ObjectId       | MongoDB ID                                         |
| `id`         | string         | Same as `pages.id` (UUID)                          |
| `pageId`     | string         | References `pages.id`                              |
| `notebookId` | string         | Denormalized for queries                           |
| `data`       | unknown        | Arbitrary JSON payload                             |
| `schema`     | unknown / null | Optional JSON Schema for validation                |
| `version`    | number         | Incremented on each write (optimistic concurrency) |
| `createdAt`  | Date           |                                                    |
| `updatedAt`  | Date           |                                                    |

---

## Key Files

| File                                                                                  | Purpose                               |
| ------------------------------------------------------------------------------------- | ------------------------------------- |
| `apps/api/src/routes/json-documents.ts`                                               | REST API endpoints                    |
| `apps/api/src/repositories/json-document.repo.ts`                                     | Data access layer                     |
| `apps/web/src/app/services/json-document.service.ts`                                  | Frontend service (caching, real-time) |
| `apps/web/src/app/components/organisms/notebook-editor/extensions/json-data-ref.ts`   | Inline reference TipTap extension     |
| `apps/web/src/app/components/organisms/notebook-editor/extensions/json-loop-block.ts` | Table/list TipTap extension           |
| `apps/web/src/app/components/molecules/json-ref-config/`                              | Configuration modal                   |
| `packages/shared/src/schemas/json-document.ts`                                        | Shared TypeBox schema                 |
