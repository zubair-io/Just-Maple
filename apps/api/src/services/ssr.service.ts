let cachedTemplate: string | null = null;

export interface MetaTags {
    title: string;
    description: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    ogUrl: string;
    ogType?: string;
    ogSiteName?: string;
    twitterCard?: string;
    canonicalUrl: string;
    faviconUrl?: string;
    jsonLd?: Record<string, unknown>;
}

export async function getHtmlTemplate(staticDir: string): Promise<string> {
    if (cachedTemplate) return cachedTemplate;
    const { join } = await import('path');
    const indexPath = join(staticDir, 'index.html');
    const file = Bun.file(indexPath);
    if (await file.exists()) {
        cachedTemplate = await file.text();
    } else {
        cachedTemplate = '';
    }
    return cachedTemplate;
}

export function clearTemplateCache(): void {
    cachedTemplate = null;
}

export function injectMetaTags(html: string, meta: MetaTags): string {
    const ogTitle = meta.ogTitle || meta.title;
    const ogDescription = meta.ogDescription || meta.description;
    const ogType = meta.ogType || 'website';
    const ogSiteName = meta.ogSiteName || 'Just Maple';
    const twitterCard = meta.twitterCard || (meta.ogImage ? 'summary_large_image' : 'summary');

    const tags: string[] = [
        `<meta name="description" content="${escapeAttr(meta.description)}" />`,
        `<link rel="canonical" href="${escapeAttr(meta.canonicalUrl)}" />`,
        `<meta property="og:title" content="${escapeAttr(ogTitle)}" />`,
        `<meta property="og:description" content="${escapeAttr(ogDescription)}" />`,
        `<meta property="og:url" content="${escapeAttr(meta.ogUrl)}" />`,
        `<meta property="og:type" content="${escapeAttr(ogType)}" />`,
        `<meta property="og:site_name" content="${escapeAttr(ogSiteName)}" />`,
        `<meta name="twitter:card" content="${escapeAttr(twitterCard)}" />`,
        `<meta name="twitter:title" content="${escapeAttr(ogTitle)}" />`,
        `<meta name="twitter:description" content="${escapeAttr(ogDescription)}" />`,
    ];

    if (meta.ogImage) {
        tags.push(`<meta property="og:image" content="${escapeAttr(meta.ogImage)}" />`);
        tags.push(`<meta name="twitter:image" content="${escapeAttr(meta.ogImage)}" />`);
    }

    if (meta.faviconUrl) {
        tags.push(`<link rel="icon" type="image/png" href="${escapeAttr(meta.faviconUrl)}" />`);
    }

    if (meta.jsonLd) {
        tags.push(`<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`);
    }

    const tagBlock = tags.join('\n    ');

    return html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${escapeHtml(meta.title)}</title>\n    ${tagBlock}`,
    );
}

/**
 * Extract a plain-text snippet from ProseMirror JSON content.
 * Walks text nodes and returns the first ~maxLength characters.
 */
export function extractTextSnippet(content: unknown, maxLength = 160): string {
    if (!content || typeof content !== 'object') return '';

    const texts: string[] = [];
    let totalLength = 0;

    function walk(node: any): void {
        if (totalLength >= maxLength) return;
        if (node.type === 'text' && typeof node.text === 'string') {
            texts.push(node.text);
            totalLength += node.text.length;
        }
        if (Array.isArray(node.content)) {
            for (const child of node.content) {
                walk(child);
            }
        }
    }

    walk(content);
    const full = texts.join(' ').trim();
    if (full.length <= maxLength) return full;
    return full.slice(0, maxLength - 3).trimEnd() + '...';
}

function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
