/**
 * Filename utilities for .maple.md files.
 *
 * Naming convention: {kebab-title}-{shortId}.maple.md
 * Short ID = first 6 chars of the page UUID.
 */

const MAX_TITLE_LENGTH = 60;

/**
 * Convert a title and UUID into a .maple.md filename.
 * Example: toFilename("Meeting Notes", "a1b2c3d4-5678-...") → "meeting-notes-a1b2c3.maple.md"
 */
export function toFilename(title: string, id: string): string {
    const shortId = id.replace(/-/g, '').slice(0, 6);
    const slug = toKebab(title);
    return slug ? `${slug}-${shortId}.maple.md` : `${shortId}.maple.md`;
}

/**
 * Parse a .maple.md filename back into title and shortId.
 * Returns null if the filename doesn't match the expected pattern.
 */
export function parseFilename(filename: string): { title: string; shortId: string } | null {
    const match = filename.match(/^(.+)-([a-zA-Z0-9]{6})\.maple\.md$/);
    if (!match) {
        // Handle ID-only filenames: {shortId}.maple.md
        const idOnly = filename.match(/^([a-zA-Z0-9]{6})\.maple\.md$/);
        if (idOnly) {
            return { title: '', shortId: idOnly[1]! };
        }
        return null;
    }
    return { title: match[1]!, shortId: match[2]! };
}

/**
 * Build a sidecar filename from the main file stem and sidecar type.
 * Example: toSidecarFilename("architecture-a1b2c3", "whiteboard") → "architecture-a1b2c3.whiteboard.json"
 */
export function toSidecarFilename(stem: string, type: 'whiteboard' | 'kanban' | 'data'): string {
    return `${stem}.${type}.json`;
}

/**
 * Parse a sidecar filename into its stem and type.
 * Example: parseSidecarFilename("architecture-a1b2c3.whiteboard.json") → { stem: "architecture-a1b2c3", type: "whiteboard" }
 */
export function parseSidecarFilename(filename: string): { stem: string; type: string } | null {
    const match = filename.match(/^(.+)\.(whiteboard|kanban|data)\.json$/);
    if (!match) return null;
    return { stem: match[1]!, type: match[2]! };
}

/**
 * Convert a title to kebab-case, stripping non-ASCII and special chars.
 */
function toKebab(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, MAX_TITLE_LENGTH);
}
