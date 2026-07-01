## 2026-07-01 - Prevent NoSQL injection and ReDoS vulnerabilities in MongoDB queries

**Vulnerability:** User-supplied strings were being passed directly to MongoDB `$regex` operators or `RegExp` constructors without sanitization.
**Learning:** This exposes the application to NoSQL injection and Regular Expression Denial of Service (ReDoS) attacks.
**Prevention:** Always sanitize user-supplied strings using the `escapeRegex` utility before passing them to `$regex` operators or `RegExp` constructors.
