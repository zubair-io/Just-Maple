# Initial PR preparation and code review

September 23, 2026. Findings are open; this is not a merge approval.

The checkout has no commits or remote. Four stacked initial-import PRs are prepared: Swift core/storage/transport; shared Angular UI/providers; Apple hosts/connectors/sync; product/design/evaluation. Repository selection is pending. No PR has been published by this preparation.

## Open findings

1. **P2 — canonical evidence propagation.** `src/apple/Packages/MapleCore/Sources/MapleCore/ObligationIdentity.swift:68`: matching new evidence is retained on the suggestion, but an accepted/completed canonical task does not receive it in its evidence/history. Resolve the visible root and propagate evidence transactionally without reopening it; test canonical and consolidated tasks.
2. **P2 — extraction scaling.** `ObligationIdentity.swift:59`: full suggestion scans plus repeated relation decoding introduce quadratic work inside extraction transactions. Narrow candidates by source/occurrence or digest and reuse relation lookup. Address before larger imports.
3. **P2 — phone snapshot allocation.** `src/apple/Just Maple/Host/CompanionSyncProjection.swift:67`: the top-50 limit precedes Waiting separation. Many dated Waiting tasks can exclude actionable work from the phone snapshot. Partition/reserve capacity before truncation and test more than 50 waiting items plus actionable work.
4. **P2 — phone retry validation.** `src/apple/Just Maple iPhone/CompanionStore.swift:65`: an identical already-queued mutation is checked against the latest snapshot before idempotent recognition. Lost native reply followed by snapshot advancement can make a committed retry fail. Recognize identical persisted mutations first and validate versions only for new commands.
5. **P2 — future unsupported commands stall sync.** `src/apple/Just Maple/Host/CompanionMacController.swift:314`: an unsupported typed intent stays pending and throws before unrelated captures/snapshot work. Current UI cannot emit it, but version skew can block the mailbox. Preserve unsupported work while allowing unrelated sync, with explicit capability/status handling; never falsely acknowledge application.

6. **P1 — provider tool isolation needs enforcement.** `src/providers/acp-provider.js:109`: session creation uses the adapter's default mode without explicitly disabling built-in tools. Rejecting requested permissions does not establish that already-permitted tools cannot act. Review the pinned adapter configuration, explicitly constrain extraction to the required read-only/text behavior, and test that tool attempts from untrusted source content cannot mutate files. This is a configuration finding; no exploit or live unintended write was tested.
7. **P2 — activity filtering uses differently truncated names.** `src/web/src/app/companion/companion.component.ts:111`: activity navigation compares a name retained at 160 characters with task tags truncated at 80, producing empty results for long names. Carry stable activity IDs through the snapshot and filter by identity, not presentation text.
8. **P2 — Save a copy can replace newer in-memory edits.** `src/web/src/app/notebooks/notebook.service.ts:52`: the copy workflow captures a document before async creation/write while the editor remains editable, then loads the captured copy and resets state. Preserve edits made during the operation or gate editing explicitly; add delayed-response/editor-change regression coverage.

Review was read-only, with no private data mutations or live provider calls. Earlier passing tests do not cover away these findings. Provider tests were additionally run during PR preparation: five passed.
