## 2024-05-30 - Angular Change Detection and Signals

**Learning:** This Angular application heavily uses Signals and `ChangeDetectionStrategy.OnPush`. Converting getters that calculate view state (like dynamic class strings) into `computed` signals, alongside ensuring `OnPush` change detection is enabled, prevents unnecessary change detection evaluations whenever any state in the application changes. This is critical for performance in large Angular apps.
**Action:** Always check Angular `@Component` for missing `ChangeDetectionStrategy.OnPush` and replace synchronous getters bound to templates with `computed()` signals to leverage fine-grained reactivity.
