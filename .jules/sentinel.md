
## 2024-05-18 - [CRITICAL] Prevent NoSQL injection and ReDoS vulnerabilities in MongoDB `$regex` operators
**Vulnerability:** User-supplied strings were being passed directly to MongoDB's `$regex` operator or `RegExp` constructors in various queries without any sanitization (e.g., `apps/api/src/repositories/collectible-registry.repo.ts`, `apps/api/src/services/link.service.ts`).
**Learning:** This exposes the application to NoSQL injection and Regular Expression Denial of Service (ReDoS) attacks, as malicious users could provide regex strings containing unescaped special characters causing long processing times or arbitrary execution flow.
**Prevention:** Always sanitize user-provided strings using the newly added `escapeRegex` utility (`apps/api/src/utils/regex.ts`) before passing them to `$regex` queries or `RegExp` constructors to neutralize regex syntax special characters.
