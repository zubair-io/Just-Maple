# Daily actions — Sugar Maple review handoff

September 23, 2026. Draft interaction designs, not shipped feature claims.

Open the existing **Just Maple** document in Sugar Maple and expand **Daily actions · Release 1**. Seven additive pages preserve the existing document and earlier designs:

1. Daily action · Mac
2. Daily action · iPhone
3. Later · iPhone
4. Waiting · iPhone
5. Source fallback · iPhone
6. Sync and recovery states
7. Overview · Release 1

The pages reuse the document's `jm-bg`, `jm-alt`, `jm-surface`, `jm-accent`, `jm-ink` and related palette tokens and existing button styling. Implementation must use shared Angular/Maple elements and system light/dark tokens; these light review boards do not constitute a separate theme implementation. All examples are synthetic. These are content/interaction drafts; final shell integration and all accessibility states still require review.

Prototype targets connect task actions to representative sheets or recovery states. They illustrate navigation, not functioning task mutations. Source copying, date selection and editing remain design specifications. No external message is sent by a prototype.

The Mac and phone task detail emphasize the action, responsibility, timing, source and fast resolution. Later preserves the original deadline and warns about a chosen date beyond it. Waiting explains that a review creates a follow-up while the original obligation remains blocked. Recovery distinguishes locally saved pending work, applied completion, a conflicting newer edit and reversible dismissal.

Overview intentionally bounds lists and separates waiting. Dynamic activity selection and generated change summaries remain deferred. The board's sample freshness is illustrative; production must derive it from actual processing metadata.

Verified the mobile task and Overview layouts in the actual Sugar Maple window, and the editor reported a saved `.syrup` bundle. A read-only export of the seven pages/tokens/nodes is retained in [daily-actions-design.json](daily-actions-design.json), document revision 189. Existing pages were not replaced. Additional grouped-request layouts and full dark/keyboard/accessibility review remain follow-on design work.

Implementation contracts: [Daily actions](DAILY-ACTIONS-CONTRACT.md). Product scope: [PRD](PRD-JUST-MAPLE.md).
