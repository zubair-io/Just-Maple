import { Elysia, t } from 'elysia';
import { findNotebookBySlug } from '../repositories/notebook.repo';
import { findPublishedPagesByNotebookId, findPublishedPageBySlug } from '../repositories/page.repo';
import { findCustomDomainByDomain } from '../repositories/custom-domain.repo';

export const publicRoutes = new Elysia({ prefix: '/api/public' })

    // Get public notebook metadata + page list by slug
    .get(
        '/notebooks/:slug',
        async ({ params, set }) => {
            const notebook = await findNotebookBySlug(params.slug);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
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
                    slug: page.publishedSlug,
                    title: page.title,
                    type: page.type,
                    updatedAt: page.updatedAt,
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
                return { error: 'Notebook not found' };
            }

            const page = await findPublishedPageBySlug(notebook._id, params.pageSlug);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Get backlinks: other published pages that link to this page
            const allPages = await findPublishedPagesByNotebookId(notebook._id);
            const backlinks = allPages
                .filter((p) => {
                    if (p.id === page.id) return false;
                    // Check if page content contains a link to this page
                    const contentStr = JSON.stringify(p.content);
                    return (
                        contentStr.includes(page.title) ||
                        contentStr.includes(page.publishedSlug || '')
                    );
                })
                .map((p) => ({
                    slug: p.publishedSlug,
                    title: p.title,
                }));

            return {
                page: {
                    slug: page.publishedSlug,
                    title: page.title,
                    type: page.type,
                    content: page.content,
                    updatedAt: page.updatedAt,
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
                return { error: 'Domain not found' };
            }

            // Find the notebook associated with this domain
            const { findNotebookByIdUnsafe } = await import('../repositories/notebook.repo');
            const notebook = await findNotebookByIdUnsafe(customDomain.notebookId);
            if (!notebook || !notebook.sharing.isPublic) {
                set.status = 404;
                return { error: 'Notebook not found' };
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
                    slug: page.publishedSlug,
                    title: page.title,
                    type: page.type,
                    updatedAt: page.updatedAt,
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
