# Today context connector

## Purpose and content policy

Populate the current local day's user-owned Markdown from successful core decisions. Reuse the existing journaled TodayDocumentCoordinator, document identity ledger, shared source cards and source inspector. This is a local projection of existing results and makes no additional Jev or extraction requests.

| Input | What enters Today | Section |
| --- | --- | --- |
| Canonical open/in-progress task, due/scheduled by today or backed by recent successfully classified evidence | Linked checkbox with the canonical task title; no inferred checkboxes | Action items |
| Successful unread notify/ask_user decision (email, iMessage, HA, calendar, existing recording or other source) | Source card requiring attention; a reply/decision prompt is not a completed task extraction | Action items |
| Successful summarize decision whose work item is still proposed | Source card containing the original excerpt, explicitly an FYI rather than generated prose | FYI |
| Retain, unfinished/failed classification, proposed deeper reasoning, notes/user events, inactive or superseded sources | Nothing automatic; evidence remains in Sources | — |

Source cards retain an immutable event ID and a readable fallback label. Show sender/title, excerpt, observed date, classification reason and the shared State & history inspector. A Home Assistant batch remains one card: show a bounded observed-state preview (up to three entities, with an explicit remaining count), using linked prior/current evidence. Never claim the displayed entities caused the batch decision, infer an emergency, or fabricate an AI summary. Existing recording/transcript references are supported; capture/transcription is out of scope. Calendar changes can be FYIs; this is not a separate daily agenda import.

## Eligibility and protection

- Only the real current day in the note's time zone can receive automatic additions. Midnight does not change the document being edited.
- Unscheduled sources must have both occurrence and receipt within the preceding 24 hours; older backlog does not flood Today. Scheduled canonical tasks can be overdue.
- Keep latest active source revisions only. Exclude sources already represented by a linked task or another document block.
- Preserve global stable source/task identities and the insertion ledger, including cleared, removed and moved blocks. Repeated ticks/restarts do not duplicate or resurrect them.
- Append under stable Action items / FYI heading blocks. Never rewrite existing prose or re-create a heading the user removed.
- The open shared editor claims and renews a 30-second native session lease. While it owns the note, automatic context is proposed to the live Tiptap/Yjs document and saved with the user's edits; normal typing or autosave does not defer insertion. Native background writes resume only outside that ownership and remain protected by expected revisions, drafts, delivery receipts and the mutation journal. Raw Markdown mode, composition or unresolved conflicts defer proposals safely. See [local collaboration](TODAY-AND-SOURCES.md#local-user-and-maple-collaboration-september-29-implementation).
- Keep the existing maximum of 64 automatic blocks per day and 32 source cards per refresh. Prioritize attention over FYIs; the remainder stays in Sources. No extra model requests and no outbound messages.

## Implementation sequence

1. Extend AutomaticToday eligibility to proposed summarize decisions; separate source attention from FYIs and keep canonical task behavior.
2. Use readable source labels instead of internal decision traces. Provide a source-detail presentation helper for HA transitions and safe attention reasons; reuse it in the shared editor card.
3. Verify email, iMessage, HA and recording insertion, route filtering, duplicate suppression, cleared tombstones, draft safety, reload and midnight using synthetic fixture tests. Retain existing concurrency/recovery tests.
4. Run core, CLI, Angular and Mac checks; build the signed Mac app. Verify live eligible sources against the actual Today file without inserting test content into user notes.

## Findings motivating this change

The existing background refresh is already wired to the native indexing tick and the editor's idle refresh. Its source query only admitted notify/ask_user and required unread work items. Summarize decisions use proposed work items, so meaningful FYIs could never reach Today. At the initial read-only audit there were two recent Gmail summaries and three recent calendar summaries, but zero automatic insertions. Routine HA observations were correctly retained without attention.

## Validation and rollout

Implemented on September 29, 2026. Passed 360 core tests, 30 companion transport tests, 223 Angular tests and 69 Mac tests. CLI build, Mac build and strict code-signature verification succeeded. Synthetic integration coverage writes email, iMessage, HA-batch and recording references into one actual Markdown document, reopens it, and checks source identities, section placement and unchanged user prose. Dedicated tests cover summary dismissal/clear suppression and factual HA before/after previews.

After loading the new build, the live September 29 note gained exactly five automatic references: two Gmail and three Google Calendar sources. The UI displayed the FYI section, source reasons and shared history controls without an opening, recovery or source-unavailable error. Routine retained HA readings were not inserted. No synthetic sources were added to the user's workspace.

## Calendar date correction and compact source design

Calendar import/observation time is not the appointment time. Automatic calendar references now additionally require the captured Start/End interval to overlap the note's local day. All-day dates use the calendar's time zone and exclusive end date; timed and overnight events use actual instants against the note's day boundaries. Missing/invalid calendar dates are ineligible. This remains a recent-update projection, not a full calendar agenda/backfill.

On the current day, refresh removes only unchanged auto-inserted out-of-day calendar cards using the same expected-revision commit and recoverable document history. Source evidence, manual insertions, annotations and drafts are retained. Removed identities stay suppressed. Historical notes are not rewritten.

The shared source card follows the supplied mockup: outlined icon, sender/calendar name, compact date/type, subject/title and excerpt, a slim source rail, and theme-token background/border/text. Calendar cards use captured occurrence times, calendar name, location and notes instead of connector serialization. Email direction comes from captured mailbox metadata. Clicking the title opens the shared source/history inspector; technical processing labels remain there.

Calendar correction validation: 362 core + 30 transport + 225 Angular + 69 Mac tests passed (686 total). The live September 29 note now retains two email references and records all three out-of-day calendar references as removed; their immutable source events remain available. A visual check of the native editor verified the compact email layout and identified/fixed a global paragraph-style override so source previews retain muted text and spacing.

## iPhone daily document alignment

The phone's Today surface now reads the same app iCloud container and `Just Maple/YYYY/MM/YYYY-MM-DD.md` file as the Mac, through the shared NotebookLibrary coordinated-read/download contract. It no longer renders the legacy SQLite daily-block snapshot. A legacy `Daily/YYYY-MM-DD.md` file is read only when the canonical path is absent. A missing file or unavailable iCloud connection is an explicit retry state, never an empty replacement file. Notebook IDs derived from device-local paths are not exchanged as cross-device document identities.

The shared MapleEditor renders the exact Markdown, preserving embedded identities, user writing, block order and source reference labels. This remains read-only on iPhone: managed-document commits/history are still coordinated by the Mac, and full source evidence remains on the Mac. No phone edit is represented as acknowledged. Yesterday/Today/Tomorrow resolve from the current local date when selected; an opened date remains pinned at midnight. Visible notes refresh from iCloud every 15 seconds and on foreground return, with stale read responses ignored.

Phone alignment validation: 229 Angular tests, 362 core tests, 30 transport tests, 29 iPhone unit tests, one iPhone UI test, and 69 Mac tests passed. Coverage includes exact file bytes/revisions, same-date refresh, legacy file fallback, absence without duplicate creation, invalid dates, late-response isolation and midnight pinning. The CLI and clean Mac build succeeded, including strict Mac signature verification.
