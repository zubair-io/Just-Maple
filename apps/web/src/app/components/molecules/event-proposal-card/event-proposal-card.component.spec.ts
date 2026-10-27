import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import type { CalendarProposal, ChatEvent } from '@maple/shared';
import { EventProposalCardComponent } from './event-proposal-card.component';
import { CalendarProposalService } from '../../../services/calendar-proposal.service';
import { RealtimeService } from '../../../services/realtime.service';
import { DeviceDataService } from '../../../services/device-data.service';

const ID = '7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00';
const event = {
  title: "Greyson's soccer pizza party",
  // Wed, Oct 28 2026, 3:00–4:00 PM in New York.
  start: Date.UTC(2026, 9, 28, 19) / 1000,
  end: Date.UTC(2026, 9, 28, 20) / 1000,
  location: 'The Commons',
  notes: 'pickup 4:15–4:30, bring jersey',
  timeZone: 'America/New_York',
};

function proposal(overrides: Partial<CalendarProposal> = {}): CalendarProposal {
  return {
    id: ID,
    notebookId: 'n1',
    pageId: 'chat',
    messageId: 'm1',
    event,
    status: 'proposed',
    canConfirm: true,
    expiresAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-10-27T12:00:00.000Z',
    ...overrides,
  };
}

describe('EventProposalCardComponent', () => {
  let events: Subject<ChatEvent>;
  let http: HttpTestingController;
  const openItem = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    events = new Subject<ChatEvent>();
    TestBed.configureTestingModule({
      imports: [EventProposalCardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: { events$: events.asObservable() } },
        { provide: DeviceDataService, useValue: { openItem } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    openItem.mockClear();
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  /** Renders the card and answers its first load with `loaded`. */
  async function render(loaded: CalendarProposal | null) {
    const fixture = TestBed.createComponent(EventProposalCardComponent);
    fixture.componentRef.setInput('proposalId', ID);
    fixture.componentRef.setInput('event', event);
    fixture.detectChanges();
    const request = http.expectOne(`/api/calendar-proposals/${ID}`);
    if (loaded) request.flush({ proposal: loaded });
    else request.flush({ error: 'Not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const text = () => host.textContent?.replace(/\s+/g, ' ') ?? '';
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    const update = async (next: Partial<CalendarProposal>) => {
      const { canConfirm: _, ...data } = proposal(next);
      events.next({
        action: 'calendar_proposal_updated',
        data,
        pageId: 'chat',
        notebookId: 'n1',
        userId: 'owner',
        timestamp: new Date().toISOString(),
      });
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, host, text, button, update };
  }

  it('shows the event details the bot proposed', async () => {
    const { text, fixture } = await render(proposal());
    expect(text()).toContain("Greyson's soccer pizza party");
    expect(text()).toContain('Wed, Oct 28, 3:00 PM – 4:00 PM');
    expect(text()).toContain('The Commons');
    expect(text()).toContain('pickup 4:15–4:30, bring jersey');
    fixture.destroy();
  });

  it('shows no button until the state loads', async () => {
    const { host, text, fixture } = await render(null);
    expect(host.querySelector('button')).toBeNull();
    expect(text()).toContain('The Commons');
    fixture.destroy();
  });

  it('lets the owner tap Add, then follows it through adding to added', async () => {
    const { button, text, update, fixture } = await render(proposal());
    const add = button('Add to calendar')!;
    expect(add.disabled).toBe(false);
    add.click();
    http.expectOne({ method: 'POST', url: `/api/calendar-proposals/${ID}/confirm` }).flush({
      proposal: proposal({
        status: 'adding',
        device: { name: 'Studio Mac', lastSeenAt: '2026-10-27T12:00:00Z', offline: false },
        updatedAt: '2026-10-27T12:01:00.000Z',
      }),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Adding to the calendar on Studio Mac');
    expect(button('Add to calendar')).toBeUndefined();

    await update({
      status: 'added',
      itemId: 'calendar:ABC@1793214000',
      updatedAt: '2026-10-27T12:02:00.000Z',
    });
    expect(text()).toContain('Added to calendar');
    button('Open in Calendar')!.click();
    expect(openItem).toHaveBeenCalledWith('calendar:ABC@1793214000');
    fixture.destroy();
  });

  it('keeps the button inactive for everyone but the calendar owner', async () => {
    const { button, text, fixture } = await render(proposal({ canConfirm: false }));
    const add = button('Add to calendar')!;
    expect(add.disabled).toBe(true);
    add.click();
    http.expectNone(`/api/calendar-proposals/${ID}/confirm`);
    expect(text()).toContain("Only the calendar's owner can add this.");
    fixture.destroy();
  });

  it('says it will be added later when the Mac has been away', async () => {
    const { text, fixture } = await render(
      proposal({
        status: 'adding',
        device: { name: 'Studio Mac', lastSeenAt: '2026-10-27T11:00:00Z', offline: true },
      }),
    );
    expect(text()).toContain("Studio Mac is offline. It will be added when it's next on.");
    fixture.destroy();
  });

  it('shows why it failed and lets the owner try again', async () => {
    const { text, button, fixture } = await render(
      proposal({ status: 'failed', error: 'Calendar is read-only' }),
    );
    expect(text()).toContain("Couldn't add it: Calendar is read-only");
    button('Try again')!.click();
    http
      .expectOne(`/api/calendar-proposals/${ID}/confirm`)
      .flush({ proposal: proposal({ status: 'adding' }) });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('Adding to the calendar on your Mac');
    fixture.destroy();
  });

  it('shows the server’s reason when a tap is refused, then the current state', async () => {
    const { text, button, fixture } = await render(proposal());
    button('Add to calendar')!.click();
    http
      .expectOne(`/api/calendar-proposals/${ID}/confirm`)
      .flush({ error: 'This proposal expired.' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    http
      .expectOne(`/api/calendar-proposals/${ID}`)
      .flush({ proposal: proposal({ status: 'expired' }) });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text()).toContain('This proposal expired.');
    expect(text()).toContain('This offer expired.');
    fixture.destroy();
  });

  it('keeps who-can-confirm from its own load when updates arrive', async () => {
    const { fixture } = await render(proposal({ canConfirm: false }));
    const service = TestBed.inject(CalendarProposalService);
    events.next({
      action: 'calendar_proposal_updated',
      data: { ...proposal({ status: 'failed', error: 'x' }), canConfirm: undefined },
      pageId: 'chat',
      notebookId: 'n1',
      userId: 'owner',
      timestamp: new Date().toISOString(),
    });
    expect(service.proposals()[ID]).toMatchObject({ status: 'failed', canConfirm: false });
    // An older event doesn't undo a newer state.
    events.next({
      action: 'calendar_proposal_updated',
      data: proposal({ status: 'proposed', updatedAt: '2026-10-27T00:00:00.000Z' }),
      pageId: 'chat',
      notebookId: 'n1',
      userId: 'owner',
      timestamp: new Date().toISOString(),
    });
    expect(service.proposals()[ID]!.status).toBe('failed');
    fixture.destroy();
  });
});
