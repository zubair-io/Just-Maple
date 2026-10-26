import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { AboutMe, ProfileFact } from '@maple/shared';
import { AboutMeComponent } from './about-me.component';
import { AboutMeService } from '../../services/about-me.service';
import { DialogService } from '../../components';

const fact = (
  id: string,
  about: string,
  key: string,
  value: string,
  extra: Partial<ProfileFact> = {},
) =>
  ({
    id,
    about,
    key,
    value,
    kind: 'lasting',
    source: { type: 'bot', botName: 'Maple' },
    status: 'active',
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-24T10:00:00Z',
    ...extra,
  }) as ProfileFact;

const profile: AboutMe = {
  me: {
    id: 'me',
    kind: 'person',
    name: 'Zubair',
    aliases: [],
    isMe: true,
    createdAt: '',
    updatedAt: '',
  },
  entities: [
    {
      id: 'me',
      kind: 'person',
      name: 'Zubair',
      aliases: [],
      isMe: true,
      createdAt: '',
      updatedAt: '',
    },
    { id: 'emma', kind: 'person', name: 'Emma', aliases: [], createdAt: '', updatedAt: '' },
    {
      id: 'home',
      kind: 'place',
      name: 'Home',
      aliases: [],
      place: { lat: 40.7128, lon: -74.006, radius: 150 },
      createdAt: '',
      updatedAt: '',
    },
  ],
  relations: [{ id: 'r', from: 'me', to: 'emma', type: 'child', createdAt: '' }],
  facts: [
    fact('f1', 'me', 'home_address', '12 Maple St', { source: { type: 'contacts' } }),
    fact('f2', 'me', 'travel', 'In Denver', {
      kind: 'current',
      validUntil: '2026-10-30T00:00:00Z',
    }),
    fact('f3', 'emma', 'team', 'Hawks'),
  ],
  pending: [fact('p1', 'me', 'condition', 'Knee recovery', { status: 'pending', sensitive: true })],
  recentlyLearned: [fact('f3', 'emma', 'team', 'Hawks')],
};

describe('AboutMeComponent', () => {
  const state = signal<AboutMe | null>(profile);
  const service = {
    profile: state.asReadonly(),
    loading: signal(false),
    error: signal<string | null>(null),
    places: computed(() => state()?.entities.filter((e) => e.kind === 'place' && e.place) ?? []),
    entitiesById: computed(() => new Map(state()?.entities.map((e) => [e.id, e]) ?? [])),
    load: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    addFact: vi.fn().mockResolvedValue(undefined),
    addPerson: vi.fn().mockResolvedValue(undefined),
    removePerson: vi.fn().mockResolvedValue(undefined),
    updateFact: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state.set(profile);
    TestBed.configureTestingModule({
      imports: [AboutMeComponent],
      providers: [
        { provide: AboutMeService, useValue: service },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: DialogService, useValue: { confirm: vi.fn().mockResolvedValue(true) } },
      ],
    });
  });

  it('shows you, your people, what is true now, and what bots learned', () => {
    const fixture = TestBed.createComponent(AboutMeComponent);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(service.load).toHaveBeenCalled();
    expect(text).toContain('Emma');
    expect(text).toContain('Child');
    expect(text).toContain('Team: Hawks');
    expect(text).toContain('In Denver');
    expect(text).toContain('12 Maple St');
    expect(text).toContain('From your contact card');
    expect(text).toContain('Learned by Maple');
    expect(text).toContain('Knee recovery');
    // Named places get their own section, with where they are.
    expect(text).toContain('40.7128, -74.0060');
    expect(text).not.toContain('No named places yet');
  });

  it('approves suggestions and undoes learned facts', () => {
    const fixture = TestBed.createComponent(AboutMeComponent);
    fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    buttons.find((b) => b.textContent?.trim() === 'Approve')!.click();
    expect(service.approve).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    buttons.find((b) => b.textContent?.trim() === 'Undo')!.click();
    expect(service.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'f3' }));
  });

  it('adds what is true right now with an end date', async () => {
    const fixture = TestBed.createComponent(AboutMeComponent);
    fixture.detectChanges();
    fixture.componentInstance.newNow.set('Traveling to Austin');
    fixture.componentInstance.newNowUntil.set('2026-11-02');
    await fixture.componentInstance.addRightNow();
    expect(service.addFact).toHaveBeenCalledWith(
      expect.objectContaining({
        about: 'me',
        kind: 'current',
        value: 'Traveling to Austin',
        validUntil: expect.any(String),
      }),
    );
  });

  it('offers to start when there is no profile yet', () => {
    state.set({ ...profile, me: null });
    const fixture = TestBed.createComponent(AboutMeComponent);
    fixture.detectChanges();
    const start = [...fixture.nativeElement.querySelectorAll('button')].find(
      (b: HTMLButtonElement) => b.textContent?.trim() === 'Start now',
    ) as HTMLButtonElement;
    start.click();
    expect(service.start).toHaveBeenCalled();
  });
});
