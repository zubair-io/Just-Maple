import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import type { BotAction, ChatEvent } from '@maple/shared';
import { ActionLogComponent } from './action-log.component';
import { BotAutonomyComponent } from '../bot-autonomy/bot-autonomy.component';
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

describe('Action log and autonomy', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ActionLogComponent, BotAutonomyComponent],
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

  it('offers "Do it and tell me" only where it is allowed, and saves changes', async () => {
    const fixture = TestBed.createComponent(BotAutonomyComponent);
    fixture.componentRef.setInput('botId', 'bot-1');
    fixture.detectChanges();
    http.expectOne('/api/bot-autonomy/bot-1').flush({
      settings: { calendar_add: 'ask', home_service: 'ask', send_reply: 'ask' },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const options = (kind: string) =>
      [...host.querySelectorAll(`[data-kind=${kind}] option`)].map((o) => o.textContent?.trim());
    expect(options('calendar_add')).toEqual(['Ask every time', 'Do it and tell me', 'Never']);
    expect(options('send_reply')).toEqual(['Ask every time', 'Never']);

    const select = host.querySelector<HTMLSelectElement>('[data-kind=calendar_add] select')!;
    select.value = 'auto';
    select.dispatchEvent(new Event('change'));
    const save = http.expectOne({ method: 'PUT', url: '/api/bot-autonomy/bot-1' });
    expect(save.request.body).toEqual({ kind: 'calendar_add', autonomy: 'auto' });
    save.flush({ settings: { calendar_add: 'auto', home_service: 'ask', send_reply: 'ask' } });
    await fixture.whenStable();
    expect(fixture.componentInstance.settings().calendar_add).toBe('auto');
  });
});
