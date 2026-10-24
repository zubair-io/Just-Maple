import { describe, expect, it } from 'vitest';
import { botUIToText, isBotUIFallbackContent } from '../bot-ui-text';
import type { BotUIResponse } from '../../schemas/bot-ui';
import type { PageContent } from '../../schemas/page';

const ui: BotUIResponse = {
    version: 1,
    format: 'openui',
    blocks: [
        { type: 'text', content: '**Mini Mission Dashboard**: Lunar flyby' },
        { type: 'table', headers: ['System', 'Status'], rows: [['Power', 'Nominal']] },
        { type: 'button', label: 'Plan a landing', message: 'Plan a Mars landing' },
    ],
};

const doc = (...paragraphs: string[]): PageContent => ({
    type: 'doc',
    content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

describe('isBotUIFallbackContent', () => {
    it('recognizes the flattened copy even after Markdown removed its markers', () => {
        // The stored copy is botUIToText rendered through Markdown: bold markers are gone.
        const stored = doc(
            'Mini Mission Dashboard: Lunar flyby',
            'System | Status',
            'Power | Nominal',
            'Plan a landing: Plan a Mars landing',
        );
        expect(isBotUIFallbackContent(stored, ui)).toBe(true);
        expect(isBotUIFallbackContent(doc(), ui)).toBe(true);
    });

    it('keeps real text that accompanies the blocks', () => {
        expect(isBotUIFallbackContent(doc('Here is a demo dashboard.'), ui)).toBe(false);
        expect(isBotUIFallbackContent(doc('anything'), undefined)).toBe(false);
    });

    it('flattens every block type', () => {
        expect(botUIToText(ui)).toContain('System | Status\nPower | Nominal');
        expect(
            botUIToText({
                version: 1,
                format: 'openui',
                blocks: [{ type: 'source', label: 'UPS notice', itemId: 'mail:1' }],
            }),
        ).toBe('Source: UPS notice (mail:1)');
    });
});
