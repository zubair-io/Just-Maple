# Just Maple MCP Server

Model Context Protocol (MCP) server for interacting with Just Maple notebooks, pages, memos, and whiteboards.

## Installation

```bash
# From the monorepo root
bun install

# Build the MCP server
cd apps/mcp
bun run build
```

## Configuration

Set the following environment variables:

| Variable                   | Description                | Default                                   |
| -------------------------- | -------------------------- | ----------------------------------------- |
| `MONGODB_URI`              | MongoDB connection string  | `mongodb://192.168.0.244:27017/justmaple` |
| `MCP_USER_ID` or `USER_ID` | User ID for authentication | Required                                  |

## Usage

### With Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
    "mcpServers": {
        "maple": {
            "command": "bun",
            "args": ["run", "/path/to/Just-Maple/apps/mcp/src/index.ts"],
            "env": {
                "MONGODB_URI": "mongodb://localhost:27017/justmaple",
                "MCP_USER_ID": "your-user-id"
            }
        }
    }
}
```

### Running Directly

```bash
MCP_USER_ID=your-user-id bun run start
```

## Tools

### Notebook Tools

- **list_notebooks** - List all notebooks the user has access to
- **get_notebook** - Get details of a specific notebook by ID

### Page Tools

- **list_pages** - List pages, optionally filtered by notebook or type
- **get_page** - Get details of a specific page by ID
- **search_pages** - Search pages by title or content
- **create_page** - Create a new page (memo or whiteboard)
- **update_page** - Update page metadata (title, notebook, favorite, archive, trash)

### Memo Tools

- **get_memo_content** - Get the text content of a memo page
- **update_memo_content** - Update the text content of a memo page

### Whiteboard Tools

- **get_whiteboard** - Get the state of a whiteboard page including its elements
- **update_whiteboard** - Update the elements of a whiteboard page

## Resources

The server also exposes notebooks as MCP resources with the URI format:

```
maple://notebook/{notebookId}
```

Reading a notebook resource returns the notebook details along with all its pages.

## Development

```bash
# Run in development mode (watch)
bun run dev

# Type check
bun run typecheck

# Build for production
bun run build
```
