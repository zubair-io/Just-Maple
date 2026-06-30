## 2023-10-27 - [Fix] NoSQL Injection / ReDoS via Unsanitized `$regex`

**Vulnerability:** User-provided queries were directly passed into MongoDB `$regex` operators in `search.service.ts`, `link.service.ts` and `collectible-registry.repo.ts`.
**Learning:** This exposes the application to NoSQL Injection (if the query is unexpectedly an object instead of a string) and Regular Expression Denial of Service (ReDoS) by allowing unescaped regex special characters.
**Prevention:** Created a global utility `escapeRegex` in `apps/api/src/utils/regex.ts`. Always use `escapeRegex` on user-supplied strings before passing them to `$regex` operators or `new RegExp()` constructors. Ensure to check `typeof str !== 'string'` defensively.
