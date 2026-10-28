import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import type { BotAction, ChatEvent } from '@maple/shared';
import { ActionLogComponent } from './action-log.component';
import { RealtimeService } from '../../../services/realtime.service';
import { AuthService } from '../../../services/auth.service';

function botAction(overrides: Partial<BotAction> = {}): BotAction {
  return {
    id: '7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00',
    kind: 'calendar_add',
    isOwner: true,
    ownerId: 'owner',
    botId: 'bot-1',
    botName: 'Maple',
    notebookId: 'n1',
    summary: 'Something',
    status: 'queued',
    canUndo: false,
    createdAt: '2026-10-27T12:00:00.000Z',
    updatedAt: '2026-10-27T12:00:00.000Z',
    ...overrides,
  };
}

/** Lets the HTTP reply's promise chain finish, then renders. */
async function flushAsync(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const done = botAction({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'done',
  canUndo: true,
  summary: '“Pizza party” · Wed, Oct 28',
});
const proposed = botAction({
  id: '22222222-2222-4222-8222-222222222222',
  status: 'proposed',
  summary: '“Practice” · Thu, Oct 29',
});
const theirs = botAction({
  id: '33333333-3333-4333-8333-333333333333',
  ownerId: 'sam',
  isOwner: false,
  status: 'done',
  summary: 'Turn on the kitchen lights',
  kind: 'home_service',
});

describe('ActionLogComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ActionLogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: { events$: new Subject<ChatEvent>() } },
        { provide: AuthService, useValue: { user: signal({ _id: 'owner' }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  async function renderLog(input: { botId?: string; notebookId?: string }, rows: BotAction[]) {
    const fixture = TestBed.createComponent(ActionLogComponent);
    if (input.botId) fixture.componentRef.setInput('botId', input.botId);
    if (input.notebookId) fixture.componentRef.setInput('notebookId', input.notebookId);
    fixture.detectChanges();
    const request = http.expectOne((r) => r.url === '/api/bot-actions');
    request.flush({ actions: rows });
    await flushAsync(fixture);
    const host: HTMLElement = fixture.nativeElement;
    const settle = () => flushAsync(fixture);
    return { fixture, host, request, settle };
  }

  it('lists a bot’s actions newest first, with Undo only where allowed', async () => {
    const { host, request } = await renderLog({ botId: 'bot-1' }, [done, proposed]);
    expect(request.request.params.get('botId')).toBe('bot-1');
    const rows = [...host.querySelectorAll('[data-testid=action-row]')];
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['done', 'proposed']);
    expect(rows[0]!.textContent).toContain('Pizza party');
    expect(rows[0]!.textContent).toContain('Add calendar events');
    expect(rows[0]!.querySelector('button')?.textContent?.trim()).toBe('Undo');
    expect(rows[1]!.querySelector('button')).toBeNull();
    expect(rows[1]!.textContent).toContain('Waiting for you');
  });

  it('filters by kind and status on the server', async () => {
    const { host, settle } = await renderLog({ notebookId: 'n1' }, [done, theirs]);
    const kind = host.querySelector<HTMLSelectElement>('[data-testid=kind-filter]')!;
    kind.value = 'home_service';
    kind.dispatchEvent(new Event('change'));
    await settle();
    const filtered = http.expectOne((r) => r.url === '/api/bot-actions');
    expect(filtered.request.params.get('notebookId')).toBe('n1');
    expect(filtered.request.params.get('kind')).toBe('home_service');
    filtered.flush({ actions: [theirs] });
    await settle();
    const rows = [...host.querySelectorAll('[data-testid=action-row]')];
    expect(rows).toHaveLength(1);
    // Someone else's action: the summary, no Undo.
    expect(rows[0]!.textContent).toContain('kitchen lights');
    expect(rows[0]!.querySelector('button')).toBeNull();

    const status = host.querySelector<HTMLSelectElement>('[data-testid=status-filter]')!;
    status.value = 'failed';
    status.dispatchEvent(new Event('change'));
    await settle();
    const byStatus = http.expectOne((r) => r.url === '/api/bot-actions');
    expect(byStatus.request.params.get('status')).toBe('failed');
    byStatus.flush({ actions: [] });
    await settle();
    expect(host.querySelector('[data-testid=empty]')?.textContent).toContain('Nothing yet');
  });

  it('undoes from the list', async () => {
    const { host, settle } = await renderLog({ botId: 'bot-1' }, [done]);
    host.querySelector<HTMLButtonElement>('[data-testid=action-row] button')!.click();
    http.expectOne({ method: 'POST', url: `/api/bot-actions/${done.id}/undo` }).flush({
      action: {
        ...done,
        canUndo: false,
        undo: { state: 'queued', requestedAt: '2026-10-27T13:00:00.000Z' },
        updatedAt: '2026-10-27T13:00:00.000Z',
      },
    });
    await settle();
    expect(host.textContent).toContain('Undoing…');
    expect(host.querySelector('[data-testid=action-row] button')).toBeNull();
  });

  it('cancels from the list, and tells a cancelled row and a missing event apart', async () => {
    const waiting = botAction({ id: '44444444-4444-4444-8444-444444444444', canCancel: true });
    const missing = botAction({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'done',
      undo: { state: 'not_found', requestedAt: '2026-10-27T13:00:00.000Z' },
    });
    const { host, settle } = await renderLog({ botId: 'bot-1' }, [waiting, missing]);
    const rows = () => [...host.querySelectorAll('[data-testid=action-row]')];
    expect(rows()[1]!.textContent).toContain("Couldn't find it on your Mac");
    expect(rows()[1]!.querySelector('button')).toBeNull();

    host.querySelector<HTMLButtonElement>('[data-testid=cancel]')!.click();
    http.expectOne({ method: 'POST', url: `/api/bot-actions/${waiting.id}/cancel` }).flush({
      action: {
        ...waiting,
        status: 'denied',
        canCancel: false,
        cancelRequestedAt: '2026-10-27T13:00:00.000Z',
        updatedAt: '2026-10-27T13:00:00.000Z',
      },
    });
    await settle();
    expect(rows()[0]!.textContent).toContain('Cancelled');
    expect(host.querySelector('[data-testid=cancel]')).toBeNull();
  });

  it('opens, copies and discards the owner’s drafted replies', async () => {
    const draftParams = {
      channel: 'messages',
      recipients: [{ address: '+15185550100', name: 'Jen' }],
      recipientLabel: 'Jen',
      itemId: 'imessage:jen-1',
      quoted: { from: 'Jen', text: 'Still on?', at: '2026-10-27T11:00:00.000Z' },
      body: 'yes! see you at 4',
    };
    const draft = botAction({
      id: '66666666-6666-4666-8666-666666666666',
      kind: 'send_reply',
      status: 'proposed',
      summary: 'Drafted a reply to Jen',
      params: draftParams,
    });
    // Someone else's draft: only the summary, nothing to open.
    const theirDraft = botAction({
      id: '77777777-7777-4777-8777-777777777777',
      kind: 'send_reply',
      status: 'proposed',
      ownerId: 'sam',
      isOwner: false,
      summary: 'Drafted a reply',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { host, settle } = await renderLog({ notebookId: 'n1' }, [draft, theirDraft]);
    const rows = () => [...host.querySelectorAll('[data-testid=action-row]')];
    expect(rows()[1]!.querySelector('[data-testid=draft-open]')).toBeNull();
    expect(rows()[1]!.querySelector('button')).toBeNull();

    const open = rows()[0]!.querySelector<HTMLAnchorElement>('[data-testid=draft-open]')!;
    expect(open.textContent?.trim()).toBe('Open in Messages');
    expect(open.getAttribute('href')).toBe('sms:+15185550100&body=yes!%20see%20you%20at%204');
    open.addEventListener('click', (event) => event.preventDefault());
    open.click();
    const opened = http.expectOne({ method: 'POST', url: `/api/reply-drafts/${draft.id}/open` });
    expect(opened.request.body).toEqual({ body: 'yes! see you at 4' });
    opened.flush({
      action: { ...draft, status: 'opened', updatedAt: '2026-10-27T13:00:00.000Z' },
      url: open.getAttribute('href'),
    });
    await settle();
    expect(rows()[0]!.textContent).toContain('Opened to send');

    host.querySelector<HTMLButtonElement>('[data-testid=draft-copy]')!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith('yes! see you at 4');
    expect(host.querySelector('[data-testid=draft-copy]')!.textContent?.trim()).toBe('Copied');

    host.querySelector<HTMLButtonElement>('[data-testid=draft-discard]')!.click();
    http
      .expectOne({ method: 'POST', url: `/api/reply-drafts/${draft.id}/discard` })
      .flush({ action: { ...draft, status: 'discarded', updatedAt: '2026-10-27T13:05:00.000Z' } });
    await settle();
    expect(rows()[0]!.textContent).toContain('Discarded');
    expect(host.querySelector('[data-testid=draft-open]')).toBeNull();
  });
});
