# Frequently Asked Questions

Common questions about Just Maple and how to use it effectively.

## General

### What is Just Maple?

Just Maple is a self-hosted note-taking and collaboration platform. It combines rich document editing, whiteboards, chat, voice recording, and AI features in one unified workspace. You host it yourself for full control over your data.

### Is Just Maple free?

Just Maple is open source and free to use. You only pay for hosting (your own server) and optional third-party services (AI APIs, push notifications).

### What platforms does Just Maple support?

- **Web** - Any modern browser
- **macOS** - Native Swift app
- **iOS** - Native Swift app with offline support
- **reMarkable** - Native Rust app for e-ink tablets

### Can I use Just Maple without self-hosting?

Currently, Just Maple requires self-hosting. There's no official hosted version, though one may be offered in the future.

## Getting Started

### How do I install Just Maple?

1. Set up a server (Docker, Bun, or cloud hosting)
2. Configure environment variables (database, auth, etc.)
3. Deploy the API
4. Access via web or connect native apps

See the deployment documentation for detailed instructions.

### How do I create an account?

Just Maple uses passwordless authentication:

1. Enter your email address
2. Click the magic link sent to your email
3. Optionally set up a passkey for faster login

### Can I import notes from other apps?

Currently, you can:

- Copy/paste content (formatting preserved)
- Drag and drop markdown files
- Use the API for bulk imports

Native importers for specific apps are planned.

## Features

### Can multiple people edit at the same time?

Yes! Just Maple uses CRDT technology (Y.js) for real-time collaboration. Multiple users can edit the same document simultaneously without conflicts.

### Does it work offline?

Yes. Just Maple is offline-first:

- All content stored locally (IndexedDB)
- Create and edit while offline
- Changes sync when back online
- See sync status indicator

### How does the AI writing assistant work?

Select text in the editor and choose an AI action (improve, expand, simplify, etc.). The AI processes your request using Claude and streams the response in real-time. Requires an Anthropic API key in your server configuration.

### Can I use my own AI API keys?

Yes. Configure your own API keys in the server settings for:

- Anthropic (Claude) for AI writing
- Other providers as supported

## Privacy & Security

### Where is my data stored?

Your data is stored on YOUR server:

- MongoDB/Cosmos DB for structured data
- Object storage for files (configurable)
- No data sent to third parties by default

### Is my data encrypted?

- **In transit** - TLS/HTTPS encryption
- **At rest** - Depends on your database configuration
- **End-to-end** - Not currently (planned for future)

### Who can see my notes?

Only you and people you explicitly share with. Since you self-host, you have full control over access.

### Do AI features send my data to external services?

When using AI features, selected text is sent to the AI provider (e.g., Anthropic). This is processed for your request and not stored for training. You can disable AI features entirely.

## Editing

### What formatting options are available?

Full rich text formatting:

- Headings (H1-H3)
- Bold, italic, underline, strikethrough
- Lists (bullet, numbered, task)
- Code blocks with syntax highlighting
- Tables
- Images and embeds
- Links and mentions

### Can I use Markdown?

Yes! Type Markdown syntax and it converts automatically:

- `#` for headings
- `**bold**` for bold
- `-` for lists
- And more

### How do I create links between notes?

Type `[[` and start typing the page name. Select from the dropdown to create a wiki-style link. Backlinks are tracked automatically.

### Can I add images?

Yes:

- Drag and drop images into the editor
- Paste from clipboard
- Use the image button in toolbar
  Images are uploaded to your configured storage.

## Collaboration

### How do I share a notebook?

1. Open notebook settings
2. Click "Share"
3. Enter email addresses
4. Choose permission levels
5. Send invitations

### What permission levels exist?

- **Reader** - View only
- **Member** - View and edit
- **Admin** - Manage members
- **Owner** - Full control

### Can I share individual pages?

Currently, sharing is at the notebook level. All pages in a shared notebook are accessible to members.

## Sync & Offline

### Why isn't my content syncing?

Check:

1. Internet connection
2. Sync status indicator
3. Server availability
4. Browser console for errors

Try the manual retry button if stuck.

### How do I resolve a sync conflict?

Conflicts are rare with CRDT, but if one occurs:

1. You'll see a conflict indicator
2. Open the conflict panel
3. Review both versions
4. Choose or merge

### Is there a storage limit?

Browser-based storage has limits (typically a few GB). Manage by:

- Archiving old notebooks
- Removing large attachments
- Clearing cached content

## Mobile & Native Apps

### Where can I download the apps?

- **iOS/macOS** - Available via TestFlight (pending App Store release)
- **reMarkable** - Manual installation via USB

### Do the apps work offline?

Yes. Native apps have full offline support with local databases.

### How do I connect to my server?

1. Open the app
2. Go to Settings > Servers
3. Enter your server URL
4. Sign in with email

## Troubleshooting

### The editor is slow

Try:

- Clearing browser cache
- Reducing document size
- Checking for browser extensions
- Using native app instead

### I can't log in

1. Check email for magic link (including spam)
2. Ensure link hasn't expired (15 min limit)
3. Try requesting a new link
4. Check server logs for errors

### Search isn't finding my content

1. Wait for content to index
2. Try reindexing (Settings > Search)
3. Check search syntax
4. Verify content exists

### Audio recording isn't working

1. Grant microphone permissions
2. Check browser supports MediaRecorder
3. Try the native app for better support
4. Check available storage

## Feature Requests & Support

### How do I request a feature?

1. Check if it's already planned in the roadmap
2. Open an issue on GitHub
3. Describe the use case clearly

### How do I report a bug?

1. Check existing issues on GitHub
2. Create a new issue with:
    - Steps to reproduce
    - Expected vs. actual behavior
    - Browser/platform info
    - Screenshots if helpful

### Where can I get help?

- GitHub Issues - Bug reports and features
- GitHub Discussions - Questions and community
- Documentation - This docs site

## Related Documentation

- [Overview](./overview.md) - What is Just Maple
- [Architecture](./architecture.md) - Technical overview
- [Keyboard Shortcuts](./feature-keyboard-shortcuts.md) - Quick reference
