/**
 * URL validation and resolution utilities for API code blocks.
 *
 * Enforces absolute URLs only — relative paths are never executed
 * to prevent accidental requests against the hosting origin.
 */

/**
 * Check whether a string is an absolute HTTP(S) URL.
 */
export function isAbsoluteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Join a server base URL with an endpoint path.
 * Returns `null` if the result is not a valid absolute URL.
 */
export function resolveApiUrl(server: string | undefined, path: string): string | null {
  if (!server || !isAbsoluteUrl(server)) return null;

  // Strip trailing slash from server, ensure leading slash on path
  const base = server.replace(/\/+$/, '');
  const endpoint = path.startsWith('/') ? path : `/${path}`;

  const full = base + endpoint;

  // Final check — must still be absolute after joining
  return isAbsoluteUrl(full) ? full : null;
}
