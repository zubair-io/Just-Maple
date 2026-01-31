# Connection Graph

Visualize how your pages are connected through links and shared hashtags. The Connection Graph provides an interactive force-directed visualization that helps you discover relationships in your knowledge base.

## Viewing the Graph

### Notebook Summary

The connection graph appears in the notebook summary view:

1. Navigate to a notebook
2. View the summary section
3. The graph displays all pages and their connections

### Graph Elements

| Element          | Description                                  |
| ---------------- | -------------------------------------------- |
| **Nodes**        | Pages in your notebook                       |
| **Solid lines**  | Direct page links (`[[Page Name]]`)          |
| **Dashed lines** | Shared hashtag connections                   |
| **Node size**    | Larger nodes have more connections           |
| **Node color**   | Indicates page type (memo, whiteboard, etc.) |

## Interaction

### Navigation

- **Zoom**: Scroll to zoom in/out
- **Pan**: Click and drag the background
- **Drag nodes**: Click and drag nodes to reposition
- **Click node**: Navigate directly to that page

### Visual Cues

Node colors indicate page types:

| Page Type   | Color  |
| ----------- | ------ |
| Memo        | Red    |
| Whiteboard  | Green  |
| Message     | Blue   |
| Kanban      | Amber  |
| Collectable | Purple |
| Recording   | Red    |

## Connection Types

### Page Links

Direct connections created using wiki-style links:

```
See [[Project Planning]] for details.
```

These appear as **solid lines** in the graph.

### Hashtag Connections

Pages that share the same hashtag are automatically connected:

```
Page 1: #project #planning
Page 2: #project #budget
```

Both pages are connected via the shared `#project` tag. These appear as **dashed lines** with the hashtag label.

## Legend

The graph includes a legend showing:

- **Pages**: Total number of pages in the graph
- **Links**: Number of direct page link connections
- **Tag connections**: Number of hashtag-based connections

## Tips

### Building Your Graph

1. **Use consistent hashtags** - Pages with shared tags connect automatically
2. **Link related pages** - Use `[[Page Name]]` to create explicit connections
3. **Name pages clearly** - Page titles appear as node labels

### Understanding Clusters

- **Densely connected areas** indicate related topics
- **Isolated nodes** might need more connections
- **Hub pages** (large nodes) are central to your knowledge base

### Finding Orphan Pages

Pages with no connections appear as isolated nodes. Consider:

- Adding relevant hashtags
- Linking from other pages
- Reviewing if the page belongs in this notebook

## Graph Statistics

The summary shows key metrics:

- Total pages in the notebook
- Number of link-based connections
- Number of hashtag-based connections

Use these to track how interconnected your knowledge base is growing.

## Related Features

- [[Bi-directional Linking]] - Create page links
- [[Search]] - Find pages by hashtag
- [[Backlinks Panel]] - View connections for a single page
