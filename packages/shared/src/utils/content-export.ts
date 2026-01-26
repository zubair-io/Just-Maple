import type { PageContent } from '../schemas/page';
import type { ContentNode } from './content-traversal';

/**
 * Mark definition for text nodes
 */
interface Mark {
    type: string;
    attrs?: Record<string, unknown>;
}

/**
 * Convert ProseMirror JSON content to Markdown
 */
export function proseMirrorToMarkdown(content: PageContent | undefined | null): string {
    if (!content || content.type !== 'doc' || !content.content) {
        return '';
    }

    return convertNodesToMarkdown(content.content as ContentNode[], 0);
}

/**
 * Convert an array of ProseMirror nodes to Markdown
 */
function convertNodesToMarkdown(nodes: ContentNode[], depth: number): string {
    const parts: string[] = [];

    for (const node of nodes) {
        const md = convertNodeToMarkdown(node, depth);
        if (md !== null) {
            parts.push(md);
        }
    }

    return parts.join('\n\n');
}

/**
 * Convert a single ProseMirror node to Markdown
 */
function convertNodeToMarkdown(node: ContentNode, depth: number): string | null {
    switch (node.type) {
        case 'heading': {
            const level = (node.attrs?.['level'] as number) || 1;
            const prefix = '#'.repeat(level);
            const text = getInlineMarkdown(node.content || []);
            return `${prefix} ${text}`;
        }

        case 'paragraph': {
            return getInlineMarkdown(node.content || []);
        }

        case 'bulletList': {
            const items = (node.content || []).map((item) => {
                const itemContent = convertListItemContent(item.content || [], depth + 1);
                return `- ${itemContent}`;
            });
            return items.join('\n');
        }

        case 'orderedList': {
            const items = (node.content || []).map((item, index) => {
                const itemContent = convertListItemContent(item.content || [], depth + 1);
                return `${index + 1}. ${itemContent}`;
            });
            return items.join('\n');
        }

        case 'taskList': {
            const items = (node.content || []).map((item) => {
                const checked = item.attrs?.['checked'] ? 'x' : ' ';
                const itemContent = convertListItemContent(item.content || [], depth + 1);
                return `- [${checked}] ${itemContent}`;
            });
            return items.join('\n');
        }

        case 'codeBlock': {
            const language = (node.attrs?.['language'] as string) || '';
            const code = getPlainText(node.content || []);
            return `\`\`\`${language}\n${code}\n\`\`\``;
        }

        case 'blockquote': {
            const content = convertNodesToMarkdown(node.content || [], depth);
            return content
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n');
        }

        case 'horizontalRule':
            return '---';

        case 'table': {
            return convertTableToMarkdown(node);
        }

        case 'embed':
        case 'recording': {
            // Embeds are represented as placeholders
            const embedType = node.attrs?.['type'] || node.type;
            const embedId = node.attrs?.['id'] || 'unknown';
            return `[Embedded ${embedType}: ${embedId}]`;
        }

        default:
            return null;
    }
}

/**
 * Convert list item content (handles nested lists)
 */
function convertListItemContent(nodes: ContentNode[], depth: number): string {
    const parts: string[] = [];

    for (const node of nodes) {
        if (node.type === 'paragraph') {
            parts.push(getInlineMarkdown(node.content || []));
        } else if (
            node.type === 'bulletList' ||
            node.type === 'orderedList' ||
            node.type === 'taskList'
        ) {
            // Handle nested lists with proper indentation
            const nestedMd = convertNodeToMarkdown(node, depth);
            if (nestedMd) {
                const indented = nestedMd
                    .split('\n')
                    .map((line) => '  ' + line)
                    .join('\n');
                parts.push('\n' + indented);
            }
        }
    }

    return parts.join('');
}

/**
 * Convert inline content (text with marks) to Markdown
 */
function getInlineMarkdown(nodes: ContentNode[]): string {
    return nodes
        .map((node) => {
            if (node.type === 'text') {
                let text = node.text || '';
                const marks = (node as any).marks as Mark[] | undefined;

                if (marks) {
                    // Apply marks in order (inner to outer for proper nesting)
                    for (const mark of marks) {
                        switch (mark.type) {
                            case 'bold':
                                text = `**${text}**`;
                                break;
                            case 'italic':
                                text = `*${text}*`;
                                break;
                            case 'code':
                                text = `\`${text}\``;
                                break;
                            case 'strike':
                                text = `~~${text}~~`;
                                break;
                            case 'link': {
                                const href = mark.attrs?.['href'] || '';
                                text = `[${text}](${href})`;
                                break;
                            }
                        }
                    }
                }

                return text;
            } else if (node.type === 'mention') {
                const handle = node.attrs?.['handle'] || 'unknown';
                return `@${handle}`;
            } else if (node.type === 'hardBreak') {
                return '  \n';
            }

            return '';
        })
        .join('');
}

/**
 * Get plain text from nodes (for code blocks)
 */
function getPlainText(nodes: ContentNode[]): string {
    return nodes.map((node) => node.text || '').join('');
}

/**
 * Convert table node to Markdown
 */
function convertTableToMarkdown(node: ContentNode): string {
    const rows = node.content || [];
    if (rows.length === 0) return '';

    const mdRows: string[] = [];
    let headerSeparator: string | null = null;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const cells = row.content || [];
        const cellTexts = cells.map((cell) => {
            const cellContent = cell.content || [];
            return cellContent.map((p) => getInlineMarkdown(p.content || [])).join(' ');
        });

        mdRows.push(`| ${cellTexts.join(' | ')} |`);

        // Add header separator after first row
        if (i === 0) {
            headerSeparator = `| ${cellTexts.map(() => '---').join(' | ')} |`;
            mdRows.push(headerSeparator);
        }
    }

    return mdRows.join('\n');
}

/**
 * Convert ProseMirror JSON content to HTML
 */
export function proseMirrorToHtml(content: PageContent | undefined | null): string {
    if (!content || content.type !== 'doc' || !content.content) {
        return '';
    }

    return convertNodesToHtml(content.content as ContentNode[]);
}

/**
 * Convert an array of ProseMirror nodes to HTML
 */
function convertNodesToHtml(nodes: ContentNode[]): string {
    return nodes.map((node) => convertNodeToHtml(node)).join('\n');
}

/**
 * Convert a single ProseMirror node to HTML
 */
function convertNodeToHtml(node: ContentNode): string {
    switch (node.type) {
        case 'heading': {
            const level = (node.attrs?.['level'] as number) || 1;
            const text = getInlineHtml(node.content || []);
            return `<h${level}>${text}</h${level}>`;
        }

        case 'paragraph': {
            const text = getInlineHtml(node.content || []);
            return `<p>${text}</p>`;
        }

        case 'bulletList': {
            const items = (node.content || [])
                .map((item) => `<li>${convertListItemHtml(item.content || [])}</li>`)
                .join('\n');
            return `<ul>\n${items}\n</ul>`;
        }

        case 'orderedList': {
            const items = (node.content || [])
                .map((item) => `<li>${convertListItemHtml(item.content || [])}</li>`)
                .join('\n');
            return `<ol>\n${items}\n</ol>`;
        }

        case 'taskList': {
            const items = (node.content || [])
                .map((item) => {
                    const checked = item.attrs?.['checked'] ? 'checked' : '';
                    const content = convertListItemHtml(item.content || []);
                    return `<li><input type="checkbox" ${checked} disabled /> ${content}</li>`;
                })
                .join('\n');
            return `<ul class="task-list">\n${items}\n</ul>`;
        }

        case 'codeBlock': {
            const language = (node.attrs?.['language'] as string) || '';
            const code = escapeHtml(getPlainText(node.content || []));
            const langAttr = language ? ` class="language-${language}"` : '';
            return `<pre><code${langAttr}>${code}</code></pre>`;
        }

        case 'blockquote': {
            const content = convertNodesToHtml(node.content || []);
            return `<blockquote>\n${content}\n</blockquote>`;
        }

        case 'horizontalRule':
            return '<hr />';

        case 'table': {
            return convertTableToHtml(node);
        }

        case 'embed':
        case 'recording': {
            const embedType = node.attrs?.['type'] || node.type;
            const embedId = node.attrs?.['id'] || 'unknown';
            return `<div class="embed embed-${embedType}" data-id="${escapeHtml(String(embedId))}">[Embedded ${embedType}]</div>`;
        }

        default:
            return '';
    }
}

/**
 * Convert list item content to HTML (handles nested lists)
 */
function convertListItemHtml(nodes: ContentNode[]): string {
    const parts: string[] = [];

    for (const node of nodes) {
        if (node.type === 'paragraph') {
            parts.push(getInlineHtml(node.content || []));
        } else if (
            node.type === 'bulletList' ||
            node.type === 'orderedList' ||
            node.type === 'taskList'
        ) {
            parts.push(convertNodeToHtml(node));
        }
    }

    return parts.join('\n');
}

/**
 * Convert inline content (text with marks) to HTML
 */
function getInlineHtml(nodes: ContentNode[]): string {
    return nodes
        .map((node) => {
            if (node.type === 'text') {
                let text = escapeHtml(node.text || '');
                const marks = (node as any).marks as Mark[] | undefined;

                if (marks) {
                    // Apply marks (wrap text with tags)
                    for (const mark of marks) {
                        switch (mark.type) {
                            case 'bold':
                                text = `<strong>${text}</strong>`;
                                break;
                            case 'italic':
                                text = `<em>${text}</em>`;
                                break;
                            case 'code':
                                text = `<code>${text}</code>`;
                                break;
                            case 'strike':
                                text = `<s>${text}</s>`;
                                break;
                            case 'underline':
                                text = `<u>${text}</u>`;
                                break;
                            case 'link': {
                                const href = escapeHtml(String(mark.attrs?.['href'] || ''));
                                text = `<a href="${href}">${text}</a>`;
                                break;
                            }
                        }
                    }
                }

                return text;
            } else if (node.type === 'mention') {
                const handle = escapeHtml(String(node.attrs?.['handle'] || 'unknown'));
                return `<span class="mention">@${handle}</span>`;
            } else if (node.type === 'hardBreak') {
                return '<br />';
            }

            return '';
        })
        .join('');
}

/**
 * Convert table node to HTML
 */
function convertTableToHtml(node: ContentNode): string {
    const rows = node.content || [];
    if (rows.length === 0) return '';

    const htmlRows: string[] = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const cells = row.content || [];
        const isHeader = i === 0;
        const tag = isHeader ? 'th' : 'td';

        const cellsHtml = cells
            .map((cell) => {
                const cellContent = cell.content || [];
                const content = cellContent.map((p) => getInlineHtml(p.content || [])).join(' ');
                return `<${tag}>${content}</${tag}>`;
            })
            .join('');

        htmlRows.push(`<tr>${cellsHtml}</tr>`);
    }

    // Wrap first row in thead, rest in tbody
    const thead = `<thead>\n${htmlRows[0]}\n</thead>`;
    const tbody = htmlRows.length > 1 ? `<tbody>\n${htmlRows.slice(1).join('\n')}\n</tbody>` : '';

    return `<table>\n${thead}\n${tbody}\n</table>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Generate a complete HTML document with basic styling
 */
export function proseMirrorToHtmlDocument(
    content: PageContent | undefined | null,
    title?: string,
): string {
    const body = proseMirrorToHtml(content);
    const pageTitle = title ? escapeHtml(title) : 'Exported Memo';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            color: #333;
        }
        h1, h2, h3, h4, h5, h6 {
            margin-top: 1.5em;
            margin-bottom: 0.5em;
        }
        h1 { font-size: 2em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.25em; }
        pre {
            background: #f5f5f5;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            background: #f5f5f5;
            padding: 0.2em 0.4em;
            border-radius: 3px;
            font-size: 0.9em;
        }
        pre code {
            background: none;
            padding: 0;
        }
        blockquote {
            border-left: 4px solid #ddd;
            margin: 1em 0;
            padding-left: 1em;
            color: #666;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 0.5em;
            text-align: left;
        }
        th {
            background: #f5f5f5;
        }
        .task-list {
            list-style: none;
            padding-left: 0;
        }
        .task-list li {
            display: flex;
            align-items: flex-start;
            gap: 0.5em;
        }
        .mention {
            color: #0066cc;
            font-weight: 500;
        }
        .embed {
            background: #f0f0f0;
            padding: 1rem;
            border-radius: 4px;
            color: #666;
            font-style: italic;
        }
    </style>
</head>
<body>
${body}
</body>
</html>`;
}
