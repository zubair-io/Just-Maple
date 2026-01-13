/**
 * Utility for generating consistent client IDs across the collaboration system
 */

export function generateClientID(
    userId: string,
    prefix: 'ws' | 'http' | 'automerge' = 'ws',
): string {
    return `${prefix}-${userId}-${Date.now()}`;
}
