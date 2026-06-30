/**
 * Escapes special regex characters in a string to be safely used in a RegExp
 * constructor or a MongoDB $regex query, preventing ReDoS and NoSQL injection.
 */
export function escapeRegex(str: string): string {
    if (typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
