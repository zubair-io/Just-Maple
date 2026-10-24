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
 * Mercury Bot Definition
 * Uses Mercury-2 (Inception Labs) API to respond to messages
 */
const mercuryDefinition: BotDefinition = {
    trigger: {
        mentionPatterns: ['mercury', 'merc'],
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
            id: 'mercury-response',
            config: {
                provider: 'inception',
                model: 'mercury-2',
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
 * Uses upsert so it's safe to run on every server boot
 */
export async function seedBotTemplates(): Promise<void> {
    await upsertBotTemplate('openai', {
        name: 'OpenAI',
        handle: 'openai',
        avatar: '✦',
        description: 'An AI assistant powered by OpenAI. Requires your OpenAI API key.',
        definition: {
            ...claudeDefinition,
            trigger: { mentionPatterns: ['openai'] },
            actions: [
                {
                    type: 'llm',
                    id: 'openai-response',
                    config: {
                        provider: 'openai',
                        model: 'gpt-4.1',
                        systemPrompt:
                            'You are a helpful AI assistant in Maple. Be concise and friendly.',
                        userPrompt: '{{$mentionText}}',
                        maxTokens: 4096,
                    },
                    outputVariable: 'response',
                },
            ],
        },
        requiresConfig: true,
        isSystemBot: true,
        configSchema: {
            type: 'object',
            properties: { apiKey: { type: 'string', title: 'OpenAI API Key' } },
            required: ['apiKey'],
        },
    });
    // Any OpenAI-compatible server (OpenRouter, Groq, Together, vLLM…). Each bot added from
    // this template keeps its own server URL, key and model, so users can add many.
    await upsertBotTemplate('openai-compatible', {
        name: 'Custom AI provider',
        handle: 'openai-compatible',
        avatar: '🔌',
        description:
            'Any OpenAI-compatible API, like OpenRouter, Groq or your own server. Add as many as you like.',
        definition: {
            ...claudeDefinition,
            trigger: { mentionPatterns: ['openai-compatible'] },
            actions: [
                {
                    type: 'llm',
                    id: 'openai-compatible-response',
                    config: {
                        provider: 'openai-compatible',
                        systemPrompt:
                            'You are a helpful AI assistant in Maple. Be concise and friendly.',
                        userPrompt: '{{$mentionText}}',
                        maxTokens: 4096,
                    },
                    outputVariable: 'response',
                },
            ],
        },
        requiresConfig: true,
        isSystemBot: true,
        configSchema: {
            type: 'object',
            properties: {
                baseUrl: { type: 'string', title: 'Server URL' },
                apiKey: { type: 'string', title: 'API Key' },
            },
            required: ['baseUrl', 'apiKey'],
        },
    });
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

    // Mercury Bot
    await upsertBotTemplate('mercury', {
        name: 'Mercury',
        handle: 'mercury',
        description:
            'A fast AI assistant powered by Mercury-2 (Inception Labs). Requires your Inception API key.',
        avatar: '⚡',
        definition: mercuryDefinition,
        requiresConfig: true,
        configSchema: {
            type: 'object',
            properties: {
                apiKey: {
                    type: 'string',
                    title: 'Inception API Key',
                    description: 'Your Inception Labs API key from inceptionlabs.ai',
                },
            },
            required: ['apiKey'],
        },
        isSystemBot: true,
    });

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
}
