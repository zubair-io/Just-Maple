import { Elysia, t } from 'elysia';
import { config } from '../config';
import { findNotebookBySlug } from '../repositories/notebook.repo';
import { findPublishedPageBySlug } from '../repositories/page.repo';
import { getHtmlTemplate, injectMetaTags, extractTextSnippet } from '../services/ssr.service';
import type { MetaTags } from '../services/ssr.service';

export function createSsrRoutes(staticDir: string) {
    return (
        new Elysia()
            // Marketing / landing page
            .get('/', async ({ set }) => {
                const html = await getHtmlTemplate(staticDir);
                if (!html) {
                    set.status = 404;
                    return { error: 'Frontend not found' };
                }

                const baseUrl = config.origin;

                const meta: MetaTags = {
                    title: 'Just Maple \u2014 Your thoughts, beautifully organized',
                    description:
                        'A note-taking platform with rich documents, whiteboards, AI assistance, and real-time collaboration.',
                    ogUrl: baseUrl,
                    canonicalUrl: baseUrl,
                    ogType: 'website',
                };

                set.headers['content-type'] = 'text/html';
                return injectMetaTags(html, meta);
            })

            // Public notebook landing: /!/:notebookSlug
            .get(
                '/!/:notebookSlug',
                async ({ params, set }) => {
                    const html = await getHtmlTemplate(staticDir);
                    if (!html) {
                        set.status = 404;
                        return { error: 'Frontend not found' };
                    }

                    const notebook = await findNotebookBySlug(params.notebookSlug);
                    if (!notebook) {
                        set.headers['content-type'] = 'text/html';
                        return html;
                    }

                    const baseUrl = config.origin;
                    const displayName = notebook.publicConfig?.displayName || notebook.label;
                    const description =
                        notebook.publicConfig?.description || `${displayName} on Just Maple`;
                    const logoUrl = notebook.publicConfig?.logoUrl;
                    const faviconUrl = notebook.publicConfig?.faviconUrl;
                    const notebookUrl = `${baseUrl}/!/${params.notebookSlug}`;

                    const meta: MetaTags = {
                        title: `${displayName} \u2014 Just Maple`,
                        description,
                        ogUrl: notebookUrl,
                        canonicalUrl: notebookUrl,
                        ogType: 'website',
                        ogImage: logoUrl || undefined,
                        faviconUrl: faviconUrl || undefined,
                        jsonLd: {
                            '@context': 'https://schema.org',
                            '@type': 'WebSite',
                            name: displayName,
                            url: notebookUrl,
                            description,
                        },
                    };

                    set.headers['content-type'] = 'text/html';
                    return injectMetaTags(html, meta);
                },
                {
                    params: t.Object({
                        notebookSlug: t.String(),
                    }),
                },
            )

            // Public notebook page: /!/:notebookSlug/:pageSlug
            .get(
                '/!/:notebookSlug/:pageSlug',
                async ({ params, set }) => {
                    const html = await getHtmlTemplate(staticDir);
                    if (!html) {
                        set.status = 404;
                        return { error: 'Frontend not found' };
                    }

                    const notebook = await findNotebookBySlug(params.notebookSlug);
                    if (!notebook) {
                        set.headers['content-type'] = 'text/html';
                        return html;
                    }

                    const page = await findPublishedPageBySlug(notebook._id, params.pageSlug);
                    if (!page) {
                        set.headers['content-type'] = 'text/html';
                        return html;
                    }

                    const baseUrl = config.origin;
                    const displayName = notebook.publicConfig?.displayName || notebook.label;
                    const pageTitle = page.publishedTitle || page.title;
                    const pageContent = page.publishedContent || page.content;
                    const snippet = extractTextSnippet(pageContent);
                    const description = snippet || `${pageTitle} \u2014 ${displayName}`;
                    const logoUrl = notebook.publicConfig?.logoUrl;
                    const faviconUrl = notebook.publicConfig?.faviconUrl;
                    const pageUrl = `${baseUrl}/!/${params.notebookSlug}/${params.pageSlug}`;

                    const meta: MetaTags = {
                        title: `${pageTitle} \u2014 ${displayName}`,
                        description,
                        ogUrl: pageUrl,
                        canonicalUrl: pageUrl,
                        ogType: 'article',
                        ogImage: logoUrl || undefined,
                        faviconUrl: faviconUrl || undefined,
                        jsonLd: {
                            '@context': 'https://schema.org',
                            '@type': 'Article',
                            headline: pageTitle,
                            url: pageUrl,
                            description,
                            datePublished: page.publishedAt,
                            publisher: {
                                '@type': 'Organization',
                                name: displayName,
                            },
                        },
                    };

                    set.headers['content-type'] = 'text/html';
                    return injectMetaTags(html, meta);
                },
                {
                    params: t.Object({
                        notebookSlug: t.String(),
                        pageSlug: t.String(),
                    }),
                },
            )
    );
}
