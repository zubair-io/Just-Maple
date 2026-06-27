## 2024-05-24 - Angular Material Icons Ligatures and Screen Readers

**Learning:** Angular's material icons often use text ligatures (e.g. `arrow_back`, `close`, `check_circle`) inside `<span>` tags. Without explicitly hiding these from screen readers using `aria-hidden="true"`, screen readers will confusingly announce the raw ligature text instead of the button's intended function. Additionally, `[attr.aria-label]` must be used for dynamic ARIA labels in Angular templates rather than just `aria-label`.
**Action:** When adding or auditing icon-only buttons using material icons, always ensure the inner `<span>` containing the ligature has `aria-hidden="true"` and the parent button has an appropriate static `aria-label` or dynamic `[attr.aria-label]`.
