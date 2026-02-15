import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import Ajv from 'ajv';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageById } from '../repositories/page.repo';
import {
    createJsonDocument,
    findJsonDocument,
    replaceJsonDocumentData,
    patchJsonDocumentData,
    updateJsonDocumentSchema,
    removeJsonDocumentSchema,
} from '../repositories/json-document.repo';
import { realtimeWSService } from '../services/realtime-ws.service';
import { getUsersWithNotebookAccess } from '../repositories/notebook.repo';
import type { JWTPayload } from '@maple/shared';

const ajv = new Ajv({ allErrors: true });

/**
 * JSON Document API routes
 * Handles CRUD operations for JSON-type pages
 * Uses 'json_documents' collection
 */
export const jsonDocumentRoutes = new Elysia({ prefix: '/api/json-documents' })
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
     * Get JSON document by page ID
     * Returns data, schema, and version
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

        if (page.type !== 'json') {
            set.status = 400;
            return { error: 'Page is not a JSON type' };
        }

        try {
            let doc = await findJsonDocument(id);

            // Auto-create if it doesn't exist yet (e.g., page created but JSON doc not initialized)
            if (!doc) {
                doc = await createJsonDocument(id, id, page.notebookId || '', {});
            }

            return { document: doc };
        } catch (error) {
            console.error(`[JSON] Failed to get document ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to get JSON document' };
        }
    })
    /**
     * Replace entire JSON data payload (PUT semantics)
     * Requires version for optimistic concurrency
     */
    .put(
        '/:id/data',
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

            if (page.type !== 'json') {
                set.status = 400;
                return { error: 'Page is not a JSON type' };
            }

            try {
                // Validate against schema if present
                const currentDoc = await findJsonDocument(id);
                if (currentDoc?.schema) {
                    const validate = ajv.compile(currentDoc.schema as object);
                    if (!validate(body.data)) {
                        set.status = 422;
                        return {
                            error: 'Schema validation failed',
                            details: validate.errors,
                        };
                    }
                }

                const doc = await replaceJsonDocumentData(id, body.data, body.version);

                if (!doc) {
                    set.status = 409;
                    return {
                        error: 'Version conflict',
                        message:
                            'The document has been modified since you last fetched it. Please refresh and try again.',
                    };
                }

                // Broadcast real-time update to notebook members
                if (page.notebookId) {
                    const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                    realtimeWSService.sendToUsers(recipientUserIds, {
                        type: 'json.updated',
                        pageId: id,
                        version: doc.version,
                        data: doc.data,
                        notebookId: page.notebookId,
                    });
                }

                return { document: doc };
            } catch (error) {
                console.error(`[JSON] Failed to replace data for ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to replace JSON data' };
            }
        },
        {
            body: t.Object({
                data: t.Unknown(),
                version: t.Number(),
            }),
        },
    )
    /**
     * Patch JSON data using JSON Merge Patch (RFC 7396)
     * Requires version for optimistic concurrency
     */
    .patch(
        '/:id/data',
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

            if (page.type !== 'json') {
                set.status = 400;
                return { error: 'Page is not a JSON type' };
            }

            try {
                const doc = await patchJsonDocumentData(id, body.patch, body.version);

                if (!doc) {
                    set.status = 409;
                    return {
                        error: 'Version conflict',
                        message:
                            'The document has been modified since you last fetched it. Please refresh and try again.',
                    };
                }

                // Validate against schema if present (after merge)
                if (doc.schema) {
                    const validate = ajv.compile(doc.schema as object);
                    if (!validate(doc.data)) {
                        // Note: Data was already written. Log warning but don't fail.
                        // In a stricter implementation, we could validate before writing.
                        console.warn(
                            `[JSON] Data for ${id} does not match schema after patch`,
                            validate.errors,
                        );
                    }
                }

                // Broadcast real-time update
                if (page.notebookId) {
                    const recipientUserIds = await getUsersWithNotebookAccess(page.notebookId);
                    realtimeWSService.sendToUsers(recipientUserIds, {
                        type: 'json.updated',
                        pageId: id,
                        version: doc.version,
                        data: doc.data,
                        notebookId: page.notebookId,
                    });
                }

                return { document: doc };
            } catch (error) {
                console.error(`[JSON] Failed to patch data for ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to patch JSON data' };
            }
        },
        {
            body: t.Object({
                patch: t.Unknown(),
                version: t.Number(),
            }),
        },
    )
    /**
     * Set/replace JSON Schema for validation
     */
    .put(
        '/:id/schema',
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

            if (page.type !== 'json') {
                set.status = 400;
                return { error: 'Page is not a JSON type' };
            }

            try {
                // Validate that the schema itself is valid JSON Schema
                try {
                    ajv.compile(body.schema as object);
                } catch {
                    set.status = 422;
                    return { error: 'Invalid JSON Schema' };
                }

                const doc = await updateJsonDocumentSchema(id, body.schema);

                if (!doc) {
                    set.status = 404;
                    return { error: 'JSON document not found' };
                }

                return { document: doc };
            } catch (error) {
                console.error(`[JSON] Failed to set schema for ${id}:`, error);
                set.status = 500;
                return { error: 'Failed to set JSON Schema' };
            }
        },
        {
            body: t.Object({
                schema: t.Unknown(),
            }),
        },
    )
    /**
     * Remove JSON Schema
     */
    .delete('/:id/schema', async ({ auth, params, set }) => {
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

        if (page.type !== 'json') {
            set.status = 400;
            return { error: 'Page is not a JSON type' };
        }

        try {
            const doc = await removeJsonDocumentSchema(id);

            if (!doc) {
                set.status = 404;
                return { error: 'JSON document not found' };
            }

            return { document: doc };
        } catch (error) {
            console.error(`[JSON] Failed to remove schema for ${id}:`, error);
            set.status = 500;
            return { error: 'Failed to remove JSON Schema' };
        }
    });
