## 2025-06-28 - [NoSQL Injection and ReDoS via Unsanitized Regex Queries]

**Vulnerability:** User input was passed directly into MongoDB `$regex` operations and `new RegExp()` constructors without sanitization.
**Learning:** This exposes the application to Regular Expression Denial of Service (ReDoS) attacks and NoSQL injection, as attackers can craft malicious regex payloads to crash the database or extract sensitive data.
**Prevention:** Always use `escapeRegex` to sanitize user-provided strings before using them in regex searches or `new RegExp()` constructors.
