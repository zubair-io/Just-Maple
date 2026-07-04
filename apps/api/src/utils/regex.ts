/**
 * Escape special regex characters for safe use in RegExp and MongoDB $regex
 */
export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
