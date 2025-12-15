import { Elysia, t } from 'elysia';
import {
    findAllRegistries,
    findRegistryById,
    findRegistryByUpc,
    findRegistryByProviderId,
    searchRegistries,
} from '../repositories/collectible-registry.repo';

// Public routes - no auth required
export const collectibleRegistryRoutes = new Elysia({ prefix: '/api/collectible-registry' })
    // List all registries (supports incremental sync via updatedAt param)
    .get(
        '/',
        async ({ query }) => {
            const registries = await findAllRegistries({
                provider: query.provider,
                limit: query.limit ? parseInt(query.limit) : undefined,
                offset: query.offset ? parseInt(query.offset) : 0,
                updatedAt: query.updatedAt, // ISO timestamp for incremental sync
            });
            return { registries };
        },
        {
            query: t.Object({
                provider: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                offset: t.Optional(t.String()),
                updatedAt: t.Optional(t.String()), // ISO timestamp - returns only items updated after this
            }),
        },
    )

    // Search registries
    .get(
        '/search',
        async ({ query, set }) => {
            if (!query.q) {
                set.status = 400;
                return { error: 'Search query required', message: 'Provide a "q" parameter' };
            }
            const registries = await searchRegistries(query.q, {
                provider: query.provider,
                limit: query.limit ? parseInt(query.limit) : 20,
            });
            return { registries };
        },
        {
            query: t.Object({
                q: t.Optional(t.String()),
                provider: t.Optional(t.String()),
                limit: t.Optional(t.String()),
            }),
        },
    )

    // Get by UPC
    .get(
        '/upc/:upc',
        async ({ params, set }) => {
            const registry = await findRegistryByUpc(params.upc);

            if (!registry) {
                set.status = 404;
                return { error: 'Not found', message: 'No item found with this UPC' };
            }

            return { registry };
        },
        {
            params: t.Object({
                upc: t.String(),
            }),
        },
    )

    // Get by provider ID
    .get(
        '/provider/:provider/:providerId',
        async ({ params, set }) => {
            const registry = await findRegistryByProviderId(params.provider, params.providerId);

            if (!registry) {
                set.status = 404;
                return { error: 'Not found', message: 'No item found with this provider ID' };
            }

            return { registry };
        },
        {
            params: t.Object({
                provider: t.String(),
                providerId: t.String(),
            }),
        },
    )

    // Get single registry by ID
    .get(
        '/:id',
        async ({ params, set }) => {
            const registry = await findRegistryById(params.id);

            if (!registry) {
                set.status = 404;
                return { error: 'Not found' };
            }

            return { registry };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
