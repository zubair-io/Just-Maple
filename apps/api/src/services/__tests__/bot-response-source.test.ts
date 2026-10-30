import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageContent } from '@maple/shared';
import { BotExecutorService } from '../bot-executor.service';

const privacy = vi.hoisted(() => ({ notice: null as string | null }));
vi.mock('../reply-draft.service', async () => ({
    ...(await vi.importActual<typeof import('../reply-draft.service')>('../reply-draft.service')),
    draftRunNotice: () => privacy.notice,
}));

describe('preserved bot response source', () => {
    afterEach(() => {
        privacy.notice = null;
    });
    const executor = new BotExecutorService() as unknown as {
        prepareResponse(ctx: { variables: Record<string, unknown> }): Promise<PageContent>;
    };
    it('retains original source alongside the portable fallback', async () => {
        const raw = '```vbnet\nResponse([Text("Forwarded email")])\n```';
        const variables: Record<string, unknown> = { $response: raw };
        const content = await executor.prepareResponse({ variables });
        expect(variables.$botResponseSource).toBe(raw);
        expect(variables.$botUI).toMatchObject({
            blocks: [{ type: 'text', content: 'Forwarded email' }],
        });
        expect(JSON.stringify(content)).not.toContain('Response(');
    });
    it('never retains raw model text when the shared-draft privacy notice replaces it', async () => {
        privacy.notice = 'Drafted a reply (only the person it is for can see it).';
        const variables: Record<string, unknown> = {
            $response: 'Private draft and recipient',
            copy: 'Private draft and recipient',
        };
        const content = await executor.prepareResponse({ variables });
        expect(variables.$botResponseSource).toBeUndefined();
        expect(JSON.stringify({ variables, content })).not.toContain('Private draft and recipient');
        expect(JSON.stringify(content)).toContain('only the person');
    });
});
