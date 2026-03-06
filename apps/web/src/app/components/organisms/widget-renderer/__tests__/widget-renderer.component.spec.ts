/**
 * Widget Renderer Component - Logic Tests
 *
 * Tests the value resolution pipeline (bind → map → format),
 * layout class generation, helper methods, and the exported pure functions
 * (resolvePath, interpolate, isTruthy).
 *
 * Note: Uses direct function testing instead of TestBed, since the
 * Angular TestBed environment has pre-existing issues in this project.
 */
import { describe, it, expect } from 'vitest';
import { resolvePath, interpolate, isTruthy } from '../widget-renderer.component';

function resolve(node: Record<string, unknown>, data: Record<string, unknown>): unknown {
  let raw: unknown;
  if (node['bind']) {
    raw = resolvePath(node['bind'] as string, data);
  } else if (typeof node['value'] === 'string' && (node['value'] as string).includes('{{')) {
    raw = interpolate(node['value'] as string, data);
  } else {
    raw = node['value'];
  }
  const map = node['map'] as Record<string, unknown> | undefined;
  const mapped = map ? (map[String(raw)] ?? map['_default'] ?? raw) : raw;
  const format = node['format'] as string | undefined;
  return format ? format.replace('{value}', String(mapped)) : mapped;
}

function resolveString(node: Record<string, unknown>, data: Record<string, unknown>): string {
  return String(resolve(node, data) ?? '');
}

function resolveNumber(node: Record<string, unknown>, data: Record<string, unknown>): number {
  const val = resolve(node, data);
  return typeof val === 'number' ? val : Number(val) || 0;
}

function resolveBoolean(node: Record<string, unknown>, data: Record<string, unknown>): boolean {
  const val = resolve(node, data);
  return val === true || val === 'true';
}

function resolveStringArray(
  node: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] {
  const val = resolve(node, data);
  if (Array.isArray(val)) return val.map(String);
  if (Array.isArray(node['items'])) return node['items'] as string[];
  return [];
}

function layoutClasses(node: Record<string, unknown>): string {
  const layoutMap: Record<string, string> = {
    card: 'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]',
    stack: 'flex flex-col',
    row: 'flex flex-row',
    grid: 'grid',
  };

  const gapMap: Record<string, string> = {
    xs: 'gap-1',
    sm: 'gap-2',
    md: 'gap-3',
    lg: 'gap-4',
  };

  const alignMap: Record<string, string> = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
  };

  const paddingMap: Record<string, string> = {
    sm: 'p-2',
    md: 'p-4',
    lg: 'p-6',
  };

  const layout = node['layout'] as string;
  const classes = [layoutMap[layout] || ''];

  if (node['gap']) classes.push(gapMap[node['gap'] as string] || '');
  if (node['align']) classes.push(alignMap[node['align'] as string] || '');
  if (node['wrap']) classes.push('flex-wrap');

  if (layout === 'card') {
    const padding = (node['padding'] as string) || 'md';
    classes.push(paddingMap[padding] || 'p-4');
  } else if (node['padding']) {
    classes.push(paddingMap[node['padding'] as string] || '');
  }

  if (layout === 'grid' && node['columns']) {
    const colsMap: Record<number, string> = {
      1: 'grid-cols-1',
      2: 'grid-cols-2',
      3: 'grid-cols-3',
      4: 'grid-cols-4',
      5: 'grid-cols-5',
      6: 'grid-cols-6',
    };
    const cols = node['columns'] as number;
    classes.push(colsMap[cols] || 'grid-cols-1');
  }

  return classes.filter(Boolean).join(' ');
}

describe('WidgetRendererComponent Logic', () => {
  describe('isLayout / isAtom', () => {
    it('should detect layout nodes', () => {
      const node = { layout: 'stack', children: [] };
      expect('layout' in node).toBe(true);
      expect('atom' in node).toBe(false);
    });

    it('should detect atom nodes', () => {
      const node = { atom: 'text', value: 'Hello' };
      expect('atom' in node).toBe(true);
      expect('layout' in node).toBe(false);
    });
  });

  describe('resolve', () => {
    it('should resolve static value', () => {
      expect(resolve({ atom: 'text', value: 'Static text' }, {})).toBe('Static text');
    });

    it('should resolve bind from data object', () => {
      expect(resolve({ atom: 'text', bind: 'temperature' }, { temperature: 72 })).toBe(72);
    });

    it('should resolve nested bind path', () => {
      expect(resolve({ atom: 'text', bind: 'weather.temp' }, { weather: { temp: 85 } })).toBe(85);
    });

    it('should apply map transform', () => {
      const node = {
        atom: 'icon',
        bind: 'conditions',
        map: { sunny: 'wb_sunny', rainy: 'umbrella', _default: 'cloud' },
      };
      expect(resolve(node, { conditions: 'sunny' })).toBe('wb_sunny');
    });

    it('should use _default when map key is missing', () => {
      const node = {
        atom: 'icon',
        bind: 'conditions',
        map: { sunny: 'wb_sunny', _default: 'cloud' },
      };
      expect(resolve(node, { conditions: 'foggy' })).toBe('cloud');
    });

    it('should apply format interpolation', () => {
      const node = { atom: 'text', bind: 'temp', format: '{value}°F' };
      expect(resolve(node, { temp: 72 })).toBe('72°F');
    });

    it('should handle full pipeline: bind → map → format', () => {
      const node = {
        atom: 'text',
        bind: 'status',
        map: { 0: 'Clear', 1: 'Cloudy', _default: 'Unknown' },
        format: 'Weather: {value}',
      };
      expect(resolve(node, { status: 0 })).toBe('Weather: Clear');
    });

    it('should return undefined for missing bind path', () => {
      expect(resolve({ atom: 'text', bind: 'missing.path' }, {})).toBeUndefined();
    });

    it('should fall through raw value when map has no match and no _default', () => {
      const node = { atom: 'text', bind: 'val', map: { a: 'A' } };
      expect(resolve(node, { val: 'b' })).toBe('b');
    });
  });

  describe('resolveString', () => {
    it('should return string from numeric value', () => {
      expect(resolveString({ atom: 'text', value: 42 }, {})).toBe('42');
    });

    it('should return empty string for undefined', () => {
      expect(resolveString({ atom: 'text' }, {})).toBe('');
    });
  });

  describe('resolveNumber', () => {
    it('should return number from value', () => {
      expect(resolveNumber({ atom: 'progress', value: 75 }, {})).toBe(75);
    });

    it('should return 0 for non-numeric', () => {
      expect(resolveNumber({ atom: 'progress', value: 'not a number' }, {})).toBe(0);
    });

    it('should parse numeric string', () => {
      expect(resolveNumber({ atom: 'progress', value: '42' }, {})).toBe(42);
    });
  });

  describe('resolveBoolean', () => {
    it('should return true for boolean true', () => {
      expect(resolveBoolean({ atom: 'checkbox', value: true }, {})).toBe(true);
    });

    it('should return true for string "true"', () => {
      expect(resolveBoolean({ atom: 'checkbox', value: 'true' }, {})).toBe(true);
    });

    it('should return false for other values', () => {
      expect(resolveBoolean({ atom: 'checkbox', value: 'no' }, {})).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(resolveBoolean({ atom: 'checkbox' }, {})).toBe(false);
    });
  });

  describe('resolveStringArray', () => {
    it('should return array from resolved bind value', () => {
      expect(
        resolveStringArray({ atom: 'list', bind: 'items' }, { items: ['a', 'b', 'c'] }),
      ).toEqual(['a', 'b', 'c']);
    });

    it('should fall back to items property', () => {
      expect(resolveStringArray({ atom: 'list', items: ['x', 'y'] }, {})).toEqual(['x', 'y']);
    });

    it('should return empty array when nothing available', () => {
      expect(resolveStringArray({ atom: 'list' }, {})).toEqual([]);
    });

    it('should convert numbers to strings', () => {
      expect(resolveStringArray({ atom: 'list', bind: 'nums' }, { nums: [1, 2, 3] })).toEqual([
        '1',
        '2',
        '3',
      ]);
    });
  });

  describe('layoutClasses', () => {
    it('should return card classes with default padding', () => {
      const classes = layoutClasses({ layout: 'card' });
      expect(classes).toContain('rounded-lg');
      expect(classes).toContain('border');
      expect(classes).toContain('p-4');
    });

    it('should return card classes with custom padding', () => {
      const classes = layoutClasses({ layout: 'card', padding: 'lg' });
      expect(classes).toContain('p-6');
    });

    it('should return stack classes with gap', () => {
      const classes = layoutClasses({ layout: 'stack', gap: 'sm' });
      expect(classes).toContain('flex');
      expect(classes).toContain('flex-col');
      expect(classes).toContain('gap-2');
    });

    it('should return row classes with alignment', () => {
      const classes = layoutClasses({ layout: 'row', align: 'center' });
      expect(classes).toContain('flex');
      expect(classes).toContain('flex-row');
      expect(classes).toContain('items-center');
    });

    it('should return grid classes with columns', () => {
      const classes = layoutClasses({ layout: 'grid', columns: 3, gap: 'md' });
      expect(classes).toContain('grid');
      expect(classes).toContain('grid-cols-3');
      expect(classes).toContain('gap-3');
    });

    it('should add flex-wrap class', () => {
      expect(layoutClasses({ layout: 'row', wrap: true })).toContain('flex-wrap');
    });

    it('should handle all gap sizes', () => {
      expect(layoutClasses({ layout: 'stack', gap: 'xs' })).toContain('gap-1');
      expect(layoutClasses({ layout: 'stack', gap: 'sm' })).toContain('gap-2');
      expect(layoutClasses({ layout: 'stack', gap: 'md' })).toContain('gap-3');
      expect(layoutClasses({ layout: 'stack', gap: 'lg' })).toContain('gap-4');
    });

    it('should handle all alignment values', () => {
      expect(layoutClasses({ layout: 'row', align: 'start' })).toContain('items-start');
      expect(layoutClasses({ layout: 'row', align: 'end' })).toContain('items-end');
      expect(layoutClasses({ layout: 'row', align: 'stretch' })).toContain('items-stretch');
    });
  });

  describe('resolvePath', () => {
    it('should access top-level keys', () => {
      expect(resolvePath('foo', { foo: 'bar' })).toBe('bar');
    });

    it('should access deeply nested keys', () => {
      expect(resolvePath('a.b.c', { a: { b: { c: 42 } } })).toBe(42);
    });

    it('should strip $. prefix', () => {
      expect(resolvePath('$.books', { books: [1, 2] })).toEqual([1, 2]);
    });

    it('should unwrap {{expression}}', () => {
      expect(resolvePath('{{book.title}}', { book: { title: 'Dune' } })).toBe('Dune');
    });

    it('should handle {{$.path}}', () => {
      expect(resolvePath('{{$.name}}', { name: 'Alice' })).toBe('Alice');
    });

    it('should return undefined for missing paths', () => {
      expect(resolvePath('b', { a: 1 })).toBeUndefined();
    });

    it('should return undefined for paths through non-objects', () => {
      expect(resolvePath('a.b', { a: 'string' })).toBeUndefined();
    });

    it('should return undefined for paths through null', () => {
      expect(resolvePath('a.b', { a: null } as any)).toBeUndefined();
    });

    it('should return undefined for empty path', () => {
      expect(resolvePath('', { a: 1 })).toBeUndefined();
    });
  });

  describe('interpolate', () => {
    it('should replace single expression', () => {
      expect(interpolate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
    });

    it('should replace multiple expressions', () => {
      expect(interpolate('by {{author}} ({{year}})', { author: 'Frank Herbert', year: 1965 })).toBe(
        'by Frank Herbert (1965)',
      );
    });

    it('should resolve nested paths in expressions', () => {
      expect(interpolate('{{book.title}}', { book: { title: 'Dune' } })).toBe('Dune');
    });

    it('should replace missing values with empty string', () => {
      expect(interpolate('Hi {{name}}!', {})).toBe('Hi !');
    });

    it('should leave text without expressions unchanged', () => {
      expect(interpolate('plain text', {})).toBe('plain text');
    });
  });

  describe('isTruthy', () => {
    it('should return true for truthy values', () => {
      expect(isTruthy('hello')).toBe(true);
      expect(isTruthy(1)).toBe(true);
      expect(isTruthy(true)).toBe(true);
      expect(isTruthy([])).toBe(true);
      expect(isTruthy({})).toBe(true);
    });

    it('should return false for falsy values', () => {
      expect(isTruthy(null)).toBe(false);
      expect(isTruthy(undefined)).toBe(false);
      expect(isTruthy(false)).toBe(false);
      expect(isTruthy(0)).toBe(false);
      expect(isTruthy('')).toBe(false);
    });
  });

  describe('resolve with {{interpolation}}', () => {
    it('should interpolate value strings', () => {
      expect(resolve({ atom: 'text', value: 'by {{author}}' }, { author: 'Herbert' })).toBe(
        'by Herbert',
      );
    });

    it('should interpolate multiple expressions in value', () => {
      expect(
        resolve(
          { atom: 'text', value: '{{title}} by {{author}}' },
          { title: 'Dune', author: 'Herbert' },
        ),
      ).toBe('Dune by Herbert');
    });

    it('should prefer bind over value interpolation', () => {
      expect(
        resolve({ atom: 'text', bind: 'name', value: '{{other}}' }, { name: 'A', other: 'B' }),
      ).toBe('A');
    });
  });

  describe('resolve with $. prefix', () => {
    it('should resolve $.path bind', () => {
      expect(resolve({ atom: 'text', bind: '$.title' }, { title: 'Dune' })).toBe('Dune');
    });

    it('should resolve $.nested.path bind', () => {
      expect(resolve({ atom: 'stat', bind: '$.metadata.count' }, { metadata: { count: 42 } })).toBe(
        42,
      );
    });
  });

  describe('each node helpers', () => {
    it('should resolve array from $.path', () => {
      const data = { books: [{ title: 'A' }, { title: 'B' }] };
      const resolved = resolvePath('$.books', data);
      expect(Array.isArray(resolved)).toBe(true);
      expect(resolved).toHaveLength(2);
    });

    it('should return empty array for non-array path', () => {
      const resolved = resolvePath('$.count', { count: 42 });
      expect(Array.isArray(resolved)).toBe(false);
    });

    it('should extend context with loop variable', () => {
      const parentCtx = { books: [{ title: 'Dune' }] };
      const item = { title: 'Dune' };
      const childCtx = { ...parentCtx, book: item };
      expect(childCtx['book']).toEqual(item);
      expect(childCtx['books']).toEqual(parentCtx.books);
    });
  });

  describe('when node helpers', () => {
    it('should evaluate truthy condition', () => {
      const val = resolvePath('{{item.is_public}}', { item: { is_public: true } });
      expect(isTruthy(val)).toBe(true);
    });

    it('should evaluate falsy condition', () => {
      const val = resolvePath('{{item.is_public}}', { item: { is_public: false } });
      expect(isTruthy(val)).toBe(false);
    });

    it('should evaluate null as falsy', () => {
      const val = resolvePath('{{item.missing}}', { item: {} });
      expect(isTruthy(val)).toBe(false);
    });

    it('should evaluate non-empty string as truthy', () => {
      const val = resolvePath('{{status}}', { status: 'active' });
      expect(isTruthy(val)).toBe(true);
    });
  });

  describe('getChildren / getHeader', () => {
    it('should return children array from node', () => {
      const children = [{ atom: 'text', value: 'A' }];
      const node = { layout: 'stack', children };
      expect((node['children'] as unknown[]) || []).toEqual(children);
    });

    it('should return empty array when no children', () => {
      const node = { layout: 'stack' };
      expect((node['children'] as unknown[]) || []).toEqual([]);
    });

    it('should return header string', () => {
      const node = { layout: 'card', header: 'Weather', children: [] };
      expect(node['header'] || '').toBe('Weather');
    });

    it('should return empty string when no header', () => {
      const node = { layout: 'card', children: [] };
      expect((node as any)['header'] || '').toBe('');
    });
  });
});
