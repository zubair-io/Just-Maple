# Y.js Collaboration Protocol Issue

## Status: Temporarily Disabled

Real-time collaborative editing with Y.js has been temporarily disabled due to protocol compatibility issues.

## Problem Description

When implementing Y.js collaboration with a custom WebSocket server (Elysia), the frontend y-websocket client encounters decoding errors:

```
ERROR Error: Unexpected end of array
    at create3 (lib0/decoding)
```

These errors occur when the client attempts to decode update messages broadcast from the server.

## Root Cause

The issue stems from a subtle incompatibility between:

1. Our manual WebSocket server implementation (`apps/api/src/ws/collaboration.ws.ts`)
2. The y-websocket client's expectations for message format (`y-websocket@3.0.0`)

Even though we're using the correct y-protocols encoding functions (`syncProtocol.writeUpdate()`), the messages are not being decoded successfully by the client. Possible causes:

- Version mismatches between frontend bundled lib0/y-protocols and backend versions
- Subtle protocol differences in how y-websocket wraps/unwraps messages
- Missing initialization handshakes or message sequences

## What Was Tried

1. **Version Alignment**: Installed matching versions of lib0 (0.2.102) and y-protocols (1.0.5) on the backend to match y-websocket's dependencies
2. **Binary Protocol**: Verified correct encoding with test scripts - messages encode/decode correctly in isolation
3. **WebSocket Origin Tracking**: Added proper origin tracking to prevent message echo
4. **Message Buffering**: Implemented buffering during async WebSocket initialization

None of these resolved the "Unexpected end of array" errors.

## Current Workaround

Collaboration is disabled and the app falls back to the legacy content field:

- Notes are saved/loaded using ProseMirror JSON in the `content` field
- No real-time sync between users
- Note switching works correctly
- All e2e tests pass (except the WebSocket collaboration test, which is skipped)

## Files Modified

### Disabled Collaboration

- `apps/web/src/app/components/organisms/note-editor/note-editor.component.ts`
    - Line 197-202: Commented out `initializeCollaboration()` call
    - Line 332-333: Removed collaboration content update guard

### Test Updates

- `e2e/collaboration-test.spec.ts`
    - Fixed note switching to use correct URL format (`tagId/noteId`)
    - Skipped WebSocket collaboration test with explanation

## Solution Path Forward

To properly implement Y.js collaboration, consider these approaches:

### Option 1: Use y-websocket Server (Recommended)

Instead of manually implementing the WebSocket server, use the official y-websocket server utilities:

- Install `y-websocket/bin/utils` server implementation
- This ensures 100% protocol compatibility
- May require running a separate Node.js service for collaboration

### Option 2: Debug Protocol Compatibility

- Add detailed binary message logging on both client and server
- Compare message byte-by-byte with working y-websocket server implementation
- Identify exact point where encoding diverges
- Fix encoding to match expected format

### Option 3: Alternative Collaboration Backend

- Consider using a hosted Y.js collaboration service (e.g., Liveblocks, Yjs Cloud)
- Removes need to maintain custom WebSocket server
- Trade-off: External dependency and potential cost

## Testing

To re-enable and test collaboration:

1. **Uncomment initialization** in `note-editor.component.ts` (line 200-202)
2. **Remove content update guard** comment (line 332-333)
3. **Un-skip WebSocket test** in `collaboration-test.spec.ts` (line 216)
4. **Start dev servers**: `bun run dev:e2e`
5. **Run tests**: `npx playwright test --config=playwright.manual.config.ts e2e/collaboration-test.spec.ts`
6. **Check browser console** for "Unexpected end of array" errors

## Related Files

### Backend

- `apps/api/src/ws/collaboration.ws.ts` - WebSocket collaboration endpoint
- `apps/api/src/services/yjs.service.ts` - Y.Doc management and broadcasting

### Frontend

- `apps/web/src/app/components/organisms/note-editor/note-editor.component.ts` - Editor with Y.js
- Package: `y-websocket@3.0.0` (client), `yjs@13.6.28`

### Backend Dependencies

- `y-protocols@1.0.5` - Sync protocol encoding
- `lib0@0.2.102` - Binary encoding/decoding
- `yjs@13.6.28` - CRDT document

## References

- [Y.js Documentation](https://docs.yjs.dev/)
- [y-websocket GitHub](https://github.com/yjs/y-websocket)
- [y-protocols](https://github.com/yjs/y-protocols)
- [Our implementation plan](/Users/riabuz/.claude/plans/purrfect-puzzling-pretzel.md)

## Date

2025-12-30

## Contributors

- Claude Sonnet 4.5 (implementation and debugging)
