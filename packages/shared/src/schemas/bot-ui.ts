import { Type, Static } from '@sinclair/typebox';

const Text = Type.String({ maxLength: 10000 });
export const BotUIBlockSchema = Type.Union([
    Type.Object({ type: Type.Literal('text'), content: Text }),
    Type.Object({ type: Type.Literal('card'), title: Text, content: Text }),
    Type.Object({
        type: Type.Literal('table'),
        headers: Type.Array(Text, { maxItems: 20 }),
        rows: Type.Array(Type.Array(Text, { maxItems: 20 }), { maxItems: 100 }),
    }),
    Type.Object({
        type: Type.Literal('button'),
        label: Text,
        message: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    Type.Object({
        type: Type.Literal('form'),
        title: Text,
        fields: Type.Array(
            Type.Object({
                name: Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,49}$' }),
                label: Text,
            }),
            { maxItems: 12 },
        ),
        submitLabel: Text,
    }),
]);
export const BotUIResponseSchema = Type.Object({
    version: Type.Literal(1),
    format: Type.Literal('openui'),
    blocks: Type.Array(BotUIBlockSchema, { minItems: 1, maxItems: 30 }),
});
export type BotUIBlock = Static<typeof BotUIBlockSchema>;
export type BotUIResponse = Static<typeof BotUIResponseSchema>;

export type BotProvider = 'anthropic' | 'openai';
export const BotModelOptionSchema = Type.Object({ id: Type.String(), name: Type.String() });
export type BotModelOption = Static<typeof BotModelOptionSchema>;
export function isBotModel(model: string, provider: string): boolean {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)) return false;
    return provider === 'openai'
        ? /^(?:ft:)?(gpt-|o[1-9])/.test(model)
        : provider === 'anthropic'
          ? model.startsWith('claude-')
          : provider === 'inception' && model.startsWith('mercury');
}
