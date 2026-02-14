import { Elysia, t } from 'elysia';
import { findNotebookBySlug, findNotebookByIdUnsafe } from '../repositories/notebook.repo';
import { findPublishedPagesByNotebookId, findPublishedPageBySlug } from '../repositories/page.repo';
import { findCustomDomainByDomain } from '../repositories/custom-domain.repo';

/**
 * Build a display slug: "{slugified-title}-{shortId}".
 * Used in URLs for SEO/readability; only the shortId is stored in DB.
 */
function toDisplaySlug(title: string, shortId: string): string {
    const prefix = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
    return prefix ? `${prefix}-${shortId}` : shortId;
}

export const publicRoutes = new Elysia({ prefix: '/api/public' })

    // Check if a notebook is public and return its slugs for redirect
    // Used by the frontend guard to redirect ID-based URLs to slug-based public URLs
    .get(
        '/notebook-info/:id',
        async ({ params, query, set }) => {
            const notebook = await findNotebookByIdUnsafe(params.id);

            // Return 404 for both private and nonexistent notebooks
            // to avoid revealing whether a notebook exists
            if (!notebook || !notebook.sharing.isPublic || !notebook.slug) {
                set.status = 404;
                return { error: 'Not found' };
            }

            const pages = await findPublishedPagesByNotebookId(notebook._id);

            let matchedPage: (typeof pages)[number] | undefined;

            if (query.pageId) {
                matchedPage = pages.find((p) => p.id === query.pageId);
            }

            if (!matchedPage && pages.length > 0) {
                matchedPage = pages[0];
            }

            const notebookDisplaySlug = toDisplaySlug(notebook.label, notebook.slug!);
            const pageDisplaySlug = matchedPage?.publishedSlug
                ? toDisplaySlug(
                      matchedPage.publishedTitle || matchedPage.title,
                      matchedPage.publishedSlug,
                  )
                : undefined;

            return {
                isPublic: true,
                notebookSlug: notebookDisplaySlug,
                pageSlug: pageDisplaySlug,
            };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            query: t.Object({
                pageId: t.Optional(t.String()),
            }),
        },
    )

    // Get public notebook metadata + page list by slug
    .get(
        '/notebooks/:slug',
        async ({ params, set }) => {
            const notebook = await findNotebookBySlug(params.slug);
            if (!notebook) {
                set.status = 404;
                return { error: 'Not found', message: 'Notebook not found' };
            }

            const pages = await findPublishedPagesByNotebookId(notebook._id);

            return {
                notebook: {
                    slug: notebook.slug,
                    displayName: notebook.publicConfig?.displayName || notebook.label,
                    description: notebook.publicConfig?.description,
                    logoUrl: notebook.publicConfig?.logoUrl,
                    faviconUrl: notebook.publicConfig?.faviconUrl,
                    showPageList: notebook.publicConfig?.showPageList ?? true,
                    landingPageId: notebook.publicConfig?.landingPageId,
                },
                pages: pages.map((page) => ({
                    slug: page.publishedSlug
                        ? toDisplaySlug(page.publishedTitle || page.title, page.publishedSlug)
                        : page.publishedSlug,
                    title: page.publishedTitle || page.title,
                    type: page.type,
                    updatedAt: page.publishedAt || page.updatedAt,
                    order: page.publishedOrder ?? 0,
                })),
            };
        },
        {
            params: t.Object({
                slug: t.String(),
            }),
        },
    )

    // Get a single published page by slug within a notebook
    .get(
        '/notebooks/:slug/pages/:pageSlug',
        async ({ params, set }) => {
            const notebook = await findNotebookBySlug(params.slug);
            if (!notebook) {
                set.status = 404;
                return { error: 'Not found', message: 'Notebook not found' };
            }

            const page = await findPublishedPageBySlug(notebook._id, params.pageSlug);
            if (!page) {
                set.status = 404;
                return { error: 'Not found', message: 'Page not found' };
            }

            const pageTitle = page.publishedTitle || page.title;
            const pageContent = page.publishedContent || page.content;

            // Get backlinks: other published pages that link to this page
            const allPages = await findPublishedPagesByNotebookId(notebook._id);
            const backlinks = allPages
                .filter((p) => {
                    if (p.id === page.id) return false;
                    // Check if published content contains a link to this page
                    const contentStr = JSON.stringify(p.publishedContent || p.content);
                    return (
                        contentStr.includes(pageTitle) ||
                        contentStr.includes(page.publishedSlug || '')
                    );
                })
                .map((p) => ({
                    slug: p.publishedSlug
                        ? toDisplaySlug(p.publishedTitle || p.title, p.publishedSlug)
                        : p.publishedSlug,
                    title: p.publishedTitle || p.title,
                }));

            const pageDisplaySlug = page.publishedSlug
                ? toDisplaySlug(pageTitle, page.publishedSlug)
                : page.publishedSlug;

            return {
                page: {
                    slug: pageDisplaySlug,
                    title: pageTitle,
                    type: page.type,
                    content: pageContent,
                    publishedAt: page.publishedAt,
                    todoMeta: page.todoMeta,
                },
                links: {
                    backlinks,
                },
            };
        },
        {
            params: t.Object({
                slug: t.String(),
                pageSlug: t.String(),
            }),
        },
    )

    // Resolve a custom domain to a notebook
    .get(
        '/domains/:domain',
        async ({ params, set }) => {
            const customDomain = await findCustomDomainByDomain(params.domain);
            if (!customDomain) {
                set.status = 404;
                return { error: 'Not found', message: 'Domain not found' };
            }

            // Find the notebook associated with this domain
            const { findNotebookByIdUnsafe } = await import('../repositories/notebook.repo');
            const notebook = await findNotebookByIdUnsafe(customDomain.notebookId);
            if (!notebook || !notebook.sharing.isPublic) {
                set.status = 404;
                return { error: 'Not found', message: 'Notebook not found' };
            }

            const pages = await findPublishedPagesByNotebookId(notebook._id);

            return {
                notebook: {
                    slug: notebook.slug,
                    displayName: notebook.publicConfig?.displayName || notebook.label,
                    description: notebook.publicConfig?.description,
                    logoUrl: notebook.publicConfig?.logoUrl,
                    faviconUrl: notebook.publicConfig?.faviconUrl,
                    showPageList: notebook.publicConfig?.showPageList ?? true,
                    landingPageId: notebook.publicConfig?.landingPageId,
                },
                pages: pages.map((page) => ({
                    slug: page.publishedSlug
                        ? toDisplaySlug(page.publishedTitle || page.title, page.publishedSlug)
                        : page.publishedSlug,
                    title: page.publishedTitle || page.title,
                    type: page.type,
                    updatedAt: page.publishedAt || page.updatedAt,
                    order: page.publishedOrder ?? 0,
                })),
                domain: {
                    domain: customDomain.domain,
                    status: customDomain.status,
                    sslStatus: customDomain.sslStatus,
                },
            };
        },
        {
            params: t.Object({
                domain: t.String(),
            }),
        },
    );
