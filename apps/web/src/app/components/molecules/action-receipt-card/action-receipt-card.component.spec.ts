import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import type { BotAction, ChatEvent } from '@maple/shared';
import { ActionReceiptCardComponent } from './action-receipt-card.component';
import { RealtimeService } from '../../../services/realtime.service';
import { AuthService } from '../../../services/auth.service';

const ID = '7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00';
const SUMMARY = '“Pizza party” · Wed, Oct 28, 3:00 – 4:00 PM';

function botAction(overrides: Partial<BotAction> = {}): BotAction {
  return {
    id: ID,
    kind: 'calendar_add',
    isOwner: true,
    ownerId: 'owner',
    botId: 'bot-1',
    botName: 'Maple',
    notebookId: 'n1',
    pageId: 'chat',
    messageId: 'm1',
    summary: SUMMARY,
    status: 'queued',
    decision: 'auto',
    canUndo: false,
    createdAt: '2026-10-27T12:00:00.000Z',
    updatedAt: '2026-10-27T12:00:00.000Z',
    ...overrides,
  };
}

describe('ActionReceiptCardComponent', () => {
  let events: Subject<ChatEvent>;
  let http: HttpTestingController;
  const me = signal<{ _id: string } | null>({ _id: 'owner' });

  beforeEach(() => {
    events = new Subject<ChatEvent>();
    me.set({ _id: 'owner' });
    TestBed.configureTestingModule({
      imports: [ActionReceiptCardComponent],
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
  });

  async function render(loaded: BotAction | null) {
    const fixture = TestBed.createComponent(ActionReceiptCardComponent);
    fixture.componentRef.setInput('actionId', ID);
    fixture.componentRef.setInput('summary', SUMMARY);
    fixture.detectChanges();
    const request = http.expectOne(`/api/bot-actions/${ID}`);
    if (loaded) request.flush({ action: loaded });
    else request.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const text = () => host.textContent?.replace(/\s+/g, ' ') ?? '';
    const undoButton = () =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Undo');
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, text, undoButton, settle };
  }

  it('says it is doing it, then "Done · Undo" when the server says so', async () => {
    const { text, undoButton, settle } = await render(botAction());
    expect(text()).toContain('Doing it: “Pizza party”');
    expect(undoButton()).toBeUndefined();

    events.next({
      action: 'bot_action_updated',
      data: { ...botAction({ status: 'done', updatedAt: '2026-10-27T12:01:00.000Z' }) },
      pageId: 'chat',
      notebookId: 'n1',
      userId: 'owner',
      timestamp: new Date().toISOString(),
    });
    // The owner's card loads the full row again: it says whether Undo is offered.
    http.expectOne(`/api/bot-actions/${ID}`).flush({
      action: botAction({ status: 'done', canUndo: true, updatedAt: '2026-10-27T12:01:00.000Z' }),
    });
    await settle();
    expect(text()).toContain('Done: Added to your calendar · “Pizza party”');
    expect(undoButton()).toBeDefined();
  });

  it('undoes on tap', async () => {
    const { text, undoButton, settle } = await render(botAction({ status: 'done', canUndo: true }));
    undoButton()!.click();
    http.expectOne({ method: 'POST', url: `/api/bot-actions/${ID}/undo` }).flush({
      action: botAction({
        status: 'done',
        canUndo: false,
        undo: { state: 'queued', requestedAt: '2026-10-27T12:02:00.000Z' },
        updatedAt: '2026-10-27T12:02:00.000Z',
      }),
    });
    await settle();
    expect(text()).toContain('Undoing…');
    expect(undoButton()).toBeUndefined();
  });

  it('shows the server’s reason when it can’t undo', async () => {
    const { text, undoButton, settle } = await render(botAction({ status: 'done', canUndo: true }));
    undoButton()!.click();
    http
      .expectOne({ method: 'POST', url: `/api/bot-actions/${ID}/undo` })
      .flush(
        { error: 'No Mac is collecting your calendar.' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();
    http.expectOne(`/api/bot-actions/${ID}`).flush({ action: botAction({ status: 'done' }) });
    await settle();
    expect(text()).toContain('No Mac is collecting your calendar.');
  });

  it('gives other members no Undo, and shows the saved summary before loading', async () => {
    me.set({ _id: 'someone-else' });
    const { text, undoButton } = await render(
      botAction({ status: 'done', isOwner: false, canUndo: false }),
    );
    expect(text()).toContain('Done:');
    expect(undoButton()).toBeUndefined();

    const fixture = TestBed.createComponent(ActionReceiptCardComponent);
    fixture.componentRef.setInput('actionId', 'b3c4a7d2-0000-4000-8000-000000000000');
    fixture.componentRef.setInput('summary', 'Saved summary');
    fixture.detectChanges();
    http
      .expectOne('/api/bot-actions/b3c4a7d2-0000-4000-8000-000000000000')
      .flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Saved summary');
  });

  it('shows failures and undone actions', async () => {
    const { text, settle } = await render(
      botAction({ status: 'failed', error: 'Calendar is read-only' }),
    );
    expect(text()).toContain("Couldn't do it");
    expect(text()).toContain('Calendar is read-only');
    events.next({
      action: 'bot_action_updated',
      data: botAction({ status: 'undone', updatedAt: '2026-10-28T00:00:00.000Z' }),
      pageId: 'chat',
      notebookId: 'n1',
      userId: 'owner',
      timestamp: new Date().toISOString(),
    });
    http.expectOne(`/api/bot-actions/${ID}`).flush({
      action: botAction({ status: 'undone', updatedAt: '2026-10-28T00:00:00.000Z' }),
    });
    await settle();
    expect(text()).toContain('Undone:');
  });
});
