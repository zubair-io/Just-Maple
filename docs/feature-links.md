# Bi-directional Linking

Connect your ideas across notebooks with wiki-style links. Just Maple tracks both forward links (pages you link to) and backlinks (pages that link to you), building a knowledge graph of your content.

## Creating Links

### Wiki-Style Links

Type `[[` to create a link:

```
See [[Project Planning]] for the roadmap.
The [[Q1 Budget]] was approved last week.
```

As you type, matching pages appear in a dropdown.

### Link Syntax

| Syntax                        | Result                        |
| ----------------------------- | ----------------------------- |
| `[[Page Name]]`               | Link with page title as text  |
| `[[Page Name\|Display Text]]` | Link with custom display text |
| `[[notebook/Page Name]]`      | Cross-notebook link           |

### Creating New Pages

If the linked page doesn't exist:

1. Type the new page name: `[[New Concept]]`
2. Press Enter to confirm
3. The link is created (shows as "unlinked")
4. Click the link to create the page

## Viewing Links

### Forward Links

Pages you link TO from the current page:

- Visible in the content itself
- Also listed in the Links panel
- Click to navigate

### Backlinks

Pages that link TO the current page:

- Shown in the Backlinks panel
- Helps discover related content
- See context of each link

### Links Panel

Open the links panel to see:

1. **Outgoing links** - Pages this page links to
2. **Backlinks** - Pages linking here
3. **Unlinked mentions** - References without explicit links

## Unlinked Mentions

### What Are They?

Text that matches a page title but isn't linked:

```
This is about Project Alpha...
```

If you have a page called "Project Alpha", this shows as an unlinked mention.

### Converting to Links

1. View unlinked mentions in the Links panel
2. Click "Link" next to a mention
3. The text becomes an explicit `[[link]]`

## Knowledge Graph

### Visual Graph

See how your pages connect:

1. Open the Graph View
2. Pages shown as nodes
3. Links shown as edges
4. Interact to explore

### Graph Features

- **Zoom** - Scroll to zoom in/out
- **Pan** - Drag to move around
- **Focus** - Click a node to center
- **Expand** - See connections from any node

### Filtering

Filter the graph by:

- Notebook
- Page type
- Tags
- Date range

## Link Types

### Internal Links

Links to other pages in Just Maple:

```
[[Page Name]]
```

- Tracked for backlinks
- Updated if page is renamed

### External Links

Links to websites:

```
[Link text](https://example.com)
```

- Standard markdown syntax
- Opens in new tab

### Hashtags

Tags are another form of linking:

```
#project-alpha #meeting
```

- Creates implicit connections
- Searchable and filterable
- See all pages with same tag

## Link Behavior

### Following Links

- **Click** - Navigate to the linked page
- **Cmd/Ctrl + Click** - Open in new tab
- **Hover** - Preview the page content

### Renaming Pages

When you rename a linked page:

- Links automatically update
- Display text preserved
- No broken links

### Deleting Pages

When a linked page is deleted:

- Links become "orphaned"
- Indicated visually
- Can recreate the page via link

## Building a Knowledge Base

### Strategies

#### Zettelkasten

- Atomic notes (one idea per page)
- Heavy interlinking
- Emergent connections

#### Hierarchical

- Main topic pages
- Subtopic pages
- Up/down navigation

#### Hub and Spoke

- Central "hub" pages
- Link out to related content
- Easy navigation

### Best Practices

- Link liberally as you write
- Review unlinked mentions regularly
- Use consistent naming
- Create index/hub pages

## Keyboard Shortcuts

| Action          | Shortcut           |
| --------------- | ------------------ |
| Create link     | `[[` then type     |
| Open link       | Click              |
| Open in new tab | `Cmd/Ctrl + Click` |
| Show backlinks  | Panel toggle       |

## Tips & Tricks

### Link Aliases

Use aliases for flexibility:

```
The [[Project Alpha|project]] is on track.
```

Shows "project" but links to "Project Alpha".

### Cross-Notebook Links

Link to pages in other notebooks:

```
[[Work/Meeting Notes]]
```

### Broken Link Detection

Broken links appear with special styling:

- Strikethrough or dashed underline
- Click to create the missing page
- Review and clean up periodically

## Related Documentation

- [Memo Editor](./feature-memo-editor.md) - Where links live
- [Search](./feature-search.md) - Finding linked content
- [Engineering: Links](./eng-links.md) - Technical implementation
