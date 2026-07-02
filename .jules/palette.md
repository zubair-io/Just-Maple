## 2026-07-02 - Decorative Font Icons Exposed to Screen Readers

**Learning:** The codebase makes heavy use of Google's `material-symbols-rounded` font icons where the ligature name (e.g., `arrow_back`, `close`, `inventory_2`) is rendered as text inside a span. If `aria-hidden="true"` is omitted on these spans, screen readers will mistakenly read the raw ligature name (e.g., "button, arrow back") even if the button has an `aria-label`, leading to confusing, redundant, or confusingly technical announcements.
**Action:** When adding or auditing icon-only buttons, always ensure that an explicit `aria-label` is set on the interactive element (e.g., `<button>`) AND that `aria-hidden="true"` is added to the inner `<span>` containing the material symbol text.
