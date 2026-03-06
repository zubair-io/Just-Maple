import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageById } from '../repositories/page.repo';
import {
    findCanvasById,
    findOrCreateCanvas,
    updateCanvas,
    addWidget,
    updateWidget,
    removeWidget,
    addConnector,
} from '../repositories/canvas.repo';
import type { JWTPayload } from '@maple/shared';
import {
    generateWidget,
    regenerateWidget as regenerateWidgetAI,
} from '../services/canvas-ai.service';

/**
 * Canvas API routes
 * Handles CRUD operations for canvas-type pages and their widgets
 */
export const canvasRoutes = new Elysia({ prefix: '/api/canvases' })
    .use(jwt({ name: 'jwt', secret: config.jwtSecret }))
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null };
        }

        const token = authHeader.split(' ')[1];
        const payload = (await jwt.verify(token)) as JWTPayload | false;

        if (!payload) {
            return { auth: null };
        }

        const user = await findUserById(payload.sub);
        return { auth: user ? { user } : null };
    })
    /**
     * Get canvas by page ID (auto-creates if missing)
     */
    .get('/:id', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { id } = params;

        // Verify page exists and user has access
        const page = await findPageById(id, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        if (page.type !== 'canvas') {
            set.status = 400;
            return { error: 'Page is not a canvas type' };
        }

        try {
            const canvas = await findOrCreateCanvas(id, page.notebookId || '', auth.user._id);
            return { document: canvas };
        } catch (error) {
            console.error(`[Canvas] Failed to get canvas ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to get canvas' };
        }
    })
    /**
     * Replace full canvas document
     */
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id } = params;

            const page = await findPageById(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            if (page.type !== 'canvas') {
                set.status = 400;
                return { error: 'Page is not a canvas type' };
            }

            try {
                const canvas = await updateCanvas(id, {
                    widgets: body.widgets,
                    connectors: body.connectors,
                });

                if (!canvas) {
                    set.status = 404;
                    return { error: 'Canvas not found' };
                }

                return { document: canvas };
            } catch (error) {
                console.error(`[Canvas] Failed to update canvas ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to update canvas' };
            }
        },
        {
            body: t.Object({
                widgets: t.Array(t.Any()),
                connectors: t.Array(t.Any()),
            }),
        },
    )
    /**
     * Update a specific widget
     */
    .put(
        '/:id/widgets/:widgetId',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id, widgetId } = params;

            const page = await findPageById(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            try {
                const canvas = await updateWidget(id, widgetId, body);

                if (!canvas) {
                    set.status = 404;
                    return { error: 'Canvas or widget not found' };
                }

                const widget = canvas.widgets.find((w) => w.id === widgetId);
                return { widget };
            } catch (error) {
                console.error(`[Canvas] Failed to update widget ${widgetId}:`, error);
                set.status = 500;
                return { error: 'Failed to update widget' };
            }
        },
        {
            body: t.Object({
                title: t.Optional(t.String()),
                template: t.Optional(t.Any()),
                dataPath: t.Optional(t.String()),
                position: t.Optional(
                    t.Object({
                        x: t.Number(),
                        y: t.Number(),
                        w: t.Number(),
                        h: t.Number(),
                    }),
                ),
            }),
        },
    )
    /**
     * Delete a widget from canvas
     */
    .delete('/:id/widgets/:widgetId', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const { id, widgetId } = params;

        const page = await findPageById(id, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        try {
            const canvas = await removeWidget(id, widgetId);

            if (!canvas) {
                set.status = 404;
                return { error: 'Canvas not found' };
            }

            return { success: true };
        } catch (error) {
            console.error(`[Canvas] Failed to delete widget ${widgetId}:`, error);
            set.status = 500;
            return { error: 'Failed to delete widget' };
        }
    })
    /**
     * Generate a widget from a natural language prompt
     * Uses Mercury Bot (or Claude API fallback) to generate a widget template
     */
    .post(
        '/:id/widgets/generate',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id } = params;
            const { prompt } = body;

            const page = await findPageById(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            if (page.type !== 'canvas') {
                set.status = 400;
                return { error: 'Page is not a canvas type' };
            }

            try {
                const widget = await generateWidget(
                    id,
                    page.notebookId || '',
                    auth.user._id,
                    prompt,
                );
                return { widget };
            } catch (error) {
                console.error(`[Canvas] Failed to generate widget:`, error);
                set.status = 500;
                return {
                    error: error instanceof Error ? error.message : 'Failed to generate widget',
                };
            }
        },
        {
            body: t.Object({
                prompt: t.String({ minLength: 1 }),
            }),
        },
    )
    /**
     * Regenerate widget from new prompt
     */
    .put(
        '/:id/widgets/:widgetId/regenerate',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { id, widgetId } = params;
            const { prompt } = body;

            const page = await findPageById(id, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            try {
                const widget = await regenerateWidgetAI(
                    id,
                    widgetId,
                    page.notebookId || '',
                    auth.user._id,
                    prompt,
                );

                // Update the widget in the canvas
                const canvas = await updateWidget(id, widgetId, {
                    title: widget.title,
                    template: widget.template,
                    dataPath: widget.dataPath,
                });

                if (!canvas) {
                    set.status = 404;
                    return { error: 'Canvas or widget not found' };
                }

                return { widget };
            } catch (error) {
                console.error(`[Canvas] Failed to regenerate widget ${widgetId}:`, error);
                set.status = 500;
                return {
                    error: error instanceof Error ? error.message : 'Failed to regenerate widget',
                };
            }
        },
        {
            body: t.Object({
                prompt: t.String({ minLength: 1 }),
            }),
        },
    );
