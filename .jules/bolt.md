## 2026-07-01 - Optimize Angular Component Getters

**Learning:** Angular components here heavily utilize signals. Synchronous getters bound to templates (e.g., `get myClass() { ... }`) trigger O(N) evaluation on every change detection tick, which is a specific performance anti-pattern.
**Action:** Replace synchronous getters bound to templates with `computed()` signals, especially for frequently reused components like atoms (e.g., `ButtonComponent`, `IconComponent`).
