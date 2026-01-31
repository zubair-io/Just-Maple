# Search

Just Maple provides powerful full-text search across all your content. Find pages, messages, recordings, and more instantly.

## Quick Search

### Opening Search

- Press `Cmd/Ctrl + K` anywhere in the app
- Or click the search icon in the sidebar
- The search modal opens immediately

### Basic Search

1. Type your query
2. Results appear as you type
3. Click a result to open it
4. Press Escape to close

## Search Features

### Full-Text Search

Search finds content in:

- Page titles
- Document text (memos)
- Chat messages
- Recording transcripts
- Hashtags

### Instant Results

- Results update as you type
- ~200ms latency
- Highlighted keywords in snippets

### Smart Ranking

Results are ordered by:

- Relevance to query
- Recency of modification
- Frequency of access

## Filters

### Filter by Type

Narrow results to specific content:
| Filter | Shows |
|--------|-------|
| All | Everything |
| Memos | Rich text documents |
| Whiteboards | Drawing canvases |
| Messages | Chat content |
| Recordings | Audio with transcripts |

### Filter by Notebook

- Select specific notebooks
- Or search across all
- Useful for project-specific searches

### Filter by Tags

Search using hashtags:

```
#meeting
#project-alpha
#todo
```

### Date Range

- Created after date
- Modified after date
- Useful for finding recent content

## Advanced Search

### Search Operators

| Operator     | Example            | Finds                 |
| ------------ | ------------------ | --------------------- |
| Exact phrase | `"project update"` | Exact phrase match    |
| Tag          | `#meeting`         | Tagged content        |
| Type         | `type:memo`        | Specific content type |
| In notebook  | `in:Work`          | Content in notebook   |

### Combining Filters

Combine multiple filters:

```
#meeting type:memo in:Work
```

Finds memos tagged with #meeting in the Work notebook.

## Search Results

### Result Display

Each result shows:

- **Title** - Page or document name
- **Snippet** - Text excerpt with highlights
- **Location** - Notebook name
- **Type icon** - Visual type indicator
- **Date** - Last modified

### Opening Results

- Click to open in current view
- `Cmd/Ctrl + Click` to open in new tab
- Arrow keys to navigate, Enter to select

## Hashtags

### How Hashtags Work

Type `#` followed by a tag in any document:

```
Meeting about #project-alpha and #budget
```

Tags are:

- Automatically extracted from content
- Indexed for fast searching
- Visible in page metadata

### Browsing by Tag

Click any tag to see all content with that tag.

### Tag Suggestions

When typing `#`, see suggestions based on:

- Previously used tags
- Popular tags in your notebooks

## Reindexing

### When to Reindex

Trigger a reindex if:

- Search results seem incomplete
- After bulk imports
- Content changes not appearing

### How to Reindex

1. Open Settings
2. Go to Search section
3. Click "Reindex all content"
4. Wait for completion

### Automatic Indexing

Normally, content is indexed automatically:

- When created or modified
- When tags change
- In real-time during sync

## Keyboard Shortcuts

| Action           | Shortcut            |
| ---------------- | ------------------- |
| Open search      | `Cmd/Ctrl + K`      |
| Close search     | `Escape`            |
| Navigate results | `↑` / `↓` arrows    |
| Open result      | `Enter`             |
| Open in new tab  | `Cmd/Ctrl + Enter`  |
| Clear search     | `Cmd/Ctrl + Delete` |

## Tips & Best Practices

### Effective Searching

- Use specific keywords
- Start with filters if you know the type
- Try different phrasings

### Tag Strategy

- Use consistent tag naming
- Create a tag taxonomy for your team
- Review and consolidate tags periodically

### Organizing for Search

- Use descriptive titles
- Add relevant hashtags
- Keep content well-structured

## Related Documentation

- [Memo Editor](./feature-memo-editor.md) - Searchable documents
- [Bi-directional Links](./feature-links.md) - Finding linked content
- [Chat & Messaging](./feature-chat.md) - Searching messages
- [Engineering: Search](./eng-search.md) - Technical implementation
