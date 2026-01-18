import MarkdownIt from 'markdown-it';
import type { PageContent } from '@maple/shared';

const md = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: true,
});

interface ProseMirrorNode {
    type: string;
    content?: ProseMirrorNode[];
    text?: string;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    attrs?: Record<string, unknown>;
}

/**
 * Convert markdown text to ProseMirror JSON
 */
export function markdownToProseMirror(markdown: string): PageContent {
    const tokens = md.parse(markdown, {});
    const content: ProseMirrorNode[] = [];

    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];

        if (token.type === 'paragraph_open') {
            const paragraphContent = parseInlineContent(tokens[i + 1]);
            content.push({
                type: 'paragraph',
                content: paragraphContent,
            });
            i += 3; // Skip paragraph_open, inline, paragraph_close
        } else if (token.type === 'heading_open') {
            const level = parseInt(token.tag.substring(1));
            const headingContent = parseInlineContent(tokens[i + 1]);
            content.push({
                type: 'heading',
                attrs: { level },
                content: headingContent,
            });
            i += 3;
        } else if (token.type === 'bullet_list_open') {
            const listItems: ProseMirrorNode[] = [];
            i++;
            while (i < tokens.length && tokens[i].type !== 'bullet_list_close') {
                if (tokens[i].type === 'list_item_open') {
                    i++;
                    const itemContent: ProseMirrorNode[] = [];
                    while (i < tokens.length && tokens[i].type !== 'list_item_close') {
                        if (tokens[i].type === 'paragraph_open') {
                            const paragraphContent = parseInlineContent(tokens[i + 1]);
                            itemContent.push({
                                type: 'paragraph',
                                content: paragraphContent,
                            });
                            i += 3;
                        } else {
                            i++;
                        }
                    }
                    listItems.push({
                        type: 'listItem',
                        content: itemContent,
                    });
                }
                i++;
            }
            content.push({
                type: 'bulletList',
                content: listItems,
            });
        } else if (token.type === 'ordered_list_open') {
            const listItems: ProseMirrorNode[] = [];
            i++;
            while (i < tokens.length && tokens[i].type !== 'ordered_list_close') {
                if (tokens[i].type === 'list_item_open') {
                    i++;
                    const itemContent: ProseMirrorNode[] = [];
                    while (i < tokens.length && tokens[i].type !== 'list_item_close') {
                        if (tokens[i].type === 'paragraph_open') {
                            const paragraphContent = parseInlineContent(tokens[i + 1]);
                            itemContent.push({
                                type: 'paragraph',
                                content: paragraphContent,
                            });
                            i += 3;
                        } else {
                            i++;
                        }
                    }
                    listItems.push({
                        type: 'listItem',
                        content: itemContent,
                    });
                }
                i++;
            }
            content.push({
                type: 'orderedList',
                content: listItems,
            });
        } else if (token.type === 'code_block' || token.type === 'fence') {
            content.push({
                type: 'codeBlock',
                attrs: { language: token.info || null },
                content: [{ type: 'text', text: token.content }],
            });
            i++;
        } else {
            i++;
        }
    }

    // Ensure there's at least one paragraph
    if (content.length === 0) {
        content.push({
            type: 'paragraph',
            content: [],
        });
    }

    return {
        type: 'doc',
        content,
    } as PageContent;
}

function parseInlineContent(token: any): ProseMirrorNode[] {
    if (!token || !token.children) {
        return [];
    }

    const content: ProseMirrorNode[] = [];

    for (const child of token.children) {
        if (child.type === 'text') {
            content.push({
                type: 'text',
                text: child.content,
            });
        } else if (child.type === 'strong_open') {
            // Will be handled with the text
        } else if (child.type === 'em_open') {
            // Will be handled with the text
        } else if (child.type === 'code_inline') {
            content.push({
                type: 'text',
                marks: [{ type: 'code' }],
                text: child.content,
            });
        } else if (child.type === 'link_open') {
            // Will be handled with the text
        }
    }

    // Second pass to apply marks
    const result: ProseMirrorNode[] = [];
    let i = 0;
    while (i < token.children.length) {
        const child = token.children[i];

        if (child.type === 'strong_open') {
            const textToken = token.children[i + 1];
            if (textToken && textToken.type === 'text') {
                result.push({
                    type: 'text',
                    marks: [{ type: 'bold' }],
                    text: textToken.content,
                });
                i += 3; // Skip strong_open, text, strong_close
                continue;
            }
        } else if (child.type === 'em_open') {
            const textToken = token.children[i + 1];
            if (textToken && textToken.type === 'text') {
                result.push({
                    type: 'text',
                    marks: [{ type: 'italic' }],
                    text: textToken.content,
                });
                i += 3; // Skip em_open, text, em_close
                continue;
            }
        } else if (child.type === 'code_inline') {
            result.push({
                type: 'text',
                marks: [{ type: 'code' }],
                text: child.content,
            });
            i++;
            continue;
        } else if (child.type === 'link_open') {
            const href = child.attrGet('href');
            const textToken = token.children[i + 1];
            if (textToken && textToken.type === 'text') {
                result.push({
                    type: 'text',
                    marks: [{ type: 'link', attrs: { href } }],
                    text: textToken.content,
                });
                i += 3; // Skip link_open, text, link_close
                continue;
            }
        } else if (child.type === 'text') {
            // Skip completely empty text nodes (but preserve whitespace)
            if (child.content) {
                result.push({
                    type: 'text',
                    text: child.content,
                });
            }
        }

        i++;
    }

    return result.length > 0 ? result : [];
}
