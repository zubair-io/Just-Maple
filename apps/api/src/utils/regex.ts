/**
 * Escape special regex characters for safe use in RegExp and MongoDB $regex
 */
export function escapeRegex(str: string): string {
    if (typeof str !== 'string') return str;
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
