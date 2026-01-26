import * as Y from 'yjs';
import { yjsDocumentService } from './yjs-document.service';
import { realtimeWSService } from './realtime-ws.service';

/**
 * Document edit operation types
 */
export type DocumentEdit =
    | {
          type: 'insert';
          position: 'start' | 'end' | number;
          content: string;
      }
    | {
          type: 'replace';
          search: string;
          content: string;
          occurrence?: number; // Which occurrence to replace (default: 1)
      }
    | {
          type: 'append';
          content: string;
      };

export interface DocumentEditRequest {
    pageId: string;
    edits: DocumentEdit[];
}

export interface DocumentEditResult {
    success: boolean;
    appliedCount: number;
    errors?: string[];
    debug?: {
        serverDocLength: number;
        serverDocPreview: string;
    };
}

/**
 * Document Edit Service
 * Applies edits directly to Y.js documents on the server
 * Changes are automatically persisted and broadcast to connected clients
 */
class DocumentEditService {
    /**
     * Apply edits to a document
     * @param pageId - The page/memo ID
     * @param edits - Array of edit operations
     * @returns Result with success status and applied count
     */
    async applyEdits(pageId: string, edits: DocumentEdit[]): Promise<DocumentEditResult> {
        const errors: string[] = [];
        let appliedCount = 0;

        try {
            // Get the Y.Doc for this page
            const ydoc = await yjsDocumentService.getOrCreateDoc(pageId);

            // Get the prosemirror XmlFragment (TipTap's document root)
            const fragment = ydoc.getXmlFragment('prosemirror');

            // Extract current text content for search operations
            const currentText = this.extractTextContent(fragment);

            // Apply each edit in a single transaction for efficiency
            ydoc.transact(() => {
                for (const edit of edits) {
                    try {
                        const applied = this.applyEdit(fragment, edit, currentText);
                        if (applied) {
                            appliedCount++;
                        } else {
                            // More descriptive error message
                            if (edit.type === 'replace') {
                                const searchPreview = edit.search.substring(0, 30);
                                errors.push(
                                    `Replace failed: text "${searchPreview}..." not found in document`,
                                );
                            } else {
                                errors.push(`Failed to apply ${edit.type} operation`);
                            }
                        }
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unknown error';
                        errors.push(`${edit.type} operation failed: ${message}`);
                    }
                }
            }, 'server-edit');

            // Broadcast the update to connected clients
            // The Y.js update listener in yjs-document.service.ts will handle persistence
            const update = Y.encodeStateAsUpdate(ydoc);
            realtimeWSService.broadcastUpdate(pageId, update, 'server');

            return {
                success: appliedCount > 0,
                appliedCount,
                errors: errors.length > 0 ? errors : undefined,
                // Include debug info to help diagnose sync issues
                debug: {
                    serverDocLength: currentText.length,
                    serverDocPreview: currentText.substring(0, 200),
                },
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                appliedCount: 0,
                errors: [`Document access failed: ${message}`],
            };
        }
    }

    /**
     * Apply a single edit operation
     */
    private applyEdit(fragment: Y.XmlFragment, edit: DocumentEdit, currentText: string): boolean {
        switch (edit.type) {
            case 'append':
                return this.applyAppend(fragment, edit.content);

            case 'insert':
                return this.applyInsert(fragment, edit.position, edit.content);

            case 'replace':
                return this.applyReplace(
                    fragment,
                    edit.search,
                    edit.content,
                    edit.occurrence || 1,
                    currentText,
                );

            default:
                return false;
        }
    }

    /**
     * Append content to the end of the document
     * Creates a new paragraph with the content
     */
    private applyAppend(fragment: Y.XmlFragment, content: string): boolean {
        // Create paragraph element for TipTap
        const paragraph = new Y.XmlElement('paragraph');
        const textNode = new Y.XmlText(content);
        paragraph.insert(0, [textNode]);

        // Append to the fragment
        fragment.insert(fragment.length, [paragraph]);

        return true;
    }

    /**
     * Insert content at a specific position
     * Position can be 'start', 'end', or a character offset
     */
    private applyInsert(
        fragment: Y.XmlFragment,
        position: 'start' | 'end' | number,
        content: string,
    ): boolean {
        const paragraph = new Y.XmlElement('paragraph');
        const textNode = new Y.XmlText(content);
        paragraph.insert(0, [textNode]);

        if (position === 'start') {
            // Insert after the first heading (preserve document structure)
            const insertPos = fragment.length > 0 ? 1 : 0;
            fragment.insert(insertPos, [paragraph]);
        } else if (position === 'end') {
            fragment.insert(fragment.length, [paragraph]);
        } else {
            // For numeric positions, find the appropriate element
            // Convert character offset to element index (simplified)
            let charCount = 0;
            let elementIndex = 0;

            for (let i = 0; i < fragment.length; i++) {
                const child = fragment.get(i);
                if (child instanceof Y.XmlElement) {
                    const text = this.extractTextFromElement(child);
                    if (charCount + text.length >= position) {
                        elementIndex = i + 1;
                        break;
                    }
                    charCount += text.length + 1; // +1 for newline between paragraphs
                }
                if (i === fragment.length - 1) {
                    elementIndex = fragment.length;
                }
            }

            fragment.insert(elementIndex, [paragraph]);
        }

        return true;
    }

    /**
     * Normalize text for searching - strip markdown, collapse whitespace
     */
    private normalizeForSearch(text: string): string {
        return (
            text
                // Remove heading markers: # ## ### etc
                .replace(/^#{1,6}\s*/gm, '')
                // Remove bold/italic markers
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/\*([^*]+)\*/g, '$1')
                .replace(/__([^_]+)__/g, '$1')
                .replace(/_([^_]+)_/g, '$1')
                // Remove inline code backticks
                .replace(/`([^`]+)`/g, '$1')
                // Remove blockquote markers
                .replace(/^>\s*/gm, '')
                // Remove list markers
                .replace(/^[-*]\s+/gm, '')
                .replace(/^\d+\.\s+/gm, '')
                // Remove <italic> and other HTML-like tags
                .replace(/<[^>]+>/g, '')
                // Collapse all whitespace to single space
                .replace(/\s+/g, ' ')
                .trim()
        );
    }

    /**
     * Replace text in the document
     * Searches for the text and replaces the specified occurrence
     * Uses normalized (whitespace-collapsed) matching for better reliability
     */
    private applyReplace(
        fragment: Y.XmlFragment,
        search: string,
        replacement: string,
        occurrence: number,
        _currentText: string,
    ): boolean {
        const normalizedSearch = this.normalizeForSearch(search);

        console.log(
            '[DocumentEdit] Replace search:',
            JSON.stringify(normalizedSearch.substring(0, 50)),
        );

        // Search through each element for the normalized text
        let foundCount = 0;

        for (let i = 0; i < fragment.length; i++) {
            const child = fragment.get(i);
            if (child instanceof Y.XmlElement) {
                const elementText = this.extractTextFromElement(child);
                const normalizedElement = this.normalizeForSearch(elementText);

                // Try exact match first
                let searchPos = 0;
                while (true) {
                    const idx = normalizedElement.indexOf(normalizedSearch, searchPos);
                    if (idx === -1) break;

                    foundCount++;
                    if (foundCount === occurrence) {
                        const actualPos = this.findActualPosition(
                            elementText,
                            normalizedSearch,
                            idx,
                        );
                        if (actualPos !== -1) {
                            const actualLength = this.findActualLength(
                                elementText,
                                actualPos,
                                normalizedSearch,
                            );
                            this.replaceTextInElement(child, actualPos, actualLength, replacement);
                            console.log(
                                `[DocumentEdit] Exact match at pos ${actualPos}, len ${actualLength}`,
                            );
                            return true;
                        }
                    }
                    searchPos = idx + 1;
                }

                // Try fuzzy match if exact not found and looking for first occurrence
                if (foundCount === 0 && occurrence === 1) {
                    const fuzzy = this.fuzzyFind(normalizedElement, normalizedSearch);
                    if (fuzzy) {
                        const actualPos = this.findActualPosition(
                            elementText,
                            fuzzy.matched,
                            fuzzy.index,
                        );
                        if (actualPos !== -1) {
                            const actualLength = this.findActualLength(
                                elementText,
                                actualPos,
                                fuzzy.matched,
                            );
                            this.replaceTextInElement(child, actualPos, actualLength, replacement);
                            console.log(
                                `[DocumentEdit] Fuzzy match: "${fuzzy.matched.substring(0, 30)}..."`,
                            );
                            return true;
                        }
                    }
                }
            }
        }

        console.log(
            `[DocumentEdit] Search text not found. Found ${foundCount} occurrences, needed ${occurrence}`,
        );
        return false;
    }

    /**
     * Fuzzy find - looks for text similar to search (allows small differences)
     */
    private fuzzyFind(text: string, search: string): { index: number; matched: string } | null {
        if (search.length < 10) return null;

        // Try finding progressively shorter prefixes (70% minimum)
        const minLen = Math.floor(search.length * 0.7);

        for (let len = search.length; len >= minLen; len--) {
            const prefix = search.substring(0, len);
            const idx = text.indexOf(prefix);
            if (idx !== -1) {
                // Extend to word boundary
                let endIdx = idx + prefix.length;
                while (endIdx < text.length && !/\s|[.,!?;:]/.test(text[endIdx])) {
                    endIdx++;
                }
                const matched = text.substring(idx, endIdx);
                console.log(
                    `[DocumentEdit] Fuzzy: "${prefix.substring(0, 20)}..." -> "${matched.substring(0, 20)}..."`,
                );
                return { index: idx, matched };
            }
        }

        return null;
    }

    /**
     * Find actual position in original text that corresponds to normalized position
     */
    private findActualPosition(
        original: string,
        normalizedSearch: string,
        normalizedPos: number,
    ): number {
        // Walk through original text, tracking normalized position
        let normalizedIdx = 0;
        let inWhitespace = false;

        for (let i = 0; i < original.length; i++) {
            const char = original[i];
            const isWhitespace = /\s/.test(char);

            if (isWhitespace) {
                if (!inWhitespace) {
                    // First whitespace char - counts as one space in normalized
                    if (normalizedIdx === normalizedPos) {
                        return i;
                    }
                    normalizedIdx++;
                    inWhitespace = true;
                }
                // Additional whitespace chars are skipped in normalized
            } else {
                if (normalizedIdx === normalizedPos) {
                    return i;
                }
                normalizedIdx++;
                inWhitespace = false;
            }
        }

        return -1;
    }

    /**
     * Find actual length of text to replace (accounting for whitespace differences)
     */
    private findActualLength(original: string, startPos: number, normalizedSearch: string): number {
        let normalizedIdx = 0;
        let inWhitespace = false;

        for (
            let i = startPos;
            i < original.length && normalizedIdx < normalizedSearch.length;
            i++
        ) {
            const char = original[i];
            const isWhitespace = /\s/.test(char);

            if (isWhitespace) {
                if (!inWhitespace) {
                    normalizedIdx++;
                    inWhitespace = true;
                }
            } else {
                normalizedIdx++;
                inWhitespace = false;
            }

            if (normalizedIdx >= normalizedSearch.length) {
                return i - startPos + 1;
            }
        }

        return normalizedSearch.length; // Fallback
    }

    /**
     * Replace text within a Y.XmlElement
     */
    private replaceTextInElement(
        element: Y.XmlElement,
        start: number,
        length: number,
        replacement: string,
    ): void {
        // Find the text node within the element
        let currentPos = 0;

        for (let i = 0; i < element.length; i++) {
            const child = element.get(i);

            if (child instanceof Y.XmlText) {
                const text = child.toString();
                const nodeStart = currentPos;
                const nodeEnd = currentPos + text.length;

                // Check if replacement starts in this text node
                if (start >= nodeStart && start < nodeEnd) {
                    const localStart = start - nodeStart;

                    // Check if entire replacement is in this node
                    if (localStart + length <= text.length) {
                        child.delete(localStart, length);
                        child.insert(localStart, replacement);
                        return;
                    }
                }

                currentPos += text.length;
            } else if (child instanceof Y.XmlElement) {
                // Recursively handle nested elements
                const childText = this.extractTextFromElement(child);
                const nodeStart = currentPos;
                const nodeEnd = currentPos + childText.length;

                if (start >= nodeStart && start < nodeEnd) {
                    this.replaceTextInElement(child, start - nodeStart, length, replacement);
                    return;
                }

                currentPos += childText.length;
            }
        }
    }

    /**
     * Extract plain text content from the Y.XmlFragment
     */
    private extractTextContent(fragment: Y.XmlFragment): string {
        const parts: string[] = [];

        for (let i = 0; i < fragment.length; i++) {
            const child = fragment.get(i);
            if (child instanceof Y.XmlElement) {
                parts.push(this.extractTextFromElement(child));
            }
        }

        return parts.join('\n');
    }

    /**
     * Extract text from a single Y.XmlElement
     */
    private extractTextFromElement(element: Y.XmlElement): string {
        const parts: string[] = [];

        for (let i = 0; i < element.length; i++) {
            const child = element.get(i);
            if (child instanceof Y.XmlText) {
                parts.push(child.toString());
            } else if (child instanceof Y.XmlElement) {
                parts.push(this.extractTextFromElement(child));
            }
        }

        return parts.join('');
    }

    /**
     * Get current document content as plain text
     * Useful for AI context or debugging
     */
    async getDocumentContent(pageId: string): Promise<string> {
        const ydoc = await yjsDocumentService.getOrCreateDoc(pageId);
        const fragment = ydoc.getXmlFragment('prosemirror');
        return this.extractTextContent(fragment);
    }
}

// Singleton instance
export const documentEditService = new DocumentEditService();
