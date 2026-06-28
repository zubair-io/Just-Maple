## 2024-05-24 - Screen Reader Issues with Angular Material Symbols

**Learning:** Decorative icons using text ligatures (like `<span class="material-symbols-rounded">arrow_back</span>`) will be read literally by screen readers as "arrow back" rather than the intended action. When these are inside interactive elements like buttons, it creates a confusing experience.
**Action:** Always add `aria-hidden="true"` to ligature-based icons inside interactive elements, and ensure the parent element has an appropriate `aria-label` (e.g., `aria-label="Go back"`).
