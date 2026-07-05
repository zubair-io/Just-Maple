## 2024-05-18 - Missing ARIA hidden attributes on Angular material symbols

**Learning:** The codebase heavily uses `material-symbols-rounded` class for icons. Based on my memory, "In the Angular frontend, decorative icons (such as those using the 'material-symbols-rounded' class) inside interactive elements should include the 'aria-hidden="true"' attribute to prevent redundant screen reader announcements." This applies to many files.
**Action:** Always add `aria-hidden="true"` to `span` elements with `material-symbols-rounded` class when they are decorative, especially inside interactive elements like buttons.

## 2026-06-26 - [ARIA Labels for Material Icons]

**Learning:** Icon-only buttons using Material Symbols across the app frequently miss `aria-label` attributes for screen reader support and need `aria-hidden="true"` on the icon itself to prevent double reading by screen readers.
**Action:** Always verify icon-only buttons have descriptive `aria-label`s and `title`s, and ensure their child decorative icon elements have `aria-hidden="true"`.
