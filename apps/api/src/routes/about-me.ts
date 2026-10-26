import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import {
    SaveProfileEntitySchema,
    SaveProfileFactSchema,
    SaveProfilePlaceSchema,
    UpdateProfileFactSchema,
    type JWTPayload,
} from '@maple/shared';
import {
    addRelation,
    createEntity,
    deleteEntity,
    deleteProfile,
    deleteRelation,
    findMe,
    listEntities,
    listPlaces,
    saveFact,
    savePlace,
    updateEntity,
    updateFact,
} from '../repositories/profile.repo';
import { ensureProfile, getAboutMe } from '../services/about-me.service';

/**
 * The user's About me profile: read it, edit people and facts, approve or undo what
 * bots learned. Only the signed-in user's own profile is ever reachable.
 */
export const aboutMeRoutes = new Elysia({ prefix: '/api/about-me' })
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

    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        return { aboutMe: await getAboutMe(auth.user._id) };
    })

    // Start the profile now instead of waiting for the first proactive bot.
    .post('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        await ensureProfile(auth.user._id);
        return { aboutMe: await getAboutMe(auth.user._id) };
    })

    .delete('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        await deleteProfile(auth.user._id);
        return { ok: true };
    })

    // MARK: - People and things

    .post(
        '/entities',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const me = await ensureProfile(auth.user._id);
            const entity = await createEntity(auth.user._id, body);
            if (body.relationToMe)
                await addRelation(auth.user._id, me.id, entity.id, body.relationToMe);
            return { entity };
        },
        { body: SaveProfileEntitySchema },
    )

    .patch(
        '/entities/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const entity = await updateEntity(auth.user._id, params.id, body);
            if (!entity) {
                set.status = 404;
                return { error: 'Not found' };
            }
            return { entity };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
                aliases: t.Optional(t.Array(t.String({ maxLength: 120 }), { maxItems: 10 })),
            }),
        },
    )

    .delete(
        '/entities/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await deleteEntity(auth.user._id, params.id))) {
                set.status = 404;
                return { error: 'Not found' };
            }
            return { ok: true };
        },
        { params: t.Object({ id: t.String() }) },
    )

    .post(
        '/relations',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const ids = new Set((await listEntities(auth.user._id)).map((entity) => entity.id));
            if (!ids.has(body.from) || !ids.has(body.to)) {
                set.status = 400;
                return { error: 'Unknown person' };
            }
            return { relation: await addRelation(auth.user._id, body.from, body.to, body.type) };
        },
        {
            body: t.Object({
                from: t.String(),
                to: t.String(),
                type: t.String({ minLength: 1, maxLength: 40 }),
            }),
        },
    )

    .delete(
        '/relations/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            if (!(await deleteRelation(auth.user._id, params.id))) {
                set.status = 404;
                return { error: 'Not found' };
            }
            return { ok: true };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // MARK: - Named places

    .get('/places', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        return { places: await listPlaces(auth.user._id) };
    })

    // Name a place (usually from a visit): "Home" here, within this radius.
    .post(
        '/places',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            await ensureProfile(auth.user._id);
            const place = await savePlace(auth.user._id, body.name, {
                lat: body.lat,
                lon: body.lon,
                radius: body.radius ?? 150,
                ...(body.address ? { address: body.address } : {}),
            });
            return { place };
        },
        { body: SaveProfilePlaceSchema },
    )

    // MARK: - Facts

    .post(
        '/facts',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            await ensureProfile(auth.user._id);
            const ids = new Set((await listEntities(auth.user._id)).map((entity) => entity.id));
            if (!ids.has(body.about)) {
                set.status = 400;
                return { error: 'Unknown person' };
            }
            return {
                fact: await saveFact(auth.user._id, { ...body, source: { type: 'you' } }),
            };
        },
        { body: SaveProfileFactSchema },
    )

    // Edit, approve (status active) or undo (status removed) a fact.
    .patch(
        '/facts/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const fact = await updateFact(auth.user._id, params.id, body);
            if (!fact) {
                set.status = 404;
                return { error: 'Not found' };
            }
            return { fact };
        },
        { params: t.Object({ id: t.String() }), body: UpdateProfileFactSchema },
    )

    .get('/me', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        return { me: await findMe(auth.user._id) };
    });
