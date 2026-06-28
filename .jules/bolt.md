## 2024-12-08 - ChangeDetectionStrategy in Angular Components

**Learning:** Angular components in the frontend heavily utilize Signals. Ensure new or modified components apply 'ChangeDetectionStrategy.OnPush' to prevent unnecessary change detection cycles. Many components, including those like `LoginComponent` and `WelcomeComponent`, are missing this strategy.
**Action:** Add `ChangeDetectionStrategy.OnPush` to components that heavily use Signals but lack it, improving performance by avoiding default change detection runs.
