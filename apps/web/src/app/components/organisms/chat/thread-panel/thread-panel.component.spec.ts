import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { ThreadPanelComponent } from './thread-panel.component';
import type { Message } from '@maple/shared';

describe('interactive bot follow-ups', () => {
  const reply = { userBotId: 'bot', botModel: 'gpt-4.1-mini' } as Message;
  function setup() {
    const saved = new Subject<unknown>();
    const sendMessage = vi.fn(() => saved);
    const invokeBot = vi.fn(() => of({}));
    const context = {
      allNotebookBots: () => [{ id: 'bot', handle: 'assistant' }],
      notebookId: () => 'notebook',
      parentMessage: () => ({ id: 'parent', pageId: 'page' }),
      actionPending: signal(false),
      actionError: signal<string | null>(null),
      messageService: { sendMessage },
      botService: { invokeBot },
    };
    const followUp = (text: string) =>
      Reflect.apply(ThreadPanelComponent.prototype.continueBot, context, [reply, text]);
    return { saved, sendMessage, invokeBot, context, followUp };
  }
  it('saves the follow-up before invoking the original bot using its saved model setting in its parent thread', () => {
    const { saved, sendMessage, invokeBot, context, followUp } = setup();
    followUp('Budget: 200');
    expect(context.actionPending()).toBe(true);
    expect(invokeBot).not.toHaveBeenCalled();
    followUp('Duplicate click');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('notebook', expect.objectContaining({ type: 'doc' }), {
      parentMessageId: 'parent',
      pageId: 'page',
      forceHttp: true,
    });
    saved.next({});
    expect(invokeBot).toHaveBeenCalledWith('notebook', 'assistant', 'message', 'parent', {
      mentionText: 'Budget: 200',
      fullContent: 'Budget: 200',
    });
    expect(context.actionPending()).toBe(false);
  });
  it('shows invocation failures and allows a retry', () => {
    const { saved, invokeBot, context, followUp } = setup();
    invokeBot.mockReturnValue(throwError(() => new Error('Provider unavailable')));
    followUp('Continue');
    saved.next({});
    expect(context.actionError()).toBe('Provider unavailable');
    expect(context.actionPending()).toBe(false);
  });
});
