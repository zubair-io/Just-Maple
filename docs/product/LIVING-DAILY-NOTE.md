# Just Maple — Living daily note

September 27, 2026. User-approved product direction; implementation and validation tracked in [the plan](../../plans/living-daily-note/plan.mdx).

Today is the primary workspace. A daily note contains editable text, headings, tasks, emails, messages and code blocks. The same interface runs in the Mac and iPhone hosts. Maple uses the existing cream/red theme, Lato interface typography, serif writing and transit route/station marks to distinguish writing from incoming context.

## Behavior

- Write directly into blocks. Edits autosave; failed or conflicting saves retain drafts for review.
- Clear means remove from this day’s attention. It preserves content and before/after history, supports Undo, and does not mark a linked task complete.
- Explicit task completion completes a standalone daily task or atomically completes its linked canonical task. Restoring a completed block does not reopen the canonical task.
- Move to tomorrow changes the same block’s day. It does not copy the block. Entering the actual current day carries unfinished task blocks forward from older days; ordinary writing stays on its original day.
- Existing accepted tasks and eligible unread source decisions supply incoming context. Bot refreshes cannot overwrite user-edited text or resurrect cleared blocks. Source evidence remains inspectable.
- Empty means no active blocks on the selected day. It does not claim there are no outstanding obligations outside the current projection. Partial, unavailable and pending sync states are visible.

## What remains

The existing Markdown notebook editor, connections, settings, source inspection, task/activity tools and onboarding remain accessible. Existing databases and user Markdown are preserved. The additive daily tables reuse the Mac-owned SQLite transaction, command-idempotency and history infrastructure. No source-project import, identity change or signing change is required.

The iPhone caches bounded whole-block snapshots and queues encrypted versioned commands. Queued edits are saved locally, but remain pending until the Mac acknowledges them. Uncached days and unavailable history report their limits explicitly. Automated tests are separate from live iCloud or physical-device validation.

## Deliberate limits

This delivery does not add sending blocks as email/messages, remote-provider edits, arbitrary autonomous rewriting, manual reordering, a new graph engine, or bulk migration of old notes. Daily task prose does not rewrite its linked canonical task title. Source/task projections are bot updates; user writing remains protected. Existing source processing and inference quality still determine the usefulness of incoming context.

## Validation

Use labeled synthetic UI content, temporary SQLite databases and isolated companion caches. The browser smoke script is `scripts/daily-note-smoke.mjs`; it injects a test-only bridge into the actual Angular UI and is never bundled as a production fallback. Native/core tests independently verify persistence, replay, conflicts, projection and transport. Delivery evidence is recorded in the plan after integrated checks finish.
