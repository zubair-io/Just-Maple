import { ObjectId } from 'mongodb';
import * as Y from 'yjs';
import { getDb } from '../db/client';
import { getMemoState, findMemosByPageIds } from '../repositories/memo.repo';
import { extractTagsFromYjs } from '../repositories/search.repo';
import type {
    PageContent,
    PageLink,
    PageLinksMeta,
    LinkSearchResult,
    UnlinkedMention,
    GraphData,
    GraphNode,
    GraphEdge,
    ConnectionGraph,
    ConnectionNode,
    ConnectionEdge,
} from '@maple/shared';

/**
 * Link Service
 * Handles bi-directional link extraction, tracking, and graph queries
 */

/**
 * Extract page links from Y.js XML fragment (for memos stored in Y.js format)
 */
function extractLinksFromYjs(xmlFragment: Y.XmlFragment): PageLink[] {
    const links: PageLink[] = [];
    const seen = new Set<string>();

    function traverse(node: Y.XmlElement | Y.XmlText | Y.XmlFragment): void {
        if (node instanceof Y.XmlElement) {
            // Check for pageLink nodes
            if (node.nodeName === 'pageLink') {
                const pageId = node.getAttribute('pageId');
                const title = node.getAttribute('title') || 'Untitled';
                if (pageId && typeof pageId === 'string' && !seen.has(pageId)) {
                    links.push({ pageId, title: String(title), type: 'inline' });
                    seen.add(pageId);
                }
            }
            // Check for pageLinkBlock nodes (block embeds)
            if (node.nodeName === 'pageLinkBlock') {
                const pageId = node.getAttribute('pageId');
                const title = node.getAttribute('title') || 'Untitled';
                if (pageId && typeof pageId === 'string' && !seen.has(pageId)) {
                    links.push({ pageId, title: String(title), type: 'block' });
                    seen.add(pageId);
                }
            }
            // Continue traversing children
            const children = node.toArray();
            for (const child of children) {
                if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
                    traverse(child);
                }
            }
        } else if (node instanceof Y.XmlFragment) {
            const children = node.toArray();
            for (const child of children) {
                if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
                    traverse(child);
                }
            }
        }
    }

    traverse(xmlFragment);
    return links;
}

interface UserMention {
    userId: string;
    displayName: string;
}

/**
 * Extract @user mentions from Y.js XML fragment
 */
function extractUserMentionsFromYjs(xmlFragment: Y.XmlFragment): UserMention[] {
    const mentions: UserMention[] = [];
    const seen = new Set<string>();

    function traverse(node: Y.XmlElement | Y.XmlText | Y.XmlFragment): void {
        if (node instanceof Y.XmlElement) {
            if (node.nodeName === 'inlineMention' && node.getAttribute('type') === 'user') {
                const userId = node.getAttribute('value');
                const displayName = node.getAttribute('displayName') || 'User';
                if (userId && typeof userId === 'string' && !seen.has(userId)) {
                    mentions.push({ userId, displayName: String(displayName) });
                    seen.add(userId);
                }
            }
            const children = node.toArray();
            for (const child of children) {
                if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
                    traverse(child);
                }
            }
        } else if (node instanceof Y.XmlFragment) {
            const children = node.toArray();
            for (const child of children) {
                if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
                    traverse(child);
                }
            }
        }
    }

    traverse(xmlFragment);
    return mentions;
}

/**
 * Extract all page links from ProseMirror/TipTap content
 */
export function extractLinksFromContent(content: PageContent): PageLink[] {
    const links: PageLink[] = [];

    const traverse = (node: any): void => {
        if (!node) return;

        // Check for pageLink nodes (inline links)
        if (node.type === 'pageLink') {
            links.push({
                pageId: node.attrs?.pageId,
                title: node.attrs?.title || 'Untitled',
                type: 'inline',
            });
        }

        // Check for pageLinkBlock nodes (block embeds)
        if (node.type === 'pageLinkBlock') {
            links.push({
                pageId: node.attrs?.pageId,
                title: node.attrs?.title || 'Untitled',
                type: 'block',
            });
        }

        // Check for tagLink marks (future: #tag references)
        if (node.marks) {
            for (const mark of node.marks) {
                if (mark.type === 'tagLink') {
                    links.push({
                        pageId: mark.attrs?.tagId,
                        title: mark.attrs?.label || '',
                        type: 'tag',
                    });
                }
            }
        }

        // Recurse into children
        if (node.content && Array.isArray(node.content)) {
            for (const child of node.content) {
                traverse(child);
            }
        }
    };

    traverse(content);

    // Deduplicate links by pageId
    const seen = new Set<string>();
    return links.filter((link) => {
        if (!link.pageId || seen.has(link.pageId)) return false;
        seen.add(link.pageId);
        return true;
    });
}

/**
 * Update forward and back links when a page's content changes
 */
export async function updateLinksForPage(
    pageId: string,
    content: PageContent,
    pageTitle: string,
): Promise<void> {
    const db = getDb();
    const pages = db.collection('pages');

    // Extract new forward links from content
    const newLinks = extractLinksFromContent(content);
    const newLinkIds = new Set(newLinks.map((l) => l.pageId));

    // Get current page with old forward links
    const currentPage = await pages.findOne({ id: pageId });
    const oldLinks = currentPage?.linksMeta?.forwardLinks || [];
    const oldLinkIds = new Set(oldLinks.map((l: PageLink) => l.pageId));

    // Find added and removed links
    const addedLinks = newLinks.filter((l) => !oldLinkIds.has(l.pageId));
    const removedLinkIds = [...oldLinkIds].filter((id) => !newLinkIds.has(id));

    // Update this page's forward links
    await pages.updateOne(
        { id: pageId },
        {
            $set: {
                'linksMeta.forwardLinks': newLinks,
                'linksMeta.lastIndexedAt': new Date().toISOString(),
            },
        },
    );

    // Add backlinks to newly linked pages
    for (const link of addedLinks) {
        await pages.updateOne({ id: link.pageId }, {
            $push: {
                'linksMeta.backlinks': {
                    pageId: pageId,
                    title: pageTitle,
                    type: link.type,
                } as PageLink,
            },
        } as any);
    }

    // Remove backlinks from pages we no longer link to
    if (removedLinkIds.length > 0) {
        await pages.updateMany({ id: { $in: removedLinkIds as string[] } }, {
            $pull: {
                'linksMeta.backlinks': { pageId: pageId },
            },
        } as any);
    }
}

/**
 * Get all backlinks for a page
 */
export async function getBacklinks(pageId: string): Promise<PageLink[]> {
    const db = getDb();
    const page = await db.collection('pages').findOne({ id: pageId });
    return page?.linksMeta?.backlinks || [];
}

/**
 * Get all forward links for a page
 */
export async function getForwardLinks(pageId: string): Promise<PageLink[]> {
    const db = getDb();
    const page = await db.collection('pages').findOne({ id: pageId });
    return page?.linksMeta?.forwardLinks || [];
}

/**
 * Find unlinked mentions of a page's title in other pages
 */
export async function findUnlinkedMentions(
    pageId: string,
    userId: string,
    notebookId?: string,
): Promise<UnlinkedMention[]> {
    const db = getDb();
    const pages = db.collection('pages');

    // Get the target page
    const targetPage = await pages.findOne({ id: pageId });
    if (!targetPage?.title || targetPage.title.length < 2) {
        return [];
    }

    // Build query for pages that might contain the title
    const query: any = {
        id: { $ne: pageId },
        userId: new ObjectId(userId),
        isTrashed: { $ne: true },
    };

    if (notebookId) {
        query.notebookId = new ObjectId(notebookId);
    }

    // Find pages and check for title mentions in content
    const candidatePages = await pages.find(query).toArray();
    const mentions: UnlinkedMention[] = [];
    const linkedPageIds = new Set(
        targetPage?.linksMeta?.backlinks?.map((l: PageLink) => l.pageId) || [],
    );

    for (const page of candidatePages) {
        // Skip if already linked
        if (linkedPageIds.has(page.id)) continue;

        // Check if page content contains the title
        const contentText = extractTextFromContent(page.content);
        const titleLower = targetPage.title.toLowerCase();
        const contentLower = contentText.toLowerCase();

        if (contentLower.includes(titleLower)) {
            // Extract context around the mention
            const index = contentLower.indexOf(titleLower);
            const start = Math.max(0, index - 50);
            const end = Math.min(contentText.length, index + titleLower.length + 50);
            const context =
                (start > 0 ? '...' : '') +
                contentText.slice(start, end) +
                (end < contentText.length ? '...' : '');

            mentions.push({
                pageId: page.id,
                title: page.title,
                context,
            });
        }
    }

    return mentions.slice(0, 20); // Limit results
}

/**
 * Extract plain text from content for search
 */
function extractTextFromContent(content: PageContent): string {
    const texts: string[] = [];

    const traverse = (node: any): void => {
        if (!node) return;

        if (node.text) {
            texts.push(node.text);
        }

        if (node.content && Array.isArray(node.content)) {
            for (const child of node.content) {
                traverse(child);
            }
        }
    };

    traverse(content);
    return texts.join(' ');
}

/**
 * Search pages for linking autocomplete
 */
export async function searchPagesForLinking(
    query: string,
    userId: string,
    options?: {
        notebookId?: string;
        excludePageId?: string;
        limit?: number;
    },
): Promise<LinkSearchResult[]> {
    const db = getDb();
    const pages = db.collection('pages');
    const notebooks = db.collection('notebooks');

    const limit = options?.limit || 10;

    // Build search query
    const searchQuery: any = {
        userId: new ObjectId(userId),
        isTrashed: { $ne: true },
        title: { $regex: query, $options: 'i' },
    };

    if (options?.notebookId) {
        searchQuery.notebookId = new ObjectId(options.notebookId);
    }

    if (options?.excludePageId) {
        searchQuery.id = { $ne: options.excludePageId };
    }

    const results = await pages
        .find(searchQuery)
        .project({
            id: 1,
            title: 1,
            type: 1,
            notebookId: 1,
            updatedAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .toArray();

    // Get notebook names for display
    const notebookIds = [...new Set(results.filter((r) => r.notebookId).map((r) => r.notebookId))];
    const notebookDocs = await notebooks
        .find({ _id: { $in: notebookIds } })
        .project({ _id: 1, name: 1 })
        .toArray();
    const notebookMap = new Map(notebookDocs.map((n) => [n._id.toString(), n.name]));

    return results.map((doc) => ({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        notebookId: doc.notebookId?.toString(),
        notebookName: doc.notebookId ? notebookMap.get(doc.notebookId.toString()) : undefined,
        updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString(),
    }));
}

/**
 * Handle page title rename - update all links that reference this page
 */
export async function handlePageRename(pageId: string, newTitle: string): Promise<void> {
    const db = getDb();
    const pages = db.collection('pages');

    // Get pages that link to this page
    const page = await pages.findOne({ id: pageId });
    const backlinkPageIds = page?.linksMeta?.backlinks?.map((l: PageLink) => l.pageId) || [];

    if (backlinkPageIds.length === 0) return;

    // Update the title in all forward links pointing to this page
    await pages.updateMany(
        {
            id: { $in: backlinkPageIds },
            'linksMeta.forwardLinks.pageId': pageId,
        },
        {
            $set: {
                'linksMeta.forwardLinks.$[link].title': newTitle,
            },
        },
        {
            arrayFilters: [{ 'link.pageId': pageId }],
        } as any,
    );
}

/**
 * Handle page deletion - clean up all link references
 */
export async function handlePageDeletion(pageId: string): Promise<void> {
    const db = getDb();
    const pages = db.collection('pages');

    // Get the page being deleted
    const page = await pages.findOne({ id: pageId });
    if (!page) return;

    // Remove backlinks from pages this page linked to
    const forwardLinkIds = page.linksMeta?.forwardLinks?.map((l: PageLink) => l.pageId) || [];
    if (forwardLinkIds.length > 0) {
        await pages.updateMany({ id: { $in: forwardLinkIds } }, {
            $pull: {
                'linksMeta.backlinks': { pageId: pageId },
            },
        } as any);
    }

    // Note: We don't remove the backlinks from other pages pointing to this page
    // They will show as "Page not found" which preserves the user's intent
}

/**
 * Get graph data for knowledge graph visualization
 */
export async function getGraphData(userId: string, notebookId?: string): Promise<GraphData> {
    const db = getDb();
    const pages = db.collection('pages');

    // Build query
    const query: any = {
        userId: new ObjectId(userId),
        isTrashed: { $ne: true },
    };

    if (notebookId) {
        query.notebookId = new ObjectId(notebookId);
    }

    // Get all pages
    const allPages = await pages
        .find(query)
        .project({
            id: 1,
            title: 1,
            type: 1,
            'linksMeta.forwardLinks': 1,
            'linksMeta.backlinks': 1,
        })
        .toArray();

    // Build nodes
    const nodes: GraphNode[] = allPages.map((page) => ({
        id: page.id,
        label: page.title || 'Untitled',
        type: page.type || 'memo',
        linkCount:
            (page.linksMeta?.forwardLinks?.length || 0) + (page.linksMeta?.backlinks?.length || 0),
    }));

    // Build edges (deduplicated)
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();
    const pageIdSet = new Set(allPages.map((p) => p.id));

    for (const page of allPages) {
        const forwardLinks = page.linksMeta?.forwardLinks || [];
        for (const link of forwardLinks) {
            // Only include edges where both nodes exist in the result set
            if (!pageIdSet.has(link.pageId)) continue;

            const edgeId = `${page.id}-${link.pageId}`;
            if (!edgeSet.has(edgeId)) {
                edges.push({
                    source: page.id,
                    target: link.pageId,
                    type: link.type || 'inline',
                });
                edgeSet.add(edgeId);
            }
        }
    }

    return { nodes, edges };
}

/**
 * Get local graph centered on a specific page
 */
export async function getLocalGraph(
    pageId: string,
    userId: string,
    depth: number = 1,
): Promise<GraphData> {
    const db = getDb();
    const pages = db.collection('pages');

    // BFS to get nodes within depth
    const visited = new Set<string>();
    const queue: Array<{ id: string; level: number }> = [{ id: pageId, level: 0 }];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    while (queue.length > 0) {
        const { id, level } = queue.shift()!;
        if (visited.has(id) || level > depth) continue;
        visited.add(id);

        const page = await pages.findOne({
            id,
            userId: new ObjectId(userId),
        });
        if (!page) continue;

        nodes.push({
            id: page.id,
            label: page.title || 'Untitled',
            type: page.type || 'memo',
            linkCount:
                (page.linksMeta?.forwardLinks?.length || 0) +
                (page.linksMeta?.backlinks?.length || 0),
            isCenter: id === pageId,
        });

        // Add connected pages to queue
        const allLinks = [
            ...(page.linksMeta?.forwardLinks || []),
            ...(page.linksMeta?.backlinks || []),
        ];

        for (const link of allLinks) {
            if (!visited.has(link.pageId)) {
                queue.push({ id: link.pageId, level: level + 1 });

                // Add edge
                const isForward = page.linksMeta?.forwardLinks?.some(
                    (l: PageLink) => l.pageId === link.pageId,
                );
                edges.push({
                    source: isForward ? id : link.pageId,
                    target: isForward ? link.pageId : id,
                    type: link.type || 'inline',
                });
            }
        }
    }

    return { nodes, edges };
}

/**
 * Bulk reindex links for all pages (migration/repair)
 */
export async function reindexAllLinks(userId: string, notebookId?: string): Promise<number> {
    const db = getDb();
    const pages = db.collection('pages');

    const query: any = {
        userId: new ObjectId(userId),
        isTrashed: { $ne: true },
    };

    if (notebookId) {
        query.notebookId = new ObjectId(notebookId);
    }

    const allPages = await pages.find(query).toArray();
    let count = 0;

    for (const page of allPages) {
        if (page.content) {
            await updateLinksForPage(page.id, page.content, page.title);
            count++;
        }
    }

    return count;
}

/**
 * Get connection graph data including page links, hashtag connections, and mentions
 * This builds a comprehensive graph showing all relationships between pages
 */
export async function getConnectionGraph(
    userId: string,
    notebookId?: string,
): Promise<ConnectionGraph> {
    const db = getDb();
    const pages = db.collection('pages');
    const searchIndex = db.collection('search_index');

    // Build query
    const query: any = {
        userId: new ObjectId(userId),
        isTrashed: { $ne: true },
    };

    if (notebookId) {
        query.notebookId = new ObjectId(notebookId);
    }

    // Get all pages with their links and tags
    const allPages = await pages
        .find(query)
        .project({
            id: 1,
            title: 1,
            type: 1,
            tags: 1,
            'linksMeta.forwardLinks': 1,
            'linksMeta.backlinks': 1,
        })
        .toArray();

    // Also get tags from search_index (may be more up-to-date)
    const pageIds = allPages.map((p) => p.id);
    const searchDocs = await searchIndex
        .find({ pageId: { $in: pageIds } })
        .project({ pageId: 1, tags: 1 })
        .toArray();
    const searchTagsMap = new Map(searchDocs.map((d) => [d.pageId, d.tags || []]));

    const pageIdSet = new Set(pageIds);

    // Extract links and @user mentions from Y.js content for memos
    const pageLinksMap = new Map<string, PageLink[]>();
    // Map: userId -> { displayName, mentionedInPageIds[] }
    const userMentionsMap = new Map<string, { displayName: string; pageIds: Set<string> }>();

    for (const page of allPages) {
        // If linksMeta exists and has forward links, use those
        if (page.linksMeta?.forwardLinks?.length > 0) {
            pageLinksMap.set(page.id, page.linksMeta.forwardLinks);
        }

        if (page.type === 'memo') {
            // Try to extract links and user mentions from Y.js content
            try {
                const state = await getMemoState(page.id);
                if (state) {
                    const ydoc = new Y.Doc();
                    Y.applyUpdate(ydoc, state);
                    const xmlFragment = ydoc.getXmlFragment('prosemirror');

                    // Extract page links (if not already from linksMeta)
                    if (!pageLinksMap.has(page.id)) {
                        const links = extractLinksFromYjs(xmlFragment);
                        if (links.length > 0) {
                            pageLinksMap.set(page.id, links);
                        }
                    }

                    // Extract @user mentions
                    const mentions = extractUserMentionsFromYjs(xmlFragment);
                    for (const m of mentions) {
                        const existing = userMentionsMap.get(m.userId);
                        if (existing) {
                            existing.pageIds.add(page.id);
                        } else {
                            userMentionsMap.set(m.userId, {
                                displayName: m.displayName,
                                pageIds: new Set([page.id]),
                            });
                        }
                    }
                }
            } catch (e) {
                // Ignore errors, just skip this page
            }
        }
    }

    // Build nodes with merged tags and corrected link counts
    const nodes: ConnectionNode[] = allPages.map((page) => {
        // Merge tags from page and search_index
        const pageTags = page.tags || [];
        const indexTags = searchTagsMap.get(page.id) || [];
        const mergedTags = [...new Set([...pageTags, ...indexTags])];

        // Get link count from extracted links
        const forwardLinks = pageLinksMap.get(page.id) || [];
        const backlinks = page.linksMeta?.backlinks || [];

        return {
            id: page.id,
            label: page.title || 'Untitled',
            type: page.type || 'memo',
            linkCount: forwardLinks.length + backlinks.length,
            tags: mergedTags.length > 0 ? mergedTags : undefined,
        };
    });

    // Include kanban card memos as nodes in the graph
    const kanbanPages = allPages.filter((p) => p.type === 'kanban');
    const kanbanCardEdges: Array<{ kanbanPageId: string; cardMemoId: string }> = [];

    if (kanbanPages.length > 0) {
        const kanbanPageIds = kanbanPages.map((p) => p.id);
        const cardMemos = await findMemosByPageIds(kanbanPageIds);

        for (const memo of cardMemos) {
            try {
                const state = memo.state;
                if (!state) continue;

                const stateBytes =
                    state instanceof Uint8Array ? state : new Uint8Array(state as ArrayBuffer);
                const ydoc = new Y.Doc();
                Y.applyUpdate(ydoc, stateBytes);
                const xmlFragment = ydoc.getXmlFragment('prosemirror');

                // Extract tags from Y.js content
                const cardTags = extractTagsFromYjs(xmlFragment);

                // Extract page links from Y.js content (for graph edges)
                const cardLinks = extractLinksFromYjs(xmlFragment);
                if (cardLinks.length > 0) {
                    pageLinksMap.set(memo.id, cardLinks);
                }

                // Extract @user mentions from card memos
                const cardUserMentions = extractUserMentionsFromYjs(xmlFragment);
                for (const m of cardUserMentions) {
                    const existing = userMentionsMap.get(m.userId);
                    if (existing) {
                        existing.pageIds.add(memo.id);
                    } else {
                        userMentionsMap.set(m.userId, {
                            displayName: m.displayName,
                            pageIds: new Set([memo.id]),
                        });
                    }
                }

                // Extract title from first heading or first line
                let cardTitle = 'Untitled Card';
                const children = xmlFragment.toArray();
                for (const child of children) {
                    if (child instanceof Y.XmlElement) {
                        if (child.nodeName === 'heading') {
                            const headingText = child
                                .toArray()
                                .map((c: any) => c.toString())
                                .join('');
                            if (headingText) {
                                cardTitle = headingText;
                                break;
                            }
                        }
                    }
                }

                // Add card memo as node
                const cardLinkCount = 1 + cardLinks.length; // Parent kanban + page links
                nodes.push({
                    id: memo.id,
                    label: cardTitle,
                    type: 'kanban-card',
                    linkCount: cardLinkCount,
                    tags: cardTags.length > 0 ? cardTags : undefined,
                });
                pageIdSet.add(memo.id);

                // Track edge from kanban page to card memo
                kanbanCardEdges.push({
                    kanbanPageId: memo.pageId,
                    cardMemoId: memo.id,
                });
            } catch {
                // Skip card memos that fail to decode
            }
        }
    }

    // Build edges
    const edges: ConnectionEdge[] = [];
    const edgeSet = new Set<string>();
    let linkEdgeCount = 0;
    let hashtagEdgeCount = 0;

    // Add page link edges (forward links only to avoid duplicates)
    for (const page of allPages) {
        const forwardLinks = pageLinksMap.get(page.id) || [];
        for (const link of forwardLinks) {
            // Only include edges where both nodes exist in the result set
            if (!pageIdSet.has(link.pageId)) continue;

            const edgeId = `link:${page.id}-${link.pageId}`;
            if (!edgeSet.has(edgeId)) {
                edges.push({
                    source: page.id,
                    target: link.pageId,
                    type: link.type || 'inline',
                });
                edgeSet.add(edgeId);
                linkEdgeCount++;
            }
        }
    }

    // Add kanban page → card memo edges
    for (const { kanbanPageId, cardMemoId } of kanbanCardEdges) {
        const edgeId = `link:${kanbanPageId}-${cardMemoId}`;
        if (!edgeSet.has(edgeId)) {
            edges.push({
                source: kanbanPageId,
                target: cardMemoId,
                type: 'inline',
            });
            edgeSet.add(edgeId);
            linkEdgeCount++;
        }

        // Add edges from card memo to pages it links to
        const cardLinks = pageLinksMap.get(cardMemoId) || [];
        for (const link of cardLinks) {
            if (!pageIdSet.has(link.pageId)) continue;

            const cardLinkEdgeId = `link:${cardMemoId}-${link.pageId}`;
            if (!edgeSet.has(cardLinkEdgeId)) {
                edges.push({
                    source: cardMemoId,
                    target: link.pageId,
                    type: link.type || 'inline',
                });
                edgeSet.add(cardLinkEdgeId);
                linkEdgeCount++;
            }
        }
    }

    // Build hashtag connections (pages sharing the same hashtag)
    // Group pages by their tags
    const tagToPages = new Map<string, string[]>();
    for (const node of nodes) {
        if (node.tags) {
            for (const tag of node.tags) {
                if (!tagToPages.has(tag)) {
                    tagToPages.set(tag, []);
                }
                tagToPages.get(tag)!.push(node.id);
            }
        }
    }

    // Create edges between pages that share tags
    for (const [tag, pageIdsWithTag] of tagToPages) {
        // Only create connections if multiple pages share the tag
        if (pageIdsWithTag.length < 2) continue;

        // Create edges between all pairs (but only in one direction)
        for (let i = 0; i < pageIdsWithTag.length; i++) {
            for (let j = i + 1; j < pageIdsWithTag.length; j++) {
                const sourceId = pageIdsWithTag[i];
                const targetId = pageIdsWithTag[j];

                // Skip if already connected via link
                const linkEdgeId = `link:${sourceId}-${targetId}`;
                const linkEdgeIdReverse = `link:${targetId}-${sourceId}`;
                if (edgeSet.has(linkEdgeId) || edgeSet.has(linkEdgeIdReverse)) continue;

                // Create hashtag edge
                const hashEdgeId = `hashtag:${sourceId}-${targetId}`;
                if (!edgeSet.has(hashEdgeId)) {
                    edges.push({
                        source: sourceId,
                        target: targetId,
                        type: 'hashtag',
                        label: `#${tag}`,
                    });
                    edgeSet.add(hashEdgeId);
                    hashtagEdgeCount++;
                }
            }
        }
    }

    // Add @user mention nodes and edges
    let mentionEdgeCount = 0;
    for (const [userId, { displayName, pageIds: mentionPageIds }] of userMentionsMap) {
        const userNodeId = `user:${userId}`;

        // Add user node
        nodes.push({
            id: userNodeId,
            label: displayName,
            type: 'user',
            linkCount: mentionPageIds.size,
        });

        // Add edges from each page/card that mentions this user
        for (const srcPageId of mentionPageIds) {
            const mentionEdgeId = `mention:${srcPageId}-${userNodeId}`;
            if (!edgeSet.has(mentionEdgeId)) {
                edges.push({
                    source: srcPageId,
                    target: userNodeId,
                    type: 'mention',
                });
                edgeSet.add(mentionEdgeId);
                mentionEdgeCount++;
            }
        }
    }

    return {
        nodes,
        edges,
        stats: {
            totalNodes: nodes.length,
            totalEdges: edges.length,
            linkEdges: linkEdgeCount,
            hashtagEdges: hashtagEdgeCount,
        },
    };
}
