/**
 * Parser/serializer for [[shortId|title]] page link syntax.
 *
 * Examples:
 *   [[a1b2c3]]           → shortId "a1b2c3", no title
 *   [[a1b2c3|My Page]]   → shortId "a1b2c3", title "My Page"
 *   \[[escaped]]         → not parsed (backslash escapes)
 */

export interface PageLinkMatch {
    shortId: string;
    title?: string;
    index: number;
    raw: string;
}

// Match [[shortId]] or [[shortId|title]], skip escaped \[[
const PAGE_LINK_REGEX = /(?<!\\)\[\[([a-zA-Z0-9]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Find all page links in a text string.
 */
export function parsePageLinks(text: string): PageLinkMatch[] {
    const matches: PageLinkMatch[] = [];
    let match: RegExpExecArray | null;

    PAGE_LINK_REGEX.lastIndex = 0;
    while ((match = PAGE_LINK_REGEX.exec(text)) !== null) {
        const result: PageLinkMatch = {
            shortId: match[1]!,
            index: match.index,
            raw: match[0],
        };
        if (match[2]) {
            result.title = match[2];
        }
        matches.push(result);
    }

    return matches;
}

/**
 * Serialize a page link into [[shortId|title]] or [[shortId]] format.
 */
export function serializePageLink(shortId: string, title?: string): string {
    return title ? `[[${shortId}|${title}]]` : `[[${shortId}]]`;
}
