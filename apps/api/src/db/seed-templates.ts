import { createSystemTemplate } from '../repositories/template.repo';
import type { PageContent, TemplateCategory } from '@maple/shared';

interface SystemTemplateData {
    title: string;
    description: string;
    category: TemplateCategory;
    icon: string;
    content: PageContent;
}

const systemTemplates: SystemTemplateData[] = [
    {
        title: 'Meeting Notes',
        description: 'Structured template for taking meeting notes',
        category: 'work',
        icon: '📝',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: '{{title}}' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '📅 {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Attendees' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Agenda' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Discussion Notes' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Action Items' }],
                },
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: false },
                            content: [{ type: 'paragraph', content: [] }],
                        },
                    ],
                },
            ],
        },
    },
    {
        title: 'Daily Journal',
        description: 'Daily reflection and planning template',
        category: 'personal',
        icon: '📓',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: 'Journal - {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: "🌅 Today's Focus" }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '🙏 Gratitude' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '📝 Notes' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '🌙 Evening Reflection' }],
                },
                { type: 'paragraph', content: [] },
            ],
        },
    },
    {
        title: 'Weekly Review',
        description: 'Weekly planning and review template',
        category: 'planning',
        icon: '📆',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: 'Weekly Review - {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '✅ Accomplishments' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '🎯 Goals for Next Week' }],
                },
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: false },
                            content: [{ type: 'paragraph', content: [] }],
                        },
                    ],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '💡 Lessons Learned' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: '📊 Metrics' }],
                },
                { type: 'paragraph', content: [] },
            ],
        },
    },
    {
        title: 'Project Brief',
        description: 'Project planning and overview template',
        category: 'work',
        icon: '🚀',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: '{{title}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Overview' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Goals & Objectives' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Scope' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Timeline' }],
                },
                {
                    type: 'taskList',
                    content: [
                        {
                            type: 'taskItem',
                            attrs: { checked: false },
                            content: [{ type: 'paragraph', content: [] }],
                        },
                    ],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Stakeholders' }],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Risks & Mitigations' }],
                },
                { type: 'paragraph', content: [] },
            ],
        },
    },
    {
        title: 'Bug Report',
        description: 'Structured bug report template',
        category: 'work',
        icon: '🐛',
        content: {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: '🐛 Bug: {{title}}' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Reported: {{date}}' }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Description' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Steps to Reproduce' }],
                },
                {
                    type: 'orderedList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
                },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Expected Behavior' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Actual Behavior' }],
                },
                { type: 'paragraph', content: [] },
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Environment' }],
                },
                {
                    type: 'bulletList',
                    content: [
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'OS: ' }],
                                },
                            ],
                        },
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Browser: ' }],
                                },
                            ],
                        },
                        {
                            type: 'listItem',
                            content: [
                                {
                                    type: 'paragraph',
                                    content: [{ type: 'text', text: 'Version: ' }],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
];

export async function seedSystemTemplates(): Promise<void> {
    console.log('Seeding system templates...');

    for (const template of systemTemplates) {
        await createSystemTemplate(template);
    }

    console.log(`Seeded ${systemTemplates.length} system templates`);
}
