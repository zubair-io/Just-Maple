import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import type { FollowUp, FollowUpList, Page } from '@maple/shared';
import { FollowUpsViewComponent } from './follow-ups-view.component';
import { FollowUpsService, placeFollowUp } from '../../services/follow-ups.service';
import { PageService } from '../../services/page.service';

const day = 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);

function followUp(fields: Partial<FollowUp> & Pick<FollowUp, 'id' | 'direction'>): FollowUp {
  return {
    who: 'Jordan',
    what: 'Something',
    at: now - day,
    status: 'open',
    confidence: 0.9,
    madeBy: 'model',
    evidence: [{ itemId: 'imessage:1', source: 'imessage', at: now - day, pageId: 'msgs' }],
    ...fields,
  };
}

const photos = followUp({
  id: 'u|you_promised|imessage:1',
  direction: 'you_promised',
  what: 'Send the photos',
  dueAt: now - day / 2,
});
const reply = followUp({
  id: 'u|owe_reply|mail:2',
  direction: 'owe_reply',
  who: 'Pat Lee',
  what: 'Could you confirm the deck size?',
  at: now - 3 * day,
  evidence: [{ itemId: 'mail:2', source: 'mail', at: now - 3 * day, pageId: 'mail-page' }],
});
const carpool = followUp({
  id: 'u|they_owe|imessage:3',
  direction: 'they_owe',
  what: 'Get back about carpool',
  dueAt: now + 3 * day,
});
const hike = followUp({
  id: 'u|waiting_reply|imessage:4',
  direction: 'waiting_reply',
  who: 'Riley',
  what: 'Are we still on for the hike?',
  status: 'snoozed',
  snoozedUntil: now + 2 * day,
});

const closedByBot = followUp({
  id: 'u|you_promised|imessage:5',
  direction: 'you_promised',
  what: 'Book the dentist',
  status: 'done',
  closedAt: now - day / 4,
  closedBy: { type: 'bot', name: 'Helper' },
});
const expired = followUp({
  id: 'u|they_owe|imessage:6',
  direction: 'they_owe',
  what: 'Return the drill',
  status: 'expired',
  closedAt: now - day,
  closedBy: { type: 'auto' },
});

const list: FollowUpList = {
  followUps: [carpool, photos, reply, hike],
  recent: [expired, closedByBot],
  status: { lastRunAt: '2026-10-28T00:00:00Z', modelAvailable: true },
};

describe('FollowUpsViewComponent', () => {
  const state = signal<FollowUpList | null>(list);
  const service = {
    list: state.asReadonly(),
    error: signal<string | null>(null),
    loading: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
    act: vi.fn(),
  };
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  const page = {
    id: 'followups-nb1',
    type: 'followups',
    title: 'Follow-ups',
    notebookId: 'nb1',
  } as Page;

  beforeEach(() => {
    vi.clearAllMocks();
    state.set(list);
    // Like the real service: done and dismissed ones move to Recently closed.
    service.act.mockImplementation(async (item: FollowUp, action: string, until?: string) => {
      const status =
        action === 'done'
          ? 'done'
          : action === 'dismiss'
            ? 'dismissed'
            : action === 'snooze'
              ? 'snoozed'
              : 'open';
      const updated: FollowUp = {
        ...item,
        status,
        ...(until ? { snoozedUntil: Math.floor(Date.parse(until) / 1000) } : {}),
      };
      if (status !== 'snoozed') delete (updated as Partial<FollowUp>).snoozedUntil;
      state.update((current) => placeFollowUp(current!, updated));
      return updated;
    });
    TestBed.configureTestingModule({
      imports: [FollowUpsViewComponent],
      providers: [
        { provide: FollowUpsService, useValue: service },
        { provide: Router, useValue: router },
        { provide: PageService, useValue: { pages: signal([page]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'followups-nb1' })),
            snapshot: { paramMap: convertToParamMap({ id: 'followups-nb1' }) },
          },
        },
      ],
    });
  });

  const render = () => {
    const fixture = TestBed.createComponent(FollowUpsViewComponent);
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
    return fixture;
  };
  const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = (fixture: ReturnType<typeof render>, section: string) =>
    [...fixture.nativeElement.querySelectorAll(`[data-testid="${section}"] article`)].map(
      (row: Element) => row.getAttribute('data-id'),
    );
  const button = (fixture: ReturnType<typeof render>, id: string, action: string) =>
    fixture.nativeElement.querySelector(
      `article[data-id="${id}"] [data-action="${action}"]`,
    ) as HTMLButtonElement;
  const settle = async (fixture: ReturnType<typeof render>) => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('loads once and groups by who owes, due first', () => {
    const fixture = render();
    TestBed.flushEffects();
    expect(service.load).toHaveBeenCalledTimes(1);
    expect(service.load).toHaveBeenCalledWith('nb1');
    // The three-day-old question before the promise due half a day ago.
    expect(rows(fixture, 'you-owe')).toEqual([reply.id, photos.id]);
    expect(rows(fixture, 'owed-to-you')).toEqual([carpool.id]);
    expect(text(fixture.nativeElement.querySelector('[data-testid="summary"]'))).toContain(
      '3 open · 1 overdue · 1 snoozed',
    );
    const overdue = fixture.nativeElement.querySelector(
      `article[data-id="${photos.id}"] [data-testid="due"]`,
    );
    expect(overdue.classList).toContain('follow-up-overdue');
    expect(text(overdue)).toMatch(/^Overdue, was due/);
    // Snoozed ones stay folded away.
    expect(rows(fixture, 'snoozed')).toEqual([]);
  });

  it('sorts by due date, or by age when none was stated', () => {
    const fixture = render();
    const youOwe = fixture.componentInstance.youOwe().map((f) => f.id);
    // The question is 3 days old; the promise was due half a day ago.
    expect(youOwe).toEqual([reply.id, photos.id]);
  });

  it('marks done with an undo, and undo puts it back', async () => {
    const fixture = render();
    button(fixture, photos.id, 'done').click();
    await settle(fixture);
    expect(service.act).toHaveBeenCalledWith(photos, 'done', undefined);
    expect(rows(fixture, 'you-owe')).toEqual([reply.id]);
    const undo = fixture.nativeElement.querySelector('[data-testid="undo"]');
    expect(text(undo)).toContain('Marked done: Send the photos');

    (undo.querySelector('button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(service.act).toHaveBeenLastCalledWith(photos, 'reopen', undefined);
    expect(rows(fixture, 'you-owe')).toContain(photos.id);
    expect(fixture.nativeElement.querySelector('[data-testid="undo"]')).toBeNull();
  });

  it('dismisses', async () => {
    const fixture = render();
    button(fixture, carpool.id, 'dismiss').click();
    await settle(fixture);
    expect(service.act).toHaveBeenCalledWith(carpool, 'dismiss', undefined);
    expect(rows(fixture, 'owed-to-you')).toEqual([]);
    expect(text(fixture.nativeElement.querySelector('[data-testid="undo"]'))).toContain(
      'Dismissed: Get back about carpool',
    );
  });

  it('snoozes for a day, a week or until a chosen day', async () => {
    const fixture = render();
    button(fixture, carpool.id, 'snooze').click();
    fixture.detectChanges();
    const menu = fixture.nativeElement.querySelector('[data-testid="snooze-menu"]');
    const [oneDay] = [...menu.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[];
    oneDay!.click();
    await settle(fixture);
    const until = Date.parse(service.act.mock.calls[0]![2]);
    expect(Math.abs(until - (Date.now() + day * 1000))).toBeLessThan(60_000);
    expect(rows(fixture, 'owed-to-you')).toEqual([]);
    expect(fixture.nativeElement.querySelector('[data-testid="snooze-menu"]')).toBeNull();

    // A week.
    button(fixture, reply.id, 'snooze').click();
    fixture.detectChanges();
    (
      [...fixture.nativeElement.querySelectorAll('[role="menuitem"]')] as HTMLButtonElement[]
    )[1]!.click();
    await settle(fixture);
    const week = Date.parse(service.act.mock.calls[1]![2]);
    expect(Math.abs(week - (Date.now() + 7 * day * 1000))).toBeLessThan(60_000);

    // A chosen day: its morning.
    button(fixture, photos.id, 'snooze').click();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      '[data-testid="snooze-menu"] input[type="date"]',
    ) as HTMLInputElement;
    input.value = '2099-03-04';
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button(fixture, photos.id, 'snooze-custom').click();
    await settle(fixture);
    expect(service.act).toHaveBeenLastCalledWith(
      photos,
      'snooze',
      new Date('2099-03-04T08:00:00').toISOString(),
    );
  });

  it('wakes a snoozed one', async () => {
    const fixture = render();
    (
      fixture.nativeElement.querySelector('[data-testid="snoozed"] button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(rows(fixture, 'snoozed')).toEqual([hike.id]);
    const wake = button(fixture, hike.id, 'wake');
    expect(text(wake)).toBe('Wake now');
    wake.click();
    await settle(fixture);
    expect(service.act).toHaveBeenCalledWith(hike, 'reopen', undefined);
    expect(rows(fixture, 'owed-to-you')).toContain(hike.id);
  });

  it('opens the data page the message came from', async () => {
    const fixture = render();
    (
      fixture.nativeElement.querySelector(
        `article[data-id="${reply.id}"] [data-testid="evidence"]`,
      ) as HTMLButtonElement
    ).click();
    await settle(fixture);
    expect(router.navigate).toHaveBeenCalledWith(['/', 'nb1', 'mail-page']);
    expect(
      text(
        fixture.nativeElement.querySelector(
          `article[data-id="${reply.id}"] [data-testid="evidence"]`,
        ),
      ),
    ).toBe('Open email');
  });

  it('shows why a change failed, and keeps the item', async () => {
    service.act.mockRejectedValueOnce({
      error: { message: 'That follow-up is not in this notebook' },
    });
    const fixture = render();
    button(fixture, photos.id, 'done').click();
    await settle(fixture);
    expect(text(fixture.nativeElement.querySelector('[role="alert"]'))).toBe(
      'That follow-up is not in this notebook',
    );
    expect(rows(fixture, 'you-owe')).toContain(photos.id);
    expect(fixture.nativeElement.querySelector('[data-testid="undo"]')).toBeNull();
  });

  it('lists recently closed ones with who closed them, and reopens them', async () => {
    const fixture = render();
    const section = () => fixture.nativeElement.querySelector('[data-testid="recent"]');
    expect(text(section().querySelector('button'))).toContain('Recently closed · 2');
    section().querySelector('button').click();
    fixture.detectChanges();
    // Newest first, each saying who closed it.
    expect(rows(fixture, 'recent')).toEqual([closedByBot.id, expired.id]);
    const labels = [...section().querySelectorAll('[data-testid="closed-by"]')].map(text);
    expect(labels[0]).toContain('Done by Helper');
    expect(labels[1]).toContain('Expired');

    button(fixture, closedByBot.id, 'reopen').click();
    await settle(fixture);
    expect(service.act).toHaveBeenCalledWith(closedByBot, 'reopen', undefined);
    expect(rows(fixture, 'you-owe')).toContain(closedByBot.id);
    expect(rows(fixture, 'recent')).toEqual([expired.id]);

    // Marked done here: it moves to Recently closed.
    button(fixture, photos.id, 'done').click();
    await settle(fixture);
    expect(rows(fixture, 'recent')).toContain(photos.id);
  });

  it('says when there is nothing owed, and when the server has no model', () => {
    state.set({ followUps: [], recent: [], status: { modelAvailable: false } });
    const fixture = render();
    expect(fixture.nativeElement.querySelector('[data-testid="empty"]')).not.toBeNull();
    const summary = text(fixture.nativeElement.querySelector('[data-testid="summary"]'));
    expect(summary).toContain('no model on this server');
    expect(summary).toContain('Reading the last two weeks');
  });
});
