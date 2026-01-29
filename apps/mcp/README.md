# Just Maple MCP Server

Model Context Protocol (MCP) server for interacting with Just Maple notebooks, pages, memos, and whiteboards.

This package provides two server modes:

1. **Local (stdio)** - For Claude Desktop and local MCP clients
2. **Remote (HTTP)** - For Claude.ai custom connectors and public access

## Installation

```bash
# From the monorepo root
bun install

# Build the MCP server
cd apps/mcp
bun run build        # Local server
bun run build:remote # Remote server
```

## Local Server (stdio)

For use with Claude Desktop and other local MCP clients.

### Configuration

| Variable                   | Description                | Default                                   |
| -------------------------- | -------------------------- | ----------------------------------------- |
| `MONGODB_URI`              | MongoDB connection string  | `mongodb://192.168.0.244:27017/justmaple` |
| `MCP_USER_ID` or `USER_ID` | User ID for authentication | Required                                  |

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

## Remote Server (HTTP with OAuth)

For use with Claude.ai custom connectors and other remote MCP clients.

### Configuration

| Variable         | Description                     | Default                                   |
| ---------------- | ------------------------------- | ----------------------------------------- |
| `MONGODB_URI`    | MongoDB connection string       | `mongodb://192.168.0.244:27017/justmaple` |
| `MCP_PORT`       | HTTP server port                | `7072`                                    |
| `MCP_PUBLIC_URL` | Public URL of the server        | `http://localhost:7072`                   |
| `JWT_SECRET`     | JWT secret for token validation | `dev-secret-change-in-production`         |
| `OAUTH_ISSUER`   | OAuth issuer URL                | `https://justmaple.app`                   |

### Running the Remote Server

```bash
# Development
bun run dev:remote

# Production
MCP_PORT=7072 MCP_PUBLIC_URL=https://mcp.justmaple.app bun run start:remote
```

### Endpoints

| Endpoint                                  | Method | Description                         |
| ----------------------------------------- | ------ | ----------------------------------- |
| `/mcp`                                    | POST   | Send MCP messages (JSON-RPC)        |
| `/mcp`                                    | GET    | Open SSE stream for server messages |
| `/mcp`                                    | DELETE | Terminate session                   |
| `/.well-known/oauth-protected-resource`   | GET    | OAuth Protected Resource Metadata   |
| `/.well-known/oauth-authorization-server` | GET    | OAuth Authorization Server Metadata |
| `/health`                                 | GET    | Health check                        |

### Authentication

The remote server uses JWT Bearer tokens for authentication. Clients must:

1. Obtain a JWT token from the OAuth authorization server
2. Include it in the `Authorization: Bearer <token>` header
3. The token's `sub` claim is used as the user ID

### Session Management

Sessions are managed via the `Mcp-Session-Id` header:

- Server returns session ID in `Mcp-Session-Id` header after `initialize`
- Client must include this header in subsequent requests
- Sessions expire after 24 hours of inactivity

### Using with Claude.ai

1. Deploy the remote server publicly (e.g., `https://mcp.justmaple.app`)
2. In Claude.ai, go to Settings > Integrations > Add Custom Connector
3. Enter your MCP server URL: `https://mcp.justmaple.app/mcp`
4. Configure OAuth settings to match your authorization server

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
