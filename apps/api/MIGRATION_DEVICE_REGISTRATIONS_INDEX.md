# Device Registrations Index Migration

## Problem

The `device_registrations` collection has a unique index that doesn't include the `production` field, causing duplicate key errors when the same user tries to register for both development and production APNs environments.

## Solution

Update the unique index to include the `production` field: `(userId, serverUrl, production)`

## Migration Steps

### Option 1: MongoDB Shell

```javascript
// Connect to your MongoDB instance
use justmaple

// Drop the old unique index (if it exists)
db.device_registrations.dropIndex("userId_1_serverUrl_1")

// Create new compound unique index with production field
db.device_registrations.createIndex(
  { userId: 1, serverUrl: 1, production: 1 },
  { unique: true, name: "userId_serverUrl_production_unique" }
)

// Verify the indexes
db.device_registrations.getIndexes()
```

### Option 2: MongoDB Compass

1. Connect to your database
2. Navigate to `justmaple` database → `device_registrations` collection
3. Click on the "Indexes" tab
4. Delete any existing unique index on `userId` and `serverUrl`
5. Click "Create Index"
6. Add fields:
    - `userId: 1`
    - `serverUrl: 1`
    - `production: 1`
7. Check "Create unique index"
8. Name: `userId_serverUrl_production_unique`
9. Click "Create Index"

### Option 3: Programmatic Migration (Add to API startup)

Add this to `apps/api/src/db/migrations.ts`:

```typescript
import { getDb } from './client';

export async function migrateDeviceRegistrationsIndex() {
    const db = getDb();
    const collection = db.collection('device_registrations');

    try {
        // Drop old index if it exists
        await collection.dropIndex('userId_1_serverUrl_1').catch(() => {
            console.log('[Migration] Old index does not exist, skipping drop');
        });

        // Create new compound unique index
        await collection.createIndex(
            { userId: 1, serverUrl: 1, production: 1 },
            { unique: true, name: 'userId_serverUrl_production_unique' },
        );

        console.log('[Migration] ✅ Device registrations index updated successfully');
    } catch (error) {
        console.error('[Migration] ❌ Failed to update device registrations index:', error);
        throw error;
    }
}
```

Then call it in `apps/api/src/index.ts`:

```typescript
import { migrateDeviceRegistrationsIndex } from './db/migrations';

// After connectToDatabase()
await migrateDeviceRegistrations Index();
```

## Why This Index?

The compound unique index on `(userId, serverUrl, production)` allows:

✅ Same user to register multiple devices on the same server
✅ Same user to register on multiple servers
✅ Same user to register for both production AND development APNs (different `production` values)
✅ Multiple users on the same server

❌ Prevents duplicate registration of the same user on the same server with the same production flag

## Testing

After migration, test:

1. Register device in development mode → ✅ Should work
2. Register same device in production mode → ✅ Should create new record
3. Re-register same device in development mode → ✅ Should update existing record
4. Different user on same server → ✅ Should create new record

## Rollback

If needed, restore the old index:

```javascript
db.device_registrations.dropIndex('userId_serverUrl_production_unique');
db.device_registrations.createIndex({ userId: 1, serverUrl: 1 }, { unique: true });
```
