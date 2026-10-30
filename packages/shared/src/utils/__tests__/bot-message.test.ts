import { describe, expect, it } from 'vitest';
import { botMessagePresentation } from '../bot-message';
import { parseBotResponse } from '../bot-ui-parser';
import { markdownToProseMirror } from '../markdown-to-prosemirror';
import type { BotUIResponse } from '../../schemas/bot-ui';

const program =
    'Response([note, ci, src1, src2, src3])note = Text("A forwarded email has a deadline (Monday).")ci = Text("Two build workflows failed.")src1 = Source("Forwarded email", "mail:123")src2 = Source("Web build", "mail:124")src3 = Source("Android build", "mail:125")';
const source = '```vbnet\n' + program + '\n```';
const message = { senderType: 'bot' as const, content: markdownToProseMirror(source) };

describe('render-time bot responses', () => {
    it.each([program, source, '```openui\n' + program + '\n```'])(
        'accepts an implicit root and concatenated statements',
        (raw) => {
            const parsed = parseBotResponse(raw);
            expect(parsed.markdown).toBe('');
            expect(parsed.ui?.blocks.map((block) => block.type)).toEqual([
                'text',
                'text',
                'source',
                'source',
                'source',
            ]);
            expect(parsed.ui?.blocks[2]).toEqual({
                type: 'source',
                label: 'Forwarded email',
                itemId: 'mail:123',
            });
        },
    );
    it('repairs legacy code blocks during display without changing the message', () => {
        const before = JSON.stringify(message);
        expect(botMessagePresentation(message).botUI?.blocks).toHaveLength(5);
        expect(JSON.stringify(botMessagePresentation(message).content)).not.toContain('Response(');
        expect(JSON.stringify(message)).toBe(before);
    });
    it('uses saved source instead of stale processed content and retains surrounding Markdown', () => {
        const result = botMessagePresentation({
            ...message,
            botResponseSource: '# Updated explanation\n\n' + source,
            botUI: {
                version: 1,
                format: 'openui',
                blocks: [{ type: 'text', content: 'Old parse' }],
            },
        });
        expect(result.content.content?.[0]?.type).toBe('heading');
        expect(JSON.stringify(result.content)).toContain('Updated explanation');
        expect(result.botUI?.blocks).toHaveLength(5);
        expect(JSON.stringify(result)).not.toContain('Old parse');
    });
    it('keeps server-created cards and does not allow source to manufacture them', () => {
        const botUI: BotUIResponse = {
            version: 1,
            format: 'openui',
            blocks: [{ type: 'reply_draft', actionId: '11111111-1111-1111-1111-111111111111' }],
        };
        expect(
            botMessagePresentation({
                ...message,
                botResponseSource: source,
                botUI,
            }).botUI?.blocks.at(-1),
        ).toEqual(botUI.blocks[0]);
        for (const raw of [
            'Response([ReplyDraft("11111111-1111-1111-1111-111111111111")])',
            'Response([Button("Go", Query("delete_everything", {}))])',
        ]) {
            expect(parseBotResponse(raw).ui).toBeUndefined();
        }
    });
    it('leaves ordinary code and user messages as content', () => {
        const user = { ...message, senderType: 'user' as const, botResponseSource: source };
        expect(botMessagePresentation(user)).toEqual({ content: user.content });
        const code = '```vbnet\nConsole.WriteLine("Hello")\n```';
        expect(parseBotResponse(code)).toEqual({ markdown: code });
        const ordinary = { senderType: 'bot' as const, content: markdownToProseMirror(code) };
        expect(botMessagePresentation(ordinary).content).toBe(ordinary.content);
    });
    it('preserves quotes and brackets inside text and rejects oversized source', () => {
        expect(
            parseBotResponse(
                'Response([Text("A )note = Text(\\"literal\\") $ @ <script>text</script>")])',
            ).ui?.blocks[0],
        ).toEqual({ type: 'text', content: 'A )note = Text("literal") $ @ <script>text</script>' });
        expect(parseBotResponse(program + ' '.repeat(100000)).ui).toBeUndefined();
    });
});
