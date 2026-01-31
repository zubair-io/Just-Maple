# Sharing & Collaboration

Just Maple makes it easy to share notebooks and collaborate in real-time. Control who can access your content with flexible permissions.

## Sharing Notebooks

### How to Share

1. Open the notebook you want to share
2. Click the settings/gear icon
3. Select "Share"
4. Enter email addresses
5. Set permission levels
6. Send invitations

### Share Dialog

The share dialog shows:

- Current members and their roles
- Pending invitations
- Quick add for new members
- Permission level selector

## Permission Levels

### Roles Explained

| Role       | View | Edit | Manage | Delete |
| ---------- | ---- | ---- | ------ | ------ |
| **Reader** | Yes  | No   | No     | No     |
| **Member** | Yes  | Yes  | No     | No     |
| **Admin**  | Yes  | Yes  | Yes    | No     |
| **Owner**  | Yes  | Yes  | Yes    | Yes    |

### Role Details

#### Reader

- View all content
- No editing capabilities
- Good for stakeholders

#### Member

- View and edit content
- Create new pages
- Cannot manage members

#### Admin

- All member capabilities
- Add/remove members
- Change permissions
- Cannot delete notebook

#### Owner

- Full control
- Delete notebook
- Transfer ownership
- Only one owner per notebook

## Managing Members

### Adding Members

1. Open share dialog
2. Enter email address
3. Select permission level
4. Click "Invite"

### Changing Permissions

1. Open share dialog
2. Find the member
3. Click their current role
4. Select new role

### Removing Members

1. Open share dialog
2. Find the member
3. Click "Remove"
4. Confirm removal

### Transferring Ownership

1. Make sure new owner is an admin
2. Open share dialog
3. Click "Transfer ownership"
4. Confirm transfer

## Real-time Collaboration

### Presence Awareness

See who's currently viewing:

- Avatars in the header
- Active collaborators highlighted
- "Typing" indicators in chat

### Cursor Tracking

In documents and whiteboards:

- See collaborators' cursors
- Cursors are color-coded
- Names appear on hover

### Live Updates

Changes appear instantly:

- Text edits stream in
- Drawing strokes show live
- Messages arrive immediately
- No refresh needed

## Collaboration Features

### Simultaneous Editing

Multiple people can edit at once:

- No locks or conflicts
- Changes merge automatically
- CRDT ensures consistency

### Comments (Coming Soon)

Discuss specific content:

- Highlight text to comment
- Thread discussions
- Resolve when done

### @Mentions

Get someone's attention:

```
@sarah Please review this section
```

- Triggers notification
- Links to their profile

## Sharing Links

### Link Sharing

Create shareable links:

1. Open share dialog
2. Click "Copy link"
3. Share the URL
4. Recipients need to sign in

### Link Settings

Configure link behavior:

- Require authentication
- Set expiration
- Limit to specific domains

## Notifications

### Collaboration Notifications

Stay informed about:

- New content from collaborators
- @mentions
- Comments on your content
- Permission changes

### Notification Settings

Customize per notebook:

1. Open notebook settings
2. Go to "Notifications"
3. Choose what to be notified about

## Best Practices

### Team Collaboration

- Use descriptive notebook names
- Assign clear roles
- Establish editing conventions
- Use chat for coordination

### Sharing with External Users

- Prefer Reader role for external stakeholders
- Review access regularly
- Remove access when no longer needed

### Large Teams

- Use Admin role sparingly
- Create multiple notebooks if needed
- Consider permission groups

## Security Considerations

### Access Control

- All access requires authentication
- Permissions enforced server-side
- Audit trail of changes

### Removing Access

When removing a member:

- They lose access immediately
- Local cached content eventually expires
- Cannot recover without re-invitation

### Sensitive Content

For sensitive notebooks:

- Limit to essential members
- Use Reader role when possible
- Review access regularly

## Related Documentation

- [Notebooks](./feature-notebooks.md) - Notebook basics
- [Chat & Messaging](./feature-chat.md) - Team communication
- [Offline Support](./feature-offline.md) - Sync and collaboration
- [Engineering: Realtime](./eng-realtime.md) - Technical implementation
