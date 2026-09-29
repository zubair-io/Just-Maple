# Sources and note references — design concept

September 27, 2026. User-requested companion to the dated Markdown Today workspace.

The editable Sketch file is `../today/Just Maple - Today.sketch`, page **04 · Sources / States and evidence**. All data, responses, IDs and times are illustrative. No live ingestion, provider calls or app routes were changed.

## Screens

1. All incoming entries: received time, type, entry/observed state, source connection, processing state, Jev status, downstream AI status, linked note.
2. Entry detail: original source, stable identity, linked notes and chronological processing history. Shows recorded Jev output and AI output with provider/model, attempt and time. Full response, input context and evidence are separate inspectable details in the proposed UI.
3. Today: email, iMessage and Home Assistant references mixed with user writing. Each shows compact processing state and a State history link. Home Assistant also shows the observed state transition.
4. Filtered table: Type = Email AND Source = Gmail / Work. Source includes connector and account; type is independent. A state filter is also proposed.

## Sketch walkthrough

Start at All incoming entries. Click the Type/Source filter area for the combined filter example; Clear filters returns to the complete list. The Dominick row opens its history, In Today opens the note, and its email block's State history link returns to the inspector. Sidebar Today/Sources and Back to sources are linked. Other controls illustrate proposed behavior, not a working application.

## Implementation requirements to retain

- Suggested routes: `/sources`, `/sources/:eventID`, and the requested default `/today`.
- Every received source observation still enters Event/KnowledgeStore.ingest, with stable source/account/external-ID/revision identity.
- Keep observed entity state, processing state, and task completion distinct.
- History must preserve each attempt, transition, provider/model, time, routing decision, recorded response, input context version and evidence IDs. Do not reconstruct missing historical responses from today's state; label them unavailable.
- Jev is the classification stage; AI in this concept means downstream reasoning/extraction. Downstream branches may run independently. The detail view must list all applicable branches and attempts, not assume every entry follows this one successful example.
- Distinguish intentionally skipped, not yet run, pending, running, failed/retrying and completed work. Record failures without secrets or private HTTP error bodies. Never substitute a successful demo response for a failure.
- Reuse source references inside Markdown notes rather than materializing each incoming observation as a Markdown file. A source may appear in multiple notes while retaining one event identity and inspectable history.
- Refresh source state without replacing adjacent user prose or changing task completion. Show stale/unavailable and phone pending-acknowledgment states explicitly.
- Existing history UI offers connector filtering and current status; this concept adds independent type/source filtering and full attempt/response inspection. Backend support for complete historical traces needs an implementation audit.
