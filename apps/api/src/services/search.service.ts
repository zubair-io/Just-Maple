import { getDb } from '../db/client';
import { findNotebooksByUserId } from '../repositories/notebook.repo';
import type { SearchResult, PageType } from '@maple/shared';

export interface SearchOptions {
    userId: string;
    types?: string[];
    notebookIds?: string[];
    tags?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
}

/**
 * Get all notebook IDs the user has access to (owned, shared, or public)
 */
async function getAccessibleNotebookIds(userId: string): Promise<string[]> {
    const notebooks = await findNotebooksByUserId(userId);
    return notebooks.map((n) => n._id);
}

/**
 * Escape special regex characters for safe use in RegExp
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight search terms in text and extract snippet
 */
function highlightSnippet(text: string, query: string, contextLength = 100): string {
    if (!text) return '';

    const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
    const lowerText = text.toLowerCase();

    // Find first matching term position
    let matchPos = -1;
    for (const term of terms) {
        const pos = lowerText.indexOf(term);
        if (pos !== -1 && (matchPos === -1 || pos < matchPos)) {
            matchPos = pos;
        }
    }

    if (matchPos === -1) return text.slice(0, contextLength * 2);

    // Extract context around match
    const start = Math.max(0, matchPos - contextLength);
    const end = Math.min(text.length, matchPos + contextLength);
    let snippet = text.slice(start, end);

    // Wrap matches in <mark> tags
    for (const term of terms) {
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        snippet = snippet.replace(regex, '<mark>$1</mark>');
    }

    return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
}

/**
 * Calculate a simple relevance score based on term frequency
 */
function calculateScore(title: string, plainText: string, terms: string[]): number {
    let score = 0;
    const lowerTitle = (title || '').toLowerCase();
    const lowerText = (plainText || '').toLowerCase();

    for (const term of terms) {
        // Title matches are worth more (10x weight)
        const titleMatches = (lowerTitle.match(new RegExp(escapeRegex(term), 'gi')) || []).length;
        score += titleMatches * 10;

        // Content matches
        const textMatches = (lowerText.match(new RegExp(escapeRegex(term), 'gi')) || []).length;
        score += textMatches;
    }

    return score;
}

/**
 * Search notes using regex-based search (Cosmos DB compatible)
 */
export async function searchNotes(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const db = getDb();

    // CRITICAL: Get all notebooks user has access to for access control
    const accessibleNotebookIds = await getAccessibleNotebookIds(options.userId);

    if (accessibleNotebookIds.length === 0) {
        return [];
    }

    // Parse search terms
    const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);

    if (terms.length === 0) {
        return [];
    }

    // Build regex pattern for OR matching (any term matches)
    const regexPattern = terms.map((t) => escapeRegex(t)).join('|');
    const searchRegex = { $regex: regexPattern, $options: 'i' };

    // Build filter
    const filter: Record<string, unknown> = {
        notebookId: { $in: accessibleNotebookIds },
        $or: [{ title: searchRegex }, { plainText: searchRegex }],
    };

    // Additional user-requested filters
    if (options.types?.length) {
        filter.type = { $in: options.types };
    }

    // If user specifies notebookIds, intersect with accessible notebooks
    if (options.notebookIds?.length) {
        const requestedIds = options.notebookIds.filter((id) => accessibleNotebookIds.includes(id));
        if (requestedIds.length === 0) {
            return [];
        }
        filter.notebookId = { $in: requestedIds };
    }

    // Filter by tags
    if (options.tags?.length) {
        filter.tags = { $all: options.tags };
    }

    if (options.dateFrom || options.dateTo) {
        const dateFilter: Record<string, Date> = {};
        if (options.dateFrom) dateFilter.$gte = options.dateFrom;
        if (options.dateTo) dateFilter.$lte = options.dateTo;
        filter.updatedAt = dateFilter;
    }

    // Fetch more results than needed to allow for scoring and sorting
    const fetchLimit = (options.limit || 20) * 3;
    const results = await db
        .collection('search_index')
        .find(filter)
        .limit(fetchLimit + (options.offset || 0))
        .toArray();

    // Calculate scores and sort by relevance
    const scoredResults = results
        .map((r) => ({
            ...r,
            score: calculateScore(r.title as string, r.plainText as string, terms),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(options.offset || 0, (options.offset || 0) + (options.limit || 20));

    // Add highlighted snippets
    return scoredResults.map((r) => ({
        pageId: r.pageId as string,
        title: r.title as string,
        type: r.type as PageType,
        notebookId: r.notebookId as string | undefined,
        notebookLabel: r.notebookLabel as string | undefined,
        preview: r.preview as string,
        snippet: highlightSnippet(r.plainText as string, query),
        score: r.score,
        tags: (r.tags as string[] | undefined) || [],
        updatedAt: r.updatedAt as string,
    }));
}
