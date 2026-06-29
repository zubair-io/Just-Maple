/**
 * Escape special regex characters for safe use in RegExp and MongoDB $regex operations
 * Mitigates NoSQL injection and ReDoS vulnerabilities.
 */
export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
