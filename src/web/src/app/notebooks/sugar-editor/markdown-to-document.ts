/**
 * Converts .maple.md files into ProseMirror JSON documents.
 *
 * Uses markdown-it for parsing, then transforms the token stream
 * into ProseMirror-compatible JSON nodes.
 */

import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { parseFrontmatter } from './frontmatter';
import type { FrontmatterMeta } from './frontmatter';
import { parseTaskAttributes } from './task-attributes';
import { parsePageLinks } from './page-links';

export interface ProseMirrorNode {
    type: string;
    attrs?: Record<string, unknown>;
    content?: ProseMirrorNode[];
    text?: string;
    marks?: ProseMirrorMark[];
}

export interface ProseMirrorMark {
    type: string;
    attrs?: Record<string, unknown>;
}

export interface MarkdownToDocumentResult {
    meta: FrontmatterMeta;
    doc: ProseMirrorNode;
}

const md = new MarkdownIt({
    html: true,
    linkify: false,
});

// Enable task list parsing via manual detection (we handle it ourselves)

/**
 * Parse a .maple.md file into frontmatter meta and ProseMirror document.
 */
export function markdownToDocument(raw: string): MarkdownToDocumentResult | { error: string } {
    const frontmatterResult = parseFrontmatter(raw);
    if ('error' in frontmatterResult) {
        return frontmatterResult;
    }

    const { meta, body } = frontmatterResult;
    const doc = markdownBodyToDoc(body);

    return { meta, doc };
}

/**
 * Parse a markdown body (no frontmatter) into a ProseMirror document.
 */
export function markdownBodyToDoc(body: string): ProseMirrorNode {
    // Pre-process: extract maple typed blocks before markdown-it parsing
    const { processed, typedBlocks } = extractTypedBlocks(body);

    const tokens = md.parse(processed, {});
    const content = normalizeMixedLists(tokensToNodes(tokens, typedBlocks));

    return {
        type: 'doc',
        content: content.length > 0 ? content : [{ type: 'paragraph' }],
    };
}

// ─── Typed block extraction ───────────────────────────────────────────────

interface ExtractedBlock {
    type: string;
    data: Record<string, unknown>;
}

function extractTypedBlocks(body: string): {
    processed: string;
    typedBlocks: Map<string, ExtractedBlock>;
} {
    const typedBlocks = new Map<string, ExtractedBlock>();
    let counter = 0;

    const processed = body.replace(
        /```maple:(embed|page-link|image)\n([\s\S]*?)```/g,
        (_match, type: string, jsonStr: string) => {
            const placeholder = `MAPLE_TYPED_BLOCK_${counter++}`;
            try {
                const data = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
                typedBlocks.set(placeholder, { type, data });
            } catch {
                typedBlocks.set(placeholder, { type, data: {} });
            }
            // Replace with a paragraph containing the placeholder so markdown-it picks it up
            return placeholder;
        },
    );

    return { processed, typedBlocks };
}

// ─── Token → ProseMirror node conversion ──────────────────────────────────

function tokensToNodes(
    tokens: Token[],
    typedBlocks: Map<string, ExtractedBlock>,
): ProseMirrorNode[] {
    const nodes: ProseMirrorNode[] = [];
    let i = 0;

    while (i < tokens.length) {
        const token = tokens[i]!;

        switch (token.type) {
            case 'heading_open': {
                const level = parseInt(token.tag.slice(1), 10);
                const inlineToken = tokens[i + 1];
                const content = inlineToken ? inlineToNodes(inlineToken, typedBlocks) : [];
                nodes.push({
                    type: 'heading',
                    attrs: { level },
                    ...(content.length > 0 ? { content } : {}),
                });
                i += 3; // heading_open, inline, heading_close
                break;
            }

            case 'paragraph_open': {
                const inlineToken = tokens[i + 1];
                const inlineContent = inlineToken?.content || '';

                // Check if this is a typed block placeholder
                const blockMatch = inlineContent.match(/^MAPLE_TYPED_BLOCK_(\d+)$/);
                if (blockMatch) {
                    const block = typedBlocks.get(inlineContent);
                    if (block) {
                        nodes.push(typedBlockToNode(block));
                        i += 3;
                        break;
                    }
                }

                const content = inlineToken ? inlineToNodes(inlineToken, typedBlocks) : [];
                nodes.push({
                    type: 'paragraph',
                    ...(content.length > 0 ? { content } : {}),
                });
                i += 3; // paragraph_open, inline, paragraph_close
                break;
            }

            case 'bullet_list_open': {
                const { node, endIndex } = parseList(tokens, i, 'bulletList', typedBlocks);
                nodes.push(node);
                i = endIndex + 1;
                break;
            }

            case 'ordered_list_open': {
                const { node, endIndex } = parseList(tokens, i, 'orderedList', typedBlocks);
                nodes.push(node);
                i = endIndex + 1;
                break;
            }

            case 'blockquote_open': {
                const { node, endIndex } = parseBlockquote(tokens, i, typedBlocks);
                nodes.push(node);
                i = endIndex + 1;
                break;
            }

            case 'fence': {
                nodes.push({
                    type: 'codeBlock',
                    attrs: { language: token.info || '' },
                    content: token.content
                        ? [{ type: 'text', text: token.content.replace(/\n$/, '') }]
                        : [],
                });
                i++;
                break;
            }

            case 'code_block': {
                nodes.push({
                    type: 'codeBlock',
                    attrs: { language: '' },
                    content: token.content
                        ? [{ type: 'text', text: token.content.replace(/\n$/, '') }]
                        : [],
                });
                i++;
                break;
            }

            case 'hr': {
                nodes.push({ type: 'horizontalRule' });
                i++;
                break;
            }

            case 'table_open': {
                const { node, endIndex } = parseTable(tokens, i, typedBlocks);
                nodes.push(node);
                i = endIndex + 1;
                break;
            }

            case 'html_block': {
                // Pass through HTML blocks as paragraphs with text
                if (token.content.trim()) {
                    nodes.push({
                        type: 'paragraph',
                        content: [{ type: 'text', text: token.content.trim() }],
                    });
                }
                i++;
                break;
            }

            default:
                i++;
                break;
        }
    }

    return nodes;
}

// ─── Inline token processing ──────────────────────────────────────────────

function inlineToNodes(token: Token, _typedBlocks: Map<string, ExtractedBlock>): ProseMirrorNode[] {
    if (!token.children || token.children.length === 0) {
        if (token.content) {
            return processTextWithPageLinks(token.content);
        }
        return [];
    }

    const nodes: ProseMirrorNode[] = [];
    const markStack: ProseMirrorMark[] = [];

    for (const child of token.children) {
        switch (child.type) {
            case 'text': {
                const textNodes = processTextWithPageLinks(child.content || '');
                for (const textNode of textNodes) {
                    if (markStack.length > 0 && textNode.type === 'text') {
                        textNode.marks = [...markStack];
                    }
                    nodes.push(textNode);
                }
                break;
            }

            case 'code_inline': {
                nodes.push({
                    type: 'text',
                    text: child.content,
                    marks: [...markStack, { type: 'code' }],
                });
                break;
            }

            case 'softbreak': {
                // Treat as space or ignore
                break;
            }

            case 'hardbreak': {
                nodes.push({ type: 'hardBreak' });
                break;
            }

            case 'strong_open':
                markStack.push({ type: 'bold' });
                break;
            case 'strong_close':
                removeLastMark(markStack, 'bold');
                break;

            case 'em_open':
                markStack.push({ type: 'italic' });
                break;
            case 'em_close':
                removeLastMark(markStack, 'italic');
                break;

            case 's_open':
                markStack.push({ type: 'strike' });
                break;
            case 's_close':
                removeLastMark(markStack, 'strike');
                break;

            case 'link_open': {
                const href = child.attrGet('href') || '';
                markStack.push({ type: 'link', attrs: { href } });
                break;
            }
            case 'link_close':
                removeLastMark(markStack, 'link');
                break;

            case 'image': {
                const src = child.attrGet('src') || '';
                const alt = child.content || child.attrGet('alt') || '';
                nodes.push({
                    type: 'image',
                    attrs: { src, alt },
                });
                break;
            }

            case 'html_inline': {
                // Handle <u> and </u> for underline
                if (child.content === '<u>') {
                    markStack.push({ type: 'underline' });
                } else if (child.content === '</u>') {
                    removeLastMark(markStack, 'underline');
                }
                break;
            }

            default:
                break;
        }
    }

    return nodes;
}

function removeLastMark(marks: ProseMirrorMark[], type: string): void {
    for (let i = marks.length - 1; i >= 0; i--) {
        if (marks[i]!.type === type) {
            marks.splice(i, 1);
            return;
        }
    }
}

// ─── Page link processing ─────────────────────────────────────────────────

function processTextWithPageLinks(text: string): ProseMirrorNode[] {
    const links = parsePageLinks(text);
    if (links.length === 0) {
        return text ? [{ type: 'text', text }] : [];
    }

    const nodes: ProseMirrorNode[] = [];
    let lastIndex = 0;

    for (const link of links) {
        // Text before the link
        if (link.index > lastIndex) {
            nodes.push({ type: 'text', text: text.slice(lastIndex, link.index) });
        }
        // The page link node
        nodes.push({
            type: 'pageLink',
            attrs: {
                shortId: link.shortId,
                ...(link.title ? { title: link.title } : {}),
            },
        });
        lastIndex = link.index + link.raw.length;
    }

    // Text after the last link
    if (lastIndex < text.length) {
        nodes.push({ type: 'text', text: text.slice(lastIndex) });
    }

    return nodes;
}

// ─── List parsing ─────────────────────────────────────────────────────────

function parseList(
    tokens: Token[],
    startIndex: number,
    listType: 'bulletList' | 'orderedList',
    typedBlocks: Map<string, ExtractedBlock>,
): { node: ProseMirrorNode; endIndex: number } {
    const closeTag = listType === 'bulletList' ? 'bullet_list_close' : 'ordered_list_close';
    const items: ProseMirrorNode[] = [];
    let i = startIndex + 1;

    while (i < tokens.length && tokens[i]!.type !== closeTag) {
        if (tokens[i]!.type === 'list_item_open') {
            const { node, endIndex } = parseListItem(tokens, i, typedBlocks);
            items.push(node);
            i = endIndex + 1;
        } else {
            i++;
        }
    }

    // Check if this is actually a task list
    const isTaskList = items.every((item) => item.type === 'taskItem');

    if (isTaskList && items.length > 0) {
        return {
            node: { type: 'taskList', content: items },
            endIndex: i,
        };
    }

    return {
        node: { type: listType, content: items },
        endIndex: i,
    };
}

function parseListItem(
    tokens: Token[],
    startIndex: number,
    typedBlocks: Map<string, ExtractedBlock>,
): { node: ProseMirrorNode; endIndex: number } {
    let i = startIndex + 1;
    const itemContent: ProseMirrorNode[] = [];

    while (i < tokens.length && tokens[i]!.type !== 'list_item_close') {
        const token = tokens[i]!;

        if (token.type === 'paragraph_open') {
            const inlineToken = tokens[i + 1];
            const content = inlineToken ? inlineToNodes(inlineToken, typedBlocks) : [];
            itemContent.push({
                type: 'paragraph',
                ...(content.length > 0 ? { content } : {}),
            });
            i += 3;
        } else if (token.type === 'bullet_list_open') {
            const { node, endIndex } = parseList(tokens, i, 'bulletList', typedBlocks);
            itemContent.push(node);
            i = endIndex + 1;
        } else if (token.type === 'ordered_list_open') {
            const { node, endIndex } = parseList(tokens, i, 'orderedList', typedBlocks);
            itemContent.push(node);
            i = endIndex + 1;
        } else {
            i++;
        }
    }

    // Check if this is a task item by examining the first paragraph's text content
    const firstPara = itemContent[0];
    if (firstPara?.type === 'paragraph' && firstPara.content) {
        const firstText = firstPara.content[0];
        if (firstText?.type === 'text' && firstText.text) {
            const taskMatch = firstText.text.match(/^\[([ xX])\]\s*/);
            if (taskMatch) {
                const checked = taskMatch[1] === 'x' || taskMatch[1] === 'X';
                const remainingText = firstText.text.slice(taskMatch[0].length);

                // Parse enhanced task attributes from the remaining text line
                const taskLine = `- [${taskMatch[1]}] ${remainingText}`;
                const parsed = parseTaskAttributes(taskLine);

                // Rebuild the first paragraph without the checkbox prefix
                const newContent = [...firstPara.content];
                if (parsed.text) {
                    newContent[0] = { type: 'text', text: parsed.text };
                } else {
                    newContent.splice(0, 1);
                }

                const updatedPara = {
                    ...firstPara,
                    content: newContent.length > 0 ? newContent : undefined,
                };
                itemContent[0] = updatedPara;

                const attrs: Record<string, unknown> = { checked };
                if (parsed.attrs.priority) attrs['priority'] = parsed.attrs.priority;
                if (parsed.attrs.color) attrs['color'] = parsed.attrs.color;
                if (parsed.attrs.due) attrs['dueDate'] = parsed.attrs.due;
                if (parsed.attrs.id) attrs['id'] = parsed.attrs.id;

                return {
                    node: { type: 'taskItem', attrs, content: itemContent },
                    endIndex: i,
                };
            }
        }
    }

    return {
        node: { type: 'listItem', content: itemContent },
        endIndex: i,
    };
}

// ─── Blockquote parsing ───────────────────────────────────────────────────

function parseBlockquote(
    tokens: Token[],
    startIndex: number,
    typedBlocks: Map<string, ExtractedBlock>,
): { node: ProseMirrorNode; endIndex: number } {
    let i = startIndex + 1;
    const innerTokens: Token[] = [];

    while (i < tokens.length && tokens[i]!.type !== 'blockquote_close') {
        innerTokens.push(tokens[i]!);
        i++;
    }

    const content = tokensToNodes(innerTokens, typedBlocks);
    return {
        node: { type: 'blockquote', content },
        endIndex: i,
    };
}

// ─── Table parsing ────────────────────────────────────────────────────────

function parseTable(
    tokens: Token[],
    startIndex: number,
    typedBlocks: Map<string, ExtractedBlock>,
): { node: ProseMirrorNode; endIndex: number } {
    const rows: ProseMirrorNode[] = [];
    let i = startIndex + 1;

    while (i < tokens.length && tokens[i]!.type !== 'table_close') {
        const token = tokens[i]!;

        if (token.type === 'thead_open' || token.type === 'tbody_open') {
            i++;
            continue;
        }
        if (token.type === 'thead_close' || token.type === 'tbody_close') {
            i++;
            continue;
        }

        if (token.type === 'tr_open') {
            const { node, endIndex } = parseTableRow(tokens, i, typedBlocks);
            rows.push(node);
            i = endIndex + 1;
        } else {
            i++;
        }
    }

    return {
        node: { type: 'table', content: rows },
        endIndex: i,
    };
}

function parseTableRow(
    tokens: Token[],
    startIndex: number,
    typedBlocks: Map<string, ExtractedBlock>,
): { node: ProseMirrorNode; endIndex: number } {
    const cells: ProseMirrorNode[] = [];
    let i = startIndex + 1;

    while (i < tokens.length && tokens[i]!.type !== 'tr_close') {
        const token = tokens[i]!;

        if (token.type === 'th_open' || token.type === 'td_open') {
            const cellType = token.type === 'th_open' ? 'tableHeader' : 'tableCell';
            const inlineToken = tokens[i + 1];
            const content = inlineToken ? inlineToNodes(inlineToken, typedBlocks) : [];
            cells.push({
                type: cellType,
                content: [
                    {
                        type: 'paragraph',
                        ...(content.length > 0 ? { content } : {}),
                    },
                ],
            });
            i += 3; // open, inline, close
        } else {
            i++;
        }
    }

    return {
        node: { type: 'tableRow', content: cells },
        endIndex: i,
    };
}

// ─── Typed block → ProseMirror node ───────────────────────────────────────

function typedBlockToNode(block: ExtractedBlock): ProseMirrorNode {
    switch (block.type) {
        case 'image':
            return {
                type: 'image',
                attrs: {
                    src: block.data['src'] || '',
                    alt: block.data['alt'] || '',
                    ...(block.data['width'] ? { width: block.data['width'] } : {}),
                },
            };
        case 'embed':
            return {
                type: 'embed',
                attrs: {
                    url: block.data['url'] || '',
                    title: block.data['title'] || '',
                },
            };
        case 'page-link':
            return {
                type: 'pageLink',
                attrs: {
                    shortId: block.data['shortId'] || '',
                    title: block.data['title'] || '',
                },
            };
        default:
            return { type: 'paragraph' };
    }
}

// Adaptation: Markdown permits ordinary items and checkboxes in one list. ProseMirror
// schemas require homogeneous list children. Preserve both by splitting adjacent runs.
function normalizeMixedLists(nodes: ProseMirrorNode[]): ProseMirrorNode[] {
    return nodes.flatMap(node => {
        if (node.content) node = {...node, content: normalizeMixedLists(node.content)};
        if (node.type !== 'bulletList' || !node.content?.some(item => item.type === 'taskItem')) return [node];
        const groups: ProseMirrorNode[] = [];
        for (const item of node.content) {
            const type = item.type === 'taskItem' ? 'taskList' : 'bulletList';
            if (groups.at(-1)?.type !== type) groups.push({type, content: []});
            groups.at(-1)!.content!.push(item);
        }
        return groups;
    });
}
