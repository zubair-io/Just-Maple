# Daily canvas v2 verification — October 3, 2026

- Sketch MCP: edited the existing Today design on a new page, preserved prior pages, saved the document, and inspected screenshots of canvas, writing and connections. Corrected fill rendering, stack order and text wrapping before final capture. Design content is illustrative.
- Angular: `npm test` — 387 tests in 53 files passed. Regression coverage includes link validation/round trip/undo, focused editing identity, zoom geometry, canceled drag restoration, rectangle selection, keyboard resizing and actionable feedback priority/version-scoped dismissal.
- Core: `npm run test:core` — 458 tests in 98 MapleCore suites and 30 tests in 6 companion transport suites passed.
- CLI: `swift build --package-path src/apple/Packages/MapleCore --product just-maple` passed.
- Browser: `scripts/daily-canvas-smoke.mjs` passed the existing card/group/source/request journey. `scripts/daily-canvas-v2-smoke.mjs` passed labeled links and reload, pinch-wheel view changes without Markdown mutation, focused graph, same-editor writing/typography with text visibly in viewport, pointer resize persistence and Space-drag pan. Final browser checks used the built static UI on localhost:4329; transport is explicitly synthetic and never packaged.
- Native: final result recorded below. An earlier concurrent native run had two assertions fail in the companion lost-receipt test before ingestion; isolated rerun passed all 79 tests in 19 suites. Both native WebKit journeys passed in that initial run as well. Added programmatic WebKit pinch events with unchanged saved Markdown. This is not a physical trackpad/VoiceOver/OS-IME quality claim.
- `git diff --check` passed.

Evidence: `.build/daily-canvas-v2/{canvas,writing,connections}.png`, `.build/daily-canvas-v2/result.json`, and the Sketch captures under `design/daily-canvas`. Browser checks made no live provider calls and no private source observations. No running user app session was terminated or relaunched. Existing source projects and signing identity remain intact.

Final native run: `npm run test:apple` — **TEST SUCCEEDED**, 79 tests in 19 suites passed, including the new programmatic WebKit pinch contract and existing trusted native composition/persistence journeys.

Fresh app: `npm run build` — **BUILD SUCCEEDED**, using the existing Xcode project/signing configuration. App path: `/Users/riabuz/Projects/_Just Maple/.build/xcode/Build/Products/Debug/Just Maple.app`. The build script completed its signature verification. The already-running user app was left open and was not relaunched; it does not hot reload.
