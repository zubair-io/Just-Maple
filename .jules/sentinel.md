## 2025-07-03 - [Security Enhancement] Prevent NoSQL Injection/ReDoS via Unescaped Regex

**Vulnerability:** User-supplied search queries were passed directly to MongoDB `$regex` operators in `apps/api/src/services/link.service.ts` and `apps/api/src/repositories/collectible-registry.repo.ts`. This created a risk for NoSQL injection and Regular Expression Denial of Service (ReDoS).
**Learning:** MongoDB's `$regex` operator interprets regular expression metacharacters, allowing users to potentially construct complex queries that manipulate query logic or consume excessive resources. The `escapeRegex` utility existed locally in `search.service.ts` but wasn't centralized.
**Prevention:** Created a centralized utility file `apps/api/src/utils/regex.ts` exporting `escapeRegex`. Applied this utility to all instances where user-supplied strings are used within `$regex` queries.
