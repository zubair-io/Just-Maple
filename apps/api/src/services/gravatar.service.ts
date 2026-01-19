import { createHash } from 'crypto';
import { config } from '../config';
import type { ProfilePictureUrls } from './storage.service';

interface GravatarProfile {
    displayName?: string;
    profileUrl?: string;
    /** Original Gravatar avatar URL (for downloading and processing) */
    avatarUrl?: string;
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
            avatarUrl: data.avatar_url,
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
 * @param defaultImage - What to show if no Gravatar exists (default: '404' to return 404 for no avatar)
 */
export function getGravatarUrl(
    email: string,
    size: number = 200,
    defaultImage: string = '404',
): string {
    // Avatar URL uses MD5 (different from API which uses SHA-256)
    const md5Hash = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
    return `https://www.gravatar.com/avatar/${md5Hash}?s=${size}&d=${defaultImage}`;
}

/**
 * Check if a Gravatar exists for an email (not the default avatar)
 * @param email - User's email address
 * @returns true if a custom Gravatar exists
 */
export async function hasGravatar(email: string): Promise<boolean> {
    try {
        const url = getGravatarUrl(email, 80, '404');
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Get Gravatar profile data and avatar URL for an email
 * Returns displayName and the highest resolution avatar URL available
 */
export async function getGravatarProfileAndImageUrl(
    email: string,
): Promise<{ displayName?: string; imageUrl?: string }> {
    // Try to get profile data from API first
    const profile = await fetchGravatarProfile(email);

    if (profile.avatarUrl) {
        // API returned an avatar URL - use it with higher resolution
        // Gravatar avatar_url is usually something like https://0.gravatar.com/avatar/xxx
        // We can append size parameter
        const imageUrl = profile.avatarUrl.includes('?')
            ? `${profile.avatarUrl}&s=512`
            : `${profile.avatarUrl}?s=512`;

        return {
            displayName: profile.displayName,
            imageUrl,
        };
    }

    // Fallback: check if Gravatar exists using public URL
    const hasCustomAvatar = await hasGravatar(email);
    if (hasCustomAvatar) {
        return {
            displayName: profile.displayName,
            imageUrl: getGravatarUrl(email, 512, '404'),
        };
    }

    // No Gravatar found
    return {
        displayName: profile.displayName,
    };
}
