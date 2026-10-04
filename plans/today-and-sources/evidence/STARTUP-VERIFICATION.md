# Mac workspace startup verification

Verified September 27, 2026 after reproducing the workspace stuck at “Opening your workspace…”.

The local shell now opens before notebook recovery, connection restoration and background context hydration. Snapshot polling reads cached model state independently of filesystem requests. Opening failures show a retry action without resetting files; later connection failures leave the workspace usable. Connection-setting changes wait for restoration to finish. Overlapping context refreshes coalesce into a trailing pass, and mutation callers wait for that fresh state.

Navigation tests cover delayed Today reads and saves so an older request cannot return the user to Today after choosing Sources. Editor drafts and queued saves survive route changes. Query-plan and semantic retrieval corrections are documented in [QUERY-PERFORMANCE.md](QUERY-PERFORMANCE.md).

Validation:

- 288 core and 30 transport tests passed; MapleCore CLI built.
- 130 Angular tests passed; production build and synthetic browser smoke passed.
- 57 Mac native tests across 14 suites passed, including startup failure/retry, cached snapshot, overlapping refresh and restoration guards.
- iPhone simulator test suite passed.
- Fresh `npm run build` succeeded; deep strict code-signature verification passed.
- Actual rebuilt Mac app launched against the existing workspace: Today rendered its editable note, Sources loaded approximately 40,000 observations, and returning to Today rendered the editor again. No user writing was changed during this check.
- Diff whitespace and secret scans passed.

Screenshots remain in private local attachments, outside the repository. Automated provider/storage checks do not establish live model classification quality.
