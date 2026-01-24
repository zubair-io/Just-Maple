import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { config } from '../config';
import type { Notebook, Page } from '@maple/shared';

// Constants
export const DOC_NOTEBOOK_ID = 'doc-notebook';
const DOC_PAGE_PREFIX = 'doc-';
const DOCS_DIR = join(process.cwd(), '..', '..', 'docs');

/**
 * Check if running in dev mode
 */
export function isDevMode(): boolean {
    return config.isDev;
}

/**
 * Check if an ID is a doc page ID
 */
export function isDocPage(id: string): boolean {
    return id.startsWith(DOC_PAGE_PREFIX);
}

/**
 * Check if an ID is the doc notebook ID
 */
export function isDocNotebook(id: string): boolean {
    return id === DOC_NOTEBOOK_ID;
}

/**
 * Get the virtual Documentation notebook
 */
export function getDocNotebook(): Notebook {
    const now = new Date().toISOString();
    return {
        _id: DOC_NOTEBOOK_ID,
        type: 'folder',
        value: 'notes',
        label: 'Documentation',
        sharing: {
            sharedWith: [],
            isPublic: true,
        },
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Convert filename to slug
 * e.g., "getting-started.md" -> "getting-started"
 */
function filenameToSlug(filename: string): string {
    return basename(filename, '.md').toLowerCase();
}

/**
 * Convert slug to page ID
 * e.g., "getting-started" -> "doc-getting-started"
 */
function slugToPageId(slug: string): string {
    return `${DOC_PAGE_PREFIX}${slug}`;
}

/**
 * Extract page ID from doc page ID
 * e.g., "doc-getting-started" -> "getting-started"
 */
export function pageIdToSlug(pageId: string): string {
    return pageId.replace(DOC_PAGE_PREFIX, '');
}

/**
 * Extract title from markdown content
 * Returns the first H1 heading or the slug as fallback
 */
function extractTitle(content: string, slug: string): string {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
        return h1Match[1].trim();
    }
    // Fallback: convert slug to title case
    return slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Create a virtual Page object from a doc file
 */
function createDocPage(slug: string, title: string): Page {
    const now = new Date().toISOString();
    const pageId = slugToPageId(slug);
    return {
        _id: pageId,
        id: pageId,
        userId: 'system',
        type: 'memo',
        title,
        content: { type: 'doc', content: [] },
        notebookId: DOC_NOTEBOOK_ID,
        isFavorite: false,
        isArchived: false,
        isTrashed: false,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Get all doc pages
 */
export async function getDocPages(): Promise<Page[]> {
    try {
        const files = await readdir(DOCS_DIR);
        const mdFiles = files.filter((f) => f.endsWith('.md'));

        const pages: Page[] = [];
        for (const file of mdFiles) {
            const slug = filenameToSlug(file);
            const content = await readFile(join(DOCS_DIR, file), 'utf-8');
            const title = extractTitle(content, slug);
            pages.push(createDocPage(slug, title));
        }

        // Sort by title
        pages.sort((a, b) => a.title.localeCompare(b.title));
        return pages;
    } catch (error) {
        console.error('[DocsService] Failed to read docs directory:', error);
        return [];
    }
}

/**
 * Get a single doc page by slug
 */
export async function getDocPage(slug: string): Promise<Page | null> {
    try {
        const filePath = join(DOCS_DIR, `${slug}.md`);
        const content = await readFile(filePath, 'utf-8');
        const title = extractTitle(content, slug);
        return createDocPage(slug, title);
    } catch {
        // Also try with different casing
        try {
            const files = await readdir(DOCS_DIR);
            const matchingFile = files.find((f) => f.toLowerCase() === `${slug.toLowerCase()}.md`);
            if (matchingFile) {
                const filePath = join(DOCS_DIR, matchingFile);
                const content = await readFile(filePath, 'utf-8');
                const title = extractTitle(content, slug);
                return createDocPage(slug, title);
            }
        } catch {
            // Ignore
        }
        return null;
    }
}

/**
 * Get markdown content for a doc page
 */
export async function getDocContent(slug: string): Promise<string | null> {
    try {
        const filePath = join(DOCS_DIR, `${slug}.md`);
        return await readFile(filePath, 'utf-8');
    } catch {
        // Also try with different casing
        try {
            const files = await readdir(DOCS_DIR);
            const matchingFile = files.find((f) => f.toLowerCase() === `${slug.toLowerCase()}.md`);
            if (matchingFile) {
                const filePath = join(DOCS_DIR, matchingFile);
                return await readFile(filePath, 'utf-8');
            }
        } catch {
            // Ignore
        }
        return null;
    }
}
