# Chat & Messaging

Every notebook in Just Maple includes a built-in chat for team communication. Keep discussions organized alongside your work without switching to external tools.

## Accessing Chat

### Opening Chat

1. Select a notebook in the sidebar
2. Click the messages icon or "Chat" section
3. The chat view opens showing the notebook's conversation

### Chat vs. Other Pages

- Each notebook has exactly **one** messages page
- Chat is for quick, conversational communication
- Use memos for structured, long-form content

## Sending Messages

### Basic Messages

1. Type in the message input at the bottom
2. Press Enter or click Send
3. Your message appears in the chat

### Formatting

Messages support basic formatting:

- **Bold** - `**text**` or `Cmd/Ctrl + B`
- _Italic_ - `*text*` or `Cmd/Ctrl + I`
- `Code` - backticks
- Links - paste URLs to auto-link

### Mentions

Mention people or bots with `@`:

```
@sarah Can you review the proposal?
@claude-bot Summarize this thread
```

Mentions trigger notifications and can activate bots.

## Threading

### Creating Threads

Reply to messages to start a thread:

1. Hover over a message
2. Click the reply icon
3. Type your response
4. The reply is nested under the original

### Thread Benefits

- Keep related discussion together
- Reduce noise in the main chat
- Easy to follow complex conversations

### Viewing Threads

- Threads show a collapsed preview in main chat
- Click to expand and see all replies
- Reply count shows at the thread root

## Real-time Updates

### Live Sync

Messages appear instantly for all participants:

- See messages as others type (typing indicators)
- New messages push automatically
- No refresh needed

### Offline Support

When offline:

- Read previous messages from cache
- New messages queue locally
- Messages send when back online
- See sync status indicator

## Unread Tracking

### Unread Indicators

- Unread count shows on notebook in sidebar
- Bold formatting for unread messages
- "New messages" divider marks your place

### Marking Read

- Scroll through messages to mark as read
- Or click "Mark all read" in the menu

## Bot Interactions

### Triggering Bots

Mention a bot with `@botname` to invoke it:

```
@claude-bot What are the key points from today's meeting?
```

### Bot Responses

Bot responses appear in the thread:

- Formatted output (can include markdown, tables)
- May include interactive elements
- Show bot name and avatar

See [Bot Integrations](./feature-bots.md) for more on setting up bots.

## Notifications

### Push Notifications

Get notified of new messages:

- Desktop notifications (web)
- Push notifications (iOS/macOS)
- Notification sounds (configurable)

### Notification Settings

Customize per-notebook:

- All messages
- Mentions only
- None

See [Notifications](#related-documentation) for details.

## Keyboard Shortcuts

| Action       | Shortcut        |
| ------------ | --------------- |
| Send message | `Enter`         |
| New line     | `Shift + Enter` |
| Bold         | `Cmd/Ctrl + B`  |
| Italic       | `Cmd/Ctrl + I`  |
| Link         | `Cmd/Ctrl + K`  |

## Tips & Best Practices

### When to Use Chat vs. Memos

| Chat                       | Memos                  |
| -------------------------- | ---------------------- |
| Quick questions            | Detailed documentation |
| Real-time discussion       | Reference material     |
| Status updates             | Meeting notes          |
| Decisions and coordination | Structured content     |

### Effective Communication

- Use threads to keep topics organized
- Mention people for attention
- Summarize long discussions into memos
- Use bots for automated responses

### Team Workflows

- Start projects with a kickoff message
- Daily standup updates in chat
- Link to relevant memos: "See [[Project Plan]] for details"
- Archive old notebooks to reduce noise

## Related Documentation

- [Notebooks](./feature-notebooks.md) - Chat lives in notebooks
- [Bot Integrations](./feature-bots.md) - Using bots in chat
- [Sharing & Collaboration](./feature-sharing.md) - Adding team members
- [Engineering: Chat](./eng-chat.md) - Technical implementation
