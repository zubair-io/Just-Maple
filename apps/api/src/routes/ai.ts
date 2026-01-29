import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import { checkRateLimit, incrementUsage, getUserUsage } from '../repositories/ai-usage.repo';
import { aiWritingService } from '../services/ai-writing.service';
import type { JWTPayload, AIWritingType } from '@maple/shared';

const AI_WRITING_TYPES: AIWritingType[] = [
    'continue',
    'improve',
    'simplify',
    'expand',
    'shorten',
    'summarize',
    'grammar',
    'translate',
    'custom',
];

export const aiRoutes = new Elysia({ prefix: '/api/ai' })
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

    // ============================================
    // AI Generation with SSE Streaming
    // ============================================
    .post(
        '/generate/:notebookId',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify notebook access
            const notebook = await findNotebookByIdWithAccess(
                params.notebookId,
                auth.user._id,
                'write',
            );
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found or access denied' };
            }

            // Check rate limit
            const rateLimit = await checkRateLimit(auth.user._id);
            if (!rateLimit.allowed) {
                set.status = 429;
                return {
                    error: 'Rate limit exceeded',
                    resetAt: rateLimit.resetAt,
                    remaining: rateLimit.remaining,
                };
            }

            // Validate type
            if (!AI_WRITING_TYPES.includes(body.type as AIWritingType)) {
                set.status = 400;
                return { error: `Invalid type. Must be one of: ${AI_WRITING_TYPES.join(', ')}` };
            }

            // Return SSE stream
            set.headers['Content-Type'] = 'text/event-stream';
            set.headers['Cache-Control'] = 'no-cache';
            set.headers['Connection'] = 'keep-alive';

            // Create readable stream for SSE
            const stream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    let totalTokens = 0;

                    try {
                        for await (const event of aiWritingService.generateStream(
                            params.notebookId,
                            {
                                type: body.type as AIWritingType,
                                selection: body.selection,
                                context: body.context,
                                instruction: body.instruction,
                                targetLanguage: body.targetLanguage,
                                pageId: body.pageId,
                            },
                        )) {
                            if (event.type === 'token') {
                                const data = JSON.stringify(event.data);
                                controller.enqueue(
                                    encoder.encode(`event: token\ndata: ${data}\n\n`),
                                );
                            } else if (event.type === 'done') {
                                const doneData = event.data as {
                                    tokensUsed: number;
                                    finishReason: string;
                                };
                                totalTokens = doneData.tokensUsed;
                                const data = JSON.stringify(doneData);
                                controller.enqueue(
                                    encoder.encode(`event: done\ndata: ${data}\n\n`),
                                );
                            } else if (event.type === 'error') {
                                const data = JSON.stringify(event.data);
                                controller.enqueue(
                                    encoder.encode(`event: error\ndata: ${data}\n\n`),
                                );
                            }
                        }

                        // Track usage (estimate input tokens as context length / 4)
                        const inputTokens = Math.ceil((body.context?.length || 0) / 4);
                        await incrementUsage(auth.user._id, inputTokens, totalTokens);
                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                        const data = JSON.stringify({ error: errorMsg });
                        controller.enqueue(encoder.encode(`event: error\ndata: ${data}\n\n`));
                    } finally {
                        controller.close();
                    }
                },
            });

            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                },
            });
        },
        {
            params: t.Object({ notebookId: t.String() }),
            body: t.Object({
                type: t.String(),
                selection: t.Optional(t.String()),
                context: t.String(),
                instruction: t.Optional(t.String()),
                targetLanguage: t.Optional(t.String()),
                pageId: t.Optional(t.String()),
            }),
        },
    )

    // ============================================
    // AI Usage Statistics
    // ============================================
    .get('/usage', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const usage = await getUserUsage(auth.user._id);
        return { usage };
    });
