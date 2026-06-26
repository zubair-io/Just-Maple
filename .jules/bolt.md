## 2026-06-26 - [Angular Change Detection: Synchronous Getters]

**Learning:** Synchronous getters bound to templates trigger unnecessary change detection, an anti-pattern in Angular applications.
**Action:** Always apply `ChangeDetectionStrategy.OnPush` and use `computed()` signals instead of getters to avoid unneeded evaluations.
