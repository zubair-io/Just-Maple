# Daily canvas verification — October 3, 2026

The MVP uses the existing Xcode app and Angular/Tiptap editor. Reference JustMaple, Just-Maple and SugarMaple projects were read only. Existing work in this checkout was preserved.

## Completed checks

- `npm test`: 373 tests in 51 files passed. New tests cover presentation metadata round trips, invalid/future layouts, group move/fold/dissolve/undo, rich writing and local checklists, unchanged editor identity between views, preserved user placement/caret under Maple arrivals, unsubmitted selection drafts, read-only/source-mode protection, and Note folding without hidden Canvas content.
- `npm run test:core`: 458 tests in 98 MapleCore suites and 30 tests in 6 companion suites passed. New tests verify immutable selected-card snapshots, saved-anchor and selection validation, bounded context, source evidence and citation rejection, inspectable provider responses, idempotent runs/replies, layout commits through the actual document coordinator, revision conflicts and recoverable history.
- `swift build --package-path src/apple/Packages/MapleCore --product just-maple`: passed.
- `npm run test:apple`: 79 tests in 19 suites passed on `Just Maple`, `platform=macOS,arch=arm64`. The WebKit heading contract explicitly selects Note view; the existing native source-picker, inspector, clear/restore and reload journey also passed against Canvas as the default view.
- `node scripts/daily-canvas-smoke.mjs`: synthetic browser acceptance passed, with no page errors. Covers actual keyboard writing/autosave, multiple paragraphs within one writing card, local action checklist, named groups, keyboard and pointer group movement, fold/reload persistence, the same mounted editor in Canvas/Note, fit, light/dark screenshots and selection requests remaining unsubmitted.
- `git diff --check`: passed.

The browser fixture uses a synthetic transport and local browser storage; it does not prove live provider quality, physical iCloud delivery, VoiceOver operation or phone canvas editing. Core canvas-answer tests use an explicitly named synthetic provider. No live provider quality claim is made.

Browser evidence: `.build/daily-canvas-smoke/result.json`, `canvas-light.png`, `canvas-dark.png`. Build/test logs for this session are `/tmp/maple-canvas-{angular-tests,core-tests,cli-build,apple-tests,browser,app-build}.log`.

## Product boundaries

Flat groups, grid-snapped positions, predefined compact/writing sizes and session zoom. Long-form cards use standard blockquote Markdown. View switching keeps the same live editor and does not rewrite prose. Presentation fields share the existing Markdown commit and journal. Group titles and placements persist; view/zoom remain session preferences. Layout history is separate from human prose undo. Incoming cards use a new shelf without moving saved placements. Explicit Maple selection requests retain submitted writing and cite available immutable source revisions; no task completion or external action tools are added.

“Bot” was not identified by the user during this run. Jambot was included as an additional research reference and the ambiguity remains documented. Nested boards, drawing, arrows, phone canvas editing and AI rearrangement are deferred.

## Fresh Mac app

`npm run build` completed successfully after verification; the build script also passed `codesign --verify --deep --strict`. App: `/Users/riabuz/Projects/_Just Maple/.build/xcode/Build/Products/Debug/Just Maple.app`. The existing app was not terminated or relaunched.
