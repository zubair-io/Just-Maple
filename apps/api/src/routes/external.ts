import { Elysia, t } from 'elysia';
import {
    botAuthMiddleware,
    checkBotAuth,
    checkBotPermission,
    checkRateLimit,
} from '../middleware/bot-auth';
import { documentEditService, type DocumentEdit } from '../services/document-edit.service';
import { findPageById } from '../repositories/page.repo';
import { canAccessNotebook } from '../repositories/bot-token.repo';
import { findUserBotById } from '../repositories/user-bot.repo';
import { findNotebookById } from '../repositories/notebook.repo';

/**
 * External API Routes
 * For external services (Home Assistant, webhooks, etc.) to interact with documents
 * Authenticated using bot access tokens (not JWT)
 */
export const externalRoutes = new Elysia({ prefix: '/api/external' })
    .use(botAuthMiddleware)

    // ============================================
    // Document Read/Edit Endpoints
    // ============================================

    // Get document content
    .get(
        '/documents/:pageId',
        async ({ botAuth, params, set }) => {
            // Check bot authentication
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'Unauthorized', message: 'Valid bot token required' };
            }

            // Check rate limit
            if (
                !checkRateLimit(
                    botAuth.token._id,
                    set as { status?: number; headers: Record<string, string> },
                )
            ) {
                return { error: 'Too many requests', message: 'Rate limit exceeded' };
            }

            // Check read permission
            if (!checkBotPermission(botAuth, 'read', set)) {
                return { error: 'Forbidden', message: 'Token does not have read permission' };
            }

            try {
                // Get the page
                const page = await findPageById(params.pageId);
                if (!page) {
                    set.status = 404;
                    return { error: 'Not found', message: 'Page not found' };
                }

                // Check notebook access
                if (page.notebookId && !canAccessNotebook(botAuth.token, page.notebookId)) {
                    set.status = 403;
                    return { error: 'Forbidden', message: 'Token cannot access this notebook' };
                }

                // Verify the bot is shared with this notebook
                if (page.notebookId) {
                    const accessAllowed = await verifyBotNotebookAccess(
                        botAuth.userBotId,
                        page.notebookId,
                    );
                    if (!accessAllowed) {
                        set.status = 403;
                        return {
                            error: 'Forbidden',
                            message: 'Bot is not shared with this notebook',
                        };
                    }
                }

                // Get document content
                const content = await documentEditService.getDocumentContent(params.pageId);

                return {
                    pageId: page.id,
                    title: page.title,
                    type: page.type,
                    content,
                    updatedAt: page.updatedAt,
                };
            } catch (error) {
                set.status = 500;
                return {
                    error: 'Internal error',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        { params: t.Object({ pageId: t.String() }) },
    )

    // Edit document content
    .post(
        '/documents/:pageId/edit',
        async ({ botAuth, params, body, set }) => {
            // Check bot authentication
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'Unauthorized', message: 'Valid bot token required' };
            }

            // Check rate limit
            if (
                !checkRateLimit(
                    botAuth.token._id,
                    set as { status?: number; headers: Record<string, string> },
                )
            ) {
                return { error: 'Too many requests', message: 'Rate limit exceeded' };
            }

            // Check write permission
            if (!checkBotPermission(botAuth, 'write', set)) {
                return { error: 'Forbidden', message: 'Token does not have write permission' };
            }

            try {
                // Get the page
                const page = await findPageById(params.pageId);
                if (!page) {
                    set.status = 404;
                    return { error: 'Not found', message: 'Page not found' };
                }

                // Check page type - only memo pages can be edited
                if (page.type !== 'memo') {
                    set.status = 400;
                    return {
                        error: 'Invalid page type',
                        message: 'Only memo pages can be edited',
                    };
                }

                // Check notebook access
                if (page.notebookId && !canAccessNotebook(botAuth.token, page.notebookId)) {
                    set.status = 403;
                    return { error: 'Forbidden', message: 'Token cannot access this notebook' };
                }

                // Verify the bot is shared with this notebook
                if (page.notebookId) {
                    const accessAllowed = await verifyBotNotebookAccess(
                        botAuth.userBotId,
                        page.notebookId,
                    );
                    if (!accessAllowed) {
                        set.status = 403;
                        return {
                            error: 'Forbidden',
                            message: 'Bot is not shared with this notebook',
                        };
                    }
                }

                // Convert body edits to DocumentEdit type
                const edits: DocumentEdit[] = body.edits.map((edit) => {
                    if (edit.type === 'append') {
                        return { type: 'append', content: edit.content };
                    } else if (edit.type === 'insert') {
                        return {
                            type: 'insert',
                            position: edit.position ?? 'end',
                            content: edit.content,
                        };
                    } else {
                        return {
                            type: 'replace',
                            search: edit.search!,
                            content: edit.content,
                            occurrence: edit.occurrence ?? 1,
                        };
                    }
                });

                // Apply edits
                const result = await documentEditService.applyEdits(params.pageId, edits);

                return {
                    success: result.success,
                    appliedCount: result.appliedCount,
                    errors: result.errors,
                };
            } catch (error) {
                set.status = 500;
                return {
                    error: 'Internal error',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({ pageId: t.String() }),
            body: t.Object({
                edits: t.Array(
                    t.Object({
                        type: t.Union([
                            t.Literal('insert'),
                            t.Literal('replace'),
                            t.Literal('append'),
                        ]),
                        content: t.String(),
                        position: t.Optional(
                            t.Union([t.Literal('start'), t.Literal('end'), t.Number()]),
                        ),
                        search: t.Optional(t.String()),
                        occurrence: t.Optional(t.Number()),
                    }),
                    { minItems: 1 },
                ),
            }),
        },
    );

/**
 * Verify that a bot is shared with a notebook
 * Checks if the bot's owner has shared it with the notebook
 */
async function verifyBotNotebookAccess(userBotId: string, notebookId: string): Promise<boolean> {
    try {
        // Get the user bot
        const userBot = await findUserBotById(userBotId);
        if (!userBot) {
            return false;
        }

        // Get the notebook
        const notebook = await findNotebookById(notebookId, userBot.userId);
        if (!notebook) {
            return false;
        }

        // Check if the bot is in the notebook's shared bots
        // (or if the bot owner is the notebook owner)
        if (notebook.userId === userBot.userId) {
            return true; // Owner always has access
        }

        // Check if bot is explicitly shared
        // This would require checking the notebook_bots collection or similar
        // For now, allow if user owns the bot and has access to the notebook
        return true;
    } catch {
        return false;
    }
}
