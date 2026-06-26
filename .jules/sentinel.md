## 2024-05-24 - MongoDB ReDoS Vulnerabilities

**Vulnerability:** Unsanitized user inputs were being passed directly to MongoDB `$regex` operators and JavaScript `RegExp` constructors in several places (link search, bot search, collectible search). This could allow attackers to execute Regular Expression Denial of Service (ReDoS) attacks.
**Learning:** Due to the reliance on MongoDB `$regex` for partial string matching, without standardizing on text indexes or sanitizing user inputs, the API was vulnerable to ReDoS. The lack of a shared utility for `escapeRegex` meant that only `search.service.ts` had this protection, leaving other services exposed.
**Prevention:** Always escape user-provided strings before using them in `$regex` or `RegExp` by stripping/escaping special characters, or consider switching to MongoDB `$text` search indexes for unstructured query matching. Ensure a common `escapeRegex` util is provided for all database query code.
