import * as Y from 'yjs';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/client';
import { findPageByIdForCollab } from './page.repo';
import { getMemoState } from './memo.repo';
import { findNotebookByIdUnsafe } from './notebook.repo';
import { extractText } from '@maple/shared';
import type { PageContent } from '@maple/shared';

/**
 * Extract text from Y.js XML fragment
 */
function extractTextFromYjs(xmlFragment: Y.XmlFragment): string {
    const parts: string[] = [];

    function traverse(node: Y.XmlElement | Y.XmlText | Y.XmlFragment): void {
        if (node instanceof Y.XmlText) {
            const text = node.toString();
            if (text) parts.push(text);
        } else if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
            const children = node.toArray();
            for (const child of children) {
                if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
                    traverse(child);
                }
            }
            // Add newline after block elements
            if (node instanceof Y.XmlElement) {
                const nodeName = node.nodeName;
                if (nodeName === 'paragraph' || nodeName === 'heading') {
                    parts.push('\n');
                }
            }
        }
    }

    traverse(xmlFragment);
    return parts.join('').trim();
}

/**
 * Index a page into the search_index collection
 */
export async function indexPage(pageId: string): Promise<void> {
    const db = getDb();

    // Get page using internal function (bypass permission checks for indexing)
    const page = await findPageByIdForCollab(pageId, 'MigrationService');
    if (!page) {
        console.log(`[SearchIndex] Page not found: ${pageId}`);
        return;
    }

    let plainText = page.title || '';

    // Extract text based on page type
    if (page.type === 'memo') {
        // Try to get Y.js state first
        const state = await getMemoState(pageId);
        if (state) {
            try {
                const ydoc = new Y.Doc();
                Y.applyUpdate(ydoc, state);
                const xmlFragment = ydoc.getXmlFragment('prosemirror');
                plainText += ' ' + extractTextFromYjs(xmlFragment);
            } catch (e) {
                console.error(`[SearchIndex] Failed to decode Y.js for ${pageId}:`, e);
                // Fall back to page content if Y.js decode fails
                if (page.content) {
                    plainText += ' ' + extractText(page.content as PageContent);
                }
            }
        } else if (page.content) {
            // Fall back to page content
            plainText += ' ' + extractText(page.content as PageContent);
        }
    } else if (page.type === 'message') {
        // For message pages, extract from content
        if (page.content) {
            plainText += ' ' + extractText(page.content as PageContent);
        }
    }
    // Whiteboards and other types don't have text content to index for now

    // Get notebook label
    let notebookLabel: string | undefined;
    if (page.notebookId) {
        const notebook = await findNotebookByIdUnsafe(page.notebookId);
        if (notebook) {
            notebookLabel = notebook.label;
        }
    }

    // Generate preview (first 200 chars)
    const preview = plainText.slice(0, 200);

    // Upsert to search_index collection
    await db.collection('search_index').updateOne(
        { pageId },
        {
            $set: {
                pageId,
                userId: page.userId,
                notebookId: page.notebookId,
                type: page.type,
                title: page.title,
                plainText,
                preview,
                notebookLabel,
                updatedAt: new Date(),
            },
        },
        { upsert: true },
    );

    console.log(`[SearchIndex] Indexed page: ${pageId}`);
}

/**
 * Remove a page from the search index
 */
export async function removeFromIndex(pageId: string): Promise<void> {
    const db = getDb();
    await db.collection('search_index').deleteOne({ pageId });
    console.log(`[SearchIndex] Removed from index: ${pageId}`);
}

/**
 * Reindex all pages for a user
 */
export async function reindexAllForUser(userId: string): Promise<void> {
    const db = getDb();

    // Get all pages for the user
    const pages = await db
        .collection('pages')
        .find({ userId: new ObjectId(userId) })
        .project({ id: 1 })
        .toArray();

    console.log(`[SearchIndex] Reindexing ${pages.length} pages for user ${userId}`);

    // Index each page
    for (const page of pages) {
        try {
            await indexPage(page.id as string);
        } catch (e) {
            console.error(`[SearchIndex] Failed to index page ${page.id}:`, e);
        }
    }

    console.log(`[SearchIndex] Reindex complete for user ${userId}`);
}

/**
 * Reindex all pages in the database (for migration)
 */
export async function reindexAll(): Promise<void> {
    const db = getDb();

    // Get all pages
    const pages = await db.collection('pages').find({}).project({ id: 1 }).toArray();

    console.log(`[SearchIndex] Reindexing ${pages.length} pages`);

    let indexed = 0;
    let failed = 0;

    // Index each page
    for (const page of pages) {
        try {
            await indexPage(page.id as string);
            indexed++;
        } catch (e) {
            console.error(`[SearchIndex] Failed to index page ${page.id}:`, e);
            failed++;
        }

        // Progress logging
        if ((indexed + failed) % 100 === 0) {
            console.log(`[SearchIndex] Progress: ${indexed + failed}/${pages.length}`);
        }
    }

    console.log(`[SearchIndex] Reindex complete: ${indexed} indexed, ${failed} failed`);
}
