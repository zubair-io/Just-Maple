/**
 * Converts ProseMirror JSON documents to .maple.md format.
 *
 * Extends the existing proseMirrorToMarkdown() with:
 * - Enhanced task item attributes ({priority, color, due, id})
 * - [[shortId|title]] page links
 * - maple:image / maple:embed / maple:page-link typed blocks
 * - Underline marks (rendered as <u>text</u>)
 * - Frontmatter prepending
 */

import type { ProseMirrorNode as PageContent } from './markdown-to-document';
import type { ProseMirrorNode as ContentNode } from './markdown-to-document';
import { serializeFrontmatter } from './frontmatter';
import type { FrontmatterMeta } from './frontmatter';
import { serializeTaskAttributes } from './task-attributes';
import type { TaskAttrs } from './task-attributes';
import { serializePageLink } from './page-links';
import { serializeTypedBlock } from './typed-blocks';

/**
 * Convert a ProseMirror document + frontmatter meta into a complete .maple.md string.
 * Updates meta.modified to the current ISO timestamp.
 */
export function documentToMarkdown(doc: PageContent, meta: FrontmatterMeta): string {
    meta.modified = new Date().toISOString();
    const body = docToMarkdown(doc);
    return serializeFrontmatter(meta, body);
}

/**
 * Convert a ProseMirror doc to markdown body (no frontmatter).
 */
export function docToMarkdown(content: PageContent | undefined | null): string {
    if (!content || content.type !== 'doc' || !content.content) {
        return '';
    }
    return convertNodesToMarkdown(content.content as ContentNode[], 0);
}

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
                return `${index + ((node.attrs?.['start'] as number) || 1)}. ${itemContent}`;
            });
            return items.join('\n');
        }

        case 'taskList': {
            const items = (node.content || []).map((item) => {
                const checked = !!item.attrs?.['checked'];
                const itemContent = convertListItemContent(item.content || [], depth + 1);

                // Build enhanced task attributes
                const attrs: TaskAttrs = {};
                if (item.attrs?.['priority'])
                    attrs.priority = item.attrs['priority'] as TaskAttrs['priority'];
                if (item.attrs?.['color']) attrs.color = item.attrs['color'] as string;
                if (item.attrs?.['dueDate']) attrs.due = item.attrs['dueDate'] as string;
                if (item.attrs?.['id']) attrs.id = item.attrs['id'] as string;

                return serializeTaskAttributes(itemContent, checked, attrs);
            });
            return items.join('\n');
        }

        case 'codeBlock': {
            const language = (node.attrs?.['language'] as string) || '';
            const code = getPlainText(node.content || []);
            const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(m => m[0].length + 1)));
            return `${fence}${language}\n${code}\n${fence}`;
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

        case 'table':
            return convertTableToMarkdown(node);

        case 'image': {
            const src = (node.attrs?.['src'] as string) || '';
            const alt = (node.attrs?.['alt'] as string) || '';
            const width = node.attrs?.['width'] as number | undefined;

            // Use typed block for images with extra attributes
            if (width || src.startsWith('./assets/')) {
                const data: Record<string, unknown> = { src };
                if (alt) data['alt'] = alt;
                if (width) data['width'] = width;
                return serializeTypedBlock('image', data);
            }
            return `![${alt}](${src})`;
        }

        case 'embed': {
            const url = (node.attrs?.['url'] as string) || '';
            const title = (node.attrs?.['title'] as string) || '';
            const data: Record<string, unknown> = {};
            if (url) data['url'] = url;
            if (title) data['title'] = title;
            return serializeTypedBlock('embed', data);
        }

        case 'pageLink': {
            const shortId = (node.attrs?.['shortId'] as string) || '';
            const title = (node.attrs?.['title'] as string) || '';
            const data: Record<string, unknown> = { shortId };
            if (title) data['title'] = title;
            return serializeTypedBlock('page-link', data);
        }

        case 'recording': {
            const embedType = node.attrs?.['type'] || 'recording';
            const embedId = node.attrs?.['id'] || 'unknown';
            return `[Embedded ${embedType}: ${embedId}]`;
        }

        default:
            return null;
    }
}

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

interface Mark {
    type: string;
    attrs?: Record<string, unknown>;
}

function getInlineMarkdown(nodes: ContentNode[]): string {
    return nodes
        .map((node) => {
            if (node.type === 'text') {
                let text = node.text || '';
                const marks = (node as unknown as { marks?: Mark[] }).marks;
                if (!marks?.some(mark => mark.type === 'code')) text = text.replace(/[\\`*_~\[\]<>#|]/g, '\\$&').replace(/(^|\n)([-+] |\d+\. )/g, '$1\\$2');

                if (marks) {
                    for (const mark of marks) {
                        switch (mark.type) {
                            case 'bold':
                                text = `**${text}**`;
                                break;
                            case 'italic':
                                text = `*${text}*`;
                                break;
                            case 'code':
                                {const fence="`".repeat(Math.max(1,...[...text.matchAll(/`+/g)].map(m=>m[0].length+1)));const pad=/^`|`$|^ | $/.test(text)?" ":"";text=`${fence}${pad}${text}${pad}${fence}`;}
                                break;
                            case 'strike':
                                text = `~~${text}~~`;
                                break;
                            case 'underline':
                                text = `<u>${text}</u>`;
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
            } else if (node.type === 'pageLink' || node.type === 'page-link') {
                const shortId = (node.attrs?.['shortId'] as string) || '';
                const title = node.attrs?.['title'] as string | undefined;
                return serializePageLink(shortId, title);
            }
            return '';
        })
        .join('');
}

function getPlainText(nodes: ContentNode[]): string {
    return nodes.map((node) => node.text || '').join('');
}

function convertTableToMarkdown(node: ContentNode): string {
    const rows = node.content || [];
    if (rows.length === 0) return '';

    const mdRows: string[] = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const cells = row.content || [];
        const cellTexts = cells.map((cell) => {
            const cellContent = cell.content || [];
            return cellContent.map((p) => getInlineMarkdown(p.content || [])).join(' ');
        });
        mdRows.push(`| ${cellTexts.join(' | ')} |`);
        if (i === 0) {
            mdRows.push(`| ${cellTexts.map(() => '---').join(' | ')} |`);
        }
    }
    return mdRows.join('\n');
}
