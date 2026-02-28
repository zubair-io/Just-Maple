import { describe, it, expect } from 'vitest';
import { parseTypedBlocks, serializeTypedBlock } from '../typed-blocks';

describe('parseTypedBlocks', () => {
    it('parses a single maple:embed block', () => {
        const md = `Some text.

\`\`\`maple:embed
{
  "url": "https://youtube.com/watch?v=abc",
  "title": "Video Title"
}
\`\`\`

More text.`;

        const results = parseTypedBlocks(md);
        expect(results).toHaveLength(1);
        const block = results[0]!;
        expect('type' in block).toBe(true);
        if ('type' in block) {
            expect(block.type).toBe('embed');
            expect(block.data).toEqual({
                url: 'https://youtube.com/watch?v=abc',
                title: 'Video Title',
            });
        }
    });

    it('parses a maple:image block', () => {
        const md = `\`\`\`maple:image
{
  "src": "./assets/3a7f2b.png",
  "alt": "Screenshot",
  "width": 600
}
\`\`\``;

        const results = parseTypedBlocks(md);
        expect(results).toHaveLength(1);
        const block = results[0]!;
        expect('type' in block).toBe(true);
        if ('type' in block) {
            expect(block.type).toBe('image');
            expect(block.data.src).toBe('./assets/3a7f2b.png');
            expect(block.data.width).toBe(600);
        }
    });

    it('ignores non-maple code fences', () => {
        const md = `\`\`\`python
print("hello")
\`\`\`

\`\`\`maple:embed
{"url": "https://example.com"}
\`\`\`

\`\`\`javascript
console.log("hi")
\`\`\``;

        const results = parseTypedBlocks(md);
        expect(results).toHaveLength(1);
        const block = results[0]!;
        expect('type' in block).toBe(true);
        if ('type' in block) {
            expect(block.type).toBe('embed');
        }
    });

    it('returns error with line number for invalid JSON', () => {
        const md = `\`\`\`maple:embed
{invalid json here}
\`\`\``;

        const results = parseTypedBlocks(md);
        expect(results).toHaveLength(1);
        const result = results[0]!;
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error).toContain('Invalid JSON');
            expect(result.line).toBe(1);
        }
    });

    it('parses multiple typed blocks', () => {
        const md = `\`\`\`maple:embed
{"url": "https://example.com"}
\`\`\`

\`\`\`maple:page-link
{"shortId": "d4e5f6", "title": "Linked Page"}
\`\`\``;

        const results = parseTypedBlocks(md);
        expect(results).toHaveLength(2);
        expect('type' in results[0]!).toBe(true);
        expect('type' in results[1]!).toBe(true);
        if ('type' in results[0]! && 'type' in results[1]!) {
            expect(results[0]!.type).toBe('embed');
            expect(results[1]!.type).toBe('page-link');
        }
    });
});

describe('serializeTypedBlock', () => {
    it('serializes an embed block', () => {
        const result = serializeTypedBlock('embed', {
            url: 'https://example.com',
            title: 'Example',
        });
        expect(result).toBe(`\`\`\`maple:embed
{
  "url": "https://example.com",
  "title": "Example"
}
\`\`\``);
    });

    it('round-trips a typed block', () => {
        const original = { src: './assets/abc.png', alt: 'Test', width: 400 };
        const serialized = serializeTypedBlock('image', original);
        const parsed = parseTypedBlocks(serialized);
        expect(parsed).toHaveLength(1);
        const block = parsed[0]!;
        expect('type' in block).toBe(true);
        if ('type' in block) {
            expect(block.data).toEqual(original);
        }
    });
});
