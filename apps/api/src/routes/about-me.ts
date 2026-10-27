import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import {
    SaveProfilePlaceSchema,
    UpdateProfileFactSchema,
    UpdateProfileRelationSchema,
    type JWTPayload,
} from '@maple/shared';
import {
    deleteRelation,
    findFact,
    listPlaces,
    savePlace,
    updateFact,
    updateRelation,
    type ProfileScope,
} from '../repositories/profile.repo';
import { findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import { findAboutMePage } from '../repositories/page.repo';
import { getAboutMe } from '../services/about-me.service';
import { isNotebookShared } from '../utils/notebook-sharing';

/**
 * About me, on a notebook's About me page: read yours, edit facts, approve or undo what
 * bots learned. Each member only ever reaches their own About me, in a notebook they're a
 * member of with write access (public read access isn't enough). While the notebook is
 * shared, sensitive facts are hidden and can't be approved or restored. Named places
 * (`/places`) belong to the account; the iPhone reads them.
 */

const NotebookQuery = t.Object({ notebookId: t.String() });

/** The signed-in user's About me in the notebook, when it has an About me page. */
async function scopeFor(
    auth: AuthContext,
    notebookId: string,
): Promise<{ scope: ProfileScope; shared: boolean } | null> {
    const notebook = await findNotebookByIdWithAccess(notebookId, auth.user._id, 'write').catch(
        () => null,
    );
    if (!notebook || !(await findAboutMePage(notebookId))) return null;
    return {
        scope: { userId: auth.user._id, notebookId },
        shared: isNotebookShared(notebook),
    };
}

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

    .get(
        '/',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const found = await scopeFor(auth, query.notebookId);
            if (!found) {
                set.status = 404;
                return {
                    error: 'Not found',
                    message:
                        'About me is only for members who can edit this notebook, once it has an About me page.',
                };
            }
            return {
                aboutMe: await getAboutMe(found.scope, Date.now(), { shared: found.shared }),
                shared: found.shared,
            };
        },
        { query: NotebookQuery },
    )

    // Edit, approve (status active) or undo (status removed) a fact.
    .patch(
        '/facts/:id',
        async ({ auth, params, query, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const found = await scopeFor(auth, query.notebookId);
            const current = found ? await findFact(found.scope, params.id) : null;
            if (current?.sensitive && found?.shared) {
                set.status = 403;
                return {
                    error: 'Not allowed',
                    message:
                        'This notebook is shared, so sensitive things can’t be kept in its About me.',
                };
            }
            const fact =
                found && current
                    ? await updateFact(found.scope, params.id, body, { shared: found.shared })
                    : null;
            if (!fact) {
                set.status = 404;
                return { error: 'Not found' };
            }
            return { fact };
        },
        {
            params: t.Object({ id: t.String() }),
            query: NotebookQuery,
            body: UpdateProfileFactSchema,
        },
    )

    // MARK: - Relations ("Emma: daughter")

    .patch(
        '/relations/:id',
        async ({ auth, params, query, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const found = await scopeFor(auth, query.notebookId);
            const relation = found ? await updateRelation(found.scope, params.id, body.type) : null;
            if (!relation) {
                set.status = 404;
                return { error: 'Not found' };
            }
            return { relation };
        },
        {
            params: t.Object({ id: t.String() }),
            query: NotebookQuery,
            body: UpdateProfileRelationSchema,
        },
    )

    .delete(
        '/relations/:id',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const found = await scopeFor(auth, query.notebookId);
            if (!found || !(await deleteRelation(found.scope, params.id))) {
                set.status = 404;
                return { error: 'Not found' };
            }
            return { ok: true };
        },
        { params: t.Object({ id: t.String() }), query: NotebookQuery },
    )

    // MARK: - Named places (the account's, not a notebook's)

    .get('/places', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
        return { places: await listPlaces(auth.user._id) };
    })

    // Name a place (usually from a visit): "Home" here, within this radius.
    .post(
        '/places',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const place = await savePlace(auth.user._id, body.name, {
                lat: body.lat,
                lon: body.lon,
                radius: body.radius ?? 150,
                ...(body.address ? { address: body.address } : {}),
            });
            return { place };
        },
        { body: SaveProfilePlaceSchema },
    );
