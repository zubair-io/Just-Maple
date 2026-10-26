import { describe, it, expect } from 'vitest';
import { parseBotResponse } from '../bot-ui.service';

const response = (source: string) => `Here are the options.\n\n\`\`\`openui\n${source}\n\`\`\``;
describe('OpenUI response boundary', () => {
    it('keeps existing Markdown replies unchanged', () => {
        expect(parseBotResponse('**Hello**')).toEqual({ markdown: '**Hello**' });
    });
    it('parses cards, tables, buttons and forms into portable Maple data', () => {
        const result = parseBotResponse(
            response(
                'card = Card("Plan", "Costs $20 @ home")\ntable = Table(["Name", "Price"], [["A", "$20"]])\nbutton = Button("Compare", "Compare the options")\nform = Form("Preferences", [{name: "budget", label: "Budget"}], "Submit")\nroot = Response([card, table, button, form])',
            ),
        );
        expect(result.markdown).toBe('Here are the options.');
        expect(result.ui?.blocks).toEqual([
            { type: 'card', title: 'Plan', content: 'Costs $20 @ home' },
            { type: 'table', headers: ['Name', 'Price'], rows: [['A', '$20']] },
            { type: 'button', label: 'Compare', message: 'Compare the options' },
            {
                type: 'form',
                title: 'Preferences',
                fields: [{ name: 'budget', label: 'Budget' }],
                submitLabel: 'Submit',
            },
        ]);
    });
    it.each([
        'root = Unknown("bad")',
        'root = Response([missing])',
        'root = Response([Card("title")])',
        'root = Response([Card("title", "body")',
        'root = Response([Button("click", Query("delete_everything", {}))])',
        'root = Response([Form("secret", [{name: "__proto__", label: "bad"}], "Submit")])',
        'root = Response([Card("title", "x".repeat(20000))])',
    ])('falls back to text for invalid or executable UI: %s', (source) => {
        expect(parseBotResponse(response(source))).toEqual({ markdown: 'Here are the options.' });
    });
    it('rejects oversized collections rather than rendering unbounded UI', () => {
        const cards = Array.from({ length: 31 }, () => 'Card("title", "body")').join(', ');
        expect(parseBotResponse(response(`root = Response([${cards}])`)).ui).toBeUndefined();
    });
    it('provides a readable fallback if invalid UI has no prose', () => {
        expect(parseBotResponse('```openui\nroot = Unknown()\n```').markdown).toContain(
            'respond as text',
        );
    });

    it('renders OpenUI the model sent without the openui fence', () => {
        const statements =
            'root = Response([note, src])\nnote = Text("The Android build failed.")\nsrc = Source("Android CI failure", "mail:737240")';
        for (const reply of [statements, '```\n' + statements + '\n```']) {
            const parsed = parseBotResponse(reply);
            expect(parsed.markdown).toBe('');
            expect(parsed.ui?.blocks).toEqual([
                { type: 'text', content: 'The Android build failed.' },
                { type: 'source', label: 'Android CI failure', itemId: 'mail:737240' },
            ]);
        }
        // Ordinary text that merely mentions an assignment stays text.
        expect(parseBotResponse('Set x = Foo(1) in the config.').ui).toBeUndefined();
    });
});
