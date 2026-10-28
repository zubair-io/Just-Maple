import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import type { BotAction, ChatEvent, ReplyDraftParams } from '@maple/shared';
import { ReplyDraftCardComponent } from './reply-draft-card.component';
import { RealtimeService } from '../../../services/realtime.service';
import { AuthService } from '../../../services/auth.service';

const ID = '5b0c6f1e-3d2a-4c1b-9e8f-7a6b5c4d3e2f';

const messageDraft: ReplyDraftParams = {
  channel: 'messages',
  recipients: [{ address: '+15185550100', name: 'Jen' }],
  recipientLabel: 'Jen',
  itemId: 'imessage:jen-1',
  quoted: { from: 'Jen', text: 'Still on for Saturday?', at: '2026-10-27T14:00:00.000Z' },
  body: 'yesss saturday works!!',
};

function draftAction(overrides: Partial<BotAction> = {}): BotAction {
  return {
    id: ID,
    kind: 'send_reply',
    isOwner: true,
    ownerId: 'owner',
    botId: 'bot-1',
    botName: 'Maple',
    notebookId: 'n1',
    pageId: 'chat',
    messageId: 'm1',
    summary: 'Drafted a reply',
    status: 'proposed',
    decision: 'ask',
    params: { ...messageDraft },
    canUndo: false,
    createdAt: '2026-10-27T14:01:00.000Z',
    updatedAt: '2026-10-27T14:01:00.000Z',
    ...overrides,
  };
}

describe('ReplyDraftCardComponent', () => {
  let events: Subject<ChatEvent>;
  let http: HttpTestingController;
  const me = signal<{ _id: string } | null>({ _id: 'owner' });

  beforeEach(() => {
    events = new Subject<ChatEvent>();
    me.set({ _id: 'owner' });
    TestBed.configureTestingModule({
      imports: [ReplyDraftCardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: { events$: events.asObservable() } },
        { provide: AuthService, useValue: { user: me } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function render(loaded: BotAction) {
    const fixture = TestBed.createComponent(ReplyDraftCardComponent);
    fixture.componentRef.setInput('actionId', ID);
    fixture.detectChanges();
    http.expectOne(`/api/bot-actions/${ID}`).flush({ action: loaded });
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const text = () => host.textContent?.replace(/\s+/g, ' ') ?? '';
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    const openLink = () => host.querySelector<HTMLAnchorElement>('[data-testid=open]');
    const textarea = () => host.querySelector('textarea')!;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, host, text, button, openLink, textarea, settle };
  }

  it('shows the owner who it is for, the channel, the quoted message and the draft', async () => {
    const { text, textarea, openLink, button } = await render(draftAction());
    expect(text()).toContain('Reply to Jen');
    expect(text()).toContain('Messages');
    expect(text()).toContain('Still on for Saturday?');
    expect(text()).toContain('Nothing is sent until you send it yourself.');
    expect(textarea().value).toBe('yesss saturday works!!');
    expect(openLink()?.textContent?.trim()).toBe('Open in Messages');
    expect(openLink()?.getAttribute('href')).toBe(
      'sms:+15185550100&body=yesss%20saturday%20works!!',
    );
    expect(button('Copy')).toBeTruthy();
    expect(button('Discard')).toBeTruthy();
    // There is no send button: the person sends it from Messages.
    expect(button('Send')).toBeUndefined();
  });

  it('opens the edited text in Messages and records it', async () => {
    const { textarea, openLink, settle, text } = await render(draftAction());
    textarea().value = 'saturday at 4!';
    textarea().dispatchEvent(new Event('input'));
    await settle();
    const link = openLink()!;
    expect(link.getAttribute('href')).toBe('sms:+15185550100&body=saturday%20at%204!');

    // The browser follows the link itself; jsdom can't, so stop it there.
    link.addEventListener('click', (event) => event.preventDefault());
    link.click();
    const request = http.expectOne(`/api/reply-drafts/${ID}/open`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ body: 'saturday at 4!' });
    request.flush({
      action: draftAction({
        status: 'opened',
        params: { ...messageDraft, body: 'saturday at 4!' },
        result: { openedAt: '2026-10-27T14:05:00.000Z', openCount: 1 },
        updatedAt: '2026-10-27T14:05:00.000Z',
      }),
      url: 'sms:+15185550100&body=saturday%20at%204!',
    });
    await settle();
    expect(text()).toContain('Opened in Messages. Press send there');
  });

  it('opens mail drafts in Mail with the subject', async () => {
    const { openLink, text } = await render(
      draftAction({
        params: {
          ...messageDraft,
          channel: 'mail',
          recipients: [{ address: 'jen@example.com', name: 'Jen Park' }],
          recipientLabel: 'Jen Park',
          subject: 'Re: Dinner plans',
          body: 'Thursday works.',
        },
      }),
    );
    expect(text()).toContain('Re: Dinner plans');
    expect(openLink()?.textContent?.trim()).toBe('Open in Mail');
    expect(openLink()?.getAttribute('href')).toBe(
      'mailto:jen@example.com?subject=Re%3A%20Dinner%20plans&body=Thursday%20works.',
    );
  });

  it('copies the draft and saves edits', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { textarea, button, settle } = await render(draftAction());
    textarea().value = 'edited!';
    textarea().dispatchEvent(new Event('input'));
    await settle();
    button('Copy')!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith('edited!');
    const save = http.expectOne(`/api/reply-drafts/${ID}`);
    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toEqual({ body: 'edited!' });
    save.flush({ action: draftAction({ params: { ...messageDraft, body: 'edited!' } }) });
    await settle();
    expect(button('Copied')).toBeTruthy();
  });

  it('discards it, and then offers nothing to open', async () => {
    const { button, openLink, settle, text, textarea } = await render(draftAction());
    button('Discard')!.click();
    http
      .expectOne(`/api/reply-drafts/${ID}/discard`)
      .flush({ action: draftAction({ status: 'discarded', updatedAt: '2026-10-27T14:06:00Z' }) });
    await settle();
    expect(text()).toContain('Discarded.');
    expect(openLink()).toBeNull();
    expect(button('Copy')).toBeUndefined();
    expect(textarea().disabled).toBe(true);
  });

  it('shows other members only that a reply was drafted', async () => {
    me.set({ _id: 'member' });
    const { text, host } = await render(
      draftAction({ isOwner: false, params: undefined, decision: 'ask' }),
    );
    expect(text()).toContain('Drafted a reply');
    expect(text()).toContain("Only the person it's for can see it.");
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('[data-testid=open]')).toBeNull();
    expect(text()).not.toContain('Jen');

    // A broadcast for the row (no parameters) doesn't reveal anything either.
    events.next({
      action: 'bot_action_updated',
      data: { ...draftAction({ status: 'opened', updatedAt: '2026-10-27T14:07:00Z' }) },
      pageId: 'chat',
      notebookId: 'n1',
      userId: 'owner',
      timestamp: '2026-10-27T14:07:00Z',
    } as ChatEvent);
    await TestBed.inject(HttpTestingController);
    expect(host.querySelector('textarea')).toBeNull();
  });
});
