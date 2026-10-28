import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import type { ChatEvent, HomeProposal, HomeServiceCall } from '@maple/shared';
import { HomeProposalCardComponent } from './home-proposal-card.component';
import { RealtimeService } from '../../../services/realtime.service';

const ID = '9a1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00';
const light: HomeServiceCall = {
  entityId: 'light.kitchen',
  domain: 'light',
  service: 'turn_on',
  data: { brightness_pct: 80 },
  name: 'Kitchen Light',
  area: 'Kitchen',
};
const lock: HomeServiceCall = {
  entityId: 'lock.front_door',
  domain: 'lock',
  service: 'unlock',
  name: 'Front Door',
  sensitive: true,
};

function proposal(call: HomeServiceCall, overrides: Partial<HomeProposal> = {}): HomeProposal {
  return {
    id: ID,
    notebookId: 'n1',
    pageId: 'chat',
    messageId: 'm1',
    call,
    summary: 'summary',
    status: 'proposed',
    canConfirm: true,
    expiresAt: '2026-10-28T13:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  };
}

describe('HomeProposalCardComponent', () => {
  let events: Subject<ChatEvent>;
  let http: HttpTestingController;

  beforeEach(() => {
    events = new Subject<ChatEvent>();
    TestBed.configureTestingModule({
      imports: [HomeProposalCardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: { events$: events.asObservable() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  async function render(call: HomeServiceCall, loaded: HomeProposal) {
    const fixture = TestBed.createComponent(HomeProposalCardComponent);
    fixture.componentRef.setInput('proposalId', ID);
    fixture.componentRef.setInput('call', call);
    fixture.detectChanges();
    http.expectOne(`/api/home-proposals/${ID}`).flush({ proposal: loaded });
    await fixture.whenStable();
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const text = () => host.textContent?.replace(/\s+/g, ' ') ?? '';
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, text, button, settle };
  }

  it('describes the action and follows it from the tap to done', async () => {
    const { text, button, settle, fixture } = await render(light, proposal(light));
    expect(text()).toContain('Turn on Kitchen Light at 80%');
    expect(text()).toContain('Kitchen');
    button('Do it')!.click();
    const request = http.expectOne({ method: 'POST', url: `/api/home-proposals/${ID}/confirm` });
    expect(request.request.body).toEqual({});
    request.flush({
      proposal: proposal(light, {
        status: 'running',
        device: { name: 'Studio Mac', lastSeenAt: '2026-10-28T12:00:00Z', offline: false },
        updatedAt: '2026-10-28T12:01:00.000Z',
      }),
    });
    await settle();
    expect(text()).toContain('Sending to Home Assistant through Studio Mac');

    const { canConfirm: _, ...data } = proposal(light, {
      status: 'done',
      updatedAt: '2026-10-28T12:02:00.000Z',
    });
    events.next({
      action: 'home_proposal_updated',
      data,
      pageId: 'chat',
      notebookId: 'n1',
      userId: 'owner',
      timestamp: new Date().toISOString(),
    });
    await settle();
    expect(text()).toContain('Done');
    fixture.destroy();
  });

  it('asks twice before unlocking a door', async () => {
    const { text, button, settle, fixture } = await render(lock, proposal(lock));
    expect(text()).toContain('Unlock Front Door');
    button('Do it')!.click();
    await settle();
    // The first tap only asks; nothing is sent.
    http.expectNone({ method: 'POST', url: `/api/home-proposals/${ID}/confirm` });
    expect(text()).toContain('Are you sure? This unlocks a door.');

    button('Yes, do it')!.click();
    const request = http.expectOne({ method: 'POST', url: `/api/home-proposals/${ID}/confirm` });
    expect(request.request.body).toEqual({ acknowledged: true });
    request.flush({
      proposal: proposal(lock, { status: 'running', updatedAt: '2026-10-28T12:01:00Z' }),
    });
    await settle();
    expect(text()).toContain('Sending to Home Assistant');
    fixture.destroy();
  });

  it('only the owner gets an active button', async () => {
    const { text, button, fixture } = await render(light, proposal(light, { canConfirm: false }));
    expect(button('Do it')!.disabled).toBe(true);
    expect(text()).toContain("Only the home's owner can do this.");
    fixture.destroy();
  });

  it("shows why the Mac couldn't do it", async () => {
    const { text, button, fixture } = await render(
      light,
      proposal(light, {
        status: 'failed',
        error: 'Kitchen Light is no longer exposed in Home Assistant',
      }),
    );
    expect(text()).toContain("Couldn't do it: Kitchen Light is no longer exposed");
    expect(button('Try again')).toBeDefined();
    fixture.destroy();
  });
});
