# Just Maple engineering direction

Build the intelligent core first. Notes are one connector. The earlier editor-first recommendation in ENGINEERING-AUDIT.md is superseded by the user's direction and docs/product/PRD-JUST-MAPLE.md.

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
