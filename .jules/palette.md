## 2025-06-23 - Dynamic ARIA Labels on Interactive Angular Elements

**Learning:** When adding `aria-label` attributes to elements in Angular where the value changes based on component state (e.g., a Play/Pause button that toggles between two states based on an `isPlaying()` signal), the standard `aria-label="{{ value }}"` or `[aria-label]="value"` syntax often fails or is less robust. The strict and correct way to bind ARIA attributes dynamically in Angular is using the attribute binding syntax: `[attr.aria-label]="condition ? 'State A' : 'State B'"`. Additionally, any decorative icons (like SVGs) inside these buttons must explicitly have `aria-hidden="true"` so screen readers read the dynamic label and not raw SVG content.

**Action:** Always use `[attr.aria-label]` for dynamic accessibility labels in Angular components. Accompany interactive buttons that have purely visual states (like Play/Pause icons) with explicit `aria-hidden="true"` on their child graphics.

## 2025-02-18 - Missing ARIA hidden attributes on icon ligatures

**Learning:** Decorative icons using material-symbols-rounded class and text ligatures lack aria-hidden="true" attributes on several components (e.g. Kanban board). This can cause screen readers to announce confusing raw ligature text.
**Action:** Always add aria-hidden="true" to decorative text-ligature icons within interactive elements.

## 2026-07-02 - Decorative Font Icons Exposed to Screen Readers

**Learning:** The codebase makes heavy use of Google's `material-symbols-rounded` font icons where the ligature name (e.g., `arrow_back`, `close`, `inventory_2`) is rendered as text inside a span. If `aria-hidden="true"` is omitted on these spans, screen readers will mistakenly read the raw ligature name (e.g., "button, arrow back") even if the button has an `aria-label`, leading to confusing, redundant, or confusingly technical announcements.
**Action:** When adding or auditing icon-only buttons, always ensure that an explicit `aria-label` is set on the interactive element (e.g., `<button>`) AND that `aria-hidden="true"` is added to the inner `<span>` containing the material symbol text.

## 2024-05-18 - Missing ARIA hidden attributes on Angular material symbols

**Learning:** The codebase heavily uses `material-symbols-rounded` class for icons. Based on my memory, "In the Angular frontend, decorative icons (such as those using the 'material-symbols-rounded' class) inside interactive elements should include the 'aria-hidden="true"' attribute to prevent redundant screen reader announcements." This applies to many files.
**Action:** Always add `aria-hidden="true"` to `span` elements with `material-symbols-rounded` class when they are decorative, especially inside interactive elements like buttons.

## 2026-06-26 - [ARIA Labels for Material Icons]

**Learning:** Icon-only buttons using Material Symbols across the app frequently miss `aria-label` attributes for screen reader support and need `aria-hidden="true"` on the icon itself to prevent double reading by screen readers.
**Action:** Always verify icon-only buttons have descriptive `aria-label`s and `title`s, and ensure their child decorative icon elements have `aria-hidden="true"`.
