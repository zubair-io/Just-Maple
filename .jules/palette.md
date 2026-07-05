## 2026-06-26 - [ARIA Labels for Material Icons]

**Learning:** Icon-only buttons using Material Symbols across the app frequently miss `aria-label` attributes for screen reader support and need `aria-hidden="true"` on the icon itself to prevent double reading by screen readers.
**Action:** Always verify icon-only buttons have descriptive `aria-label`s and `title`s, and ensure their child decorative icon elements have `aria-hidden="true"`.
