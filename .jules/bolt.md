## 2024-07-05 - Angular Template Getters Performance Bottleneck

**Learning:** Synchronous getters bound to Angular templates execute on every change detection cycle, causing performance degradation when generating dynamic classes.
**Action:** Replace synchronous getters with Angular's `computed()` signal to ensure the logic only runs when its dependencies change, preventing unnecessary recalculations.
