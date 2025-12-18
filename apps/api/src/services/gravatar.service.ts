import { createHash } from 'crypto';
import { config } from '../config';

interface GravatarProfile {
    displayName?: string;
    profileUrl?: string;
    thumbnailUrl?: string;
}

/**
 * Hash an email address for Gravatar v3 API
 * v3 API uses SHA-256 hashes
 */
function hashEmail(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Fetch Gravatar profile data for an email address using v3 API
 * Returns displayName and profilePictureUrl if available
 */
export async function fetchGravatarProfile(email: string): Promise<GravatarProfile> {
    try {
        const hash = hashEmail(email);
        const url = `https://api.gravatar.com/v3/profiles/${hash}`;

        const response = await fetch(url, {
            headers: config.gravatarKey
                ? {
                      Authorization: `Bearer ${config.gravatarKey}`,
                  }
                : {},
        });

        if (!response.ok) {
            // No Gravatar profile found (404) or other error
            return {};
        }

        const data = await response.json();

        // v3 API returns profile data directly
        return {
            displayName: data.display_name || data.name?.formatted,
            profileUrl: data.profile_url,
            thumbnailUrl: data.avatar_url,
        };
    } catch (error) {
        console.error('[Gravatar] Failed to fetch profile:', error);
        return {};
    }
}

/**
 * Get Gravatar image URL for an email address
 * This doesn't require API access - it's a public URL
 * Note: The public avatar URL uses MD5, not SHA-256
 * @param email - User's email address
 * @param size - Image size in pixels (default: 200)
 * @param defaultImage - What to show if no Gravatar exists (default: 'mp' for mystery person)
 */
export function getGravatarUrl(
    email: string,
    size: number = 200,
    defaultImage: string = 'mp',
): string {
    // Avatar URL uses MD5 (different from API which uses SHA-256)
    const md5Hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
    return `https://www.gravatar.com/avatar/${md5Hash}?s=${size}&d=${defaultImage}`;
}
