## 2024-05-18 - Missing ARIA hidden attributes on Angular material symbols

**Learning:** The codebase heavily uses `material-symbols-rounded` class for icons. Based on my memory, "In the Angular frontend, decorative icons (such as those using the 'material-symbols-rounded' class) inside interactive elements should include the 'aria-hidden="true"' attribute to prevent redundant screen reader announcements." This applies to many files.
**Action:** Always add `aria-hidden="true"` to `span` elements with `material-symbols-rounded` class when they are decorative, especially inside interactive elements like buttons.
