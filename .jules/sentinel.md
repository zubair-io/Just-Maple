## 2024-07-05 - 🛡️ Prevent NoSQL Injection and ReDoS in MongoDB Regex Queries

**Vulnerability:** User-supplied strings were directly concatenated or passed into MongoDB `$regex` operators and JavaScript `RegExp` constructors in multiple places (e.g. `link.service.ts`, `user-bot.repo.ts`, `collectible-registry.repo.ts`).
**Learning:** This allowed users to inject arbitrary regex characters into queries, which could bypass intended search constraints (NoSQL Injection) or cause catastrophic backtracking during regex evaluation (ReDoS - Regular Expression Denial of Service).
**Prevention:** Always sanitize user-supplied search inputs by escaping special regex characters before incorporating them into a `$regex` operator or a `RegExp` constructor. Created a central `escapeRegex` utility in `apps/api/src/utils/regex.ts` to enforce this pattern consistently.
