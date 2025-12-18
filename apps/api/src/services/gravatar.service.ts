import { createHash } from 'crypto';
import { config } from '../config';

interface GravatarProfile {
    displayName?: string;
    profileUrl?: string;
    thumbnailUrl?: string;
}

/**
 * Hash an email address for Gravatar API
 * Gravatar uses MD5 hashes, not SHA-256
 */
function hashEmail(email: string): string {
    return createHash('md5').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Fetch Gravatar profile data for an email address
 * Returns displayName and profilePictureUrl if available
 */
export async function fetchGravatarProfile(email: string): Promise<GravatarProfile> {
    try {
        const hash = hashEmail(email);
        const url = `https://api.gravatar.com/${hash}.json`;

        const response = await fetch(url, {
            headers: config.gravatarKey
                ? {
                      Authorization: `Bearer ${config.gravatarKey}`,
                  }
                : {},
        });

        if (!response.ok) {
            // No Gravatar profile found
            return {};
        }

        const data = await response.json();

        // Gravatar API returns an array of profile entries
        const entry = data.entry?.[0];
        if (!entry) {
            return {};
        }

        return {
            displayName: entry.displayName || entry.preferredUsername,
            profileUrl: entry.profileUrl,
            thumbnailUrl: entry.thumbnailUrl,
        };
    } catch (error) {
        console.error('[Gravatar] Failed to fetch profile:', error);
        return {};
    }
}

/**
 * Get Gravatar image URL for an email address
 * This doesn't require API access - it's a public URL
 * @param email - User's email address
 * @param size - Image size in pixels (default: 200)
 * @param defaultImage - What to show if no Gravatar exists (default: 'mp' for mystery person)
 */
export function getGravatarUrl(
    email: string,
    size: number = 200,
    defaultImage: string = 'mp',
): string {
    const hash = hashEmail(email);
    return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultImage}`;
}
