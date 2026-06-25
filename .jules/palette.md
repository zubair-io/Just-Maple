## 2024-05-15 - ARIA Labels and Hidden Icons in Angular

**Learning:** When using Angular, it's important to use standard Angular attribute binding syntax like `[attr.aria-label]` for dynamic labels on elements such as interactive buttons based on state. Furthermore, decorative icons (like those utilizing the `material-symbols-rounded` class) inside interactive elements should include `aria-hidden="true"` to prevent screen readers from redundantly announcing the icon along with the parent element's label.
**Action:** Ensure that all icon-only interactive elements possess appropriate `aria-label`s and that their internal icons use `aria-hidden="true"`. Use `[attr.aria-label]` when the label text changes based on component state.
