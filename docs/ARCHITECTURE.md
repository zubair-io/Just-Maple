# Architecture

The proper Xcode project in `src/apple` hosts a shared Angular WebView from `src/web`. Reuse `@maple/ui` components; MapleCore is a UI-independent local package. Preserve the app identity, development team and Automatic signing in this checkout. Contributors need their own signing access.

The Mac owns local SQLite. Source observations enter atomic Event/KnowledgeStore ingestion and durable queues. Explicit user corrections use the correction API. Retries must not duplicate effects. Failed provider work remains failed/pending rather than receiving synthetic answers.

Direct Jev calls are the development path. A future authenticated API gateway is planned; it must not become a remote personal knowledge database. Local provider adapters and service credentials remain on the user's machine.

The companion uses encrypted private CloudKit records, durable local commands, version checks and acknowledgments. Automatic sync does not imply continuous processing while the Mac is asleep. Notes use coordinated Markdown files and iCloud download handling. The Mac Messages connector currently needs unsandboxed filesystem access and Full Disk Access; distribution hardening is unfinished.

Run core/transport, provider, Angular and native tests appropriate to changes. The current open review findings and release limitations are documented in the public product and review directories.

## Approved Today and Sources architecture

The [Today and Sources engineering design](engineering/TODAY-AND-SOURCES.md) owns the current daily-note migration: dated Markdown owns writing/order; Mac SQLite owns source evidence, canonical tasks and recoverable mutation/history records. Angular/Tiptap renders Today and Sources inside the existing Xcode hosts. The implementation must gate legacy/phone writers for migrated documents and retain recovery copies. See [build stages](../plans/today-and-sources/BUILD-PLAN.md) for release gates.
