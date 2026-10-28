import { Type, Static } from '@sinclair/typebox';
import { CalendarEventDraftSchema } from './calendar-proposal';
import { HomeServiceCallSchema } from './home';

const Text = Type.String({ maxLength: 10000 });
export const MAC_DATA_ITEM_ID_PATTERN = '^(imessage|mail|calendar):[^\\s]{1,390}$';
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
    // Cites an item from the user's Mac data (iMessage, Mail, Calendar)
    Type.Object({
        type: Type.Literal('source'),
        label: Type.String({ maxLength: 200 }),
        itemId: Type.String({ pattern: MAC_DATA_ITEM_ID_PATTERN, maxLength: 400 }),
    }),
    // An "Add to calendar" card. Only the server adds it, from a proposal the bot made
    // with the propose_calendar_event tool; the card reads live state by `proposalId`.
    Type.Object({
        type: Type.Literal('event_proposal'),
        proposalId: Type.String({ pattern: '^[0-9a-f-]{36}$' }),
        event: CalendarEventDraftSchema,
    }),
    // A Home Assistant action card ("Turn off Kitchen Light"). Only the server adds it,
    // from a proposal the bot made with propose_home_action; nothing runs until the tap.
    Type.Object({
        type: Type.Literal('home_proposal'),
        proposalId: Type.String({ pattern: '^[0-9a-f-]{36}$' }),
        call: HomeServiceCallSchema,
    }),
    // "Done: … · Undo" for an action a bot did on its own (the owner's "Do it and tell
    // me" setting). Only the server adds it; the card reads live state by `actionId`.
    Type.Object({
        type: Type.Literal('action_receipt'),
        actionId: Type.String({ pattern: '^[0-9a-f-]{36}$' }),
        summary: Type.String({ maxLength: 500 }),
    }),
]);
export const BotUIResponseSchema = Type.Object({
    version: Type.Literal(1),
    format: Type.Literal('openui'),
    blocks: Type.Array(BotUIBlockSchema, { minItems: 1, maxItems: 30 }),
});
export type BotUIBlock = Static<typeof BotUIBlockSchema>;
export type BotUIResponse = Static<typeof BotUIResponseSchema>;

export type BotProvider = 'anthropic' | 'openai' | 'openai-compatible';
export const BotModelOptionSchema = Type.Object({ id: Type.String(), name: Type.String() });
export type BotModelOption = Static<typeof BotModelOptionSchema>;
export function isBotModel(model: string, provider: string): boolean {
    // Any server's model names are allowed, including routed ones like "meta-llama/llama-3.3-70b".
    if (provider === 'openai-compatible')
        return /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/.test(model);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model)) return false;
    return provider === 'openai'
        ? /^(?:ft:)?(gpt-|o[1-9])/.test(model)
        : provider === 'anthropic'
          ? model.startsWith('claude-')
          : provider === 'inception' && model.startsWith('mercury');
}
