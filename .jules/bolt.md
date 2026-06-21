## 2024-06-21 - Angular ChangeDetectionStrategy

**Learning:** Almost all Angular components in this codebase are missing `changeDetection: ChangeDetectionStrategy.OnPush` in their `@Component` decorator. Given that many of these components are using signals (e.g. `signal()`, `input()`, `computed()`), this is a huge performance bottleneck as Angular will run change detection for these components on every check cycle, instead of only when inputs change or signals emit.

**Action:** Add `ChangeDetectionStrategy.OnPush` to a widely used component (e.g. `OfflineIndicatorComponent` or `BacklinksPanelComponent`) or update a handful of simple ones to drastically reduce unnecessary re-renders.
