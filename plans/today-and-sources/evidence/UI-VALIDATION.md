# Angular UI validation — September 27, 2026

All screenshots and the browser transport use labeled synthetic content. They are interface and persistence-contract evidence, not live provider-quality results.

- `npm run build:ui --prefix src/web`: passed after the primary-button contrast update.
- `npm run build --prefix src/web`: passed; production main bundle `main-KFAUA5CV.js`.
- `npm test --prefix src/web`: passed, 19 suites / 115 tests.
- `node scripts/today-sources-smoke.mjs`: passed against the Angular development server on port 4320.
- Browser journey: Today formatted editing → durable revision save → reload → exact source-mode toggle → explicit inline Maple submission/result → same source inspector and raw response → independent type/account/date filters → representative and related-revision navigation → audit history → managed ordinary notebook registration → source insertion → reload → both themes and narrow layout.
- Near-limit synthetic Markdown: 248,167 UTF-8 bytes; 37 measured inputs; p95 beforeinput-to-next-animation-frame latency **18.1 ms**, below the 50 ms target. This estimates browser paint scheduling; it does not measure native file I/O or model latency. See `editor-performance.json` for the exact sample metadata.

Focused unit regressions cover Markdown metadata/source/task round trips; literal marker comments inside code fences; duplicate or malformed metadata/source preservation; recovered draft conflicts that must not overwrite an external revision; original draft-base retention; edits made during a save; exact retry identity; explicit submit after durable commit; generic-document recovery; fresh host reads after an inline reply; inclusive local-day date bounds including DST transitions; filter query restoration/reset; and invalid date interval rejection.

Images:

- `today-light.png`, `today-dark.png`: continuous document, inline source/request/reply rendering.
- `today-narrow.png`: responsive writing view.
- `sources-light.png`, `sources-dark.png`: filtered observations and distinct processing state.
- `source-history.png`: shared inspector with retained transitions.
- `notebook-source.png`: the same reference NodeView inside an ordinary managed notebook.

Recording references deliberately say **Audio unavailable** and expose captured transcript/provenance. The existing native platform has no recording attachment-streaming API in this release; the UI does not invent a media URL. Managed phone snapshots stay read only pending a Mac-coordinated editing capability.

Final color-only verification: the dark Sources **Apply filters** button renders white text on the primary red fill using `--color-on-primary`; Today body text, active-day label, source links and agent replies remain legible. Screenshots and performance metadata were refreshed after this change.

Final Sources contract verification: optional Received from/to controls persist in route parameters, convert local calendar days into inclusive UTC boundaries, and reject invalid ranges before querying. Processing and history can open the coalesced representative; related revisions open in the shared inspector while retaining the table filters. Browser smoke exercised both navigation links and inspected the actual submitted date bounds.
