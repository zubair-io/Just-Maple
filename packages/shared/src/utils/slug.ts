/**
 * Build a display slug: "{slugified-title}-{shortId}".
 * Used in URLs for SEO/readability; only the shortId is stored in DB.
 */
export function toDisplaySlug(title: string, shortId: string): string {
    const prefix = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
    return prefix ? `${prefix}-${shortId}` : shortId;
}

/**
 * Extract the shortId from a display slug like "my-notebook-a3k9m2x7" -> "a3k9m2x7".
 * If no prefix, returns the slug as-is.
 */
export function extractSlugId(displaySlug: string): string {
    const lastDash = displaySlug.lastIndexOf('-');
    return lastDash >= 0 ? displaySlug.slice(lastDash + 1) : displaySlug;
}
