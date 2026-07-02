## 2024-07-02 - NoSQL Injection and ReDoS Prevention

**Vulnerability:** User-supplied search queries were directly passed into MongoDB `$regex` operators and `new RegExp()` constructors without being sanitized.
**Learning:** This exposes the application to NoSQL injection and Regular Expression Denial of Service (ReDoS) attacks.
**Prevention:** Always escape user input using a centralized utility function (like `escapeRegex` from `apps/api/src/utils/regex.ts`) before passing it into MongoDB `$regex` or `RegExp` objects.
