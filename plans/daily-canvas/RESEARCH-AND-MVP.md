# Daily canvas MVP

Requested October 3, 2026. This addendum changes the primary Today presentation from the continuous note to a daily canvas. The approved Today/Sources ownership, evidence, task, signing, privacy and recovery contracts continue to apply. Continuous Note view remains available against the same live document.

## Product goal

Open Today and work with Maple in one spatial workspace: jot a sticky, write a longer note, collect source references and action items, then select related cards and box them together. Maple can contribute successful incoming context and answer explicitly submitted requests about selected cards. User organization and edits survive refresh, view switching, save and reopening.

## Research and decisions

Primary product documentation reviewed October 3, 2026:

| Reference | Observed behavior | Maple decision |
| --- | --- | --- |
| [Allume, formerly Muse](https://allume.com/) | Nested boards, mixed text/media cards, inbox, local-first work; a deliberately restrained toolset | Calm cards and named boxes; retain context instead of flattening everything into prose. Flat named groups for MVP; nested canvases later. |
| [FigJam sorting/summaries](https://help.figma.com/hc/en-us/articles/18711926790423-Sort-and-summarize-stickies-with-FigJam-AI) | Select stickies, sort by topic or summarize into an on-board object | Explicit selection scopes Maple requests. Preserve originals and add a reply; do not silently reorganize user work. |
| [Jambot](https://help.figma.com/hc/en-us/articles/16783866441111-Use-Jambot-in-FigJam) | Board widget uses connected stickies/sections as AI input, with named functions | An editable anchored request draft references stable selected block IDs. Only Run or Cmd+Enter submits. “Bot” remains ambiguous; Jambot is an additional reference, not a claimed identification. |
| [OpenClaw canvas](https://docs.openclaw.ai/plugins/reference/canvas) | Presents hosted widget documents on paired macOS panels | Agent results belong on the working surface. Use validated native/editor operations; no OpenClaw runtime, hosted HTML widgets or enrollment. |
| [Obsidian Canvas](https://help.obsidian.md/plugins/canvas) | Text/file cards, named groups, multi-selection, pan/zoom, open JSON Canvas format | Stable block identity, adjustable card size, reversible group operations, zoom/fit. Keep Maple's Markdown prose authority rather than a second writable JSON prose file. |
| [Apple Freeform](https://apps.apple.com/us/app/freeform/id6443742539) | Mixed media/stickies and scenes for jumping to regions | Mixed existing source renderers; bounded canvas navigation. Scenes and export later. |
| [tldraw custom shapes](https://tldraw.dev/examples/custom-shape) | Custom shapes integrated through shape utilities in its component runtime | Useful custom-card abstraction; avoid introducing a second UI framework. Use Angular DOM cards and existing Tiptap NodeViews for accessible rich text. |

## Clarified product references: personal AI, spatial work and connections

The user subsequently supplied Instinct, muse.ai, OpenAI dots, Notion and Obsidian as product references, with FigJam, nodes and graphs defining the interface. These are the primary product references for subsequent work. The earlier Muse/Allume research remains a supplemental spatial interaction reference; it is a different product from the supplied muse.ai.

| Reference | Verified public behavior | Proposed Maple interpretation |
| --- | --- | --- |
| [Instinct](https://instinct.com/) | Personal assistant uses context across applications/devices and follows up on dropped threads | Surface relevant context and unfinished commitments on Today, with inspectable sources and existing attention semantics. |
| [Muse Connector Platform](https://muse.ai/platform) | Current public page describes a personal AI agent and connectors for everyday tasks | Maple works with connected source context and produces useful work on the canvas. The homepage requires authentication; older video-search results describe an earlier product and are not the current agent reference. |
| [OpenAI dots](https://openai.com/index/introducing-dots/) | Ongoing goal-oriented work, feedback, inspectable progress and results | Agent work has visible pending/running/failed/completed states and delivers editable results beside its context. This is behavioral inspiration, not adoption of cloud computers or a new remote backend. |
| [Notion blocks](https://www.notion.com/help/what-is-a-block) and [Notion](https://www.notion.com/) | Composable content blocks, documents, knowledge and connected AI work | Cards support substantial writing, tasks and source references; opening a card offers focused editing without losing its canvas identity. |
| [Obsidian Canvas](https://obsidian.md/help/plugins/canvas) and [Graph](https://obsidian.md/help/plugins/graph) | Manual card connections/groups; graph navigation through existing note links, including focused local graphs | Provide authored connections on Today and a focused relationship graph for exploring context. Preserve local ownership and distinguish deliberate links from inferred suggestions. |

Product direction: a daily workspace where the user and Maple collect context, think spatially and move work forward. The canvas is the primary working surface. A focused graph answers “what is this connected to?”; long-form writing remains available inside cards and Note view.

### Next implementation slice

1. Connect two existing cards with a durable directed link and optional label. Move either endpoint without breaking the connection. Select, edit and remove links; deleting a link does not change the linked content or complete a task. Undo and revision-based persistence apply to connection edits.
2. Inspect connections around a selected card. Start with user-authored links and existing block-to-source/task identities. Each relationship exposes its origin. Group membership alone is organization, not proof of a semantic relationship.
3. Keep a focused graph scoped to the selected card, its sources and linked tasks, with bounded expansion and navigation back to the canvas/source inspector. Graph layout is a view of existing identities, not a second content authority.
4. Let Maple propose useful links or a grouping from selected context. Suggested relationships remain visibly proposed until accepted; supporting evidence and the originating run remain inspectable. Accepted proposals use versioned operations and preserve user edits.

Example target journey: place an email and a message on Today, link both to a writing card titled “Weekend plans,” then link that card to an action. Ask Maple about the selected cluster and receive an editable reply citing the original sources. Open the local graph to see those relationships, then return to the same canvas positions.

The current built MVP implements cards, flat groups and selected-context requests. Connectors, graph navigation and agent relationship proposals are the next slice described here; they are not implemented in that build. Markdown remains the sole writable prose/order authority, with immutable evidence and canonical tasks in local SQLite. Schema evolution must preserve older and unfamiliar metadata, stable identities, cleared tombstones and recoverable history.

## Legacy code audit

Read-only references; no source project modifications or wholesale imports:

- `JustMaple/SugarMaple/src/library/components/ink-canvas/ink-canvas.component.ts`, `ink-canvas.types.ts`: world coordinates, pointer interaction, pan/zoom, selection and resize handles. Its HTML canvas ink/path renderer does not fit rich text and accessible source cards. Reimplement only the relevant interaction patterns.
- `Just-Maple/packages/whiteboard/src/core/components/canvas/canvas.component.ts`: camera state, tool context and pointer selection. Avoid remote awareness, server services and ink rendering.
- `Just-Maple/packages/shared/src/schemas/canvas.ts`, `apps/web/src/app/pages/canvas-view/canvas-view.component.ts`, `docs/canvas-prd.md`, `docs/canvas-tech-spec.md`: node-oriented canvas and content separation; API-backed persistence is unsuitable for this Mac-owned app.
- Existing `_Just Maple` Tiptap/Yjs editor, Sugar-derived Markdown adapters, `@maple/ui`, shared source/task NodeViews and Today coordinator are the implementation foundation.

## MVP acceptance

1. Today defaults to Canvas. Note and Markdown source views retain the same content and identities; switching does not remount or discard typing.
2. Add editable sticky, local action checklist, long-form writing card, source reference and Maple request. Long-form cards are standard Markdown blockquotes containing multiple paragraphs; compact and writing sizes scroll internally.
3. Move cards using headers or keyboard arrows (Shift = larger step); select several, change color/size and arrange explicitly. Writing never initiates dragging. Scroll navigates, zoom/fit frames work.
4. Named boxes group existing identities. Move a group with its members, collapse/expand, rename or remove the box without deleting cards or completing tasks. Moving a card outside its box removes membership. Layout undo/redo emits a new recoverable document change and is separate from prose undo.
5. Automatic arrivals and Maple replies use the existing live-editor operations. New unplaced cards get a deterministic shelf below saved placements; existing organization, cleared tombstones and prose remain intact.
6. Ask about selection creates a draft carrying up to 32 stable block IDs. The Mac resolves their Markdown and source IDs from the saved expected revision and retains a bounded immutable snapshot with the run. The provider returns a plain-text answer with validated evidence IDs. No card content becomes tool instructions, and failures remain failed work with inspectable attempts.
7. Presentation-only `mapleCanvas` v1 frontmatter saves with the same Markdown commit/journal. No second writable prose store. Invalid/future metadata opens in source mode; ordinary Note/phone rendering preserves the field. Tombstoned placements are retained for restoration.
8. Existing canonical-task completion, clear/restore, source inspection, pending Mac acknowledgments and provider selection remain intact. Phone stays on its compatible note/read-only representation.

## Limits and next steps

MVP has flat named groups, grid snapping, predefined card sizes and a bounded zoom range. Drawing tools, connector arrows, nested boards, selection lasso, phone canvas editing, semantic AI rearrangement, cross-day group transfer and image/PDF board export are deferred. AI proposes next steps in replies; it does not execute tasks or reorganize cards. View/zoom are session presentation preferences; positions and grouping are durable. Existing card order in Markdown remains the reading/export order.
