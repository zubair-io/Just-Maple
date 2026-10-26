import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { createMessageInThread, findMessageById, findMessagesByThreadId } from '../message.repo';
import { mongoAvailable } from '../../__tests__/setup';
import { parseBotResponse } from '../../services/bot-ui.service';

describe.runIf(mongoAvailable)('saved interactive bot replies', () => {
    it('reloads validated UI and the chosen model from MongoDB', async () => {
        const { ui } = parseBotResponse(
            '```openui\nroot = Response([Card("Plan", "Details"), Button("More", "Tell me more")])\n```',
        );
        expect(ui).toBeDefined();
        const threadId = new ObjectId().toString();
        const message = await createMessageInThread({
            pageId: 'messages-page',
            notebookId: new ObjectId().toString(),
            userId: new ObjectId().toString(),
            userBotId: new ObjectId().toString(),
            threadId,
            senderType: 'bot',
            content: { type: 'doc', content: [] },
            botUI: ui,
            botModel: 'gpt-4.1-mini',
        });
        const reloaded = await findMessageById(message.id);
        expect(reloaded).toMatchObject({
            botUI: ui,
            botModel: 'gpt-4.1-mini',
            pageId: 'messages-page',
        });
        expect(await findMessagesByThreadId(threadId)).toEqual([reloaded]);
    });

    it('shows an old bot message saved as raw card text as a card', async () => {
        const raw =
            'root = Response([note, src])note = Text("The build failed.")src = Source("CI run failed", "mail:737267")';
        const message = await createMessageInThread({
            pageId: 'messages-page',
            notebookId: new ObjectId().toString(),
            userId: new ObjectId().toString(),
            userBotId: new ObjectId().toString(),
            threadId: new ObjectId().toString(),
            senderType: 'bot',
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }],
            },
        });
        const reloaded = await findMessageById(message.id);
        expect(reloaded?.botUI?.blocks).toEqual([
            { type: 'text', content: 'The build failed.' },
            { type: 'source', label: 'CI run failed', itemId: 'mail:737267' },
        ]);
        expect(JSON.stringify(reloaded?.content)).not.toContain('root = Response');
    });
});
