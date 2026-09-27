# Just Maple engineering direction

Build the daily living note as the primary experience, following the user's September 27 direction and docs/product/LIVING-DAILY-NOTE.md. Preserve the intelligent core as the source of evidence-backed context. This direction supersedes the detached Overview/Tasks landing experience in the earlier PRD; its ingestion, privacy, task correctness and signing invariants still apply.

- Daily blocks have stable identities, versioned mutations and recoverable history. Clearing attention is separate from completing a linked task. Moves retain identity; bot refreshes must preserve user edits and cleared tombstones.
- Keep daily-block SQLite storage separate from user-owned Markdown notebook files. Do not materialize each incoming message as a Markdown file. Phone commands must remain visibly pending until acknowledged by the Mac.

- The app is the Xcode project in src/apple; the UI is Angular in src/web. Reuse @maple/ui components from projects/maple-common. Do not create a separate Swift executable app or handwritten WebView renderer. MapleCore is a UI-independent local library package under src/apple/Packages.
- The Mac owns local SQLite. Do not add MongoDB, Meilisearch, a remote knowledge backend or remote collector enrollment. Direct Jev calls are the development path; a Cloudflare Worker API intermediary is planned for later distribution (docs/ARCHITECTURE.md).
- All source observations enter Event/KnowledgeStore.ingest. Explicit user corrections use the separate correction API.
- Keep event ingestion and queue persistence atomic. Retried events and decisions must not duplicate effects.
- Model failures remain failed/pending work. Never quietly substitute fixture/deterministic answers for live classification.
- Fixtures must be visibly labeled. Test transport/storage correctness separately from live model quality.
- Keep successful responses, context and evidence IDs inspectable. Do not log secrets or private HTTP error bodies.
- Add a regression test for storage, routing, concurrency or provider-contract changes. Run npm run test:core and build the CLI with --package-path src/apple/Packages/MapleCore. Run Angular and Xcode tests for UI/native changes.
- Keep source projects untouched during this build. No blanket editor or server code imports.
- Preserve the user-created Xcode project, bundle identity, development team and Automatic signing. See docs/ARCHITECTURE.md for the macOS scope, existing unsandboxed Messages requirement and remaining distribution work.
