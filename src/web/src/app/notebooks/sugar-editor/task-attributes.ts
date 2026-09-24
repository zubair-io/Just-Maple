/**
 * Parser/serializer for enhanced task item attributes.
 *
 * Format: `- [x] Task text {priority: high, color: "#dc2626", due: 2026-03-01, id: abc123}`
 * The `{...}` block at the end of a task line contains key-value pairs.
 */

export interface TaskAttrs {
    priority?: 'high' | 'medium' | 'low';
    color?: string;
    due?: string;
    id?: string;
}

export interface ParsedTaskLine {
    text: string;
    checked: boolean;
    attrs: TaskAttrs;
}

// Match a task line: optional leading whitespace, `- [x] ` or `- [ ] `, then text
const TASK_LINE_REGEX = /^(\s*-\s*\[)([ xX])(\]\s*)(.*)$/;

// Match `{...}` at end of the text portion
const ATTRS_BLOCK_REGEX = /\s*\{([^}]+)\}\s*$/;

// Match a key-value pair: key: value or key: "value"
const KV_REGEX = /(\w+)\s*:\s*(?:"([^"]*)"|([\w#.-]+))/g;

/**
 * Parse a markdown task line into text, checked state, and attributes.
 */
export function parseTaskAttributes(line: string): ParsedTaskLine {
    const taskMatch = line.match(TASK_LINE_REGEX);
    if (!taskMatch) {
        return { text: line, checked: false, attrs: {} };
    }

    const checked = taskMatch[2] === 'x' || taskMatch[2] === 'X';
    let textPart = taskMatch[4]!;
    let attrs: TaskAttrs = {};

    const attrsMatch = textPart.match(ATTRS_BLOCK_REGEX);
    if (attrsMatch) {
        textPart = textPart.slice(0, textPart.length - attrsMatch[0].length);
        attrs = parseAttrsBlock(attrsMatch[1]!);
    }

    return { text: textPart, checked, attrs };
}

/**
 * Serialize task text, checked state, and attributes back into a markdown task line.
 */
export function serializeTaskAttributes(text: string, checked: boolean, attrs: TaskAttrs): string {
    const checkbox = checked ? '[x]' : '[ ]';
    const attrStr = serializeAttrsBlock(attrs);
    return attrStr ? `- ${checkbox} ${text} ${attrStr}` : `- ${checkbox} ${text}`;
}

function parseAttrsBlock(raw: string): TaskAttrs {
    const attrs: TaskAttrs = {};
    let match: RegExpExecArray | null;

    KV_REGEX.lastIndex = 0;
    while ((match = KV_REGEX.exec(raw)) !== null) {
        const key = match[1]!;
        const value = match[2] ?? match[3]!;

        switch (key) {
            case 'priority':
                if (value === 'high' || value === 'medium' || value === 'low') {
                    attrs.priority = value;
                }
                break;
            case 'color':
                attrs.color = value;
                break;
            case 'due':
                attrs.due = value;
                break;
            case 'id':
                attrs.id = value;
                break;
        }
    }

    return attrs;
}

function serializeAttrsBlock(attrs: TaskAttrs): string {
    const parts: string[] = [];

    if (attrs.priority) parts.push(`priority: ${attrs.priority}`);
    if (attrs.color) parts.push(`color: "${attrs.color}"`);
    if (attrs.due) parts.push(`due: ${attrs.due}`);
    if (attrs.id) parts.push(`id: ${attrs.id}`);

    return parts.length > 0 ? `{${parts.join(', ')}}` : '';
}
