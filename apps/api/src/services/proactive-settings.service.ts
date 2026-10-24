import type { Page, ProactiveBotSettings, UpdateProactiveBotInput } from '@maple/shared';
import { findPageByIdForBot, setPageProactive } from '../repositories/page.repo';
import { findUserBotById } from '../repositories/user-bot.repo';
import { findBotTemplateById } from '../repositories/bot-template.repo';
import { macDataRelay } from './mac-data-relay.service';

export const MAX_PROACTIVE_INSTRUCTIONS = 8000;

export class ProactiveSettingsError extends Error {
    constructor(
        message: string,
        readonly status = 400,
    ) {
        super(message);
    }
}

/**
 * Turn a messages page's proactive bot on, change it, or turn it off. The person saving
 * becomes the owner: their Mac supplies the data. Only one bot per page.
 */
export async function saveProactiveSettings(
    page: Page,
    userId: string,
    input: UpdateProactiveBotInput,
    options: { isNotebookOwner?: boolean } = {},
): Promise<Page> {
    if (page.type !== 'message') {
        throw new ProactiveSettingsError('Only messages pages can have a proactive bot.');
    }
    assertCanChange(page, userId, options.isNotebookOwner);
    const bot = await findUserBotById(input.userBotId);
    if (!bot || bot.userId !== userId) {
        throw new ProactiveSettingsError('Choose one of your own bots.', 404);
    }
    // Webhook bots run on someone else's server; they never get the user's Mac data.
    if (bot.botType === 'custom' || !bot.templateId) {
        throw new ProactiveSettingsError(
            'Custom webhook bots can’t be proactive. Choose a built-in AI bot.',
        );
    }
    const template = await findBotTemplateById(bot.templateId);
    if (!template?.definition.actions.some((action) => action.type === 'llm')) {
        throw new ProactiveSettingsError(
            'This bot doesn’t use an AI model, so it can’t be proactive.',
        );
    }

    const previousOwner = page.proactive?.ownerUserId;
    const settings: ProactiveBotSettings = {
        userBotId: bot._id,
        instructions: input.instructions.slice(0, MAX_PROACTIVE_INSTRUCTIONS),
        enabled: input.enabled,
        ownerUserId: userId,
        updatedAt: new Date().toISOString(),
    };
    const updated = await setPageProactive(page.id, settings);
    if (!updated) throw new ProactiveSettingsError('Page not found.', 404);
    await notifyOwners(userId, previousOwner);
    return updated;
}

export async function clearProactiveSettings(
    page: Page,
    userId: string,
    options: { isNotebookOwner?: boolean } = {},
): Promise<Page> {
    assertCanChange(page, userId, options.isNotebookOwner);
    const updated = await setPageProactive(page.id, null);
    if (!updated) throw new ProactiveSettingsError('Page not found.', 404);
    await notifyOwners(page.proactive?.ownerUserId);
    return updated;
}

/**
 * Adds a correction the user gave in conversation to the page's standing instructions.
 * When the limit is reached, the oldest remembered lines are dropped first.
 */
export async function appendProactiveInstruction(
    pageId: string,
    instruction: string,
): Promise<void> {
    const page = await findPageByIdForBot(pageId);
    const current = page?.proactive;
    if (!page || !current) return;
    const marker = '\n\nRemembered from conversation:\n';
    const [base, remembered = ''] = current.instructions.split(marker);
    const lines = remembered
        .split('\n')
        .filter(Boolean)
        .concat(`- ${instruction.replace(/\s+/g, ' ').trim()}`);
    let instructions = `${base}${marker}${lines.join('\n')}`;
    while (instructions.length > MAX_PROACTIVE_INSTRUCTIONS && lines.length > 1) {
        lines.shift();
        instructions = `${base}${marker}${lines.join('\n')}`;
    }
    await setPageProactive(page.id, {
        ...current,
        instructions: instructions.slice(0, MAX_PROACTIVE_INSTRUCTIONS),
        updatedAt: new Date().toISOString(),
    });
}

/**
 * A chat's proactive bot reads its owner's Mac and spends their API key, so only that
 * person or the notebook's owner may replace or remove it.
 */
function assertCanChange(page: Page, userId: string, isNotebookOwner = false): void {
    const owner = page.proactive?.ownerUserId;
    if (owner && owner !== userId && !isNotebookOwner) {
        throw new ProactiveSettingsError(
            'Another member set up this chat’s proactive bot. Ask them or the notebook owner to change it.',
            403,
        );
    }
}

/** Tell affected Macs which notebooks now have proactive bots. */
async function notifyOwners(...userIds: Array<string | undefined>): Promise<void> {
    for (const id of new Set(userIds.filter((u): u is string => !!u))) {
        await macDataRelay.pushProactiveNotebooks(id).catch(() => {});
    }
}
