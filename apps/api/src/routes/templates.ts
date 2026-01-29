import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload, PageContent } from '@maple/shared';
import {
    findTemplates,
    findTemplatesByCategory,
    findTemplateById,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    incrementUsageCount,
} from '../repositories/template.repo';
import { findPageById, createPage } from '../repositories/page.repo';
import { findNotebookById } from '../repositories/notebook.repo';

/**
 * Process template variables like {{date}}, {{notebook}}, {{title}}
 */
function processTemplateVariables(
    content: PageContent,
    context: { date: string; notebook: string; title: string },
): PageContent {
    const processNode = (node: any): any => {
        if (node.type === 'text' && node.text) {
            let text = node.text as string;
            text = text.replace(/\{\{date\}\}/g, context.date);
            text = text.replace(/\{\{notebook\}\}/g, context.notebook);
            text = text.replace(/\{\{title\}\}/g, context.title);
            return { ...node, text };
        }
        if (node.content && Array.isArray(node.content)) {
            return { ...node, content: node.content.map(processNode) };
        }
        return node;
    };

    return {
        ...content,
        content: content.content?.map(processNode),
    };
}

export const templateRoutes = new Elysia({ prefix: '/api/templates' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }
        const token = authHeader.slice(7);
        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    // List all templates (system + user's custom)
    .get(
        '/',
        async ({ auth, set, query }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const templates = query.category
                ? await findTemplatesByCategory(auth.user._id, query.category)
                : await findTemplates(auth.user._id);
            return { templates };
        },
        {
            query: t.Object({
                category: t.Optional(
                    t.Union([
                        t.Literal('work'),
                        t.Literal('personal'),
                        t.Literal('planning'),
                        t.Literal('meeting'),
                        t.Literal('custom'),
                    ]),
                ),
            }),
        },
    )

    // Get single template by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const template = await findTemplateById(params.id);
            if (!template) {
                set.status = 404;
                return { error: 'Template not found' };
            }
            return { template };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create custom template
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            let content = body.content;

            // If pageId provided, extract content from that page
            if (body.pageId && !content) {
                const page = await findPageById(body.pageId, auth.user._id);
                if (!page) {
                    set.status = 404;
                    return { error: 'Page not found' };
                }
                content = page.content;
            }

            const template = await createTemplate(auth.user._id, {
                title: body.title,
                description: body.description,
                category: body.category,
                icon: body.icon,
                content,
            });

            return { template };
        },
        {
            body: t.Object({
                title: t.String({ minLength: 1, maxLength: 255 }),
                description: t.Optional(t.String({ maxLength: 500 })),
                category: t.Optional(
                    t.Union([
                        t.Literal('work'),
                        t.Literal('personal'),
                        t.Literal('planning'),
                        t.Literal('custom'),
                    ]),
                ),
                icon: t.Optional(t.String()),
                content: t.Optional(
                    t.Object({
                        type: t.String(),
                        content: t.Optional(t.Array(t.Any())),
                        attrs: t.Optional(t.Record(t.String(), t.Any())),
                        text: t.Optional(t.String()),
                    }),
                ),
                pageId: t.Optional(t.String()),
            }),
        },
    )

    // Update template
    .patch(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const template = await updateTemplate(params.id, auth.user._id, body);
            if (!template) {
                set.status = 404;
                return { error: 'Template not found or not authorized' };
            }

            return { template };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                title: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
                description: t.Optional(t.String({ maxLength: 500 })),
                category: t.Optional(
                    t.Union([
                        t.Literal('work'),
                        t.Literal('personal'),
                        t.Literal('planning'),
                        t.Literal('custom'),
                    ]),
                ),
                icon: t.Optional(t.String()),
                content: t.Optional(
                    t.Object({
                        type: t.String(),
                        content: t.Optional(t.Array(t.Any())),
                        attrs: t.Optional(t.Record(t.String(), t.Any())),
                        text: t.Optional(t.String()),
                    }),
                ),
            }),
        },
    )

    // Delete template
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const deleted = await deleteTemplate(params.id, auth.user._id);
            if (!deleted) {
                set.status = 404;
                return { error: 'Template not found or not authorized' };
            }

            return { success: true };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create page from template
    .post(
        '/:id/apply',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const template = await findTemplateById(params.id);
            if (!template) {
                set.status = 404;
                return { error: 'Template not found' };
            }

            // Get notebook name for variable substitution
            let notebookName = body.notebookName ?? '';
            if (!notebookName && body.notebookId) {
                const notebook = await findNotebookById(body.notebookId);
                notebookName = notebook?.name ?? '';
            }

            // Process template variables
            const today = new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
            const pageTitle = body.title ?? template.title;
            const processedContent = processTemplateVariables(template.content, {
                date: today,
                notebook: notebookName,
                title: pageTitle,
            });

            // Create new page with template content
            const page = await createPage(auth.user._id, {
                notebookId: body.notebookId,
                type: 'memo',
                title: pageTitle,
                content: processedContent,
            });

            // Track usage
            await incrementUsageCount(params.id);

            return { page };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                notebookId: t.String(),
                title: t.Optional(t.String()),
                notebookName: t.Optional(t.String()),
            }),
        },
    );
