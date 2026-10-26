import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import {
    RegisterCollectorSchema,
    UploadDeviceItemsSchema,
    UploadTravelEstimatesSchema,
    MacDataSourceSchema,
    UpdateDeviceDataPageSchema,
    type DeviceDataAccess,
    type JWTPayload,
    type MacDataSource,
} from '@maple/shared';
import { saveTravelEstimates } from '../repositories/travel-estimate.repo';
import {
    deleteCollector,
    findCollector,
    disableAllSources,
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
import { findDeviceDataPages, findPageById, updatePage } from '../repositories/page.repo';
import {
    describeAccess,
    isMemberOf,
    loadDataPageView,
    filterOptionsFor,
    itemMatcherFor,
    itemQueryFor,
} from '../services/device-data-access.service';
import { getUsersWithNotebookAccess } from '../repositories/notebook.repo';
import { realtimeWSService } from '../services/realtime-ws.service';
import { applyDeviceUpload, DeviceUploadError } from '../services/device-data.service';
import { bumpDeviceDataVersion } from '../services/device-search.service';

/**
 * Devices (Mac, iPhone) collect the user's personal data and upload it here:
 *
 * - `POST /api/collectors` registers a device and what it can collect.
 * - `POST /api/device-data/items` uploads a batch of items, removals and vectors.
 * - `GET /api/device-data/items` lists items for a device data page, through its filter.
 * - `PATCH /api/device-data/pages/:id` changes a page's name, description and filter (creator only).
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

    // Upcoming events with a location, for the iPhone to estimate travel time (owner's own).
    .get(
        '/device-data/upcoming',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const now = Math.floor(Date.now() / 1000);
            const hours = Math.min(Math.max(query.hours ?? 12, 1), 48);
            const { items } = await findDeviceItems(auth.user._id, {
                sources: ['calendar'],
                from: now - 3600,
                to: now + hours * 3600,
                limit: 200,
                order: 'asc',
            });
            return {
                events: items
                    .filter((item) => !!item.location?.trim() && !item.allDay)
                    .filter((item) => (item.endAt ?? item.occurredAt) >= now)
                    .slice(0, 30)
                    .map((item) => ({
                        id: item.id,
                        title: item.title,
                        location: item.location!.trim(),
                        start: item.occurredAt,
                        ...(item.endAt !== undefined ? { end: item.endAt } : {}),
                    })),
            };
        },
        { query: t.Object({ hours: t.Optional(t.Numeric({ minimum: 1, maximum: 48 })) }) },
    )

    // Driving times to those events, from where the phone is now.
    .post(
        '/device-data/travel',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await findCollector(auth.user._id, body.deviceId))) {
                set.status = 404;
                return { error: 'Register this device first' };
            }
            if (body.estimates.some((e) => !Number.isFinite(Date.parse(e.computedAt)))) {
                set.status = 400;
                return { error: 'Invalid estimate', message: 'computedAt must be an ISO date' };
            }
            return {
                saved: await saveTravelEstimates(auth.user._id, body.deviceId, body.estimates),
            };
        },
        { body: UploadTravelEstimatesSchema },
    )

    // Items: the user's own for a source, or a data page's, through the page's filter.
    // Everyone in the notebook can read a page that has a filter; the creator manages it.
    .get(
        '/device-data/items',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            let sources: MacDataSource[] = [query.source];
            let ownerId = auth.user._id;
            let pageQuery: Awaited<ReturnType<typeof itemQueryFor>> | undefined;
            let access: DeviceDataAccess | undefined;
            if (query.pageId) {
                const page = await findPageById(query.pageId, auth.user._id);
                const view = page ? await loadDataPageView(page, auth.user._id) : null;
                if (!view) {
                    set.status = 404;
                    return { error: 'Page not found' };
                }
                access = await describeAccess(view);
                if (!view.visible) {
                    set.status = 403;
                    return { error: 'Only the owner can see this data', ownerOnly: true, access };
                }
                sources = [view.source];
                ownerId = view.ownerId;
                pageQuery = await itemQueryFor(view);
                if (!pageQuery) {
                    return { items: [], total: 0, collector: null, access };
                }
            }
            // Which device collects it: shown to the person whose data it is.
            const collector =
                ownerId === auth.user._id
                    ? (await listCollectors(ownerId)).find((c) =>
                          c.activeSources.includes(sources[0]!),
                      )
                    : undefined;
            const result = await findDeviceItems(ownerId, {
                sources,
                search: query.search,
                from: query.from,
                to: query.to,
                limit: query.limit,
                offset: query.offset,
                order: query.order,
                ...pageQuery,
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
                ...(access ? { access } : {}),
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

    // The user's data pages in notebooks they're no longer in: nobody sees them there, and
    // only the user can delete them.
    .get('/device-data/pages/left', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        const pages = await findDeviceDataPages(auth.user._id);
        const left = [];
        for (const page of pages) {
            if (page.notebookId && !(await isMemberOf(page.notebookId, auth.user._id))) {
                left.push(page);
            }
        }
        return { pages: left };
    })

    // Choices for a data page's filter, from the creator's own data.
    .get(
        '/device-data/pages/:id/options',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const page = await findPageById(params.id, auth.user._id);
            const view = page ? await loadDataPageView(page, auth.user._id) : null;
            if (!view) {
                set.status = 404;
                return { error: 'Page not found' };
            }
            if (!view.canManage) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'Only the person who added this page can change it',
                };
            }
            return { options: await filterOptionsFor(view.ownerId) };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // Name, description and filter of a data page. Only its creator.
    .patch(
        '/device-data/pages/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const existing = await findPageById(params.id, auth.user._id);
            const view = existing ? await loadDataPageView(existing, auth.user._id) : null;
            if (!view) {
                set.status = 404;
                return { error: 'Page not found' };
            }
            if (!view.canManage) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'Only the person who added this page can change it',
                };
            }
            const title = body.title?.replace(/[\r\n]/g, ' ').trim();
            const page = await updatePage(params.id, auth.user._id, {
                ...(title ? { title } : {}),
                ...(body.description !== undefined
                    ? { description: body.description.replace(/\s+/g, ' ').trim() }
                    : {}),
                ...(body.deviceFilter ? { deviceFilter: body.deviceFilter } : {}),
            });
            if (!page) {
                set.status = 404;
                return { error: 'Page not found' };
            }
            if (page.notebookId) {
                // Other open clients update the page's filter and description without a reload.
                realtimeWSService.sendToUsers(await getUsersWithNotebookAccess(page.notebookId), {
                    type: 'page.updated',
                    pageId: page.id,
                    title: page.title,
                    updatedAt: page.updatedAt,
                    notebookId: page.notebookId,
                    deviceFilter: page.deviceFilter ?? null,
                    description: page.description ?? '',
                });
            }
            return { page };
        },
        { params: t.Object({ id: t.String() }), body: UpdateDeviceDataPageSchema },
    )

    .get(
        '/device-data/items/:id',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            // With a page: the creator's item, if the page's filter lets it through.
            if (query.pageId) {
                const page = await findPageById(query.pageId, auth.user._id);
                const view = page ? await loadDataPageView(page, auth.user._id) : null;
                const match = view ? await itemMatcherFor(view) : null;
                const item = view && match ? await findDeviceItem(view.ownerId, params.id) : null;
                if (!item || !match!(item)) {
                    set.status = 404;
                    return { error: 'Item not found' };
                }
                return { item };
            }
            const item = await findDeviceItem(auth.user._id, params.id);
            if (!item) {
                set.status = 404;
                return { error: 'Item not found' };
            }
            return { item };
        },
        {
            params: t.Object({ id: t.String() }),
            query: t.Object({ pageId: t.Optional(t.String()) }),
        },
    )

    // Remove everything the user's devices uploaded. Devices stop uploading until
    // they're switched back on (their active sources are cleared).
    .delete('/device-data', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        const removed = await deleteDeviceItems(auth.user._id);
        // Devices stay off until the user picks "Collect here" again.
        await disableAllSources(auth.user._id);
        await bumpDeviceDataVersion(auth.user._id);
        return { removed };
    });
