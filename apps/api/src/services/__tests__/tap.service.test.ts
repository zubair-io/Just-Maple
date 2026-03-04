import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies for getTapBotConfig tests
vi.mock('../../repositories/user-bot.repo', () => ({
    findUserBotsForNotebook: vi.fn(),
    findUserBotByIdInternal: vi.fn(),
}));

import { getTapBotConfig } from '../tap.service';
import { findUserBotsForNotebook, findUserBotByIdInternal } from '../../repositories/user-bot.repo';

// Extract normalizeTemplate for testing by re-implementing the same logic.
// The function is not exported, so we replicate it here to verify the algorithm.

const LAYOUT_TYPES = new Set(['card', 'stack', 'row', 'grid']);
const ATOM_TYPES = new Set([
    'text',
    'stat',
    'icon',
    'badge',
    'image',
    'progress',
    'timestamp',
    'divider',
    'link',
    'list',
    'checkbox',
]);
const BINDING_KEYS = new Set(['bind', 'format', 'map']);

function hoistBindings(node: Record<string, unknown>): Record<string, unknown> {
    if (!('atom' in node)) return node;

    const result = { ...node };

    for (const key of ['value', 'name', 'label', 'href', 'checked', 'items']) {
        const val = result[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const obj = val as Record<string, unknown>;
            const hasBinding = Object.keys(obj).some((k) => BINDING_KEYS.has(k));
            if (hasBinding) {
                delete result[key];
                for (const [bk, bv] of Object.entries(obj)) {
                    result[bk] = bv;
                }
            }
        }
    }

    return result;
}

const ATOM_VALUE_ALIASES: Record<string, string> = {
    image: 'src',
    icon: 'name',
    link: 'href',
    checkbox: 'checked',
};

function normalizeAtomValue(node: Record<string, unknown>): Record<string, unknown> {
    const atomType = node['atom'] as string | undefined;
    if (!atomType || 'value' in node || 'bind' in node) return node;

    const alias = ATOM_VALUE_ALIASES[atomType];
    if (alias && alias in node) {
        const result = { ...node };
        result['value'] = result[alias];
        delete result[alias];
        return result;
    }
    return node;
}

function normalizeTemplate(node: Record<string, unknown>): Record<string, unknown> {
    if ('layout' in node || 'atom' in node) {
        const result = { ...node };
        if (Array.isArray(result['children'])) {
            result['children'] = (result['children'] as Record<string, unknown>[]).map(
                normalizeTemplate,
            );
        }
        return normalizeAtomValue(hoistBindings(result));
    }

    const nodeType = node['type'] as string | undefined;
    if (!nodeType) return node;

    const props = (node['props'] as Record<string, unknown>) || {};
    const result: Record<string, unknown> = { ...props };

    if (LAYOUT_TYPES.has(nodeType)) {
        result['layout'] = nodeType;
    } else if (ATOM_TYPES.has(nodeType)) {
        result['atom'] = nodeType;
    } else {
        return node;
    }

    for (const [key, value] of Object.entries(node)) {
        if (key === 'type' || key === 'props') continue;
        if (key === 'children' && Array.isArray(value)) {
            result['children'] = (value as Record<string, unknown>[]).map(normalizeTemplate);
        } else if (!(key in result)) {
            result[key] = value;
        }
    }

    return normalizeAtomValue(hoistBindings(result));
}

function unwrapConnectorData(raw: Record<string, unknown>): Record<string, unknown> {
    if ('data' in raw && ('version' in raw || 'updatedAt' in raw)) {
        const inner = raw['data'];
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
            return inner as Record<string, unknown>;
        }
    }
    return raw;
}

describe('normalizeTemplate', () => {
    it('should pass through nodes already in correct layout format', () => {
        const node = { layout: 'card', padding: 'lg', children: [] };
        expect(normalizeTemplate(node)).toEqual(node);
    });

    it('should pass through nodes already in correct atom format', () => {
        const node = { atom: 'text', value: 'Hello', size: 'lg' };
        expect(normalizeTemplate(node)).toEqual(node);
    });

    it('should convert type/props layout to layout format', () => {
        const input = {
            type: 'card',
            props: { padding: 'lg' },
            children: [],
        };
        const expected = {
            layout: 'card',
            padding: 'lg',
            children: [],
        };
        expect(normalizeTemplate(input)).toEqual(expected);
    });

    it('should convert type/props atom to atom format', () => {
        const input = {
            type: 'text',
            props: { value: '72°F', size: 'xl', weight: 'bold' },
        };
        const expected = {
            atom: 'text',
            value: '72°F',
            size: 'xl',
            weight: 'bold',
        };
        expect(normalizeTemplate(input)).toEqual(expected);
    });

    it('should recursively normalize children', () => {
        const input = {
            type: 'stack',
            props: { gap: 'md' },
            children: [
                { type: 'text', props: { value: 'Title', size: 'lg' } },
                { type: 'stat', props: { value: '72', label: 'Temperature' } },
            ],
        };
        const result = normalizeTemplate(input);
        expect(result['layout']).toBe('stack');
        expect(result['gap']).toBe('md');

        const children = result['children'] as Record<string, unknown>[];
        expect(children[0]['atom']).toBe('text');
        expect(children[0]['value']).toBe('Title');
        expect(children[1]['atom']).toBe('stat');
        expect(children[1]['label']).toBe('Temperature');
    });

    it('should handle deeply nested templates', () => {
        const input = {
            type: 'card',
            props: { padding: 'lg', header: 'Weather' },
            children: [
                {
                    type: 'stack',
                    props: { gap: 'sm' },
                    children: [
                        {
                            type: 'row',
                            props: { gap: 'md', align: 'center' },
                            children: [
                                { type: 'icon', props: { name: 'wb_sunny', size: 'xl' } },
                                {
                                    type: 'text',
                                    props: { bind: 'temperature', format: '{value}°F' },
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const result = normalizeTemplate(input);
        expect(result['layout']).toBe('card');
        expect(result['header']).toBe('Weather');

        const stack = (result['children'] as any[])[0];
        expect(stack['layout']).toBe('stack');

        const row = (stack['children'] as any[])[0];
        expect(row['layout']).toBe('row');
        expect(row['align']).toBe('center');

        const icon = (row['children'] as any[])[0];
        expect(icon['atom']).toBe('icon');
        // normalizeAtomValue renames 'name' to 'value' for icons
        expect(icon['value']).toBe('wb_sunny');

        const text = (row['children'] as any[])[1];
        expect(text['atom']).toBe('text');
        expect(text['bind']).toBe('temperature');
    });

    it('should handle atom without props', () => {
        const input = { type: 'divider' };
        expect(normalizeTemplate(input)).toEqual({ atom: 'divider' });
    });

    it('should return unknown type nodes as-is', () => {
        const input = { type: 'unknown_widget', props: { foo: 'bar' } };
        expect(normalizeTemplate(input)).toEqual(input);
    });

    it('should return nodes without type key as-is', () => {
        const input = { foo: 'bar', baz: 123 };
        expect(normalizeTemplate(input)).toEqual(input);
    });

    it('should preserve bind/map/format properties', () => {
        const input = {
            type: 'icon',
            props: {
                bind: 'conditions',
                map: { sunny: 'wb_sunny', _default: 'cloud' },
                size: 'xl',
            },
        };
        const result = normalizeTemplate(input);
        expect(result['atom']).toBe('icon');
        expect(result['bind']).toBe('conditions');
        expect(result['map']).toEqual({ sunny: 'wb_sunny', _default: 'cloud' });
        expect(result['size']).toBe('xl');
    });

    it('should handle mixed format (some correct, some not)', () => {
        const input = {
            layout: 'stack',
            gap: 'md',
            children: [
                { atom: 'text', value: 'Already correct' },
                { type: 'stat', props: { value: '42', label: 'Count' } },
            ],
        };
        const result = normalizeTemplate(input);
        const children = result['children'] as Record<string, unknown>[];
        expect(children[0]['atom']).toBe('text');
        expect(children[1]['atom']).toBe('stat');
        expect(children[1]['value']).toBe('42');
    });

    it('should handle all layout types', () => {
        for (const layoutType of ['card', 'stack', 'row', 'grid']) {
            const result = normalizeTemplate({ type: layoutType });
            expect(result['layout']).toBe(layoutType);
        }
    });

    it('should handle all atom types', () => {
        for (const atomType of [
            'text',
            'stat',
            'icon',
            'badge',
            'image',
            'progress',
            'timestamp',
            'divider',
            'link',
            'list',
            'checkbox',
        ]) {
            const result = normalizeTemplate({ type: atomType });
            expect(result['atom']).toBe(atomType);
        }
    });

    it('should preserve extra keys from node that are not in props', () => {
        const input = {
            type: 'text',
            props: { value: 'Hello' },
            bind: 'someField',
        };
        const result = normalizeTemplate(input);
        expect(result['atom']).toBe('text');
        expect(result['value']).toBe('Hello');
        expect(result['bind']).toBe('someField');
    });

    it('should hoist bind from nested value object to atom level', () => {
        const input = {
            atom: 'text',
            value: { bind: 'location' },
            size: 'lg',
        };
        const result = normalizeTemplate(input);
        expect(result).toEqual({ atom: 'text', bind: 'location', size: 'lg' });
    });

    it('should hoist bind+format from nested value object', () => {
        const input = {
            atom: 'text',
            value: { bind: 'temp', format: '{value}°F' },
            size: 'xl',
        };
        const result = normalizeTemplate(input);
        expect(result).toEqual({
            atom: 'text',
            bind: 'temp',
            format: '{value}°F',
            size: 'xl',
        });
    });

    it('should hoist bind+map from nested name object (icon)', () => {
        const input = {
            atom: 'icon',
            name: { bind: 'conditions', map: { sunny: 'wb_sunny', cloudy: 'cloud' } },
            size: 'lg',
        };
        const result = normalizeTemplate(input);
        expect(result).toEqual({
            atom: 'icon',
            bind: 'conditions',
            map: { sunny: 'wb_sunny', cloudy: 'cloud' },
            size: 'lg',
        });
    });

    it('should not hoist from value when it is a plain string', () => {
        const input = { atom: 'text', value: 'Hello', size: 'lg' };
        const result = normalizeTemplate(input);
        expect(result).toEqual({ atom: 'text', value: 'Hello', size: 'lg' });
    });

    it('should not hoist from value when object has no binding keys', () => {
        const input = { atom: 'text', value: { foo: 'bar' }, size: 'lg' };
        const result = normalizeTemplate(input);
        expect(result['value']).toEqual({ foo: 'bar' });
    });

    it('should hoist bindings in deeply nested Mercury-style templates', () => {
        const input = {
            layout: 'card',
            padding: 'lg',
            children: [
                {
                    atom: 'text',
                    value: { bind: 'location' },
                    size: 'lg',
                    weight: 'bold',
                },
                {
                    atom: 'text',
                    value: { bind: 'humidity', format: 'Humidity: {value}%' },
                    size: 'sm',
                },
            ],
        };
        const result = normalizeTemplate(input);
        const children = result['children'] as Record<string, unknown>[];
        expect(children[0]).toEqual({
            atom: 'text',
            bind: 'location',
            size: 'lg',
            weight: 'bold',
        });
        expect(children[1]).toEqual({
            atom: 'text',
            bind: 'humidity',
            format: 'Humidity: {value}%',
            size: 'sm',
        });
    });
});

describe('getTapBotConfig', () => {
    const mockFindBots = findUserBotsForNotebook as ReturnType<typeof vi.fn>;
    const mockFindBotInternal = findUserBotByIdInternal as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should prefer Mercury bot when both Mercury and Claude are available', async () => {
        mockFindBots.mockResolvedValue([
            { _id: 'bot-mercury', handle: 'mercury', templateName: 'Mercury' },
            { _id: 'bot-claude', handle: 'claude', templateName: 'Claude' },
        ]);
        mockFindBotInternal.mockResolvedValue({
            _id: 'bot-mercury',
            config: { apiKey: 'inception-key-123' },
        });

        const result = await getTapBotConfig('notebook-1');

        expect(result).toEqual({
            apiKey: 'inception-key-123',
            provider: 'inception',
            model: 'mercury-2',
        });
        // Should look up Mercury bot, not Claude
        expect(mockFindBotInternal).toHaveBeenCalledWith('bot-mercury');
    });

    it('should fall back to Claude when no Mercury bot is available', async () => {
        mockFindBots.mockResolvedValue([
            { _id: 'bot-claude', handle: 'claude', templateName: 'Claude' },
        ]);
        mockFindBotInternal.mockResolvedValue({
            _id: 'bot-claude',
            config: { apiKey: 'anthropic-key-456' },
        });

        const result = await getTapBotConfig('notebook-1');

        expect(result).toEqual({
            apiKey: 'anthropic-key-456',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
        });
    });

    it('should fall back to Claude when Mercury bot has no API key', async () => {
        mockFindBots.mockResolvedValue([
            { _id: 'bot-mercury', handle: 'mercury', templateName: 'Mercury' },
            { _id: 'bot-claude', handle: 'claude', templateName: 'Claude' },
        ]);
        mockFindBotInternal
            .mockResolvedValueOnce({ _id: 'bot-mercury', config: {} }) // Mercury has no key
            .mockResolvedValueOnce({
                _id: 'bot-claude',
                config: { apiKey: 'anthropic-key-456' },
            });

        const result = await getTapBotConfig('notebook-1');

        expect(result).toEqual({
            apiKey: 'anthropic-key-456',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
        });
    });

    it('should return null when no bots are configured', async () => {
        mockFindBots.mockResolvedValue([]);

        const result = await getTapBotConfig('notebook-1');

        expect(result).toBeNull();
    });

    it('should match Mercury bot by templateName containing "mercury"', async () => {
        mockFindBots.mockResolvedValue([
            { _id: 'bot-1', handle: 'my-bot', templateName: 'Mercury Fast' },
        ]);
        mockFindBotInternal.mockResolvedValue({
            _id: 'bot-1',
            config: { apiKey: 'inception-key' },
        });

        const result = await getTapBotConfig('notebook-1');

        expect(result?.provider).toBe('inception');
    });
});

describe('normalizeAtomValue', () => {
    it('should rename "src" to "value" for image atoms', () => {
        const input = { atom: 'image', src: 'https://example.com/photo.jpg', alt: 'Photo' };
        const result = normalizeTemplate(input);
        expect(result).toEqual({
            atom: 'image',
            value: 'https://example.com/photo.jpg',
            alt: 'Photo',
        });
    });

    it('should rename "name" to "value" for icon atoms (static name)', () => {
        const input = { atom: 'icon', name: 'wb_sunny', size: 'lg' };
        const result = normalizeTemplate(input);
        expect(result).toEqual({ atom: 'icon', value: 'wb_sunny', size: 'lg' });
    });

    it('should rename "href" to "value" for link atoms', () => {
        const input = { atom: 'link', href: 'https://example.com', label: 'Click' };
        const result = normalizeTemplate(input);
        expect(result).toEqual({
            atom: 'link',
            value: 'https://example.com',
            label: 'Click',
        });
    });

    it('should rename "checked" to "value" for checkbox atoms', () => {
        const input = { atom: 'checkbox', checked: true, label: 'Done' };
        const result = normalizeTemplate(input);
        expect(result).toEqual({ atom: 'checkbox', value: true, label: 'Done' });
    });

    it('should NOT rename when "value" is already present', () => {
        const input = { atom: 'image', value: 'https://x.com/a.jpg', src: 'ignored' };
        const result = normalizeTemplate(input);
        expect(result['value']).toBe('https://x.com/a.jpg');
        expect(result['src']).toBe('ignored');
    });

    it('should NOT rename when "bind" is already present', () => {
        const input = { atom: 'image', bind: 'imageUrl', src: 'ignored' };
        const result = normalizeTemplate(input);
        expect(result['bind']).toBe('imageUrl');
        expect(result['src']).toBe('ignored');
    });

    it('should NOT affect atoms without aliases (e.g. text)', () => {
        const input = { atom: 'text', value: 'Hello' };
        const result = normalizeTemplate(input);
        expect(result).toEqual({ atom: 'text', value: 'Hello' });
    });

    it('should handle icon with binding in name (hoistBindings takes priority)', () => {
        const input = {
            atom: 'icon',
            name: { bind: 'conditions', map: { sunny: 'wb_sunny' } },
            size: 'xl',
        };
        const result = normalizeTemplate(input);
        // hoistBindings extracts bind/map; then normalizeAtomValue doesn't apply (bind present)
        expect(result).toEqual({
            atom: 'icon',
            bind: 'conditions',
            map: { sunny: 'wb_sunny' },
            size: 'xl',
        });
    });
});

describe('unwrapConnectorData', () => {
    it('should unwrap maple-json connector response', () => {
        const raw = {
            data: { pagination: { total: 100 }, data: [{ title: 'Art' }] },
            version: 2,
            updatedAt: '2025-01-01T00:00:00Z',
        };
        const result = unwrapConnectorData(raw);
        expect(result).toEqual({
            pagination: { total: 100 },
            data: [{ title: 'Art' }],
        });
    });

    it('should not unwrap flat connector responses (e.g. weather)', () => {
        const raw = { temp: 72, humidity: 65, conditions: 'sunny' };
        const result = unwrapConnectorData(raw);
        expect(result).toEqual(raw);
    });

    it('should not unwrap if data is an array', () => {
        const raw = { data: [1, 2, 3], version: 1 };
        const result = unwrapConnectorData(raw);
        expect(result).toEqual(raw);
    });

    it('should not unwrap if data is a primitive', () => {
        const raw = { data: 'hello', version: 1 };
        const result = unwrapConnectorData(raw);
        expect(result).toEqual(raw);
    });

    it('should unwrap with updatedAt only (no version)', () => {
        const raw = {
            data: { items: [1, 2] },
            updatedAt: '2025-01-01',
        };
        const result = unwrapConnectorData(raw);
        expect(result).toEqual({ items: [1, 2] });
    });
});
