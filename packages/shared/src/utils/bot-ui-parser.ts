import { createLibrary, defineComponent, createParser } from '@openuidev/lang-core';
import { z } from 'zod/v4';
import { Value } from '@sinclair/typebox/value';
import {
    BotUIResponseSchema,
    MAC_DATA_ITEM_ID_PATTERN,
    type BotUIResponse,
} from '../schemas/bot-ui';

const text = z.string().max(10000);
const definitions = [
    defineComponent({
        name: 'Text',
        description: 'A plain text paragraph.',
        props: z.object({ content: text }),
        component: null,
    }),
    defineComponent({
        name: 'Card',
        description: 'A Maple card with title and plain text body.',
        props: z.object({ title: text, content: text }),
        component: null,
    }),
    defineComponent({
        name: 'Table',
        description: 'A comparison table.',
        props: z.object({
            headers: z.array(text).max(20),
            rows: z.array(z.array(text).max(20)).max(100),
        }),
        component: null,
    }),
    defineComponent({
        name: 'Button',
        description: 'A follow-up suggestion. The message is sent only when clicked.',
        props: z.object({ label: text, message: z.string().min(1).max(2000) }),
        component: null,
    }),
    defineComponent({
        name: 'Form',
        description:
            'A form whose values are sent as a follow-up when submitted. Never request passwords, API keys, or secrets.',
        props: z.object({
            title: text,
            fields: z
                .array(
                    z.object({
                        name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/),
                        label: text,
                    }),
                )
                .max(12),
            submitLabel: text,
        }),
        component: null,
    }),
    defineComponent({
        name: 'Source',
        description:
            'Cites an item from the user\'s Mac data (an iMessage, email or calendar event) by the id a local-data tool returned. Use a short label such as "UPS notice".',
        props: z.object({
            label: z.string().min(1).max(200),
            itemId: z.string().regex(new RegExp(MAC_DATA_ITEM_ID_PATTERN)).max(400),
        }),
        component: null,
    }),
];
const Response = defineComponent({
    name: 'Response',
    description: 'A flat list of Maple response blocks.',
    component: null,
    props: z.object({
        children: z
            .array(
                z.union(
                    definitions.map((d) => d.ref) as [
                        (typeof definitions)[number]['ref'],
                        (typeof definitions)[number]['ref'],
                        ...(typeof definitions)[number]['ref'][],
                    ],
                ),
            )
            .min(1)
            .max(30),
    }),
});
const library = createLibrary({ root: 'Response', components: [Response, ...definitions] });

export const botUIPrompt = library.prompt({
    toolCalls: false,
    bindings: false,
    additionalRules: [
        'For ordinary answers, return Markdown. When a card, table, form, or follow-up button helps, return a short Markdown explanation followed by exactly one ```openui fenced block.',
        'Use only static literals and named references. No tools, queries, mutations, state variables, expressions, HTML, or scripts.',
        'The root must be Response. Its children must be Text, Card, Table, Button, Form, or Source. Do not nest containers.',
        'Only use Source with an itemId returned by a local-data tool in this conversation.',
    ],
    examples: [
        'intro = Text("Choose an option")\ncard = Card("Option A", "Details")\nroot = Response([intro, card])',
    ],
});

/** Normalize only recognizable static Response programs, regardless of the fence label. */
function fenceBareOpenUI(response: string): string {
    const root = (source: string) =>
        /^Response\s*\(/.test(source.trimStart()) ? 'root = ' + source.trimStart() : source;
    const recognizable = (source: string) =>
        /^Response\s*\(/.test(source.trimStart()) || /\broot\s*=\s*Response\s*\(/.test(source);
    const fences = [...response.matchAll(/```[\w+-]*[ \t]*\r?\n([\s\S]*?)```/g)];
    const candidates = fences.filter((match) => recognizable(match[1]!));
    if (candidates.length === 1) {
        const match = candidates[0]!;
        return (
            response.slice(0, match.index) +
            '```openui\n' +
            root(match[1]!) +
            '\n```' +
            response.slice(match.index! + match[0].length)
        );
    }
    if (
        !fences.length &&
        recognizable(response) &&
        /^(?:Response\s*\(|[A-Za-z_]\w*\s*=\s*[A-Z]\w*\()/.test(response.trim())
    )
        return '```openui\n' + root(response.trim()) + '\n```';
    return response;
}

/**
 * Puts each OpenUI statement on its own line. Models sometimes run them together
 * (`root = Response([a])a = Text("…")`), which the parser can't read.
 */
function splitStatements(source: string): string {
    // Blank out string contents (same length) so brackets inside text don't count.
    const masked = source.replace(
        /"(?:\\.|[^"\\])*"/g,
        (s) => '"' + 'x'.repeat(s.length - 2) + '"',
    );
    const breaks = [...masked.matchAll(/[)\]](?=[ \t]*[A-Za-z_]\w*\s*=\s*[A-Z]\w*\()/g)].map(
        (m) => m.index! + 1,
    );
    let out = source;
    for (const at of breaks.reverse()) out = out.slice(0, at) + '\n' + out.slice(at).trimStart();
    return out;
}

export function parseBotResponse(response: string): { markdown: string; ui?: BotUIResponse } {
    if (response.length > 100000) return { markdown: response };
    response = fenceBareOpenUI(response);
    const fences = [...response.matchAll(/```openui\s*\n([\s\S]*?)```/g)];
    if (fences.length !== 1 || response.length > 100000) return { markdown: response };
    const match = fences[0]!;
    const source = splitStatements(match[1]!);
    const markdown = response.replace(match[0], '').trim();
    const fallback = {
        markdown:
            markdown ||
            'The interactive response could not be displayed. Please ask the bot to respond as text.',
    };
    try {
        // No runtime evaluator or tool provider is used. Reject dynamic syntax before parsing.
        const syntax = source.replace(/"(?:\\.|[^"\\])*"/g, '""');
        if (/[$@]|\b(?:Query|Mutation|Action)\s*\(/.test(syntax)) return fallback;
        const result = createParser(library.toJSONSchema(), 'Response').parse(source);
        if (
            !result.root ||
            result.root.typeName !== 'Response' ||
            result.meta.incomplete ||
            result.meta.errors.length ||
            result.meta.unresolved.length ||
            result.queryStatements.length ||
            result.mutationStatements.length
        )
            return fallback;
        const children = result.root.props['children'];
        if (!Array.isArray(children) || children.length > 30) return fallback;
        const blocks = children.map(
            (node: {
                type?: string;
                typeName?: string;
                props?: Record<string, unknown>;
                partial?: boolean;
            }) => {
                if (
                    node?.type !== 'element' ||
                    node.partial ||
                    !node.typeName ||
                    !definitions.some((d) => d.name === node.typeName)
                )
                    throw new Error('Invalid block');
                // Zod also enforces nested field and collection limits that the parser may not enforce.
                const definition = definitions.find((d) => d.name === node.typeName)!;
                const props = definition.props.parse(node.props);
                return { ...props, type: node.typeName.toLowerCase() };
            },
        );
        const ui = { version: 1, format: 'openui', blocks };
        if (!Value.Check(BotUIResponseSchema, ui)) return fallback;
        return { markdown, ui };
    } catch {
        return fallback;
    }
}
