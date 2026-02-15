import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import {
    createCustomDomain,
    findCustomDomainsByNotebookId,
    findCustomDomainById,
    updateDomainStatus,
    deleteCustomDomain,
    isDomainTaken,
} from '../repositories/custom-domain.repo';
import type { JWTPayload } from '@maple/shared';

export const customDomainRoutes = new Elysia({ prefix: '/api/notebooks' })
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

    // List custom domains for a notebook
    .get(
        '/:id/domains',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'owner');
            if (!notebook) {
                set.status = 404;
                return { error: 'Not found', message: 'Notebook not found' };
            }

            const domains = await findCustomDomainsByNotebookId(params.id);
            return { domains };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Add a custom domain to a notebook
    .post(
        '/:id/domains',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'owner');
            if (!notebook) {
                set.status = 404;
                return { error: 'Not found', message: 'Notebook not found' };
            }

            // Validate domain format
            const domain = body.domain.toLowerCase().trim();
            const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
            if (!domainRegex.test(domain)) {
                set.status = 400;
                return { error: 'Bad request', message: 'Invalid domain format' };
            }

            // Check if domain is already taken
            const taken = await isDomainTaken(domain);
            if (taken) {
                set.status = 409;
                return { error: 'Conflict', message: 'Domain already registered' };
            }

            const customDomain = await createCustomDomain(params.id, auth.user._id, { domain });
            return { domain: customDomain };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                domain: t.String({ minLength: 1, maxLength: 253 }),
            }),
        },
    )

    // Trigger domain verification
    .post(
        '/:id/domains/:domainId/verify',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'owner');
            if (!notebook) {
                set.status = 404;
                return { error: 'Not found', message: 'Notebook not found' };
            }

            const domain = await findCustomDomainById(params.domainId);
            if (!domain || domain.notebookId !== params.id) {
                set.status = 404;
                return { error: 'Not found', message: 'Domain not found' };
            }

            // Set status to verifying
            await updateDomainStatus(params.domainId, 'verifying');

            // Attempt DNS verification (CNAME check)
            try {
                const { resolve } = await import('dns/promises');
                const records = await resolve(domain.domain, 'CNAME');
                const hasCname = records.some(
                    (record) =>
                        record === 'sites.justmaple.app' || record === 'sites.justmaple.app.',
                );

                if (hasCname) {
                    const updated = await updateDomainStatus(params.domainId, 'active', 'active');
                    return { domain: updated ?? { ...domain, status: 'active' }, verified: true };
                } else {
                    await updateDomainStatus(params.domainId, 'pending');
                    return {
                        domain: { ...domain, status: 'pending' },
                        verified: false,
                        message: 'CNAME record not found. Expected: sites.justmaple.app',
                    };
                }
            } catch {
                await updateDomainStatus(params.domainId, 'pending');
                return {
                    domain: { ...domain, status: 'pending' },
                    verified: false,
                    message: 'DNS lookup failed. Please check your DNS configuration.',
                };
            }
        },
        {
            params: t.Object({
                id: t.String(),
                domainId: t.String(),
            }),
        },
    )

    // Remove a custom domain
    .delete(
        '/:id/domains/:domainId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'owner');
            if (!notebook) {
                set.status = 404;
                return { error: 'Not found', message: 'Notebook not found' };
            }

            const deleted = await deleteCustomDomain(params.domainId, params.id);
            if (!deleted) {
                set.status = 404;
                return { error: 'Not found', message: 'Domain not found' };
            }

            return { message: 'Domain removed successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
                domainId: t.String(),
            }),
        },
    );
