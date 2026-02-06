import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import * as Y from 'yjs';
import { config } from '../config';
import { findUserById } from '../repositories/user.repo';
import { findPageById } from '../repositories/page.repo';
import {
    listMemoVersions,
    getMemoVersion,
    getMemoVersionState,
} from '../repositories/memo-version.repo';
import { createSnapshot, createSnapshotFromState } from '../services/memo-version.service';
import { yjsDocumentService } from '../services/yjs-document.service';
import { updateMemoForYJS } from '../repositories/memo.repo';
import type { JWTPayload } from '@maple/shared';

/**
 * Memo Versions API routes
 * Handles version history for memos
 */
export const memoVersionRoutes = new Elysia({ prefix: '/api/memos' })
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
     * List versions for a memo
     */
    .get(
        '/:id/versions',
        async ({ auth, params, query, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const noteId = params.id;
            const limit = query.limit ? parseInt(query.limit, 10) : 20;
            const before = query.before ? new Date(query.before) : undefined;

            // Verify page exists and user has access
            const page = await findPageById(noteId, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Verify it's a memo type
            if (page.type !== 'memo') {
                set.status = 400;
                return { error: 'Page type does not support versions' };
            }

            try {
                const result = await listMemoVersions(noteId, limit, before);
                return result;
            } catch (error) {
                console.error(`[MemoVersions] Failed to list versions for ${noteId}:`, error);
                set.status = 500;
                return { error: 'Failed to list versions' };
            }
        },
        {
            query: t.Object({
                limit: t.Optional(t.String()),
                before: t.Optional(t.String()),
            }),
        },
    )
    /**
     * Get a specific version with full state
     */
    .get('/:id/versions/:versionId', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const noteId = params.id;
        const { versionId } = params;

        // Verify page exists and user has access
        const page = await findPageById(noteId, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        try {
            const version = await getMemoVersion(noteId, versionId);
            if (!version) {
                set.status = 404;
                return { error: 'Version not found' };
            }

            // Convert state to base64 for transmission
            const stateBase64 = Buffer.from(version.state as any).toString('base64');

            return {
                ...version,
                state: stateBase64,
            };
        } catch (error) {
            console.error(`[MemoVersions] Failed to get version ${versionId}:`, error);
            set.status = 500;
            return { error: 'Failed to get version' };
        }
    })
    /**
     * Restore a version
     * Creates a new version snapshot before restoring (so restore can be undone)
     */
    .post('/:id/versions/:versionId/restore', async ({ auth, params, set }) => {
        if (!auth) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const noteId = params.id;
        const { versionId } = params;

        // Verify page exists and user has access
        const page = await findPageById(noteId, auth.user._id);
        if (!page) {
            set.status = 404;
            return { error: 'Page not found' };
        }

        // Verify it's a memo type
        if (page.type !== 'memo') {
            set.status = 400;
            return { error: 'Page type does not support versions' };
        }

        try {
            // Get the version to restore
            const versionState = await getMemoVersionState(noteId, versionId);
            if (!versionState) {
                set.status = 404;
                return { error: 'Version not found' };
            }

            const version = await getMemoVersion(noteId, versionId);
            if (!version) {
                set.status = 404;
                return { error: 'Version not found' };
            }

            // Create a snapshot of current state before restoring (so restore can be undone)
            const currentYdoc = await yjsDocumentService.getOrCreateDoc(noteId);
            await createSnapshot(noteId, currentYdoc, 'manual', 'Before restore');

            // Create a new Y.Doc with the restored state
            const restoredDoc = new Y.Doc();
            Y.applyUpdate(restoredDoc, versionState);

            // Persist the restored state
            const restoredState = Y.encodeStateAsUpdate(restoredDoc);
            const updatedMemo = await updateMemoForYJS(noteId, restoredState);

            // Reload the document in the YJS service
            yjsDocumentService.discardDocument(noteId);

            restoredDoc.destroy();

            console.log(`[MemoVersions] Restored ${noteId} to version ${versionId}`);

            return {
                success: true,
                newVersion: updatedMemo?.version ?? 0,
                restoredFrom: version.version,
            };
        } catch (error) {
            console.error(`[MemoVersions] Failed to restore version ${versionId}:`, error);
            set.status = 500;
            return { error: 'Failed to restore version' };
        }
    })
    /**
     * Create a manual checkpoint
     */
    .post(
        '/:id/versions',
        async ({ auth, params, body, set }) => {
            if (!auth) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const noteId = params.id;
            const { label } = body;

            // Verify page exists and user has access
            const page = await findPageById(noteId, auth.user._id);
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }

            // Verify it's a memo type
            if (page.type !== 'memo') {
                set.status = 400;
                return { error: 'Page type does not support versions' };
            }

            try {
                const ydoc = await yjsDocumentService.getOrCreateDoc(noteId);
                const version = await createSnapshot(noteId, ydoc, 'manual', label);

                console.log(`[MemoVersions] Created manual checkpoint for ${noteId}`);

                return { version };
            } catch (error) {
                console.error(`[MemoVersions] Failed to create checkpoint for ${noteId}:`, error);
                set.status = 500;
                return { error: 'Failed to create checkpoint' };
            }
        },
        {
            body: t.Object({
                label: t.Optional(t.String()),
            }),
        },
    );
