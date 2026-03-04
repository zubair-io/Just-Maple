# Just Maple — Security & Code Review Best Practices

**Tech Stack:** Elysia (Bun) + Angular 21 + Azure Cosmos DB (MongoDB API)
**Date:** March 2026

---

## 1. Authentication & Authorization

### 1.1 JWT Token Management

| #     | Rule                                                                                                                    | Severity     | Rationale                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| 1.1.1 | Never ship fallback JWT secrets in production builds. Enforce `JWT_SECRET` via environment and fail startup if missing. | **Critical** | A known default secret allows any attacker to forge valid tokens.                            |
| 1.1.2 | Keep token expiry at or below 14 days. Implement sliding-window refresh only on active use, not on every page load.     | **High**     | Long-lived tokens increase the window of compromise if stolen.                               |
| 1.1.3 | Use HS256 with a minimum 256-bit random secret. Rotate secrets with a grace period (accept old + new during rollover).  | **High**     | Weak secrets are brute-forceable. No rotation means one leak compromises all tokens forever. |
| 1.1.4 | Store tokens in HttpOnly, Secure, SameSite=Strict cookies or in-memory only. Never persist in localStorage.             | **High**     | localStorage is accessible to any XSS payload. HttpOnly cookies are immune to script access. |
| 1.1.5 | Implement token revocation (blocklist in Redis/DB) for logout and password change scenarios.                            | **Medium**   | Without revocation, stolen tokens remain valid until natural expiry.                         |

### 1.2 Authorization Patterns

| #     | Rule                                                                                                                                | Severity     | Rationale                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| 1.2.1 | Every data-fetching repository function must accept and verify `userId` or perform access-level checks before returning data.       | **Critical** | Missing ownership checks expose other users' data (IDOR vulnerability).                          |
| 1.2.2 | Use a centralized `hasAccess(userId, resourceId, requiredLevel)` function. Never inline ad-hoc permission checks in route handlers. | **High**     | Scattered permission logic is easy to forget or implement inconsistently.                        |
| 1.2.3 | For shared notebooks, enforce the access hierarchy: owner > write > read. Write access must not grant sharing ability.              | **High**     | Privilege escalation through sharing would let write-users grant themselves owner-level control. |
| 1.2.4 | Bot API routes must use a separate auth middleware with scoped permissions. Bot tokens must never grant user-level access.          | **High**     | Bots that inherit user permissions create a lateral movement path if a bot token leaks.          |
| 1.2.5 | Log authorization failures with userId, resourceId, and attempted action for audit trails.                                          | **Medium**   | Without audit logs, detecting and investigating unauthorized access attempts is impossible.      |

### 1.3 WebSocket Security

| #     | Rule                                                                                                                           | Severity   | Rationale                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| 1.3.1 | Authenticate WebSocket connections exclusively via the `Sec-WebSocket-Protocol` header. Remove query parameter token fallback. | **High**   | Tokens in query strings appear in server logs, browser history, and referrer headers.   |
| 1.3.2 | Close connections with code 1008 (Policy Violation) on auth failure. Do not send error details over the socket.                | **Medium** | Detailed error messages help attackers enumerate valid tokens or understand auth logic. |
| 1.3.3 | Re-validate token on reconnection. Do not cache auth state across socket reconnects.                                           | **Medium** | A revoked token could still be used if the server caches the previous auth state.       |

---

## 2. Input Validation & Data Sanitization

### 2.1 Request Validation (API)

| #     | Rule                                                                                                                                   | Severity     | Rationale                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| 2.1.1 | Every route handler must define a TypeBox schema for body, params, and query. No unvalidated user input should reach business logic.   | **Critical** | Unvalidated input is the root cause of injection, type confusion, and logic bugs. |
| 2.1.2 | Apply numeric bounds to all pagination params (limit, offset). Enforce max limit (e.g., 100) and non-negative offset.                  | **High**     | Unbounded limit values can cause memory exhaustion or slow queries.               |
| 2.1.3 | Validate string lengths with `minLength`/`maxLength` on all text fields. Titles: max 255. Descriptions: max 10,000. IDs: exact format. | **High**     | Oversized strings consume memory and can cause database or rendering issues.      |
| 2.1.4 | Validate ID formats strictly: UUID v4 pattern for new IDs, base58 pattern for legacy IDs, ObjectId pattern for MongoDB `_id`.          | **Medium**   | Malformed IDs that pass to DB queries can cause errors or unexpected behavior.    |
| 2.1.5 | For date parameters, validate ISO 8601 format and enforce reasonable bounds (not before 2020, not after 2100).                         | **Low**      | Invalid dates can cause unexpected query results or crashes in date parsing.      |

### 2.2 Output Sanitization

| #     | Rule                                                                                                                                           | Severity | Rationale                                                                               |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| 2.2.1 | Never return internal fields (`_id` as ObjectId, internal flags, debug info) in API responses. Map to clean DTOs.                              | **High** | Internal data leakage helps attackers understand the system and craft targeted attacks. |
| 2.2.2 | Strip or encode HTML in any user-generated content returned in API responses that will be rendered outside Angular's sanitizer.                | **High** | Stored XSS via unsanitized content displayed in emails, notifications, or public pages. |
| 2.2.3 | Sanitize error messages: return generic messages to clients, log details server-side. Never expose stack traces, file paths, or query details. | **High** | Stack traces reveal framework versions, file structure, and internal logic.             |

### 2.3 Database Query Safety

| #     | Rule                                                                                                                                     | Severity     | Rationale                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| 2.3.1 | Always use parameterized MongoDB operators (`$eq`, `$in`, `$regex`). Never concatenate user input into query objects.                    | **Critical** | NoSQL injection allows attackers to modify query logic and extract arbitrary data. |
| 2.3.2 | Escape all user input before using in `$regex` with the `escapeRegex()` utility. Never pass raw user strings to RegExp.                  | **Critical** | Unescaped regex can cause ReDoS (Regular Expression Denial of Service).            |
| 2.3.3 | Use projection to return only needed fields from queries. Never return entire documents when only a subset is needed.                    | **Medium**   | Over-fetching wastes bandwidth and risks leaking internal fields.                  |
| 2.3.4 | Remember Cosmos DB limitations: no `$text` indexes, no `$or` with `.sort()`, no weights. Use application-level sorting and regex search. | **Medium**   | Using unsupported features causes silent failures or errors in production.         |

---

## 3. API & Network Security

### 3.1 HTTP Security Headers

| #     | Header                      | Value                                                                     | Rationale                                                                |
| ----- | --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 3.1.1 | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                                     | Enforce HTTPS. Prevent SSL stripping attacks.                            |
| 3.1.2 | `X-Content-Type-Options`    | `nosniff`                                                                 | Prevent MIME-type sniffing that could execute uploaded files as scripts. |
| 3.1.3 | `X-Frame-Options`           | `DENY`                                                                    | Prevent clickjacking by disallowing iframe embedding.                    |
| 3.1.4 | `Content-Security-Policy`   | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` | Mitigate XSS by restricting resource origins.                            |
| 3.1.5 | `X-XSS-Protection`          | `0` (rely on CSP instead)                                                 | Legacy header. Disable to avoid false positive blocking.                 |

### 3.2 CORS Configuration

| #     | Rule                                                                                                                            | Severity     | Rationale                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| 3.2.1 | Restrict CORS origins to exact production domains. Remove private IP ranges (192.168.x.x) and localhost from production config. | **High**     | Overly permissive origins allow malicious sites to make authenticated cross-origin requests. |
| 3.2.2 | Use environment-based CORS origins: dev allows localhost, production allows only justmaple.app / justmaple.ai domains.          | **High**     | Different environments have different trust boundaries.                                      |
| 3.2.3 | When `credentials: true`, never use `origin: "*"`. Elysia handles this, but verify in tests.                                    | **Critical** | Wildcard origin with credentials is universally flagged as a security vulnerability.         |

### 3.3 Rate Limiting

| #     | Rule                                                                                                                                    | Severity     | Rationale                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| 3.3.1 | Implement global rate limiting on all API endpoints (e.g., 100 req/min per IP for unauthenticated, 300 req/min for authenticated).      | **High**     | Without global rate limiting, the API is vulnerable to brute-force and DoS attacks.        |
| 3.3.2 | Apply stricter limits on auth endpoints: login, magic-link, register (e.g., 5 req/min per IP).                                          | **Critical** | Auth endpoints are the primary target for credential stuffing and brute-force attacks.     |
| 3.3.3 | Use persistent rate limit storage (Redis or DB), not in-memory Maps. In-memory state is lost on restart and not shared across replicas. | **High**     | In-memory rate limits don't survive restarts and don't work in multi-instance deployments. |
| 3.3.4 | Return standard rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.                   | **Low**      | Helps clients implement backoff and avoids unnecessary retries.                            |

### 3.4 Request Size Limits

| #     | Rule                                                                                             | Severity   | Rationale                                                 |
| ----- | ------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------- |
| 3.4.1 | Set maximum request body size: 1MB for JSON, 10MB for file uploads, 50MB for Y.js sync payloads. | **High**   | Unlimited payload sizes enable memory exhaustion attacks. |
| 3.4.2 | Validate `Content-Type` header matches expected format before parsing.                           | **Medium** | Content-type confusion can bypass validation logic.       |

---

## 4. File Upload & Storage Security

| #   | Rule                                                                                                                            | Severity     | Rationale                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| 4.1 | Validate file type by checking magic bytes, not just extension or MIME type. Allow only: jpg, png, gif, webp.                   | **High**     | Attackers can rename executables with image extensions.                                                  |
| 4.2 | Reject filenames containing `..`, `/`, `\`, or null bytes. Use server-generated filenames (`userId-timestamp.ext`) for storage. | **Critical** | Path traversal allows writing files to arbitrary locations on the server.                                |
| 4.3 | Strip all EXIF/metadata from uploaded images using `sharp` before storing. Reprocess images to eliminate embedded payloads.     | **High**     | EXIF data can contain GPS coordinates, and crafted metadata can exploit image parsers.                   |
| 4.4 | Set `Content-Disposition: attachment` on file downloads unless rendering inline is explicitly required.                         | **Medium**   | Inline rendering of user-uploaded files can execute embedded scripts in the browser.                     |
| 4.5 | Serve uploaded files from a separate domain or subdomain (e.g., `cdn.justmaple.app`) to isolate cookies and same-origin scope.  | **Medium**   | Files served from the main domain share cookies, enabling session hijacking via XSS in uploaded content. |

---

## 5. Angular Frontend Security

### 5.1 XSS Prevention

| #     | Rule                                                                                                                            | Severity     | Rationale                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| 5.1.1 | Never use `[innerHTML]` with user-generated content. Use Angular's built-in interpolation `{{ }}` which auto-escapes.           | **Critical** | innerHTML bypasses Angular's sanitizer and allows script injection.          |
| 5.1.2 | Never use `bypassSecurityTrustHtml/Url/ResourceUrl` unless absolutely necessary and the input is fully controlled.              | **Critical** | These methods explicitly disable Angular's built-in XSS protection.          |
| 5.1.3 | For rich text (TipTap/ProseMirror), sanitize on the server side before storage. Do not rely solely on client-side sanitization. | **High**     | An attacker can bypass client-side sanitization by directly calling the API. |
| 5.1.4 | Validate all URL schemes before navigating or embedding. Allow only `https:` and `mailto:` schemes.                             | **High**     | `javascript:` and `data:` URIs can execute arbitrary code.                   |

### 5.2 Secure Client-Side Storage

| #     | Rule                                                                                                           | Severity   | Rationale                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| 5.2.1 | Never store auth tokens in localStorage. Use HttpOnly cookies or in-memory storage only.                       | **High**   | localStorage is accessible to any script running on the page, including XSS payloads.        |
| 5.2.2 | IndexedDB (used for notifications, offline cache) must not contain auth tokens, API keys, or user credentials. | **High**   | IndexedDB is accessible to page scripts and persists across sessions.                        |
| 5.2.3 | Clear sensitive cached data on logout: IndexedDB stores, in-memory state, and signal values.                   | **Medium** | Leftover data from a previous session could be accessed by the next user on a shared device. |

### 5.3 HTTP Client Standards

| #     | Rule                                                                                                                                 | Severity     | Rationale                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------ |
| 5.3.1 | Always use Angular `HttpClient`, never raw `fetch()`. HttpClient uses the environment base URL and auth interceptors automatically.  | **High**     | Raw fetch bypasses auth interceptors, error handling, and environment configuration. |
| 5.3.2 | Auth interceptor must attach tokens to requests only for allowed origins (the app's own API). Never send tokens to third-party URLs. | **Critical** | Sending auth tokens to external APIs leaks credentials to third parties.             |
| 5.3.3 | Implement retry logic with exponential backoff for transient failures (5xx, network errors). Do not retry 4xx errors.                | **Low**      | Aggressive retries on server errors amplify the problem.                             |

---

## 6. Secrets & Environment Management

| #   | Rule                                                                                                                           | Severity     | Rationale                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------- |
| 6.1 | Never log secrets at startup or anywhere. Sanitize config logging to mask `JWT_SECRET`, `MONGODB_URI`, API keys.               | **Critical** | Secrets in logs are exposed to log aggregators, monitoring tools, and anyone with log access.            |
| 6.2 | Fail fast on missing required secrets in production. Add startup validation: if any required env var is empty, throw and exit. | **Critical** | Running with default/empty secrets silently creates a fully compromised system.                          |
| 6.3 | Use separate secrets per environment (dev, staging, production). Never share secrets across environments.                      | **High**     | A staging breach should not compromise production.                                                       |
| 6.4 | Store secrets in Azure Key Vault or environment variables injected at deploy time. Never commit secrets to git.                | **Critical** | Git history is permanent. A committed secret remains accessible even after removal.                      |
| 6.5 | Remove all default/fallback secret values from source code. Use environment-only injection.                                    | **High**     | Defaults in code (`'dev-secret-change-in-production'`) ship to production if env vars are misconfigured. |
| 6.6 | Document all required environment variables in a `.env.example` file without actual values.                                    | **Low**      | New developers need to know what to configure without seeing real secrets.                               |

---

## 7. Collaborative Editing (Y.js) Security

| #   | Rule                                                                                                                           | Severity   | Rationale                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| 7.1 | Validate Y.js document updates on the server before applying. Reject malformed or oversized updates.                           | **High**   | Malicious Y.js updates could corrupt shared documents or crash the server.                       |
| 7.2 | Enforce per-user write permissions in the Y.js collaboration provider, not just at the HTTP layer.                             | **High**   | WebSocket connections may bypass HTTP middleware authorization.                                  |
| 7.3 | Limit Y.js document size (e.g., 5MB max). Reject updates that would exceed the limit.                                          | **Medium** | Unbounded document growth can cause memory exhaustion on both server and client.                 |
| 7.4 | Sanitize TipTap/ProseMirror content on save: strip script tags, event handlers, and dangerous attributes from rich text nodes. | **High**   | Collaborative editing is a vector for stored XSS if content is not sanitized before persistence. |

---

## 8. Error Handling & Observability

### 8.1 API Error Responses

| #     | Rule                                                                                                                                              | Severity   | Rationale                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| 8.1.1 | Return consistent error shape: `{ error: string, message?: string }`. Include a request correlation ID for debugging.                             | **Medium** | Inconsistent error formats make client error handling fragile.                |
| 8.1.2 | Map internal errors to safe HTTP status codes. Never return 500 with raw error messages in production.                                            | **High**   | Raw error messages reveal framework details, query structure, and file paths. |
| 8.1.3 | Use 401 for missing/invalid auth, 403 for insufficient permissions, 404 for non-existent resources. Do not use 403 to confirm resource existence. | **Medium** | Returning 403 vs 404 can leak information about which resources exist.        |

### 8.2 Logging Standards

| #     | Rule                                                                                                                | Severity     | Rationale                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| 8.2.1 | Use structured logging (JSON format) with consistent fields: timestamp, level, requestId, userId, action.           | **Medium**   | Structured logs are searchable, filterable, and integrable with monitoring tools.          |
| 8.2.2 | Never log: passwords, tokens, full request bodies with sensitive data, PII beyond userId.                           | **Critical** | Logged secrets and PII create compliance violations and security risks.                    |
| 8.2.3 | Log all auth events: login success/failure, token refresh, logout, permission denied. Include IP and user agent.    | **High**     | Auth logs are the primary source for detecting account compromise and brute-force attacks. |
| 8.2.4 | Replace `console.log`/`console.error` with a proper logging library that supports log levels and structured output. | **Medium**   | Console methods don't support structured logging, log levels, or output routing.           |

---

## 9. Dependency & Build Security

| #   | Rule                                                                                                     | Severity     | Rationale                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| 9.1 | Run `bun audit` (or `npm audit`) in CI. Fail the build on critical/high vulnerabilities.                 | **High**     | Known vulnerabilities in dependencies are the easiest attack vector to exploit.                      |
| 9.2 | Pin exact dependency versions in lockfile. Use Dependabot or Renovate for automated update PRs.          | **Medium**   | Unpinned versions can pull in compromised packages via supply chain attacks.                         |
| 9.3 | Review new dependencies before adding: check package popularity, maintenance status, and known issues.   | **Medium**   | Malicious or abandoned packages are a supply chain risk.                                             |
| 9.4 | Do not expose source maps in production builds. Configure Angular build to disable source maps for prod. | **Medium**   | Source maps expose full source code, making reverse engineering and vulnerability discovery trivial. |
| 9.5 | Ensure `.env`, credentials, and private keys are in `.gitignore`. Verify with pre-commit hooks.          | **Critical** | Committed secrets are permanently in git history.                                                    |

---

## 10. Code Quality Standards

### 10.1 Angular Specific

| #      | Rule                                                                                                         | Rationale                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 10.1.1 | Use signals (`signal()`, `computed()`) for all component state. No BehaviorSubject in components.            | Signals are the Angular 21 standard. They provide better change detection performance. |
| 10.1.2 | Separate component files: `.ts`, `.html`, `.scss`. No inline templates or styles.                            | Separation of concerns, better tooling support, and easier testing.                    |
| 10.1.3 | Follow atomic design: atoms → molecules → organisms → templates. No cross-level imports skipping levels.     | Predictable component hierarchy makes the codebase navigable and reusable.             |
| 10.1.4 | One concern per page component. Use route guards (`canMatch`) for view switching, not template conditionals. | Keeps components focused and routes declarative.                                       |
| 10.1.5 | Use `input()` and `output()` functions, not `@Input`/`@Output` decorators.                                   | Function-based APIs are the modern Angular pattern with better type inference.         |

### 10.2 API Specific

| #      | Rule                                                                                                          | Rationale                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 10.2.1 | Repository pattern: all DB access goes through `*.repo.ts` files. Route handlers never touch the DB directly. | Centralizes data access logic, makes it testable, and enforces consistent authorization. |
| 10.2.2 | Use TypeBox schemas in `@maple/shared` for all API request/response types. Share types between API and Web.   | Single source of truth prevents API contract drift between frontend and backend.         |
| 10.2.3 | Services handle business logic. Repos handle data access. Routes handle HTTP concerns. Keep layers clean.     | Clear separation makes each layer independently testable and replaceable.                |
| 10.2.4 | Use `import type` for type-only imports. Enable TypeScript strict mode with no exceptions.                    | Reduces bundle size and catches type errors at compile time.                             |

### 10.3 General

| #      | Rule                                                                                                            | Rationale                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 10.3.1 | Run Prettier on save with project `.prettierrc` settings. Never manually format code.                           | Consistent formatting eliminates style debates and noisy diffs.            |
| 10.3.2 | kebab-case for all filenames. Use standard suffixes: `.component.ts`, `.service.ts`, `.repo.ts`, `.guard.ts`.   | Consistent naming makes files discoverable and indicates their role.       |
| 10.3.3 | Use Tailwind utility classes for styling. Only use SCSS for animations, pseudo-elements, and complex selectors. | Tailwind keeps styles co-located and eliminates CSS specificity conflicts. |
| 10.3.4 | Use CSS variables (`--color-primary`, `--color-bg`, etc.) from `styles.scss`. Never hardcode colors.            | Design tokens ensure visual consistency and enable theme changes.          |
| 10.3.5 | No `any` types. Use `unknown` with type narrowing, or define proper interfaces.                                 | `any` silently disables type checking and allows bugs to pass undetected.  |

---

## 11. Code Review Checklist

Use this checklist when reviewing pull requests. Every PR should be checked against these categories.

### 11.1 Security Review

1. **Auth:** Does every new endpoint check authentication? Does it verify resource ownership?
2. **Input:** Are all request parameters validated with TypeBox schemas? Are string lengths bounded?
3. **Output:** Are error responses generic? Are internal fields stripped from responses?
4. **Queries:** Is user input escaped before regex? Are queries parameterized? Are projections used?
5. **Secrets:** Are there any hardcoded secrets, tokens, or API keys? Any new env vars documented?
6. **XSS:** Any use of `innerHTML`, `bypassSecurityTrust`, or unescaped template rendering?
7. **Dependencies:** Any new dependencies added? Are they well-maintained and necessary?
8. **Files:** Do file upload endpoints validate type, size, and sanitize filenames?

### 11.2 Code Quality

1. **Signals:** Is component state using signals, not BehaviorSubject?
2. **Separation:** Are component files separate (`.ts`, `.html`, `.scss`)? One concern per component?
3. **Types:** Are shared types defined in `@maple/shared`? Is `import type` used for type-only imports?
4. **Styling:** Tailwind for layout? CSS variables for colors? No inline styles?
5. **API layers:** Routes → Services → Repositories pattern followed? No DB access in route handlers?
6. **HTTP:** Using Angular `HttpClient`, not `fetch()`? Auth interceptor handling tokens correctly?
7. **Naming:** kebab-case files with correct suffixes? Descriptive function and variable names?
8. **Formatting:** Prettier auto-formatted? No manual formatting changes in the diff?

---

## 12. Current Codebase Findings

Summary of issues found during the initial review, organized by severity. These should be addressed in order of priority.

### 12.1 Critical Issues

| Finding                                                                        | Location                     | Action Required                                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Default JWT secret shipped in source code: `'dev-secret-change-in-production'` | `apps/api/src/config.ts`     | Remove fallback. Add startup validation that throws if `JWT_SECRET` env var is missing in production. |
| Database URI and config logged at startup (may contain credentials)            | `apps/api/src/index.ts`      | Sanitize config logging. Mask connection strings and secrets before printing.                         |
| Auth tokens stored in localStorage on the frontend                             | `apps/web/src/app/services/` | Migrate to HttpOnly cookies or in-memory-only storage.                                                |

### 12.2 High Priority Issues

| Finding                                               | Location                              | Action Required                                                               |
| ----------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| No global rate limiting on API endpoints              | `apps/api/src/index.ts`               | Add rate limiting middleware (use Redis-backed store for multi-instance).     |
| WebSocket auth falls back to query parameter token    | `apps/api/src/ws/ws-auth.ts`          | Remove query param fallback. Use `Sec-WebSocket-Protocol` header only.        |
| WebAuthn challenges stored in in-memory Map           | `apps/api/src/routes/auth.ts`         | Move to Redis or DB with TTL. In-memory state is lost on restart.             |
| In-memory bot rate limiting doesn't persist or scale  | `apps/api/src/middleware/bot-auth.ts` | Use Redis-backed rate limiter for durability across restarts and replicas.    |
| No request body size limits configured                | `apps/api/src/index.ts`               | Configure Elysia body size limits per content type.                           |
| Missing security headers (HSTS, CSP, X-Frame-Options) | `apps/api/src/index.ts`               | Add security headers middleware to all responses.                             |
| CORS allows private IP ranges in non-dev environments | `apps/api/src/config.ts`              | Make CORS origins environment-specific. Remove `192.168.x.x` from production. |

### 12.3 Medium Priority Issues

| Finding                                                          | Location                      | Action Required                                                                     |
| ---------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| No token revocation mechanism (logout doesn't invalidate tokens) | `apps/api/src/routes/auth.ts` | Implement token blocklist in Redis with TTL matching token expiry.                  |
| Minimal input sanitization (only strips newlines)                | `apps/api/src/routes/`        | Expand sanitization: HTML-encode special characters for text fields stored in DB.   |
| No structured logging (uses `console.log`/`console.error`)       | `apps/api/src/`               | Adopt a structured logger (pino or winston) with JSON output and log levels.        |
| No audit logging for sensitive operations (sharing, deletion)    | `apps/api/src/`               | Add audit events for: share/unshare, delete, permission change, bot token creation. |
| Pagination params (limit, offset) have no upper bounds           | `apps/api/src/routes/`        | Add TypeBox constraints: `t.Number({ minimum: 0, maximum: 100 })` for limit.        |
