## 2024-06-25 - Replace Template Getters with Computed Signals in Angular
**Learning:** Angular templates using synchronous getters (like `getPriorityClasses`) cause expensive recalculations during every change detection cycle. This is a common performance bottleneck in Angular components that evaluate complex logic repeatedly.
**Action:** Replace synchronous getters bound to templates with `computed()` signals, evaluating to an object map for O(1) lookups. This caches the evaluation and prevents unnecessary executions during change detection cycles.
