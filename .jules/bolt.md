## 2024-05-18 - [Angular Getter Optimization]

**Learning:** Found an anti-pattern where frequent synchronous template getters (`get classes()`) were used for dynamic CSS classes in high-use components (atoms like Button and Icon), causing re-evaluation on every change detection cycle.
**Action:** Replaced synchronous getters bound to templates with `computed()` signals to prevent unnecessary change detection cycles and ensure atom components can utilize `ChangeDetectionStrategy.OnPush`.
