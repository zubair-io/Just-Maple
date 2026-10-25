import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import {
    RegisterCollectorSchema,
    UploadDeviceItemsSchema,
    MacDataSourceSchema,
    type JWTPayload,
    type MacDataSource,
} from '@maple/shared';
import {
    deleteCollector,
    listCollectors,
    registerCollector,
    setActiveSources,
    touchCollector,
} from '../repositories/collector.repo';
import {
    countDeviceItems,
    deleteDeviceItems,
    findDeviceItem,
    findDeviceItems,
} from '../repositories/device-item.repo';
import { findPageById } from '../repositories/page.repo';
import { applyDeviceUpload, DeviceUploadError } from '../services/device-data.service';
import { bumpDeviceDataVersion } from '../services/device-search.service';

/**
 * Devices (Mac, iPhone) collect the user's personal data and upload it here:
 *
 * - `POST /api/collectors` registers a device and what it can collect.
 * - `POST /api/device-data/items` uploads a batch of items, removals and vectors.
 * - `GET /api/device-data/items` lists items for a device data page, owner only.
 * - `DELETE /api/device-data` removes everything uploaded.
 */

const sourceQuery = t.Union(
    MacDataSourceSchema.anyOf.map((s) => t.Literal(s.const as MacDataSource)),
);

export const deviceDataRoutes = new Elysia({ prefix: '/api' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) return { auth: null as AuthContext | null };
        try {
            const payload = (await jwt.verify(authHeader.slice(7))) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    // MARK: - Collectors

    .get('/collectors', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        const collectors = await listCollectors(auth.user._id);
        return {
            collectors: await Promise.all(
                collectors.map(async (collector) => ({
                    ...collector,
                    itemCounts: await countDeviceItems(auth.user._id, collector.deviceId),
                })),
            ),
        };
    })

    .post(
        '/collectors',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            return { collector: await registerCollector(auth.user._id, body) };
        },
        { body: RegisterCollectorSchema },
    )

    // Heartbeat without uploading: keeps "last seen" fresh on the Devices list.
    .post(
        '/collectors/:deviceId/seen',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            await touchCollector(auth.user._id, params.deviceId, false);
            return { ok: true };
        },
        { params: t.Object({ deviceId: t.String() }) },
    )

    // Make this device the collector for these sources. Items the previous device
    // uploaded for them are removed; this device uploads its own copy next.
    .patch(
        '/collectors/:deviceId',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const { collector, movedFrom } = await setActiveSources(
                auth.user._id,
                params.deviceId,
                body.activeSources,
            );
            if (!collector) {
                set.status = 404;
                return { error: 'Device not found' };
            }
            for (const moved of movedFrom) {
                await deleteDeviceItems(auth.user._id, moved);
            }
            if (movedFrom.length) await bumpDeviceDataVersion(auth.user._id);
            return { collector };
        },
        {
            params: t.Object({ deviceId: t.String() }),
            body: t.Object({ activeSources: t.Array(MacDataSourceSchema, { maxItems: 10 }) }),
        },
    )

    // Forget a device and everything it uploaded.
    .delete(
        '/collectors/:deviceId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const removed = await deleteDeviceItems(auth.user._id, { deviceId: params.deviceId });
            const existed = await deleteCollector(auth.user._id, params.deviceId);
            if (!existed && !removed) {
                set.status = 404;
                return { error: 'Device not found' };
            }
            await bumpDeviceDataVersion(auth.user._id);
            return { removed };
        },
        { params: t.Object({ deviceId: t.String() }) },
    )

    // MARK: - Items

    .post(
        '/device-data/items',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return await applyDeviceUpload(auth.user._id, body);
            } catch (error) {
                if (error instanceof DeviceUploadError) {
                    set.status = error.status;
                    return { error: error.message };
                }
                throw error;
            }
        },
        { body: UploadDeviceItemsSchema },
    )

    // Items for a device data page. Only the page's owner sees them, even in a shared notebook.
    .get(
        '/device-data/items',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            let sources: MacDataSource[] = [query.source];
            if (query.pageId) {
                const page = await findPageById(query.pageId, auth.user._id);
                if (!page || page.type !== 'devicedata' || !page.deviceSource) {
                    set.status = 404;
                    return { error: 'Page not found' };
                }
                if (page.userId !== auth.user._id) {
                    set.status = 403;
                    return { error: 'Only the owner can see this data', ownerOnly: true };
                }
                sources = [page.deviceSource];
            }
            const collector = (await listCollectors(auth.user._id)).find((c) =>
                c.activeSources.includes(sources[0]!),
            );
            const result = await findDeviceItems(auth.user._id, {
                sources,
                search: query.search,
                from: query.from,
                to: query.to,
                limit: query.limit,
                offset: query.offset,
                order: query.order,
            });
            return {
                ...result,
                collector: collector
                    ? {
                          name: collector.name,
                          platform: collector.platform,
                          lastUploadAt: collector.lastUploadAt,
                      }
                    : null,
            };
        },
        {
            query: t.Object({
                source: sourceQuery,
                pageId: t.Optional(t.String()),
                search: t.Optional(t.String({ maxLength: 200 })),
                from: t.Optional(t.Numeric()),
                to: t.Optional(t.Numeric()),
                limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
                offset: t.Optional(t.Numeric({ minimum: 0 })),
                order: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
            }),
        },
    )

    .get(
        '/device-data/items/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const item = await findDeviceItem(auth.user._id, params.id);
            if (!item) {
                set.status = 404;
                return { error: 'Item not found' };
            }
            return { item };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // Remove everything the user's devices uploaded. Devices stop uploading until
    // they're switched back on (their active sources are cleared).
    .delete('/device-data', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        const removed = await deleteDeviceItems(auth.user._id);
        for (const collector of await listCollectors(auth.user._id)) {
            await setActiveSources(auth.user._id, collector.deviceId, []);
        }
        await bumpDeviceDataVersion(auth.user._id);
        return { removed };
    });
