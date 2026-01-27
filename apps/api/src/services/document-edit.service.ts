import * as Y from 'yjs';
import { yjsDocumentService } from './yjs-document.service';
import { realtimeWSService } from './realtime-ws.service';

/**
 * ProseMirror JSON content type (subset of TipTap's JSONContent)
 */
export interface JSONContent {
    type: string;
    attrs?: Record<string, unknown>;
    content?: JSONContent[];
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    text?: string;
}

/**
 * Path-based AI edit operations
 * Path is an array of indices navigating the document tree
 * e.g., [2, 0] = 3rd child (index 2), then 1st grandchild (index 0)
 */
export type AIEditOp =
    | { type: 'replace-text'; offset: number; length: number; text: string }
    | { type: 'insert-text'; offset: number; text: string }
    | { type: 'delete-text'; offset: number; length: number }
    | { type: 'search-replace'; search: string; replace: string } // Easier for AI - just specify what to find and replace
    | { type: 'replace-node'; content: JSONContent }
    | { type: 'insert-node'; index: number; content: JSONContent }
    | { type: 'delete-node' }
    | { type: 'set-attrs'; attrs: Record<string, unknown> }
    | { type: 'format-text'; offset: number; length: number; mark: string; value: unknown };

export interface AIEdit {
    path: number[];
    op: AIEditOp;
}

export interface AIEditResult {
    success: boolean;
    appliedCount: number;
    errors?: string[];
}

/**
 * Document Edit Service
 * Applies edits directly to Y.js documents on the server
 * Changes are automatically persisted and broadcast to connected clients
 */
class DocumentEditService {
    // ============================================================
    // PATH-BASED AI EDIT METHODS (new approach)
    // ============================================================

    /**
     * Apply path-based AI edits to a document
     * @param pageId - The page/memo ID
     * @param edits - Array of path-based AI edit operations
     * @returns Result with success status and applied count
     */
    async applyAIEdits(pageId: string, edits: AIEdit[]): Promise<AIEditResult> {
        const errors: string[] = [];
        let appliedCount = 0;

        try {
            const ydoc = await yjsDocumentService.getOrCreateDoc(pageId);
            const fragment = ydoc.getXmlFragment('prosemirror');

            // Apply all edits in a single transaction with 'ai-editor' origin
            ydoc.transact(() => {
                for (const edit of edits) {
                    try {
                        const applied = this.applyAIEdit(fragment, edit);
                        if (applied) {
                            appliedCount++;
                        } else {
                            errors.push(
                                `Failed to apply ${edit.op.type} at path [${edit.path.join(', ')}]`,
                            );
                        }
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unknown error';
                        errors.push(`${edit.op.type} at [${edit.path.join(', ')}]: ${message}`);
                    }
                }
            }, 'ai-editor');

            // Broadcast update to connected clients
            const update = Y.encodeStateAsUpdate(ydoc);
            realtimeWSService.broadcastUpdate(pageId, update, 'server');

            return {
                success: appliedCount > 0,
                appliedCount,
                errors: errors.length > 0 ? errors : undefined,
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
     * Apply a single path-based AI edit operation
     */
    private applyAIEdit(fragment: Y.XmlFragment, edit: AIEdit): boolean {
        const { path, op } = edit;

        // Handle operations at root level (empty path)
        if (path.length === 0) {
            if (op.type === 'insert-node') {
                const node = this.jsonToYXml(op.content);
                fragment.insert(op.index, [node]);
                return true;
            }
            return false;
        }

        // Navigate to parent node (all path elements except last)
        const parentPath = path.slice(0, -1);
        const targetIndex = path[path.length - 1];

        const parent =
            parentPath.length === 0 ? fragment : this.getNodeAtPath(fragment, parentPath);
        if (!parent || !(parent instanceof Y.XmlFragment || parent instanceof Y.XmlElement)) {
            console.log(`[AIEdit] Parent not found at path [${parentPath.join(', ')}]`);
            return false;
        }

        // Get target node
        const target = parent.get(targetIndex);
        if (!target && op.type !== 'insert-node') {
            console.log(`[AIEdit] Target not found at index ${targetIndex}`);
            return false;
        }

        switch (op.type) {
            case 'replace-text':
                return this.applyReplaceText(target, op.offset, op.length, op.text);

            case 'insert-text':
                return this.applyInsertText(target, op.offset, op.text);

            case 'delete-text':
                return this.applyDeleteText(target, op.offset, op.length);

            case 'replace-node': {
                const newNode = this.jsonToYXml(op.content);
                parent.delete(targetIndex, 1);
                parent.insert(targetIndex, [newNode]);
                return true;
            }

            case 'insert-node': {
                const newNode = this.jsonToYXml(op.content);
                parent.insert(op.index, [newNode]);
                return true;
            }

            case 'delete-node':
                parent.delete(targetIndex, 1);
                return true;

            case 'set-attrs':
                if (target instanceof Y.XmlElement) {
                    for (const [key, value] of Object.entries(op.attrs)) {
                        target.setAttribute(key, value);
                    }
                    return true;
                }
                return false;

            case 'format-text':
                return this.applyFormatText(target, op.offset, op.length, op.mark, op.value);

            case 'search-replace':
                return this.applySearchReplace(target, op.search, op.replace);

            default:
                return false;
        }
    }

    /**
     * Replace text within a text node at specified offset and length
     */
    private applyReplaceText(
        node: Y.XmlElement | Y.XmlText | undefined,
        offset: number,
        length: number,
        text: string,
    ): boolean {
        const textNode = this.findTextNode(node);
        if (!textNode) return false;

        textNode.delete(offset, length);
        textNode.insert(offset, text);
        return true;
    }

    /**
     * Search and replace text within a node (easier for AI to use)
     * Finds the search string and replaces it with the replacement
     */
    private applySearchReplace(
        node: Y.XmlElement | Y.XmlText | undefined,
        search: string,
        replace: string,
    ): boolean {
        const textNode = this.findTextNode(node);
        if (!textNode) return false;

        const currentText = textNode.toString();
        const index = currentText.indexOf(search);

        if (index === -1) {
            console.log(`[AIEdit] search-replace: "${search}" not found in "${currentText}"`);
            return false;
        }

        textNode.delete(index, search.length);
        textNode.insert(index, replace);
        return true;
    }

    /**
     * Insert text at specified offset
     */
    private applyInsertText(
        node: Y.XmlElement | Y.XmlText | undefined,
        offset: number,
        text: string,
    ): boolean {
        const textNode = this.findTextNode(node);
        if (!textNode) return false;

        textNode.insert(offset, text);
        return true;
    }

    /**
     * Delete text at specified offset and length
     */
    private applyDeleteText(
        node: Y.XmlElement | Y.XmlText | undefined,
        offset: number,
        length: number,
    ): boolean {
        const textNode = this.findTextNode(node);
        if (!textNode) return false;

        textNode.delete(offset, length);
        return true;
    }

    /**
     * Apply formatting mark to text
     */
    private applyFormatText(
        node: Y.XmlElement | Y.XmlText | undefined,
        offset: number,
        length: number,
        mark: string,
        value: unknown,
    ): boolean {
        const textNode = this.findTextNode(node);
        if (!textNode) return false;

        textNode.format(offset, length, { [mark]: value });
        return true;
    }

    /**
     * Find the first XmlText node within a node (may be nested)
     */
    private findTextNode(node: Y.XmlElement | Y.XmlText | undefined): Y.XmlText | null {
        if (!node) return null;
        if (node instanceof Y.XmlText) return node;

        // Search in children
        if (node instanceof Y.XmlElement) {
            for (let i = 0; i < node.length; i++) {
                const child = node.get(i);
                const found = this.findTextNode(child);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Navigate the Y.js tree to find a node at the given path
     * Path is an array of indices, e.g., [2, 0] = 3rd child, 1st grandchild
     */
    getNodeAtPath(
        root: Y.XmlFragment | Y.XmlElement,
        path: number[],
    ): Y.XmlElement | Y.XmlText | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let current: any = root;

        for (const index of path) {
            if (current.get) {
                const child = current.get(index);
                if (!child) return null;
                current = child;
            } else {
                return null;
            }
        }

        return current;
    }

    /**
     * Convert Y.XmlFragment to ProseMirror JSON format
     * This is what we send to the AI for context
     */
    yXmlFragmentToJSON(fragment: Y.XmlFragment): JSONContent {
        const content: JSONContent[] = [];

        for (let i = 0; i < fragment.length; i++) {
            const child = fragment.get(i);
            if (child instanceof Y.XmlElement) {
                content.push(this.yXmlElementToJSON(child));
            } else if (child instanceof Y.XmlText) {
                content.push(this.yXmlTextToJSON(child));
            }
        }

        return {
            type: 'doc',
            content,
        };
    }

    /**
     * Convert Y.XmlElement to JSON
     */
    private yXmlElementToJSON(element: Y.XmlElement): JSONContent {
        const result: JSONContent = {
            type: element.nodeName,
        };

        // Get attributes
        const attrs = element.getAttributes();
        if (Object.keys(attrs).length > 0) {
            result.attrs = attrs;
        }

        // Get children
        const content: JSONContent[] = [];
        for (let i = 0; i < element.length; i++) {
            const child = element.get(i);
            if (child instanceof Y.XmlElement) {
                content.push(this.yXmlElementToJSON(child));
            } else if (child instanceof Y.XmlText) {
                content.push(this.yXmlTextToJSON(child));
            }
        }

        if (content.length > 0) {
            result.content = content;
        }

        return result;
    }

    /**
     * Convert Y.XmlText to JSON with marks
     */
    private yXmlTextToJSON(textNode: Y.XmlText): JSONContent {
        const result: JSONContent = {
            type: 'text',
            text: textNode.toString(),
        };

        // Get marks/formatting from the text node
        // Y.XmlText stores formatting as deltas
        const delta = textNode.toDelta();
        if (delta.length > 0 && delta[0].attributes) {
            const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
            const attrs = delta[0].attributes;
            for (const [key, value] of Object.entries(attrs)) {
                if (value === true) {
                    marks.push({ type: key });
                } else if (value !== null && value !== false) {
                    marks.push({ type: key, attrs: { [key]: value } });
                }
            }
            if (marks.length > 0) {
                result.marks = marks;
            }
        }

        return result;
    }

    /**
     * Convert ProseMirror JSON to Y.Xml nodes
     */
    jsonToYXml(json: JSONContent): Y.XmlElement | Y.XmlText {
        if (json.type === 'text') {
            const text = new Y.XmlText();
            text.insert(0, json.text || '');

            // Apply marks
            if (json.marks && json.marks.length > 0) {
                const format: Record<string, unknown> = {};
                for (const mark of json.marks) {
                    if (mark.attrs) {
                        Object.assign(format, mark.attrs);
                    } else {
                        format[mark.type] = true;
                    }
                }
                text.format(0, (json.text || '').length, format);
            }

            return text;
        }

        const element = new Y.XmlElement(json.type);

        // Set attributes
        if (json.attrs) {
            for (const [key, value] of Object.entries(json.attrs)) {
                element.setAttribute(key, value);
            }
        }

        // Add children
        if (json.content) {
            const children = json.content.map((child) => this.jsonToYXml(child));
            element.insert(0, children);
        }

        return element;
    }

    /**
     * Get document as JSON (for AI context)
     */
    async getDocumentAsJSON(pageId: string): Promise<JSONContent> {
        const ydoc = await yjsDocumentService.getOrCreateDoc(pageId);
        const fragment = ydoc.getXmlFragment('prosemirror');
        return this.yXmlFragmentToJSON(fragment);
    }
}

// Singleton instance
export const documentEditService = new DocumentEditService();
