# Migration Scripts

This directory contains one-time migration scripts for database updates.

## Available Migrations

### Gravatar Profile Migration

**File:** `migrate-gravatar-profiles.ts`

**Purpose:** Fetch Gravatar profile data (display name and profile picture) for all existing users who don't have a profile picture.

**When to run:** Once after deploying the Gravatar integration feature to update existing users.

**What it does:**

1. Finds all users without a `profilePictureUrl`
2. Fetches Gravatar profile data for each user
3. Updates users with:
    - Display name (only if user doesn't have one already)
    - Profile picture URL (from Gravatar or generated Gravatar URL)

**How to run:**

```bash
cd apps/api

# Run the migration
bun run migrate:gravatar
```

**Environment Variables:**

- `MONGODB_URI` - MongoDB connection string (default: `mongodb://192.168.0.244:27017/justmaple`)
- `GRAVATAR_KEY` - Optional Gravatar API key for enhanced access

**Output:**
The script will show:

- Number of users found without profile pictures
- Progress for each user being processed
- Summary of successful updates, skipped users, and errors

**Safety:**

- Only updates users without existing profile pictures
- Only updates display name if the user doesn't have one
- Includes a small delay between requests to avoid rate limiting
- Can be run multiple times safely (idempotent)

**Example output:**

```
🔍 Starting Gravatar profile migration...

✅ Connected to MongoDB

📊 Found 42 users without profile pictures

Processing: user1@example.com
  ✓ Display name: John Doe
  ✓ Profile picture: https://www.gravatar.com/avatar/...
  ✅ Updated

Processing: user2@example.com
  ✓ Profile picture: https://www.gravatar.com/avatar/...
  ✅ Updated

...

📊 Migration Summary:
   Total users processed: 42
   ✅ Successfully updated: 40
   ⏭️  Skipped: 0
   ❌ Errors: 2

✨ Migration complete!

👋 Disconnected from MongoDB
```

## Other Migration Scripts

### Tag Note Type Migration

**File:** `migrate-tag-note-types.ts`

Updates tag structure to support different note types.

```bash
bun run scripts/migrate-tag-note-types.ts
```

### Tag Sharing Migration

**File:** `migrate-tags-sharing.ts`

Updates tag structure to support sharing functionality.

```bash
bun run scripts/migrate-tags-sharing.ts
```

### Paper Registry Link Fix

**File:** `fix-paper-registry-links.ts`

Fixes links in the paper registry.

```bash
bun run scripts/fix-paper-registry-links.ts
```

## Best Practices

1. **Always backup your database** before running migrations
2. **Test in development** environment first
3. **Review the code** to understand what will be changed
4. **Check the output** for any errors or unexpected results
5. **Monitor your application** after running migrations
6. **Run during low-traffic** periods if possible
