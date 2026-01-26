/**
 * Migration script to move messages from notebook-attached to page-attached.
 *
 * This script:
 * 1. Finds all unique notebookIds that have messages
 * 2. For each notebook, creates a page with type 'message'
 * 3. Updates all messages to reference the new page via pageId
 *
 * Run with: bun run apps/api/src/scripts/migrate-messages-to-pages.ts
 */

import { MongoClient, ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from apps/api/.env
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');
await Bun.file(envPath)
    .text()
    .then((content) => {
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                if (key && !process.env[key]) {
                    process.env[key] = value;
                }
            }
        }
    })
    .catch(() => {
        console.warn(`Warning: Could not load .env from ${envPath}`);
    });

const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/maple';

interface NotebookDoc {
    _id: ObjectId;
    label: string;
    sharing: {
        sharedWith: Array<{
            userId: string;
            accessLevel: 'read' | 'write' | 'owner';
        }>;
    };
}

async function migrate() {
    console.log('Connecting to MongoDB...', mongodbUri);
    const client = new MongoClient(mongodbUri);
    await client.connect();

    const db = client.db();
    const messagesCollection = db.collection('messages');
    const pagesCollection = db.collection('pages');
    const notebooksCollection = db.collection<NotebookDoc>('notebooks');

    console.log('\n--- Messages to Pages Migration ---\n');

    // Step 1: Get counts before migration
    const totalMessagesBefore = await messagesCollection.countDocuments();
    const messagesWithPageIdBefore = await messagesCollection.countDocuments({
        pageId: { $exists: true },
    });
    const messagesWithoutPageId = await messagesCollection.countDocuments({
        pageId: { $exists: false },
    });

    console.log(`Total messages: ${totalMessagesBefore}`);
    console.log(`Messages already with pageId: ${messagesWithPageIdBefore}`);
    console.log(`Messages needing migration: ${messagesWithoutPageId}`);

    if (messagesWithoutPageId === 0) {
        console.log('\nNo messages need migration. Exiting.');
        await client.close();
        return;
    }

    // Step 2: Get all unique notebookIds that have messages without pageId
    const notebookIdsWithMessages = await messagesCollection.distinct('notebookId', {
        pageId: { $exists: false },
    });

    console.log(`\nFound ${notebookIdsWithMessages.length} notebooks with messages to migrate`);

    // Step 3: Check for existing messages pages
    const existingMessagesPages = await pagesCollection
        .find({
            type: 'message',
            notebookId: { $in: notebookIdsWithMessages },
        })
        .toArray();

    const existingPagesByNotebook = new Map<string, string>();
    for (const page of existingMessagesPages) {
        if (page.notebookId) {
            existingPagesByNotebook.set(page.notebookId.toString(), page.id);
        }
    }

    console.log(`Found ${existingMessagesPages.length} existing messages pages`);

    // Step 4: Process each notebook
    let pagesCreated = 0;
    let messagesUpdated = 0;
    const errors: string[] = [];

    for (const notebookId of notebookIdsWithMessages) {
        try {
            const notebookIdStr = notebookId.toString();
            let pageId: string;

            // Check if a messages page already exists for this notebook
            if (existingPagesByNotebook.has(notebookIdStr)) {
                pageId = existingPagesByNotebook.get(notebookIdStr)!;
                console.log(
                    `  Using existing messages page ${pageId} for notebook ${notebookIdStr}`,
                );
            } else {
                // Get the notebook to find the owner
                const notebook = await notebooksCollection.findOne({ _id: notebookId });
                if (!notebook) {
                    errors.push(`Notebook ${notebookIdStr} not found - skipping its messages`);
                    continue;
                }

                // Find the owner (user with 'owner' access level)
                const ownerEntry = notebook.sharing.sharedWith.find(
                    (e) => e.accessLevel === 'owner',
                );
                if (!ownerEntry) {
                    errors.push(`Notebook ${notebookIdStr} has no owner - skipping its messages`);
                    continue;
                }

                // Create a new messages page
                pageId = randomUUID();
                const now = new Date();
                const pageDoc = {
                    id: pageId,
                    userId: new ObjectId(ownerEntry.userId),
                    type: 'message',
                    title: 'Messages',
                    content: { type: 'doc', content: [] },
                    notebookId: notebookId,
                    isFavorite: false,
                    isArchived: false,
                    isTrashed: false,
                    createdAt: now,
                    updatedAt: now,
                };

                await pagesCollection.insertOne(pageDoc);
                pagesCreated++;
                console.log(
                    `  Created messages page ${pageId} for notebook ${notebookIdStr} (${notebook.label})`,
                );
            }

            // Update all messages in this notebook to reference the page
            const updateResult = await messagesCollection.updateMany(
                {
                    notebookId: notebookId,
                    pageId: { $exists: false },
                },
                {
                    $set: { pageId: pageId },
                },
            );

            messagesUpdated += updateResult.modifiedCount;
            console.log(`  Updated ${updateResult.modifiedCount} messages with pageId ${pageId}`);
        } catch (error) {
            errors.push(`Error processing notebook ${notebookId}: ${error}`);
        }
    }

    // Step 5: Verify migration
    console.log('\n--- Verification ---\n');

    const messagesWithPageIdAfter = await messagesCollection.countDocuments({
        pageId: { $exists: true },
    });
    const messagesWithoutPageIdAfter = await messagesCollection.countDocuments({
        pageId: { $exists: false },
    });
    const messagesPagesCount = await pagesCollection.countDocuments({ type: 'message' });

    console.log(
        `Messages with pageId: ${messagesWithPageIdAfter} (was ${messagesWithPageIdBefore})`,
    );
    console.log(
        `Messages without pageId: ${messagesWithoutPageIdAfter} (was ${messagesWithoutPageId})`,
    );
    console.log(`Total messages pages: ${messagesPagesCount}`);
    console.log(`\nPages created: ${pagesCreated}`);
    console.log(`Messages updated: ${messagesUpdated}`);

    if (errors.length > 0) {
        console.log(`\nErrors (${errors.length}):`);
        for (const error of errors) {
            console.log(`  - ${error}`);
        }
    }

    if (messagesWithoutPageIdAfter === 0) {
        console.log('\nMigration completed successfully!');
    } else {
        console.log(`\nWarning: ${messagesWithoutPageIdAfter} messages still need migration.`);
    }

    await client.close();
    console.log('\nDatabase connection closed.');
}

migrate().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
