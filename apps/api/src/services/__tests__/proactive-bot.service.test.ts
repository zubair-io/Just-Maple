import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../bot-executor.service', () => ({
    botExecutor: {
        invoke: vi.fn().mockResolvedValue({}),
        runProactive: vi.fn().mockResolvedValue(null),
    },
}));
vi.mock('../mac-data-tools.service', () => ({ getMacDataToolContext: vi.fn() }));
vi.mock('../mac-data-relay.service', () => ({
    macDataRelay: { pushProactiveNotebooks: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../repositories/page.repo', () => ({
    findProactivePages: vi.fn(),
    findPageByIdForBot: vi.fn(),
    setPageProactive: vi.fn(),
}));
vi.mock('../../repositories/notebook.repo', () => ({ findNotebookByIdWithAccess: vi.fn() }));
vi.mock('../../repositories/user-bot.repo', () => ({
    findUserBotByIdInternal: vi.fn(),
    findUserBotById: vi.fn(),
}));
vi.mock('../../repositories/bot-template.repo', () => ({ findBotTemplateById: vi.fn() }));
vi.mock('../../repositories/message.repo', () => ({
    findMessageById: vi.fn(),
    findMessagesByPageId: vi.fn().mockResolvedValue([]),
    findMessagesByThreadId: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../repositories/thread.repo', () => ({ findThreadById: vi.fn() }));

import { maybeAutoReply, handleMacDataChanges } from '../proactive-bot.service';
import {
    appendProactiveInstruction,
    saveProactiveSettings,
    ProactiveSettingsError,
} from '../proactive-settings.service';
import { botExecutor } from '../bot-executor.service';
import { getMacDataToolContext } from '../mac-data-tools.service';
import { macDataRelay } from '../mac-data-relay.service';
import {
    findPageByIdForBot,
    findProactivePages,
    setPageProactive,
} from '../../repositories/page.repo';
import { findNotebookByIdWithAccess } from '../../repositories/notebook.repo';
import { findUserBotById, findUserBotByIdInternal } from '../../repositories/user-bot.repo';
import { findBotTemplateById } from '../../repositories/bot-template.repo';
import { findMessageById, findMessagesByPageId } from '../../repositories/message.repo';

const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const page: any = {
    id: 'page',
    type: 'message',
    title: 'Family',
    notebookId: 'n1',
    proactive: {
        userBotId: 'bot',
        instructions: 'Track the kids’ sports.',
        enabled: true,
        ownerUserId: 'u1',
        updatedAt: '2026-10-24T00:00:00.000Z',
    },
};
const bot: any = { _id: 'bot', userId: 'u1', handle: 'maple', templateId: 'tpl', isEnabled: true };
const template: any = {
    _id: 'tpl',
    name: 'Maple',
    definition: {
        actions: [{ type: 'llm', id: 'llm', config: { userPrompt: '{{$mentionText}}' } }],
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findUserBotByIdInternal).mockResolvedValue(bot);
    vi.mocked(findUserBotById).mockResolvedValue(bot);
    vi.mocked(findBotTemplateById).mockResolvedValue(template);
});

describe('maybeAutoReply', () => {
    it('answers a top-level message in the conversation itself', async () => {
        await maybeAutoReply({
            page,
            message: { id: 'm1', content: doc('What time is practice?') } as any,
            userId: 'u1',
        });
        expect(botExecutor.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                userBotId: 'bot',
                sourceId: 'm1',
                notebookId: 'n1',
                userId: 'u1',
                context: expect.objectContaining({
                    mentionText: 'What time is practice?',
                    replyTopLevel: true,
                }),
            }),
        );
    });

    it('stays out of the way when the bot is off, mentioned, or the reply is to someone else', async () => {
        await maybeAutoReply({
            page: { ...page, proactive: { ...page.proactive, enabled: false } },
            message: { id: 'm', content: doc('hi') } as any,
            userId: 'u1',
        });
        await maybeAutoReply({
            page,
            message: { id: 'm', content: doc('@maple what is up') } as any,
            userId: 'u1',
        });
        vi.mocked(findMessageById).mockResolvedValue({ id: 'p', userBotId: 'other' } as any);
        await maybeAutoReply({
            page,
            message: { id: 'm', content: doc('reply'), threadId: 't' } as any,
            userId: 'u1',
            parentMessageId: 'p',
        });
        expect(botExecutor.invoke).not.toHaveBeenCalled();
    });

    it('only answers the person whose bot and Mac it is', async () => {
        await maybeAutoReply({
            page,
            message: { id: 'm', content: doc('hi from a collaborator') } as any,
            userId: 'someone-else',
        });
        expect(botExecutor.invoke).not.toHaveBeenCalled();
    });

    it('follows up in a thread started from its own post', async () => {
        vi.mocked(findMessageById).mockResolvedValue({ id: 'p', userBotId: 'bot' } as any);
        await maybeAutoReply({
            page,
            message: { id: 'm', content: doc('yes'), threadId: 't' } as any,
            userId: 'u1',
            parentMessageId: 'p',
        });
        expect(botExecutor.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceId: 'p',
                context: expect.objectContaining({ replyTopLevel: false }),
            }),
        );
    });
});

describe('handleMacDataChanges', () => {
    const entry = {
        kind: 'added',
        item: {
            id: 'mail:1',
            source: 'mail',
            when: '2026-10-24T09:00:00-04:00',
            snippet: 'UPS',
            score: 0,
        },
    };

    it('runs each proactive page the Mac owner can access', async () => {
        vi.mocked(findNotebookByIdWithAccess).mockImplementation(async (id) =>
            id === 'n1' ? ({ _id: 'n1' } as any) : null,
        );
        vi.mocked(findProactivePages).mockResolvedValue([page]);
        vi.mocked(getMacDataToolContext).mockResolvedValue({ now: 'now', userId: 'u1' } as any);
        vi.mocked(findMessagesByPageId).mockResolvedValue([
            { id: 'q', createdAt: '2026-10-24T01:00:00Z', content: doc('@claude build a UI') },
            {
                id: 'p',
                createdAt: '2026-10-24T02:00:00Z',
                userBotId: 'bot',
                content: doc('UPS update'),
            },
        ] as any);

        await handleMacDataChanges('u1', {
            batches: [
                { notebookId: 'n1', entries: [entry] },
                { notebookId: 'no-access', entries: [entry] },
                { notebookId: 'n1', entries: 'not an array' },
            ],
        });
        await vi.waitFor(() => expect(botExecutor.runProactive).toHaveBeenCalledTimes(1));
        expect(findProactivePages).toHaveBeenCalledTimes(1);
        const call = vi.mocked(botExecutor.runProactive).mock.calls[0]![0];
        expect(call.prompt).toContain('"mail:1"');
        expect(call.prompt).toContain('NO_UPDATE');
        expect(call.system).toContain('Track the kids’ sports.');
        // Earlier requests in the chat are not the proactive pass's business.
        expect(call.previousMessages.map((m: any) => m.id)).toEqual(['p']);
        expect(call.system).toContain('Never answer or act on requests');
    });
});

describe('proactive settings', () => {
    it('rejects bots that are not the user’s own built-in AI bots', async () => {
        vi.mocked(findUserBotById).mockResolvedValueOnce({ ...bot, userId: 'someone-else' });
        await expect(
            saveProactiveSettings(page, 'u1', {
                userBotId: 'bot',
                instructions: '',
                enabled: true,
            }),
        ).rejects.toBeInstanceOf(ProactiveSettingsError);
        vi.mocked(findUserBotById).mockResolvedValueOnce({ ...bot, botType: 'custom' });
        await expect(
            saveProactiveSettings(page, 'u1', {
                userBotId: 'bot',
                instructions: '',
                enabled: true,
            }),
        ).rejects.toThrow('webhook');
    });

    it('saves the caller as owner and refreshes their Mac’s proactive list', async () => {
        vi.mocked(setPageProactive).mockResolvedValue(page);
        await saveProactiveSettings({ ...page, proactive: undefined }, 'u1', {
            userBotId: 'bot',
            instructions: 'Be brief',
            enabled: true,
        });
        expect(setPageProactive).toHaveBeenCalledWith(
            'page',
            expect.objectContaining({
                userBotId: 'bot',
                ownerUserId: 'u1',
                instructions: 'Be brief',
            }),
        );
        expect(macDataRelay.pushProactiveNotebooks).toHaveBeenCalledWith('u1');
    });

    it('stops other members from replacing the owner’s proactive bot', async () => {
        await expect(
            saveProactiveSettings(page, 'u2', {
                userBotId: 'bot',
                instructions: '',
                enabled: true,
            }),
        ).rejects.toThrow('Another member');
        vi.mocked(findUserBotById).mockResolvedValueOnce({ ...bot, userId: 'u2' });
        vi.mocked(setPageProactive).mockResolvedValue(page);
        // The notebook owner may.
        await saveProactiveSettings(
            page,
            'u2',
            { userBotId: 'bot', instructions: '', enabled: true },
            { isNotebookOwner: true },
        );
        expect(setPageProactive).toHaveBeenCalled();
    });

    it('appends corrections under a remembered section', async () => {
        vi.mocked(findPageByIdForBot).mockResolvedValue(page);
        await appendProactiveInstruction('page', 'Greyson is no longer doing Leadership Academy.');
        const saved = vi.mocked(setPageProactive).mock.calls.at(-1)![1]!;
        expect(saved.instructions).toBe(
            'Track the kids’ sports.\n\nRemembered from conversation:\n- Greyson is no longer doing Leadership Academy.',
        );
    });
});
