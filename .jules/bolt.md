## 2024-06-24 - [Angular Signals Optimization]
**Learning:** Adding ChangeDetectionStrategy.OnPush along with computed() properties replacing synchronous template-bound getters for UI atoms is critical in this codebase to prevent large amounts of unnecessary ticks across the component tree.
**Action:** Always favor computed() over getters and use OnPush for leaf/atom UI components.
