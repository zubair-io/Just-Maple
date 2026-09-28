# Just Maple engineering direction

Build the daily living note as the primary experience, following the approved docs/product/PRD-TODAY-AND-SOURCES.md and docs/engineering/TODAY-AND-SOURCES.md. Preserve the intelligent core as the source of evidence-backed context. This direction supersedes the detached Overview/Tasks landing experience in the earlier PRD; its ingestion, privacy, task correctness and signing invariants still apply.

- Daily blocks have stable identities, versioned mutations and recoverable history. Clearing attention is separate from completing a linked task. Moves retain identity; bot refreshes must preserve user edits and cleared tombstones.
- User-owned dated Markdown owns daily writing and block order. SQLite separately owns immutable source evidence, canonical tasks, identity/history and recoverable file-mutation journals. Follow the approved codec and expected-revision contracts; do not keep two writable prose authorities. Do not materialize each incoming message as a Markdown file. Phone commands must remain visibly pending until acknowledged by the Mac.

- The app is the Xcode project in src/apple; the UI is Angular in src/web. Reuse @maple/ui components from projects/maple-common. Do not create a separate Swift executable app or handwritten WebView renderer. MapleCore is a UI-independent local library package under src/apple/Packages.
- The Mac owns local SQLite. Do not add MongoDB, Meilisearch, a remote knowledge backend or remote collector enrollment. Direct Jev calls are the development path; a Cloudflare Worker API intermediary is planned for later distribution (docs/ARCHITECTURE.md).
- All source observations enter Event/KnowledgeStore.ingest. Explicit user corrections use the separate correction API.
- Keep event ingestion and queue persistence atomic. Retried events and decisions must not duplicate effects.
- Model failures remain failed/pending work. Never quietly substitute fixture/deterministic answers for live classification.
- Fixtures must be visibly labeled. Test transport/storage correctness separately from live model quality.
- Keep successful responses, context and evidence IDs inspectable. Do not log secrets or private HTTP error bodies.
- Add a regression test for storage, routing, concurrency or provider-contract changes. Run npm run test:core and build the CLI with --package-path src/apple/Packages/MapleCore. Run Angular and Xcode tests for UI/native changes.
- After completing and verifying app changes, run `npm run build` to produce a fresh Mac app for ongoing user testing. Report the build result and app path. The running app does not hot reload; do not terminate an active editing session or discard unsaved work to relaunch it.
- Keep source projects untouched during this build. No blanket editor or server code imports.
- Preserve the user-created Xcode project, bundle identity, development team and Automatic signing. See docs/ARCHITECTURE.md for the macOS scope, existing unsandboxed Messages requirement and remaining distribution work.
