import { Elysia, t } from 'elysia';
import {
    type BotAuthContext,
    checkBotAuth,
    checkBotPermission,
    checkBotNotebookAccess,
} from '../../middleware/bot-auth';
import { findPageByIdForBot } from '../../repositories/page.repo';
import { findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import {
    documentEditService,
    type AIEdit,
    type AIEditOp,
    type JSONContent,
} from '../../services/document-edit.service';
import { markdownToProseMirror } from '../../utils/markdown-to-prosemirror';
import { verifyBotJWT } from '../../services/bot-jwt.service';
import { verifyToken } from '../../repositories/bot-token.repo';

/**
 * Bot Memos API
 *
 * API endpoints for bots to read and edit memo documents.
 * Supports both bot JWT and access token authentication.
 *
 * Endpoints:
 *   GET  /api/bots/pages/:pageId/document       - Read memo content as ProseMirror JSON
 *   POST /api/bots/pages/:pageId/document/edit   - Apply path-based edits
 *   PUT  /api/bots/pages/:pageId/document        - Replace entire document content
 */
export const botMemosRoutes = new Elysia({ prefix: '/api/bots' })
    // Inline bot auth - derive context for all routes (same pattern as messages API)
    .derive(async ({ request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { botAuth: null as BotAuthContext | null };
        }

        const bearerToken = authHeader.slice(7);

        try {
            // Try JWT first (custom bots)
            const jwtPayload = await verifyBotJWT(bearerToken);
            if (jwtPayload) {
                return {
                    botAuth: {
                        authType: 'jwt',
                        jwtPayload,
                        userBotId: jwtPayload.sub,
                        userId: jwtPayload.userId,
                        permissions: jwtPayload.permissions,
                    } as BotAuthContext,
                };
            }

            // Fall back to access token (template bots)
            const token = await verifyToken(bearerToken);
            if (!token) {
                return { botAuth: null as BotAuthContext | null };
            }

            return {
                botAuth: {
                    authType: 'token',
                    token,
                    userBotId: token.userBotId,
                    userId: token.userId,
                } as BotAuthContext,
            };
        } catch (error) {
            console.error('[BotMemos] Auth error:', error);
            return { botAuth: null as BotAuthContext | null };
        }
    })

    // ============================================
    // GET /api/bots/pages/:pageId/document
    // Read memo document content as ProseMirror JSON
    // ============================================
    .get(
        '/pages/:pageId/document',
        async ({ botAuth, params, set }) => {
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'auth/missing_token', message: 'Bot authentication required' };
            }

            if (!checkBotPermission(botAuth, 'read', set, 'memos')) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Memo read permission required',
                };
            }

            const page = await findPageByIdForBot(params.pageId);
            if (!page) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Page not found' };
            }

            if (page.type !== 'memo') {
                set.status = 400;
                return {
                    error: 'resource/invalid_type',
                    message: 'Only memo pages can be read via this endpoint',
                };
            }

            const notebookId = page.notebookId;
            if (!notebookId || !(await checkBotNotebookAccess(botAuth, notebookId, set))) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Bot cannot access this notebook',
                };
            }

            try {
                const document = await documentEditService.getDocumentAsJSON(params.pageId);

                return {
                    page_id: page.id,
                    title: page.title,
                    type: page.type,
                    document,
                    updated_at: page.updatedAt,
                };
            } catch (error) {
                set.status = 500;
                return {
                    error: 'server/internal',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({ pageId: t.String() }),
        },
    )

    // ============================================
    // PUT /api/bots/pages/:pageId/document
    // Replace entire document content
    // Accepts markdown or ProseMirror JSON
    // ============================================
    .put(
        '/pages/:pageId/document',
        async ({ botAuth, params, body, set }) => {
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'auth/missing_token', message: 'Bot authentication required' };
            }

            if (!checkBotPermission(botAuth, 'write', set, 'memos')) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Memo write permission required',
                };
            }

            const page = await findPageByIdForBot(params.pageId);
            if (!page) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Page not found' };
            }

            if (page.type !== 'memo') {
                set.status = 400;
                return {
                    error: 'resource/invalid_type',
                    message: 'Only memo pages can be edited via this endpoint',
                };
            }

            const notebookId = page.notebookId;
            if (!notebookId || !(await checkBotNotebookAccess(botAuth, notebookId, set))) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Bot cannot access this notebook',
                };
            }

            try {
                // Convert content to ProseMirror JSON if needed
                let prosemirrorContent: JSONContent;

                if (body.content_type === 'prosemirror') {
                    prosemirrorContent = body.content as unknown as JSONContent;
                } else {
                    // Default: treat as markdown
                    const markdown =
                        typeof body.content === 'string'
                            ? body.content
                            : JSON.stringify(body.content);
                    prosemirrorContent = markdownToProseMirror(markdown) as unknown as JSONContent;
                }

                const result = await documentEditService.replaceDocument(
                    params.pageId,
                    prosemirrorContent,
                );

                // Update page title if provided
                if (body.title) {
                    const { getDb } = await import('../../db/client');
                    await getDb()
                        .collection('pages')
                        .updateOne(
                            { id: params.pageId },
                            { $set: { title: body.title, updatedAt: new Date() } },
                        );
                }

                return {
                    success: result.success,
                    page_id: page.id,
                    errors: result.errors,
                };
            } catch (error) {
                set.status = 500;
                return {
                    error: 'server/internal',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({ pageId: t.String() }),
            body: t.Object({
                content: t.Union([t.String(), t.Record(t.String(), t.Any())]),
                content_type: t.Optional(
                    t.Union([t.Literal('markdown'), t.Literal('prosemirror')]),
                ),
                title: t.Optional(t.String()),
            }),
        },
    )

    // ============================================
    // POST /api/bots/pages/:pageId/document/edit
    // Apply path-based edits to memo document
    // ============================================
    .post(
        '/pages/:pageId/document/edit',
        async ({ botAuth, params, body, set }) => {
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'auth/missing_token', message: 'Bot authentication required' };
            }

            if (!checkBotPermission(botAuth, 'write', set, 'memos')) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Memo write permission required',
                };
            }

            const page = await findPageByIdForBot(params.pageId);
            if (!page) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Page not found' };
            }

            if (page.type !== 'memo') {
                set.status = 400;
                return {
                    error: 'resource/invalid_type',
                    message: 'Only memo pages can be edited via this endpoint',
                };
            }

            const notebookId = page.notebookId;
            if (!notebookId || !(await checkBotNotebookAccess(botAuth, notebookId, set))) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Bot cannot access this notebook',
                };
            }

            try {
                const edits: AIEdit[] = body.edits.map((edit) => ({
                    path: edit.path,
                    op: edit.op as AIEditOp,
                }));

                const result = await documentEditService.applyAIEdits(params.pageId, edits);

                return {
                    success: result.success,
                    applied_count: result.appliedCount,
                    errors: result.errors,
                };
            } catch (error) {
                set.status = 500;
                return {
                    error: 'server/internal',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({ pageId: t.String() }),
            body: t.Object({
                edits: t.Array(
                    t.Object({
                        path: t.Array(t.Number()),
                        op: t.Union([
                            t.Object({
                                type: t.Literal('replace-text'),
                                offset: t.Number(),
                                length: t.Number(),
                                text: t.String(),
                            }),
                            t.Object({
                                type: t.Literal('insert-text'),
                                offset: t.Number(),
                                text: t.String(),
                            }),
                            t.Object({
                                type: t.Literal('delete-text'),
                                offset: t.Number(),
                                length: t.Number(),
                            }),
                            t.Object({
                                type: t.Literal('search-replace'),
                                search: t.String(),
                                replace: t.String(),
                            }),
                            t.Object({
                                type: t.Literal('replace-node'),
                                content: t.Any(),
                            }),
                            t.Object({
                                type: t.Literal('insert-node'),
                                index: t.Number(),
                                content: t.Any(),
                            }),
                            t.Object({ type: t.Literal('delete-node') }),
                            t.Object({
                                type: t.Literal('set-attrs'),
                                attrs: t.Record(t.String(), t.Any()),
                            }),
                            t.Object({
                                type: t.Literal('format-text'),
                                offset: t.Number(),
                                length: t.Number(),
                                mark: t.String(),
                                value: t.Any(),
                            }),
                        ]),
                    }),
                    { minItems: 1 },
                ),
            }),
        },
    );
