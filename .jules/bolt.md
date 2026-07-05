## 2024-06-25 - Replace Template Getters with Computed Signals in Angular

**Learning:** Angular templates using synchronous getters (like `getPriorityClasses`) cause expensive recalculations during every change detection cycle. This is a common performance bottleneck in Angular components that evaluate complex logic repeatedly.
**Action:** Replace synchronous getters bound to templates with `computed()` signals, evaluating to an object map for O(1) lookups. This caches the evaluation and prevents unnecessary executions during change detection cycles.

## 2025-02-18 - Optimize component templates and Object Maps

**Learning:** Component templates should avoid executing regular getter methods heavily, such as an array `find` lookup like `this.messageService.getUnreadCountByPageId(page.id)` in a structural directive (e.g. `@for` inside the `SidebarComponent` that iterates over pages). Every change detection cycle re-evaluates template bindings, resulting in an expensive O(N*M) calculation (number of pages * number of unread items). Do not add `ChangeDetectionStrategy.OnPush` to large complex components without instruction as it carries high risks of breaking UI reactivity.

**Action:** Convert expensive getter methods used in templates into a single `computed()` signal map. For instance, `this.messageService.unreadCounts().reduce(...)` computes an object map where page IDs are keys and unread counts are values. Lookups inside the template then become simple object property accesses `unreadCountsByPage()[page.id]`, executing in O(1) time and minimizing rendering bottlenecks.

## 2024-05-18 - [Angular Getter Optimization]

**Learning:** Found an anti-pattern where frequent synchronous template getters (`get classes()`) were used for dynamic CSS classes in high-use components (atoms like Button and Icon), causing re-evaluation on every change detection cycle.
**Action:** Replaced synchronous getters bound to templates with `computed()` signals to prevent unnecessary change detection cycles and ensure atom components can utilize `ChangeDetectionStrategy.OnPush`.
