/**
 * YAML frontmatter parser/serializer for .maple.md files.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface FrontmatterMeta {
    id: string;
    type: string;
    created: string;
    modified: string;
    sidecar?: string;
    tags?: string[];
    isFavorite?: boolean;
    isArchived?: boolean;
    todoMeta?: {
        hasTodos: boolean;
        todoCount: number;
        completedCount: number;
        overdueCount: number;
    };
    [key: string]: unknown;
}

export type FrontmatterResult = { meta: FrontmatterMeta; body: string } | { error: string };

const REQUIRED_FIELDS = ['id', 'type', 'created', 'modified'] as const;

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/**
 * Parse YAML frontmatter from a .maple.md file's raw content.
 * Returns meta + body, or a descriptive error.
 */
export function parseFrontmatter(raw: string): FrontmatterResult {
    const match = raw.match(FRONTMATTER_REGEX);
    if (!match) {
        return { error: 'No YAML frontmatter found (expected --- delimiters)' };
    }

    const yamlStr = match[1]!;
    const body = match[2]!;

    let parsed: unknown;
    try {
        parsed = parseYaml(yamlStr);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { error: `Invalid YAML in frontmatter: ${message}` };
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'Frontmatter must be a YAML mapping (key-value pairs)' };
    }

    const record = parsed as Record<string, unknown>;

    // Validate required fields
    for (const field of REQUIRED_FIELDS) {
        if (record[field] === undefined || record[field] === null) {
            return { error: `Missing required frontmatter field: "${field}"` };
        }
    }

    return {
        meta: record as FrontmatterMeta,
        body,
    };
}

/**
 * Serialize a FrontmatterMeta object and body into a .maple.md string.
 */
export function serializeFrontmatter(meta: FrontmatterMeta, body: string): string {
    const yamlStr = stringifyYaml(meta, { lineWidth: 0 }).trimEnd();
    return `---\n${yamlStr}\n---\n${body}`;
}
