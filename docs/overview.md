# Just Maple Overview

Just Maple is a self-hosted note-taking and collaboration platform designed for privacy-conscious users who want full control over their data. It combines powerful editing features, real-time collaboration, AI assistance, and cross-platform support into a cohesive workspace.

## What is Just Maple?

Just Maple organizes your thoughts, notes, and creative work through **notebooks** - flexible containers that can hold rich documents, drawings, messages, recordings, and more. Whether you're taking meeting notes, brainstorming on a whiteboard, tracking your LEGO collection, or chatting with your team, Just Maple provides the tools you need in one unified platform.

## Core Features

### Rich Document Editing

Create beautifully formatted documents with our TipTap-powered editor. Support for headings, lists, tables, code blocks, callouts, and more. Your content syncs in real-time and works offline.

### Whiteboard & Drawing

Sketch ideas, create diagrams, or draw freely on an infinite canvas. Perfect for visual thinkers and collaborative brainstorming sessions.

### Enhanced Todos

Track tasks with priority levels, due dates, and color coding. View all your todos across notebooks in one place and never miss a deadline.

### Messaging & Chat

Every notebook includes a built-in chat for team communication. Reply in threads, mention teammates, and keep conversations organized alongside your work.

### AI Writing Assistant

Let AI help you write better. Continue your thoughts, improve clarity, simplify complex text, expand ideas, or get summaries - all powered by Claude.

### Voice Recording & Transcription

Record audio directly in your notes with on-device transcription powered by WhisperKit. Your voice recordings stay private and searchable.

### Bi-directional Linking

Connect your ideas with wiki-style `[[Page Links]]`. See backlinks to understand how your knowledge connects and build a personal knowledge graph.

### Templates

Start from pre-built templates (Meeting Notes, Daily Journal, Project Brief) or create your own. Templates support variable substitution for dates and context.

### Bot Integrations

Automate workflows with customizable bots. Mention a bot in chat or documents to trigger actions like AI responses, data lookups, or custom integrations.

### Collectibles & LEGO Tracking

Track your collections with barcode scanning, status management, and integration with external databases like Rebrickable.

## Platform Support

Just Maple runs everywhere you work:

| Platform       | App Type     | Key Features                                                 |
| -------------- | ------------ | ------------------------------------------------------------ |
| **Web**        | Angular SPA  | Full-featured, works in any modern browser                   |
| **macOS**      | Native Swift | Deep OS integration, menu bar access, notifications          |
| **iOS**        | Native Swift | Touch-optimized, on-device transcription, push notifications |
| **reMarkable** | Native Rust  | E-ink optimized, stylus support, distraction-free            |

## Self-Hosted & Private

Unlike cloud-only services, Just Maple is designed to be self-hosted:

- **Your data stays yours** - Host on your own server or cloud instance
- **No vendor lock-in** - Export your data anytime in standard formats
- **Privacy by design** - Passwordless auth, on-device processing, minimal telemetry
- **Offline-first** - Keep working even without internet; changes sync when you're back online

## Getting Started

1. **Set up a server** - Deploy the API using Docker or Bun directly
2. **Connect your apps** - Configure web, iOS, or macOS apps to point to your server
3. **Create a notebook** - Start organizing your content
4. **Invite collaborators** - Share notebooks with team members

## Learn More

- [Notebooks & Organization](./feature-notebooks.md)
- [Memo Editor](./feature-memo-editor.md)
- [Whiteboard](./feature-whiteboard.md)
- [Todos](./feature-todos.md)
- [Chat & Messaging](./feature-chat.md)
- [AI Writing Assistant](./feature-ai-writing.md)
- [Search](./feature-search.md)
- [Architecture Overview](./architecture.md)
- [API Reference](./api-reference.md)
