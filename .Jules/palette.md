## 2026-07-04 - Material Icons Ligatures and Screen Readers

**Learning:** Decorative icons using material symbols with text ligatures (e.g., 'arrow_back') can be confusingly announced by screen readers if they lack `aria-hidden="true"`.
**Action:** Always add `aria-hidden="true"` to icon components that rely on text ligatures, especially when used inside interactive elements like buttons, to ensure screen readers do not announce the raw ligature text.
