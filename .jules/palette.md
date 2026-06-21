## 2024-05-24 - Missing ARIA labels on Icon-only Control Buttons

**Learning:** Media embeds and custom players (like audio players) often rely heavily on icon-only control buttons. Developers often forget to include `aria-label`s on these custom controls or rely solely on `title` attributes which are insufficient for screen readers. Dynamic state changes (like Play/Pause) require dynamic `aria-label`s.
**Action:** When reviewing or creating new media embeds or custom players, explicitly verify that all icon-only control buttons, especially those with dynamic states, have explicitly bound `aria-label` attributes.
