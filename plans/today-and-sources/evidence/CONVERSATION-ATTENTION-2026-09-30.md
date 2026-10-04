# Conversation attention and actionable email review

## Observed failures

- The reported service conversation had both sides and its resolution already imported. Screening older requests included only preceding messages, so supplied answers and the later resolution were invisible. Existing attention also had no invalidation path when replies arrived.
- The reported onboarding email was fully imported and passed the independent task-review screen. Its Codex review failed because the CLI inherited a model unavailable to that runtime/account. The adapter rendered the error as answer text, causing an unnecessary repair request.
- Even a successful pending task suggestion could be absent from Today when its source did not meet the interruption/summary threshold. Canonical tasks and reviewed source suggestions have different ownership contracts.

## General changes

- Assess the original source against bounded current conversation evidence: account/connector/explicit-thread scope, later and adjacent messages, latest revisions, terminal task evidence, and explicit omissions/truncation. Do not transfer a later independent request onto the original message.
- Fence classification and task commits against newly arrived conversation evidence. Stale responses remain inspectable and cannot retire attention or proposals.
- New observations atomically queue bounded, debounced review of existing attention/pending proposals. Duplicate deliveries and UI polling do not enqueue work. Keep failure attempts/backoff and user dismissals; retain every source and earlier response artifact.
- Supersede obsolete machine attention only after a successful current review. Remove only unchanged automatically generated cards in today's note, through the existing revision-checked document path. Preserve user edits, cleared identities, prior days, and canonical task state.
- Show successfully extracted pending actionable sources in Today for review, without automatically accepting their tasks. Retain suggestions while their current review is incomplete.
- Add a read-only Conversation tab to the shared source inspector. It displays both directions within one explicit account-scoped thread, identifies the selected message/revision, and makes bounded history/excerpts visible.
- Pin the detected Codex runtime. Before inference, preserve a supported inherited model or use that runtime's explicitly advertised recommendation. Explicit unsupported app selections fail; no global configuration is changed. Typed provider errors remain failures rather than model answers, and effective model metadata is retained.

No sender, company, subject, or example-specific routing rules or threshold changes were added.

## Validation

- Angular: 358 tests passed.
- Provider transport: 26 tests passed, including recommendation selection, explicit unsupported selection, typed failures, and no repair after transport failure.
- Metadata-only runtime handshake selected its advertised recommendation, `gpt-5.6-sol`; the incompatible inherited global configuration was unchanged.
- Authorized live preview of the reported onboarding email succeeded and found two concrete obligations: equipment/software setup and the preboarding checklist. Preview did not accept tasks or edit the note.
- Core: 453 tests passed; companion transport: 30 passed. Mac/Xcode: 79 tests passed.
- The unrelated live task-cleanup suite completed all 17 provider requests successfully; 16 semantic rubric checks passed. A two-minute-old request for extra session time returned no task. Resolved later replies, concrete onboarding, optional/reference-only messages, and durable overdue obligations passed. This remaining quality miss is recorded without sender-specific tuning or changing the rubric.
- An isolated live Jev check could not start because a bounded noninteractive Keychain lookup did not return. No key was exposed and no provider call or production mutation was made by that attempt. The temporary private database copy was removed after retaining its validation status.
- The first signed build was opened after verifying the note had no draft/pending edits. The app then successfully reassessed the three reported conversation items using Jev with `message-actions-v4-current-conversation`: all three returned `retain` and their attention work became `superseded`. Context tracked 30 current observations and supplied 12–14 selected later/adjacent messages, with omissions explicit. No unrelated classification backlog was retried.
- The onboarding source's targeted task reprocessing succeeded and produced a pending review suggestion covering computer setup and the preboarding checklist. Its source card was observed in Today under Action items. No canonical task was silently accepted.
- Live projection exposed a legacy marker serialization difference (`auto\\u002dsource` versus `auto-source`) that prevented one generated card from being retired. The final fix compares parsed marker metadata while still requiring exact body bytes, apart from outer whitespace. Seven new fixture scenarios verify equivalent escaping/key order and preservation of added metadata, changed labels, and prose.
- The user began editing during live verification. Subsequent UI actions/relaunch were stopped; the final compatibility build is left ready for the next normal launch.
- Final `swift build --package-path src/apple/Packages/MapleCore` and `npm run build` passed. Strict deep signature verification passed with the existing bundle identity and team. App: `.build/xcode/Build/Products/Debug/Just Maple.app`. Logs: `.build/conversation-{core-tests,angular-tests,mac-tests,cli-build,mac-build}.log`.

Fixture tests establish storage, scope, queue, concurrency, and projection contracts. They do not substitute for live model quality evaluation.
