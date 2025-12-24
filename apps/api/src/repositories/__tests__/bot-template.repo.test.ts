import { describe, it, expect } from 'vitest';
import {
    findAllBotTemplates,
    findBotTemplateById,
    findBotTemplateByHandle,
    createBotTemplate,
    upsertBotTemplate,
    searchBotTemplates,
} from '../bot-template.repo';
import { createBotTemplateFixture } from '../../__tests__/helpers/fixtures';
import { mongoAvailable } from '../../__tests__/setup';

describe.runIf(mongoAvailable)('BotTemplateRepo', () => {
    describe('findAllBotTemplates', () => {
        it('should return all templates', async () => {
            await createBotTemplateFixture({ handle: 'bot-a', name: 'Bot A' });
            await createBotTemplateFixture({ handle: 'bot-b', name: 'Bot B' });

            const templates = await findAllBotTemplates();

            expect(templates.length).toBe(2);
            expect(templates.some((t) => t.handle === 'bot-a')).toBe(true);
            expect(templates.some((t) => t.handle === 'bot-b')).toBe(true);
        });

        it('should return empty array when no templates exist', async () => {
            const templates = await findAllBotTemplates();

            expect(templates).toEqual([]);
        });
    });

    describe('findBotTemplateById', () => {
        it('should return template when id exists', async () => {
            const fixture = await createBotTemplateFixture({ handle: 'test-bot' });

            const template = await findBotTemplateById(fixture._id.toString());

            expect(template).not.toBeNull();
            expect(template!.handle).toBe('test-bot');
            expect(template!._id).toBe(fixture._id.toString());
        });

        it('should return null when id does not exist', async () => {
            const template = await findBotTemplateById('507f1f77bcf86cd799439011');

            expect(template).toBeNull();
        });

        it('should return null for invalid ObjectId', async () => {
            const template = await findBotTemplateById('invalid-id');

            expect(template).toBeNull();
        });
    });

    describe('findBotTemplateByHandle', () => {
        it('should return template when handle exists', async () => {
            await createBotTemplateFixture({ handle: 'hello', name: 'Hello Bot' });

            const template = await findBotTemplateByHandle('hello');

            expect(template).not.toBeNull();
            expect(template!.handle).toBe('hello');
            expect(template!.name).toBe('Hello Bot');
        });

        it('should be case-insensitive', async () => {
            await createBotTemplateFixture({ handle: 'mybot' });

            const template = await findBotTemplateByHandle('MYBOT');

            expect(template).not.toBeNull();
            expect(template!.handle).toBe('mybot');
        });

        it('should return null when handle does not exist', async () => {
            const template = await findBotTemplateByHandle('nonexistent');

            expect(template).toBeNull();
        });
    });

    describe('createBotTemplate', () => {
        it('should create a new template', async () => {
            const template = await createBotTemplate({
                name: 'New Bot',
                handle: 'new-bot',
                description: 'A new bot',
                definition: {
                    trigger: { mentionPatterns: ['@new-bot'] },
                    input: { includeContext: { mentionText: true } },
                    actions: [{ type: 'reply', id: 'reply', config: { message: 'Hi!' } }],
                    output: { chatView: { components: [] } },
                },
                requiresConfig: false,
                isSystemBot: true,
            });

            expect(template).toBeDefined();
            expect(template._id).toBeDefined();
            expect(template.handle).toBe('new-bot');
            expect(template.name).toBe('New Bot');
            expect(template.createdAt).toBeDefined();
        });

        it('should lowercase the handle', async () => {
            const template = await createBotTemplate({
                name: 'Upper Bot',
                handle: 'UPPER-BOT',
                definition: {
                    trigger: {},
                    input: { includeContext: {} },
                    actions: [],
                    output: {},
                },
                requiresConfig: false,
                isSystemBot: true,
            });

            expect(template.handle).toBe('upper-bot');
        });
    });

    describe('upsertBotTemplate', () => {
        it('should create template if it does not exist', async () => {
            const template = await upsertBotTemplate('new-handle', {
                name: 'Upserted Bot',
                handle: 'new-handle',
                definition: {
                    trigger: {},
                    input: { includeContext: {} },
                    actions: [],
                    output: {},
                },
                requiresConfig: false,
                isSystemBot: true,
            });

            expect(template).toBeDefined();
            expect(template.handle).toBe('new-handle');
            expect(template.name).toBe('Upserted Bot');
        });

        it('should update template if it exists', async () => {
            await createBotTemplateFixture({ handle: 'existing', name: 'Old Name' });

            const template = await upsertBotTemplate('existing', {
                name: 'New Name',
                handle: 'existing',
                description: 'Updated description',
                definition: {
                    trigger: {},
                    input: { includeContext: {} },
                    actions: [],
                    output: {},
                },
                requiresConfig: true,
                isSystemBot: false,
            });

            expect(template.name).toBe('New Name');
            expect(template.description).toBe('Updated description');
            expect(template.requiresConfig).toBe(true);
        });
    });

    describe('searchBotTemplates', () => {
        it('should search by handle', async () => {
            await createBotTemplateFixture({ handle: 'summarize', name: 'Summarizer' });
            await createBotTemplateFixture({ handle: 'translate', name: 'Translator' });

            const results = await searchBotTemplates('sum');

            expect(results.length).toBe(1);
            expect(results[0].handle).toBe('summarize');
        });

        it('should search by name', async () => {
            await createBotTemplateFixture({ handle: 'mybot', name: 'Weather Bot' });

            const results = await searchBotTemplates('weather');

            expect(results.length).toBe(1);
            expect(results[0].name).toBe('Weather Bot');
        });

        it('should search by description', async () => {
            await createBotTemplateFixture({
                handle: 'helper',
                name: 'Helper',
                description: 'Helps with coding tasks',
            });

            const results = await searchBotTemplates('coding');

            expect(results.length).toBe(1);
            expect(results[0].handle).toBe('helper');
        });

        it('should be case-insensitive', async () => {
            await createBotTemplateFixture({ handle: 'claude', name: 'Claude AI' });

            const results = await searchBotTemplates('CLAUDE');

            expect(results.length).toBe(1);
        });

        it('should return empty array when no matches', async () => {
            await createBotTemplateFixture({ handle: 'test' });

            const results = await searchBotTemplates('nonexistent');

            expect(results).toEqual([]);
        });
    });
});
