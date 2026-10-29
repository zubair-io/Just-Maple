# Source record

- Base editor/shell: `zubair-io/Sugar-Maple`, commit `3e06248`.
- Imported tracked `src/web/` into `web/` and `src/SugarMaple/` into `apple/`, renamed
  to LocalMaple. The unrelated ingestion service in `_SugarMaple` was not used.
- Adaptations: separate identity and build target, bundled assets/fonts, local-only
  navigation/bridge scope, correlated file operations, safe document writes,
  recoverable save queue, native recorder workspace and current local test setup.
  Obsolete agenda tests referred to an absent extension and were not retained;
  page-link tests now exercise local metadata rather than removed server APIs.
- Reused recorder: `apps/apple/MapleRecorderKit` in this repository, via a relative
  Swift package reference. Host-specific storage configuration preserves existing
  hosted defaults. Optional external provider calls belong to explicit recorder
  settings; the document webview has no external connection permission.
- Assets/fonts: original user-owned Sugar Maple assets, Fontsource Lato,
  Merriweather and Material Symbols Rounded. Package licenses are retained in
  installed dependencies and bundled `WebApp/licenses/` files.
