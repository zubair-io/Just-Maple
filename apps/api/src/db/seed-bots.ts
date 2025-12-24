import { upsertBotTemplate } from '../repositories/bot-template.repo';
import type { BotDefinition } from '@maple/shared';

/**
 * Hello World Bot Definition
 * Simple bot that just replies with "hello world"
 */
const helloWorldDefinition: BotDefinition = {
    trigger: {
        mentionPatterns: ['hello', 'hi', 'helloworld'],
    },
    input: {
        includeContext: {
            mentionText: true,
        },
    },
    actions: [
        {
            type: 'reply',
            id: 'reply-hello',
            config: {
                message: 'Hello, world! 👋',
            },
        },
    ],
    output: {
        chatView: {
            components: [
                {
                    id: 'greeting',
                    type: 'text',
                    props: {
                        content: '{{$response}}',
                    },
                },
            ],
        },
    },
};

/**
 * Claude Bot Definition
 * Uses Claude API to respond to messages
 */
const claudeDefinition: BotDefinition = {
    trigger: {
        mentionPatterns: ['claude', 'ai', 'ask'],
    },
    input: {
        includeContext: {
            mentionText: true,
            fullMessage: true,
            previousMessages: 5,
        },
    },
    actions: [
        {
            type: 'llm',
            id: 'claude-response',
            config: {
                model: 'claude-sonnet-4-20250514',
                systemPrompt:
                    'You are a helpful AI assistant in a chat application. Be concise and friendly. Respond directly to what the user is asking.',
                userPrompt: '{{$mentionText}}',
                maxTokens: 1024,
            },
            outputVariable: 'response',
        },
    ],
    output: {
        chatView: {
            components: [
                {
                    id: 'response',
                    type: 'markdown',
                    props: {
                        content: '{{$response}}',
                    },
                },
            ],
        },
    },
    onError: {
        retryCount: 1,
        fallbackMessage: 'Sorry, I encountered an error processing your request.',
    },
};

/**
 * Seed bot templates into the database
 */
export async function seedBotTemplates(): Promise<void> {
    console.log('[Seed] Creating bot templates...');

    // Hello World Bot
    await upsertBotTemplate('hello', {
        name: 'Hello World',
        handle: 'hello',
        description: 'A simple bot that replies with "Hello, world!"',
        avatar: '👋',
        definition: helloWorldDefinition,
        requiresConfig: false,
        isSystemBot: true,
    });
    console.log('[Seed] Created Hello World bot template');

    // Claude Bot
    await upsertBotTemplate('claude', {
        name: 'Claude',
        handle: 'claude',
        description: 'An AI assistant powered by Claude. Requires your Anthropic API key.',
        avatar: '🤖',
        definition: claudeDefinition,
        requiresConfig: true,
        configSchema: {
            type: 'object',
            properties: {
                apiKey: {
                    type: 'string',
                    title: 'Anthropic API Key',
                    description: 'Your Anthropic API key from console.anthropic.com',
                },
            },
            required: ['apiKey'],
        },
        isSystemBot: true,
    });
    console.log('[Seed] Created Claude bot template');

    console.log('[Seed] Bot templates seeded successfully');
}
