import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { UploadHomeExposureSchema, type JWTPayload } from '@maple/shared';
import {
    HomeError,
    confirmHomeProposal,
    getHomeProposalView,
    uploadHomeExposure,
} from '../services/home.service';

/**
 * Home Assistant, through the user's Mac (see home.service):
 *
 * - `PUT /api/home/exposure` the Mac's list of entities exposed to assistants.
 * - `GET /api/home-proposals/:id` a card's state, for any notebook member.
 * - `POST /api/home-proposals/:id/confirm` the owner's tap; `{ acknowledged: true }` is the
 *   second tap that locks and garage doors need.
 *
 * Pending actions and their results go through `/api/collectors/:deviceId/actions`
 * (calendar-proposals.ts), shared with "Add to calendar".
 */
export const homeRoutes = new Elysia({ prefix: '/api' })
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

    .put(
        '/home/exposure',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return {
                    exposed: await uploadHomeExposure(auth.user._id, body.deviceId, body.entityIds),
                };
            } catch (error) {
                return failure(error, set);
            }
        },
        { body: UploadHomeExposureSchema },
    )

    .get(
        '/home-proposals/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const proposal = await getHomeProposalView(params.id, auth.user._id);
            if (!proposal) {
                set.status = 404;
                return { error: 'Not found', message: 'Proposal not found' };
            }
            return { proposal };
        },
        { params: t.Object({ id: t.String() }) },
    )

    .post(
        '/home-proposals/:id/confirm',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return {
                    proposal: await confirmHomeProposal(params.id, auth.user._id, {
                        acknowledged: body?.acknowledged === true,
                    }),
                };
            } catch (error) {
                return failure(error, set);
            }
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Optional(t.Object({ acknowledged: t.Optional(t.Boolean()) })),
        },
    );

function failure(error: unknown, set: { status?: number | string }) {
    if (!(error instanceof HomeError)) throw error;
    set.status = error.status;
    return { error: error.message };
}
