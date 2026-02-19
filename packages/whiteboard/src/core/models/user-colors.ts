/**
 * Shared user color utilities for collaborative features
 */

const USER_COLORS = [
    '#F87171', // red
    '#FB923C', // orange
    '#FBBF24', // amber
    '#A3E635', // lime
    '#34D399', // emerald
    '#22D3EE', // cyan
    '#60A5FA', // blue
    '#A78BFA', // violet
    '#F472B6', // pink
];

/**
 * Generate a consistent color for a user based on their ID
 */
export function getUserColor(userId: string): string {
    const hash = userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return USER_COLORS[hash % USER_COLORS.length];
}

/**
 * Get a color for a numeric client ID (used for awareness)
 */
export function getColorForClientId(clientId: number): string {
    return USER_COLORS[clientId % USER_COLORS.length];
}
