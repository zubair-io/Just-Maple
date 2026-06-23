## 2025-06-23 - Dynamic ARIA Labels on Interactive Angular Elements

**Learning:** When adding `aria-label` attributes to elements in Angular where the value changes based on component state (e.g., a Play/Pause button that toggles between two states based on an `isPlaying()` signal), the standard `aria-label="{{ value }}"` or `[aria-label]="value"` syntax often fails or is less robust. The strict and correct way to bind ARIA attributes dynamically in Angular is using the attribute binding syntax: `[attr.aria-label]="condition ? 'State A' : 'State B'"`. Additionally, any decorative icons (like SVGs) inside these buttons must explicitly have `aria-hidden="true"` so screen readers read the dynamic label and not raw SVG content.

**Action:** Always use `[attr.aria-label]` for dynamic accessibility labels in Angular components. Accompany interactive buttons that have purely visual states (like Play/Pause icons) with explicit `aria-hidden="true"` on their child graphics.
