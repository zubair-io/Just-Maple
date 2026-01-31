# Memo Editor

The memo editor is Just Maple's rich text editing experience, powered by TipTap and ProseMirror. It supports formatting, media, tables, code, and collaborative editing.

## Getting Started

### Creating a Memo

1. Open a notebook from the sidebar
2. Click the **+** button or press `Cmd/Ctrl + N`
3. Start typing - the title is auto-detected from the first line

### Editor Interface

- **Toolbar** - Formatting options above the editor
- **Content area** - Where you write
- **Sidebar** - Page navigation and metadata
- **Status bar** - Sync status and word count

## Text Formatting

### Basic Formatting

| Format            | Shortcut               | Markdown     |
| ----------------- | ---------------------- | ------------ |
| **Bold**          | `Cmd/Ctrl + B`         | `**text**`   |
| _Italic_          | `Cmd/Ctrl + I`         | `*text*`     |
| ~~Strikethrough~~ | `Cmd/Ctrl + Shift + S` | `~~text~~`   |
| `Code`            | `Cmd/Ctrl + E`         | `` `code` `` |
| Underline         | `Cmd/Ctrl + U`         | -            |

### Headings

Type `#`, `##`, or `###` followed by a space, or use the toolbar:

- **Heading 1** - Main sections
- **Heading 2** - Subsections
- **Heading 3** - Details

### Lists

- **Bullet list** - Type `-` or `*` followed by a space
- **Numbered list** - Type `1.` followed by a space
- **Task list** - Type `[]` or `[ ]` for a checkbox (see [Todos](./feature-todos.md))

## Block Elements

### Blockquotes

Type `>` followed by a space for quoted text:

> This is a blockquote for highlighting important information.

### Code Blocks

Type ` ``` ` on a new line for code:

```javascript
function hello() {
    console.log('Hello, Maple!');
}
```

Syntax highlighting is automatic based on the language.

### Callouts

Add attention-grabbing boxes for notes, warnings, or tips:

1. Type `/callout` and press Enter
2. Choose a type: Info, Warning, Success, Error
3. Add your content

### Tables

1. Click the table icon in the toolbar
2. Choose dimensions (rows x columns)
3. Tab to move between cells
4. Right-click for row/column options

### Horizontal Rule

Type `---` or `***` on a new line for a divider.

## Media & Embeds

### Images

- **Drag & drop** - Drop images directly into the editor
- **Paste** - Paste images from clipboard
- **Upload** - Click the image icon in the toolbar

Images are uploaded to your server's storage and served with optimized sizes.

### Embeds

Paste URLs on their own line to embed:

- YouTube videos
- Twitter/X posts
- GitHub gists
- Other supported platforms

## Linking

### Internal Links (Wiki-style)

Type `[[` to search for and link to other pages:

```
See [[Project Planning]] for more details.
```

Links are bi-directional - you can see what links to the current page in the backlinks panel.

### Hashtags

Type `#` followed by a tag to categorize content:

```
This is about #project-alpha and #meetings
```

Tags are indexed and searchable across all your notebooks.

### External Links

Select text and press `Cmd/Ctrl + K` to add a URL, or paste a URL on selected text.

## Collaboration

### Real-time Editing

Multiple users can edit the same memo simultaneously:

- See colored cursors for each collaborator
- Changes merge automatically using CRDT technology
- No save conflicts, ever

### Comments (Coming Soon)

Highlight text and add comments for discussion without modifying the content.

## Keyboard Shortcuts

| Action        | macOS             | Windows/Linux      |
| ------------- | ----------------- | ------------------ |
| Bold          | `Cmd + B`         | `Ctrl + B`         |
| Italic        | `Cmd + I`         | `Ctrl + I`         |
| Underline     | `Cmd + U`         | `Ctrl + U`         |
| Link          | `Cmd + K`         | `Ctrl + K`         |
| Undo          | `Cmd + Z`         | `Ctrl + Z`         |
| Redo          | `Cmd + Shift + Z` | `Ctrl + Shift + Z` |
| Find          | `Cmd + F`         | `Ctrl + F`         |
| Heading 1     | `Cmd + Alt + 1`   | `Ctrl + Alt + 1`   |
| Heading 2     | `Cmd + Alt + 2`   | `Ctrl + Alt + 2`   |
| Bullet list   | `Cmd + Shift + 8` | `Ctrl + Shift + 8` |
| Numbered list | `Cmd + Shift + 7` | `Ctrl + Shift + 7` |

## Offline Support

The editor works fully offline:

1. Make changes while disconnected
2. Changes are saved locally to IndexedDB
3. When back online, changes sync automatically
4. See sync status in the status bar

## Tips & Tricks

### Quick Formatting

- Use Markdown syntax for faster formatting
- Double-click a word to select it
- Triple-click to select a paragraph

### Focus Mode

Press `Cmd/Ctrl + \` to hide the sidebar and focus on writing.

### Templates

Use templates for recurring document types. See [Templates](./feature-templates.md).

### AI Assistance

Select text and use AI to improve, expand, or simplify. See [AI Writing](./feature-ai-writing.md).

## Related Documentation

- [Todos](./feature-todos.md) - Enhanced task management
- [Bi-directional Links](./feature-links.md) - Building a knowledge graph
- [Templates](./feature-templates.md) - Document templates
- [AI Writing Assistant](./feature-ai-writing.md) - AI-powered writing help
- [Engineering: Memo Editor](./eng-memo-editor.md) - Technical implementation
