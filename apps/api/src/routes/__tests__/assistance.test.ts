import { upsertDeviceItems } from '../../repositories/device-item.repo';
import type { FollowUpDocument } from '../../repositories/follow-up.repo';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Elysia } from 'elysia';
import { ObjectId } from 'mongodb';
import { assistanceRoutes } from '../assistance';
import {
    createAuthToken,
    createUserFixture,
    createNotebookFixture,
    createPageFixture,
    createBotTemplateFixture,
    createUserBotFixture,
} from '../../__tests__/helpers/fixtures';
import { testDb } from '../../__tests__/setup';
import {
    assistanceContext,
    claimAssistance,
    completeAssistance,
    findAssistanceTask,
    cancelAssistance,
    renewAssistance,
    expireAssistanceLeases,
    updateRunningAssistance,
    putAssistanceTask,
    conversationMessages,
    type TaskDoc,
} from '../../repositories/assistance.repo';
import type { AssistanceConversation, AssistanceTask, AssistanceHistory } from '@maple/shared';
vi.mock('../../services/assistance-runner.service', () => ({
    wakeAssistanceWorker: vi.fn(),
    stopAssistanceTask: vi.fn(),
}));
vi.mock('../../services/realtime.service', () => ({
    broadcastChatEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/mac-data-relay.service', () => ({
    macDataRelay: { isOnline: vi.fn().mockResolvedValue(false), request: vi.fn() },
}));

describe('durable private assistance', () => {
    const app = new Elysia().use(assistanceRoutes);
    let userId: string,
        token: string,
        otherId: string,
        otherToken: string,
        notebookId: string,
        pageId: string,
        botId: string;
    const call = (path: string, method = 'GET', body?: unknown, auth = token) =>
        app.handle(
            new Request('http://localhost/api/assistance' + path, {
                method,
                headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
        );
    async function open(): Promise<AssistanceConversation> {
        const response = await call('/conversations', 'POST', { pageId, botId });
        expect(response.status).toBe(200);
        return ((await response.json()) as { conversation: AssistanceConversation }).conversation;
    }
    async function send(
        conversationId: string,
        requestId = 'request-one',
        text = 'Summarize this page',
    ): Promise<AssistanceTask> {
        const response = await call(`/conversations/${conversationId}/messages`, 'POST', {
            requestId,
            text,
        });
        expect(response.status).toBe(200);
        return ((await response.json()) as { task: AssistanceTask }).task;
    }
    beforeEach(async () => {
        const user = await createUserFixture({ displayName: 'Reader' }),
            other = await createUserFixture({ displayName: 'Other member' });
        userId = user._id.toString();
        otherId = other._id.toString();
        token = await createAuthToken(userId);
        otherToken = await createAuthToken(otherId);
        const notebook = await createNotebookFixture({ createdBy: userId });
        notebookId = notebook._id.toString();
        const page = await createPageFixture({ userId, notebookId, title: 'Source page' });
        pageId = page.id;
        const template = await createBotTemplateFixture();
        await testDb.collection('bot_templates').updateOne(
            { _id: template._id },
            {
                $set: {
                    'definition.actions': [
                        {
                            type: 'llm',
                            id: 'answer',
                            config: {
                                provider: 'anthropic',
                                model: 'claude-sonnet-4-20250514',
                            },
                        },
                    ],
                },
            },
        );
        const bot = await createUserBotFixture({
            userId,
            templateId: template._id.toString(),
            config: { apiKey: 'not-a-real-secret' },
        });
        botId = bot._id.toString();
        await testDb
            .collection('notebooks')
            .updateOne(
                { _id: notebook._id },
                { $set: { 'sharing.sharedBots': [{ userBotId: botId }] } },
            );
    });
    it('requires sign-in and never exposes bot credentials in the picker', async () => {
        expect((await call(`/bots/${notebookId}`, 'GET', undefined, '')).status).toBe(401);
        const response = await call(`/bots/${notebookId}`);
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain(botId);
        expect(body).not.toContain('not-a-real-secret');
    });
    it('isolates histories from another member of the same notebook', async () => {
        const conversation = await open();
        await send(conversation.id);
        await testDb.collection('notebooks').updateOne(
            { _id: new ObjectId(notebookId) },
            {
                $set: {
                    'sharing.sharedWith': [
                        { userId, accessLevel: 'owner' },
                        { userId: otherId, accessLevel: 'read' },
                    ],
                },
            },
        );
        expect(
            (await call(`/conversations/${conversation.id}`, 'GET', undefined, otherToken)).status,
        ).toBe(404);
        expect(
            (
                await call(
                    `/conversations/${conversation.id}/messages`,
                    'POST',
                    { requestId: 'someone-else', text: 'hello' },
                    otherToken,
                )
            ).status,
        ).toBe(404);
    });
    it('reuses the conversation and request id without scheduling duplicate work', async () => {
        const conversation = await open();
        expect((await open()).id).toBe(conversation.id);
        const first = await send(conversation.id),
            again = await send(conversation.id);
        expect(again.id).toBe(first.id);
        expect(await testDb.collection('assistance_tasks').countDocuments({})).toBe(1);
        expect(
            (
                await call(`/conversations/${conversation.id}/messages`, 'POST', {
                    requestId: 'request-one',
                    text: 'Different content',
                })
            ).status,
        ).toBe(409);
    });
    it('rejects empty turns and bots not shared with this notebook', async () => {
        const conversation = await open();
        expect(
            (
                await call(`/conversations/${conversation.id}/messages`, 'POST', {
                    requestId: 'blank-turn',
                    text: '   ',
                })
            ).status,
        ).toBe(400);
        await testDb
            .collection('notebooks')
            .updateOne({ _id: new ObjectId(notebookId) }, { $set: { 'sharing.sharedBots': [] } });
        expect(
            (
                await call(`/conversations/${conversation.id}/messages`, 'POST', {
                    requestId: 'revoked-bot',
                    text: 'hello',
                })
            ).status,
        ).toBe(403);
    });
    it('rechecks source access after membership is removed', async () => {
        const conversation = await open();
        await testDb
            .collection('notebooks')
            .updateOne(
                { _id: new ObjectId(notebookId) },
                { $set: { 'sharing.sharedWith': [{ userId: otherId, accessLevel: 'owner' }] } },
            );
        expect((await call(`/conversations/${conversation.id}`)).status).toBe(404);
    });
    it('retains drafts and refuses stale writes from another device', async () => {
        const conversation = await open();
        expect(
            (
                await call(`/conversations/${conversation.id}/draft`, 'PATCH', {
                    text: 'My unfinished thought',
                    version: 0,
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await call(`/conversations/${conversation.id}/draft`, 'PATCH', {
                    text: 'Stale overwrite',
                    version: 0,
                })
            ).status,
        ).toBe(409);
        const history = (await (
            await call(`/conversations/${conversation.id}`)
        ).json()) as AssistanceHistory;
        expect(history.conversation.draft).toBe('My unfinished thought');
        expect(history.conversation.draftVersion).toBe(1);
    });
    it('claims work once and rejects another worker renewing its lease', async () => {
        const conversation = await open();
        const sent = await send(conversation.id);
        const [a, b] = await Promise.all([
            claimAssistance('worker-a'),
            claimAssistance('worker-b'),
        ]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
        const claimed = (a || b)!;
        expect(claimed._id).toBe(sent.id);
        expect(
            await renewAssistance(
                claimed._id,
                claimed.leaseOwner === 'worker-a' ? 'worker-b' : 'worker-a',
            ),
        ).toBeNull();
    });
    it('recovers pending work but marks an expired running lease interrupted without replay', async () => {
        const conversation = await open();
        const sent = await send(conversation.id);
        const claimed = await claimAssistance('lost-worker', new Date(Date.now() - 120_000));
        expect(claimed?._id).toBe(sent.id);
        await expireAssistanceLeases();
        expect((await findAssistanceTask(sent.id))?.status).toBe('interrupted');
        expect(await claimAssistance('new-worker')).toBeNull();
        const pending = await send(conversation.id, 'request-two');
        expect((await claimAssistance('new-worker'))?._id).toBe(pending.id);
    });
    it('cancels durably and prevents a late result from being published', async () => {
        const conversation = await open();
        const sent = await send(conversation.id);
        await claimAssistance('worker');
        expect((await call(`/tasks/${sent.id}/stop`, 'POST')).status).toBe(200);
        expect(
            await completeAssistance(
                sent.id,
                'worker',
                {
                    id: sent.id + ':answer',
                    conversationId: conversation.id,
                    role: 'assistant',
                    content: { type: 'doc', content: [] },
                    createdAt: new Date().toISOString(),
                },
                [],
            ),
        ).toBeNull();
        expect(
            (await conversationMessages(conversation.id, userId)).filter(
                (message) => message.role === 'assistant',
            ),
        ).toHaveLength(0);
        expect((await findAssistanceTask(sent.id))?.status).toBe('cancelled');
        expect(await cancelAssistance(sent.id, otherId)).toBeNull();
    });
    it('commits a result with its completed state and saves one editable note with its source', async () => {
        const conversation = await open();
        const sent = await send(conversation.id);
        await claimAssistance('worker');
        const content = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A useful answer.' }] }],
        };
        await completeAssistance(
            sent.id,
            'worker',
            {
                id: sent.id + ':answer',
                conversationId: conversation.id,
                role: 'assistant',
                content,
                createdAt: new Date().toISOString(),
                taskId: sent.id,
            },
            [],
        );
        const history = (await (
            await call(`/conversations/${conversation.id}`)
        ).json()) as AssistanceHistory;
        expect(history.messages.at(-1)?.role).toBe('assistant');
        const first = await call(`/tasks/${sent.id}/save`, 'POST', {
            title: 'Saved answer',
            notebookId,
        });
        expect(first.status).toBe(200);
        const again = await call(`/tasks/${sent.id}/save`, 'POST', {
            title: 'Another title',
            notebookId,
        });
        expect(again.status).toBe(200);
        const a = (await first.json()) as { page: { id: string; content: unknown } },
            b = (await again.json()) as { page: { id: string } };
        expect(a.page.id).toBe(b.page.id);
        expect(JSON.stringify(a.page.content)).toContain(pageId);
        expect(await updateRunningAssistance(sent.id, 'worker', { status: 'failed' })).toBeNull();
    });
    it('does not save private results into a shared notebook', async () => {
        const conversation = await open();
        const sent = await send(conversation.id);
        await claimAssistance('worker');
        await completeAssistance(
            sent.id,
            'worker',
            {
                id: sent.id + ':answer',
                conversationId: conversation.id,
                role: 'assistant',
                content: { type: 'doc', content: [] },
                createdAt: new Date().toISOString(),
            },
            [],
        );
        await testDb.collection('notebooks').updateOne(
            { _id: new ObjectId(notebookId) },
            {
                $set: {
                    'sharing.sharedWith': [
                        { userId, accessLevel: 'owner' },
                        { userId: otherId, accessLevel: 'read' },
                    ],
                },
            },
        );
        expect(
            (await call(`/tasks/${sent.id}/save`, 'POST', { title: 'Private answer', notebookId }))
                .status,
        ).toBe(403);
    });
    it('pages equal-timestamp task rows without overlap and rejects a foreign cursor', async () => {
        const conversation = await open();
        const sent = await send(conversation.id);
        const base = (await findAssistanceTask(sent.id))!;
        for (let i = 0; i < 35; i++)
            await putAssistanceTask({ ...base, _id: String(i).padStart(64, '0') } as TaskDoc);
        const a = (await (await call(`/today/${notebookId}?section=working&limit=20`)).json()) as {
            tasks: AssistanceTask[];
            nextTask: string;
        };
        const b = (await (
            await call(`/today/${notebookId}?section=working&limit=20&taskBefore=${a.nextTask}`)
        ).json()) as { tasks: AssistanceTask[] };
        expect(a.tasks).toHaveLength(20);
        expect(b.tasks).toHaveLength(16);
        expect(new Set([...a.tasks, ...b.tasks].map((task) => task.id)).size).toBe(36);
        const foreign = (await (
            await call(`/today/${notebookId}?section=working&taskBefore=not-a-real-cursor`)
        ).json()) as { tasks: AssistanceTask[] };
        expect(foreign.tasks).toEqual([]);
    });
    it('shows only owned, accessible work in Today and bounds paging', async () => {
        const conversation = await open();
        const sent = await send(conversation.id);
        const mine = (await (
            await call(`/today/${notebookId}?section=working&limit=1`)
        ).json()) as { tasks: AssistanceTask[] };
        expect(mine.tasks.map((task) => task.id)).toEqual([sent.id]);
        expect(
            (await call(`/today/${notebookId}?section=working`, 'GET', undefined, otherToken))
                .status,
        ).toBe(404);
        expect((await call(`/today/${notebookId}?limit=10000`)).status).toBe(422);
        await testDb.collection('pages').updateOne({ id: pageId }, { $set: { isTrashed: true } });
        const hidden = (await (await call(`/today/${notebookId}?section=working`)).json()) as {
            tasks: AssistanceTask[];
        };
        expect(hidden.tasks).toEqual([]);
    });
    it('runs queued turns in a conversation sequentially', async () => {
        const conversation = await open();
        await send(conversation.id, 'first-turn');
        await send(conversation.id, 'second-turn');
        const first = await claimAssistance('worker');
        expect(first).not.toBeNull();
        expect(await claimAssistance('worker')).toBeNull();
        await completeAssistance(
            first!._id,
            'worker',
            {
                id: first!._id + ':answer',
                conversationId: conversation.id,
                role: 'assistant',
                content: {
                    type: 'doc',
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'First answer' }] },
                    ],
                },
                createdAt: new Date().toISOString(),
            },
            [],
        );
        const second = await claimAssistance('worker');
        expect(second).not.toBeNull();
        expect(JSON.stringify(await assistanceContext(second!))).toContain('First answer');
    });

    it('prepares one reviewable reply from visible evidence and hides removed sources', async () => {
        const now = Date.now(),
            itemId = 'imessage:question';
        await testDb
            .collection('pages')
            .updateOne({ id: pageId }, { $set: { type: 'devicedata', deviceSource: 'imessage' } });
        await upsertDeviceItems(userId, 'test-device', [
            {
                id: itemId,
                source: 'imessage',
                revision: '1',
                occurredAt: now / 1000,
                sender: '+15555550100',
                participants: ['+15555550100'],
                thread: 'example-thread',
                body: 'Can you confirm the meeting?',
                isFromMe: false,
            },
        ]);
        const follow: FollowUpDocument = {
            _id: userId + '|owe_reply|example',
            userId,
            direction: 'owe_reply',
            who: 'Example contact',
            what: 'Confirm the meeting',
            at: now / 1000,
            status: 'open',
            confidence: 1,
            madeBy: 'rule',
            sensitive: false,
            threadKey: 'example-thread',
            evidence: [{ itemId, source: 'imessage', at: now / 1000 }],
            createdAt: new Date(now),
            updatedAt: new Date(now),
        };
        await testDb.collection<FollowUpDocument>('follow_ups').insertOne(follow);
        const feed = (await (await call(`/today/${notebookId}`)).json()) as {
            followUps: { id: string; evidence: { pageId: string }[] }[];
        };
        expect(feed.followUps[0]?.evidence[0]?.pageId).toBe(pageId);
        const body = { followUpId: follow._id, botId, requestId: 'prepare-example-reply' };
        const a = await call(`/today/${notebookId}/draft`, 'POST', body);
        expect(a.status).toBe(200);
        const b = await call(`/today/${notebookId}/draft`, 'POST', body);
        expect(b.status).toBe(200);
        const first = (await a.json()) as { task: AssistanceTask },
            retry = (await b.json()) as { task: AssistanceTask };
        expect(first.task.id).toBe(retry.task.id);
        expect(first.task.question).toContain(itemId);
        expect(first.task.question).toContain('do not send');
        await testDb.collection('pages').updateOne({ id: pageId }, { $set: { isTrashed: true } });
        expect(
            (
                await call(`/today/${notebookId}/draft`, 'POST', {
                    ...body,
                    requestId: 'new-reply-after-removal',
                })
            ).status,
        ).toBe(404);
        const hidden = (await (await call(`/today/${notebookId}`)).json()) as {
            followUps: unknown[];
        };
        expect(hidden.followUps).toEqual([]);
    });
    it('pages a question and answer deterministically when their timestamps tie', async () => {
        const conversation = await open(),
            sent = await send(conversation.id);
        const task = (await findAssistanceTask(sent.id))!;
        await claimAssistance('worker');
        await completeAssistance(
            sent.id,
            'worker',
            {
                id: sent.id + ':answer',
                conversationId: conversation.id,
                role: 'assistant',
                content: { type: 'doc', content: [] },
                createdAt: task.createdAt.toISOString(),
            },
            [],
        );
        await testDb
            .collection<TaskDoc>('assistance_tasks')
            .updateOne({ _id: sent.id }, { $set: { completedAt: task.createdAt } });
        const latest = await conversationMessages(conversation.id, userId, undefined, 1);
        expect(latest[0]?.role).toBe('assistant');
        const older = await conversationMessages(conversation.id, userId, latest[0]!._id, 1);
        expect(older[0]?.role).toBe('user');
        expect(await conversationMessages(conversation.id, userId, older[0]!._id, 1)).toEqual([]);
    });
});
