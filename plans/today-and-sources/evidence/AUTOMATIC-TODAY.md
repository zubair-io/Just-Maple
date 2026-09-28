# Automatic daily context — 2026-09-28

The daily document now owns the presentation of incoming context. The separate Suggested follow ups and persistent block organizer panels are removed. The floating toolbar opens Document tools for source view, cleared blocks, history, and recovery. Per-block grip menus expose next-day move and copy, retaining the existing durable mutation contracts.

## Placement contract

The Mac projects eligible context into the current local day's actual Markdown through the existing expected-revision journal. Canonical open/in-progress tasks appear under Action items when due/scheduled today or overdue, or backed by freshly classified evidence. Waiting, deferred, completed, future-scheduled, and unaccepted suggestion tasks are excluded. FYI cards require the latest source revision, successful processing, a real notify/ask_user decision, and unread attention. Both observation and receipt must be within the preceding 24 hours. Raw ingestion alone never fabricates a model result.

The projection adds blocks without rewriting existing writing. Stable entity identities and a durable insertion ledger prevent duplicate placement after retries, source revisions, clear, deletion, or move. A day permits at most 64 automatically placed entities, including subsequently cleared/moved entries. Existing placements on earlier days remain where the user left them; this does not silently carry unfinished tasks forward. Source evidence already represented by a linked task is not repeated as a FYI card. Existing automatic section headings are reused; removed headings are not recreated.

Editor focus renews a six-second native lease, and the background scheduler checks every ten seconds. Automatic commits also check durable drafts and file revisions. Frontend polling adopts only idle, unchanged documents; replies arriving after typing, navigation, or another mutation cannot replace local writing. History retains the committed file mutation. Recovery and cleared-item controls remain outside the prose.

## Verification

- 182 Angular tests across 26 suites.
- 300 core tests across 67 suites, plus 30 transport tests.
- 60 Mac tests across 15 suites and the iPhone simulator suite passed. CLI build, production Mac/Angular build, and strict signature verification passed.
- Native coverage includes expiring editor presence, background Today creation, and bridge refresh/defer behavior.
- Eight automatic-projection tests cover real eligibility gates, revised/deactivated evidence, drafts, user edits, clear/removal/move, daily capacity/recovery, future-task backlog, schedule-cache edits, reused/removed headings, and historical-day exclusion.
- Synthetic browser journeys exercise source cards, Markdown reopening, document tools, inline controls, attachment handling, light/dark and narrow layouts. Near-limit input-to-frame p95: 20.4 ms at 248,167 bytes.

Synthetic fixtures are explicitly labeled and never installed as live classification results. Provider quality and real-device cloud delivery are separate from these transport/storage tests.

## Native visual check

Reopened the fresh build after confirming the app was idle on Connections. Today shows only the date chip, document, and floating editor tools. Document tools opens the history/recovery drawer; closing it returns to the unchanged note. The app remains open on Today. Actual Mac screenshots are saved locally at `/Users/riabuz/.codex/attachments/maple-today-2026-09-28/mac-today.png` and `mac-document-tools.png`. No synthetic events or writing were injected into the user's workspace.
