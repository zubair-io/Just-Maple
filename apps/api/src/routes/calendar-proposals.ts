import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { touchCollector } from '../repositories/collector.repo';
import { DeviceActionResultSchema, type JWTPayload } from '@maple/shared';
import {
    ProposalError,
    confirmProposal,
    getProposalView,
    reportActionResult,
    takeActions,
} from '../services/calendar-proposal.service';

/**
 * "Add to calendar" (see calendar-proposal.service):
 *
 * - `GET /api/calendar-proposals/:id` the card's state, for any notebook member.
 * - `POST /api/calendar-proposals/:id/confirm` the owner's tap; queues the action.
 * - `GET /api/collectors/:deviceId/actions` a device's pending actions.
 * - `POST /api/collectors/:deviceId/actions/:id/result` its result; safe to repeat.
 */
export const calendarProposalRoutes = new Elysia({ prefix: '/api' })
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
        '/calendar-proposals/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const proposal = await getProposalView(params.id, auth.user._id);
            if (!proposal) {
                set.status = 404;
                return { error: 'Not found', message: 'Proposal not found' };
            }
            return { proposal };
        },
        { params: t.Object({ id: t.String() }) },
    )

    .post(
        '/calendar-proposals/:id/confirm',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return { proposal: await confirmProposal(params.id, auth.user._id) };
            } catch (error) {
                return failure(error, set);
            }
        },
        { params: t.Object({ id: t.String() }) },
    )

    .get(
        '/collectors/:deviceId/actions',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                const actions = await takeActions(auth.user._id, params.deviceId);
                await touchCollector(auth.user._id, params.deviceId, false);
                return { actions };
            } catch (error) {
                return failure(error, set);
            }
        },
        { params: t.Object({ deviceId: t.String() }) },
    )

    .post(
        '/collectors/:deviceId/actions/:id/result',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            try {
                return {
                    proposal: await reportActionResult(
                        auth.user._id,
                        params.deviceId,
                        params.id,
                        body,
                    ),
                };
            } catch (error) {
                return failure(error, set);
            }
        },
        {
            params: t.Object({ deviceId: t.String(), id: t.String() }),
            body: DeviceActionResultSchema,
        },
    );

function failure(error: unknown, set: { status?: number | string }) {
    if (!(error instanceof ProposalError)) throw error;
    set.status = error.status;
    return { error: error.message };
}
