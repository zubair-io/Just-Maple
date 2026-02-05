# Hello Bot - Example Custom Bot

A minimal example of a custom bot for Just Maple that:

1. Authenticates using a provisioning token
2. Saves the JWT for API calls
3. Responds "Hello!" when mentioned

## Setup

1. **Create a custom bot in Just Maple**
    - Go to Settings > Bots > Custom Bots
    - Click "Create Custom Bot"
    - Set the Webhook URL to `http://localhost:3001/webhook`
    - Copy the provisioning token and webhook secret

2. **Configure the bot**

    ```bash
    cp .env.example .env
    # Edit .env with your tokens
    ```

3. **Install dependencies**

    ```bash
    bun install
    ```

4. **Run the bot**
    ```bash
    bun run start
    ```

## How it works

### Authentication Flow

```
┌─────────────────┐     POST /api/bots/login        ┌──────────────────┐
│   Hello Bot     │ ─────────────────────────────▶ │  Just Maple API  │
│                 │     { provisioning_token }      │                  │
│                 │ ◀───────────────────────────── │                  │
│                 │     { jwt, expires_at }         │                  │
└─────────────────┘                                 └──────────────────┘
```

### Message Flow

```
┌─────────────────┐                                 ┌──────────────────┐
│     User        │  @hello-bot hi there!          │  Just Maple      │
└────────┬────────┘                                 └────────┬─────────┘
         │                                                   │
         └───────────────────────────────────────────────────┘
                                    │
                     Webhook: POST /webhook
                     { event_type: "bot.mentioned", ... }
                                    │
                                    ▼
                          ┌─────────────────┐
                          │   Hello Bot     │
                          └────────┬────────┘
                                   │
              POST /api/bots/threads/:messageId/reply
              { content: "Hello, User! 👋" }
                                   │
                                   ▼
                          ┌─────────────────┐
                          │  Just Maple API │
                          └─────────────────┘
```

## API Reference

### Bot Authentication

- `POST /api/bots/login` - Exchange provisioning token for JWT
- `POST /api/bots/refresh` - Refresh JWT before expiration
- `POST /api/bots/logout` - Revoke current session

### Bot Messages

- `GET /api/bots/pages/:pageId/messages` - Get messages for a page
- `POST /api/bots/pages/:pageId/messages` - Send a new message
- `POST /api/bots/threads/:parentMessageId/reply` - Reply in a thread

### Webhook Events

The bot receives webhook calls when:

- `bot.mentioned` - Someone @mentions the bot
- `message.created` - A new message is created in a thread the bot is in

## Environment Variables

| Variable             | Description                                         |
| -------------------- | --------------------------------------------------- |
| `API_URL`            | Just Maple API URL (default: http://localhost:3000) |
| `PROVISIONING_TOKEN` | Your bot's provisioning token                       |
| `WEBHOOK_SECRET`     | Secret for verifying webhook signatures             |
| `PORT`               | Port for webhook server (default: 3001)             |

## Webhook Signature Verification

All webhooks include an `X-Maple-Signature` header with an HMAC-SHA256 signature:

```typescript
const expectedSignature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

const isValid = `sha256=${expectedSignature}` === signatureHeader;
```
