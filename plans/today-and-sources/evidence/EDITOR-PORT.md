# Daily editor port

Implemented September 27, 2026, using focused JustMaple interaction patterns, the adapted SugarMaple Markdown foundations, and JustMaple light/dark tokens. Donor projects remain unchanged.

The daily editor has a bottom floating formatting dock, with paragraph/headings, inline marks, undo/redo, an insert palette, and contextual table row/column actions. Floating UI positions the dock and contextual menus. The searchable slash menu supports keyboard navigation; the selection bubble provides marks and safe links. Block grips support pointer drag with an insertion indicator, keyboard movement, duplication, clearing and conversion. Moves retain identities; copies remap block/request identities and cannot replay task commands. Clearing uses the existing versioned document action, distinct from completing a linked task.

Markdown typing and sanitized paste preserve supported structure through reopening. Both single and double tilde strike are accepted; serialization uses double tilde. Callouts use `:::callout info` (also warning, tip and danger), with `:::info ` etc. typing shortcuts. Collapsible sections use `:::details` with a JSON title/open attribute header; nesting uses longer colon fences. Ordinary tables stay GFM, while merged/resized/complex tables use a validated `maple-table` fenced representation. Unsupported content remains available in source mode. Code nodes provide language selection and copy.

Source and canonical task atoms remain top-level to preserve the native identity/backlink contract. Source and explicit Maple insertion from a nested container places the block outside that container. A manually typed nested Maple request must be moved out before submission. Comments remain deferred until durable text anchors exist.

Attachments are copied into `Attachments/<content-hash>.<extension>` at the owning notebook root; for new Today documents this is inside the app iCloud `Just Maple` notebook. References survive moves between months. Markdown stores typed references, never embedded bytes. Import placeholders retain stable identities, with retry, missing-file and interrupted-import states. Import is limited to 12 MiB per file; raster previews support PNG/JPEG/GIF/WebP up to 40 megapixels. Generic files expose native Save a copy. Imports validate managed-document authority, bounded bytes and paths, reject symlink traversal, and preserve immutable content under concurrent imports. No remote upload service was introduced. A restarted unfinished import requires choosing the file again. Phone managed documents remain read-only.

Verification:

- 173 Angular tests across 25 suites passed.
- 292 core tests and 30 transport tests passed; CLI built.
- 58 Mac native tests across 15 suites passed, including the attachment bridge contract.
- iPhone simulator suite passed.
- New synthetic browser acceptance passed slash keyboard navigation, actual pointer drag with persisted IDs, selection formatting, callout/details, attachment import, save/reopen and light/dark/narrow layouts.
- Existing Today/Sources browser regression passed, including managed notebook source insertion. Near-limit note input-to-frame p95 measured 16.0 ms for 248,167 bytes in this run.
- Fresh Mac build and deep strict signature verification passed. The actual app opened Today, rendered the dock and displayed the insert palette without changing user writing.

Browser fixtures are explicitly synthetic and do not claim live model quality. Screenshots of the actual Mac app are kept in private local attachments, outside the repository.
