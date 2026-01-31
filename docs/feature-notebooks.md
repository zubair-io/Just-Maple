# Notebooks & Organization

Notebooks are the primary way to organize your content in Just Maple. Think of them as smart folders that can contain different types of pages and enable collaboration.

## What is a Notebook?

A notebook is a container that holds:

- **Memos** - Rich text documents
- **Whiteboards** - Drawing canvases
- **Messages** - Chat conversations (one per notebook)
- **Recordings** - Audio content
- **Collectibles** - Item tracking

Each notebook has its own set of collaborators, permissions, and optional bot integrations.

## Creating Notebooks

### From the Sidebar

1. Click the **+** button in the sidebar
2. Enter a name for your notebook
3. Choose a notebook type (optional):
    - **Mixed** (default) - All content types
    - **Notes** - Primarily memos and documents
    - **Recordings** - Audio-focused workspace

### Notebook Types

| Type       | Best For                          | Icon       |
| ---------- | --------------------------------- | ---------- |
| Mixed      | General use, project workspaces   | Folder     |
| Notes      | Writing, documentation, journals  | Document   |
| Recordings | Podcasts, interviews, voice notes | Microphone |

## Organizing Content

### Pages

Each item in a notebook is called a **page**. Pages have:

- **Title** - Displayed in the sidebar and search
- **Type** - Memo, whiteboard, message, or recording
- **Tags** - Hashtags extracted from content (`#project`, `#meeting`)
- **Metadata** - Created date, last modified, author

### Favorites

Star important pages for quick access:

1. Open any page
2. Click the star icon in the header
3. Favorites appear in a dedicated section

### Archiving

Archive pages you don't need right now but want to keep:

1. Open the page menu (three dots)
2. Select "Archive"
3. Archived pages move to the Archive section

### Trash

Deleted pages go to trash first:

1. Delete a page from the menu
2. Pages stay in trash for 30 days
3. Restore or permanently delete from trash

## Sharing & Collaboration

### Sharing a Notebook

1. Open notebook settings (gear icon)
2. Click "Share"
3. Enter email addresses of collaborators
4. Choose their permission level

### Permission Levels

| Role   | Can View | Can Edit | Can Manage Members | Can Delete |
| ------ | -------- | -------- | ------------------ | ---------- |
| Member | Yes      | Yes      | No                 | No         |
| Admin  | Yes      | Yes      | Yes                | No         |
| Owner  | Yes      | Yes      | Yes                | Yes        |

### Real-time Collaboration

When multiple people edit the same page:

- See others' cursors in real-time
- Changes merge automatically (no conflicts!)
- Chat in the notebook for coordination

## Bot Integration

### Adding Bots to Notebooks

1. Go to notebook settings
2. Click "Bots"
3. Select bots to enable
4. Bots can now be mentioned in chat or documents

### Using Bots

Mention a bot with `@botname` in chat or documents to trigger it. See [Bot Integrations](./feature-bots.md) for details.

## Tips & Best Practices

### Organization Strategies

- **By Project** - One notebook per project or initiative
- **By Time** - Monthly/quarterly notebooks for journals
- **By Team** - Shared team workspaces with personal notebooks for drafts

### Naming Conventions

- Use clear, descriptive names
- Include dates for recurring notebooks (Q1 2026 Planning)
- Use emoji prefixes for visual organization

## Related Documentation

- [Memo Editor](./feature-memo-editor.md) - Creating rich documents
- [Chat & Messaging](./feature-chat.md) - Notebook communication
- [Sharing & Collaboration](./feature-sharing.md) - Advanced sharing options
- [Engineering: Notebooks](./eng-notebooks.md) - Technical implementation
