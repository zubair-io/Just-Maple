# Offline Support & Sync

Just Maple is built offline-first. Work without internet, and changes sync automatically when you're back online.

## How It Works

### Offline-First Architecture

Your data is always available:

1. **Local storage** - Content saved in IndexedDB
2. **Optimistic updates** - Changes apply immediately
3. **Background sync** - Queue processes when online
4. **Conflict resolution** - CRDT-based merging

### What Works Offline

- Read all synced content
- Create and edit memos
- Draw on whiteboards
- View recordings (if downloaded)
- Manage todos
- Search local content

### What Needs Internet

- Initial sync
- Sending messages (queued)
- AI features
- Recording uploads
- Fresh content from collaborators

## Sync Status

### Status Indicator

Look for the sync icon in the status bar:

| Icon      | Status   | Meaning                     |
| --------- | -------- | --------------------------- |
| Checkmark | Synced   | All changes saved to server |
| Arrows    | Syncing  | Sync in progress            |
| Clock     | Pending  | Changes queued              |
| Warning   | Conflict | Needs attention             |
| X         | Failed   | Sync error                  |

### Understanding States

#### Synced

All changes are saved:

- Local and server match
- Safe to close app
- Others will see your changes

#### Syncing

Active synchronization:

- Changes being uploaded
- May take a moment
- Don't close mid-sync if possible

#### Pending

Changes waiting to sync:

- Usually means offline
- Will sync when online
- Safe - changes are saved locally

#### Conflict

Merge conflict detected:

- Rare with CRDT, but possible
- Review conflicting versions
- Choose or merge manually

#### Failed

Sync encountered an error:

- Check internet connection
- Retry sync manually
- Contact support if persistent

## Offline Queue

### How Queuing Works

When offline:

1. You make a change
2. Change saves locally
3. Change adds to offline queue
4. Queue icon shows pending count

### Automatic Retry

When back online:

- Queue processes automatically
- Oldest changes first
- Exponential backoff on errors
- Notifications on completion

### Manual Retry

Force retry if stuck:

1. Open sync status panel
2. Click "Retry sync"
3. Watch for errors

## Conflict Resolution

### CRDT Magic

Automerge/Yjs handles most conflicts:

- Character-level merging
- Last-write-wins for simple values
- Automatic reconciliation

### When Conflicts Occur

True conflicts are rare, but happen when:

- Same exact position edited offline
- Structural changes overlap
- Version mismatch detected

### Resolving Conflicts

1. Notification alerts you
2. Open the conflict panel
3. See both versions
4. Choose one, merge, or edit
5. Confirm resolution

## Data Storage

### IndexedDB

Primary local storage:

- Full document content
- Metadata and indexes
- Works in all browsers
- Persists across sessions

### Storage Limits

Browser storage limits apply:

- Typically several GB
- Varies by browser
- Old content may be evicted
- Critical content prioritized

### Managing Storage

If storage is full:

- Clear old/archived content
- Remove cached attachments
- Check browser settings

## Background Sync

### Service Worker

Background sync continues even when:

- Tab is not active
- Browser is minimized
- System is waking from sleep

### Sync Triggers

Sync happens:

- On any content change
- Periodically (every few minutes)
- When coming back online
- Manually when requested

## Best Practices

### Working Offline

- Sync before going offline if possible
- Work normally - changes are safe
- Don't worry about connectivity

### Rejoining Network

- Sync happens automatically
- Watch status indicator
- Review any conflicts

### For Collaboration

- Communicate about concurrent edits
- Sync frequently if possible
- Minor overlaps merge cleanly

## Platform-Specific

### Web

- Full offline support via service worker
- IndexedDB for storage
- Background sync when available

### iOS/macOS

- Native offline support
- Core Data + IndexedDB hybrid
- Better storage management
- Push sync on reconnection

### reMarkable

- Fully offline-capable
- Sled database for storage
- Sync when USB/WiFi connected

## Troubleshooting

### Sync Stuck

1. Check internet connection
2. Try manual retry
3. Clear and re-sync if needed
4. Check for errors in console

### Data Not Appearing

1. Check sync status
2. Pull to refresh
3. Verify network connection
4. Wait for sync to complete

### Storage Issues

1. Check available space
2. Clear cached content
3. Remove old notebooks
4. Check browser storage settings

## Related Documentation

- [Architecture](./architecture.md) - Sync technical details
- [Memo Editor](./feature-memo-editor.md) - Offline editing
- [Engineering: Sync](./eng-sync.md) - Technical implementation
