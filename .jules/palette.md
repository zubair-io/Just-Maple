## 2025-02-18 - Missing ARIA hidden attributes on icon ligatures

**Learning:** Decorative icons using material-symbols-rounded class and text ligatures lack aria-hidden="true" attributes on several components (e.g. Kanban board). This can cause screen readers to announce confusing raw ligature text.
**Action:** Always add aria-hidden="true" to decorative text-ligature icons within interactive elements.
