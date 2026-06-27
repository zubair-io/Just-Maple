## 2024-06-27 - [Fix] Prevent NoSQL Injection and ReDoS via Unescaped RegEx

**Vulnerability:** Unsanitized user inputs (`query` parameters) were being passed directly into MongoDB `$regex` operators and JavaScript `RegExp` constructors in multiple files (e.g., `link.service.ts`, `user-bot.repo.ts`, `collectible-registry.repo.ts`).
**Learning:** This could allow a malicious user to craft a complex regex string causing a Regular Expression Denial of Service (ReDoS) or use regex metacharacters to perform a NoSQL injection and bypass intended query logic.
**Prevention:** Always sanitize/escape string inputs when creating regular expressions or using the `$regex` operator in MongoDB. An `escapeRegex` utility is now centralized in `apps/api/src/utils/regex.ts` and must be used whenever user input is converted into a regular expression.
