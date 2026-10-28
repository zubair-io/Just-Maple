import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { createTestApp } from '../../__tests__/helpers/app';
import {
    createAuthToken,
    createBotTemplateFixture,
    createMessageFixture,
    createNotebookFixture,
    createUserBotFixture,
    createUserFixture,
} from '../../__tests__/helpers/fixtures';
import { mongoAvailable, testDb } from '../../__tests__/setup';
import type { MacDataItem } from '@maple/shared';

// A whole chat run with the real executor; only the model is replaced. It drafts a
// reply and then writes the draft into its own answer, as a careless model might.
vi.mock('../../services/llm-tool-loop.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/llm-tool-loop.service')>()),
    runAnthropicWithTools: vi.fn(),
}));
vi.mock('../../services/proactive-bot.service', () => ({
    handleDeviceDataChanges: vi.fn().mockResolvedValue(undefined),
    maybeAutoReply: vi.fn(),
}));
vi.mock('../../services/mac-data-relay.service', () => ({
    macDataRelay: {
        isOnline: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockResolvedValue(true),
    },
}));
vi.mock('../../services/realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
    broadcastToNotebook: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/notification.service', () => ({
    sendMessageReceivedNotification: vi.fn().mockResolvedValue('n'),
}));

import { BotExecutorService } from '../../services/bot-executor.service';
import { runAnthropicWithTools } from '../../services/llm-tool-loop.service';
import { createInvocation } from '../../repositories/bot-invocation.repo';
import { SHARED_DRAFT_NOTICE } from '../../services/reply-draft.service';

const DRAFT = 'yesss saturday at 4 works!! 🎉';
const NOW = Math.floor(Date.now() / 1000);

describe.runIf(mongoAvailable)('A chat run that drafts a reply', () => {
    let app: ReturnType<typeof createTestApp>;
    let owner: { id: string; token: string };
    let member: { id: string; token: string };

    const call = (who: { token: string }, path: string, method = 'GET', body?: unknown) =>
        app.handle(
            new Request('http://localhost' + path, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + who.token,
                },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            }),
        );

    async function person(displayName: string) {
        const user = await createUserFixture({ displayName });
        const id = user._id.toString();
        return { id, token: await createAuthToken(id) };
    }

    async function setUp(sharedWithMember: boolean) {
        const notebookId = (
            await createNotebookFixture({
                createdBy: owner.id,
                sharedWith: [
                    { userId: owner.id, accessLevel: 'owner' },
                    ...(sharedWithMember
                        ? [{ userId: member.id, accessLevel: 'write' as const }]
                        : []),
                ],
            })
        )._id.toString();
        const { page } = await (
            await call(owner, '/api/pages', 'POST', {
                type: 'devicedata',
                deviceSource: 'imessage',
                title: 'Messages',
                notebookId,
            })
        ).json();
        await call(owner, `/api/device-data/pages/${page.id}`, 'PATCH', {
            deviceFilter: { includeAll: true },
        });
        const template = await createBotTemplateFixture({ name: 'Maple' });
        await testDb!.collection('bot_templates').updateOne(
            { _id: template._id },
            {
                $set: {
                    'definition.actions': [
                        {
                            type: 'llm',
                            id: 'reply',
                            config: {
                                model: 'claude-haiku-5-5',
                                userPrompt: '{{$mentionText}}',
                                responseMode: 'text',
                            },
                            outputVariable: 'answer',
                        },
                    ],
                },
            },
        );
        const bot = await createUserBotFixture({
            userId: owner.id,
            templateId: template._id.toString(),
            displayName: 'Maple',
            config: { apiKey: 'key' },
        });
        const source = await createMessageFixture({
            notebookId,
            userId: owner.id,
            content: { type: 'doc', content: [] },
        });
        const invocation = await createInvocation({
            userBotId: bot._id.toString(),
            templateId: template._id.toString(),
            sourceType: 'message',
            sourceId: source.id,
            notebookId,
            userId: owner.id,
            context: { mentionText: '@maple draft a reply to Jen' },
        });
        return { notebookId, invocationId: invocation._id };
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        app = createTestApp();
        owner = await person('Alex');
        member = await person('Sam');
        await call(owner, '/api/collectors', 'POST', {
            deviceId: 'mac-one-1',
            platform: 'macos',
            name: 'Mac one',
            sources: ['imessage'],
            timeZone: 'America/New_York',
        });
        await call(owner, '/api/collectors/mac-one-1', 'PATCH', { activeSources: ['imessage'] });
        const jen: MacDataItem = {
            id: 'imessage:jen-1',
            source: 'imessage',
            revision: '1',
            occurredAt: NOW - 600,
            sender: 'Jen',
            thread: 'Jen',
            participants: ['+15185550100'],
            body: 'Still on for Saturday?',
            isFromMe: false,
            extra: { chatId: 'iMessage;-;+15185550100' },
        };
        await call(owner, '/api/device-data/items', 'POST', {
            deviceId: 'mac-one-1',
            upserts: [jen],
            removals: [],
        });
        vi.mocked(runAnthropicWithTools).mockImplementation(async ({ execute }) => {
            await execute('draft_reply', { item_id: 'imessage:jen-1' });
            await execute('draft_reply', { item_id: 'imessage:jen-1', body: DRAFT });
            return `Here's a draft for Jen: "${DRAFT}"`;
        });
    });

    it('posts and stores no draft text in a shared notebook', async () => {
        const { notebookId, invocationId } = await setUp(true);
        await new BotExecutorService().execute(invocationId);

        const invocation = await testDb!
            .collection('bot_invocations')
            .findOne({ _id: new ObjectId(invocationId) });
        expect(invocation!.status).toBe('completed');
        expect(JSON.stringify(invocation)).not.toContain('saturday at 4');
        // The bot's words (which named Jen) are gone; the person's own request stays.
        expect(JSON.stringify(invocation!.variables)).not.toContain('draft for Jen');
        expect(invocation!.variables.$response).toBe(SHARED_DRAFT_NOTICE);
        expect(invocation!.variables.answer).toBe(SHARED_DRAFT_NOTICE);

        const asMember = await call(member, `/api/invocations/${invocationId}`);
        expect(asMember.status).toBe(200);
        const seen = JSON.stringify(await asMember.json());
        expect(seen).not.toContain('saturday at 4');
        expect(seen).not.toContain('"variables"');

        const posted = await testDb!
            .collection('messages')
            .find({ notebookId: new ObjectId(notebookId), senderType: 'bot' })
            .toArray();
        expect(posted).toHaveLength(1);
        expect(JSON.stringify(posted[0])).not.toContain('saturday at 4');
        expect(JSON.stringify(posted[0].content)).toContain('Drafted a reply');
        expect(posted[0].botUI.blocks).toEqual([
            { type: 'reply_draft', actionId: expect.any(String) },
        ]);
        const draft = await testDb!.collection('bot_actions').findOne();
        expect(draft).toMatchObject({ status: 'proposed', messageId: posted[0].id });
    });

    it('keeps the bot’s words in the owner’s private notebook', async () => {
        const { invocationId } = await setUp(false);
        await new BotExecutorService().execute(invocationId);
        const invocation = await testDb!
            .collection('bot_invocations')
            .findOne({ _id: new ObjectId(invocationId) });
        expect(invocation!.variables.$response).toContain('draft for Jen');
    });
});
