import type { BotActionKind, DeviceAction, DeviceActionResult } from '@maple/shared';
import type { BotActionDocument } from '../repositories/bot-action.repo';
import {
    cancelCalendarAdd,
    markProposalNotFound,
    markProposalRemoved,
    settleProposal,
    settleProposals,
} from './calendar-proposal.service';
import {
    expireStaleUndos,
    reportUndoResult,
    takeUndoActions,
    undoCalendarAdd,
} from './calendar-action.service';

/**
 * What the action log needs from each kind of action, beyond `recordAction` /
 * `updateAction`. A kind without handlers still logs, lists and filters; it just can't
 * be undone, and its open rows expire at their `expiresAt`.
 *
 * Adding a kind (e.g. `send_reply`): add it to `BOT_ACTION_KINDS` in @maple/shared, then
 * register here whatever it supports:
 * - `settle`: catch up on time (its own expiry, stranded work) before the log is read;
 *   a kind with `settle` expires its own rows;
 * - `settleOne`: the same for a single row, when one card is read;
 * - `cancel`: stop a queued action (the log checks owner and status; the kind sets
 *   `cancellable` in `BOT_ACTION_KINDS`);
 * - `undo`: start undoing a done action (the log checks owner, status and the 24 hours);
 * - `deviceActions` / `reportDeviceResult`: undo (or other) work that runs on the
 *   owner's Mac, served next to "Add to calendar" on the collector action queue.
 */
export interface ActionKindHandlers {
    settle?(ownerId: string): Promise<void>;
    settleOne?(row: BotActionDocument): Promise<void>;
    cancel?(row: BotActionDocument, userId: string): Promise<BotActionDocument>;
    undo?(row: BotActionDocument, userId: string): Promise<BotActionDocument>;
    deviceActions?(ownerId: string, deviceId: string): Promise<DeviceAction[]>;
    /** Null when `id` isn't one of this kind's device actions. */
    reportDeviceResult?(
        ownerId: string,
        deviceId: string,
        id: string,
        result: DeviceActionResult,
    ): Promise<BotActionDocument | null>;
}

export const ACTION_KIND_HANDLERS: Partial<Record<BotActionKind, ActionKindHandlers>> = {
    calendar_add: {
        settle: async (ownerId) => {
            await settleProposals(ownerId);
            await expireStaleUndos(ownerId);
        },
        settleOne: async (row) => {
            await settleProposal(row._id);
            if (row.undo) await expireStaleUndos(row.ownerId, row._id);
        },
        cancel: cancelCalendarAdd,
        undo: undoCalendarAdd,
        deviceActions: takeUndoActions,
        reportDeviceResult: async (ownerId, deviceId, id, result) => {
            const row = await reportUndoResult(ownerId, deviceId, id, result);
            if (row?.status === 'undone') await markProposalRemoved(row._id);
            else if (row?.undo?.state === 'not_found') await markProposalNotFound(row._id);
            return row;
        },
    },
};
