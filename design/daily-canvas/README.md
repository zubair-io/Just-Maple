# Daily canvas, writing and connections

Designed through the user-supplied Sketch MCP connection on October 3, 2026.

Editable source: `../today/Just Maple - Today.sketch`, page **06 · Daily canvas / Writing and connections**. All names, sources and agent responses in these design frames are illustrative. Existing design pages were preserved.

The page contains three desktop views: the shared daily canvas with named groups and authored relationships, a focused writing surface, and a graph around selected context. Warm paper, quiet borders and compact controls reuse the existing Maple palette. Source/agent provenance remains visible. Screenshots were reviewed after correcting fill rendering, stack ordering and writing line wrapping.

The app implements the design's interaction direction through the existing Angular/Tiptap editor: smooth header dragging, pointer resize, rectangle selection, Space/middle-button pan, anchored ctrl-wheel and WebKit gesture zoom, grouping, directed labeled connections, focused writing, typography controls, and a bounded graph with source inspection. The graph is derived from authored links; it does not invent relationships from proximity or group membership.

Writing and order remain in the dated Markdown. Canvas positions, sizes, groups and optional connections are presentation metadata in its existing `mapleCanvas` frontmatter field. Views share the same live document and recoverable native save contract. Camera and typography are session preferences.

The attention strip reflects existing native request state, pending context and evidence-backed task/carry-forward offers. Suggestions require explicit user action. Dismissal is session-local and scoped to the exact IDs/versions; failures and pending requests retain actionable controls. Provider failures never become synthetic successes.

The screenshots here show design intent. `.build/daily-canvas-v2` contains explicitly synthetic browser verification of the implemented app. Programmatic WebKit gesture checks do not establish physical trackpad feel, VoiceOver quality, or parity with every tldraw/Excalidraw feature. Nested boards, ink, freehand shapes, arbitrary relationship inference and always-on autonomous external actions are outside this MVP.
