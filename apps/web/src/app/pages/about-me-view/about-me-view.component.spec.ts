import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import type { AboutMe, Page, ProfileFact } from '@maple/shared';
import { AboutMeViewComponent } from './about-me-view.component';
import { AboutMeService } from '../../services/about-me.service';
import { PageService } from '../../services/page.service';
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
    source: { type: 'bot', botName: 'Helper' },
    status: 'active',
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-24T10:00:00Z',
    ...extra,
  }) as ProfileFact;

const me = {
  id: 'me',
  kind: 'person' as const,
  name: 'Alex',
  aliases: [],
  isMe: true,
  createdAt: '',
  updatedAt: '',
};

const profile: AboutMe = {
  me,
  entities: [
    me,
    { id: 'sam', kind: 'person', name: 'Sam', aliases: [], createdAt: '', updatedAt: '' },
  ],
  relations: [
    {
      id: 'r1',
      from: 'me',
      to: 'sam',
      type: 'sibling',
      source: { type: 'contacts' },
      createdAt: '',
    },
  ],
  facts: [
    fact('f1', 'me', 'home_address', '1 Example Rd', { source: { type: 'contacts' } }),
    fact('f2', 'me', 'trip', 'Away for work', {
      kind: 'current',
      validUntil: '2026-10-30T12:00:00Z',
    }),
    fact('f3', 'sam', 'team', 'Blue'),
  ],
  pending: [fact('p1', 'me', 'note', 'Waiting one', { status: 'pending' })],
  recentlyLearned: [],
};

describe('AboutMeViewComponent', () => {
  const state = signal<AboutMe | null>(profile);
  const service = {
    profile: state.asReadonly(),
    shared: signal(false),
    error: signal<string | null>(null),
    entitiesById: computed(() => new Map(state()?.entities.map((e) => [e.id, e]) ?? [])),
    load: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
    updateFact: vi.fn().mockResolvedValue(undefined),
    updateRelation: vi.fn().mockResolvedValue(undefined),
    removeRelation: vi.fn().mockResolvedValue(undefined),
  };
  const page = { id: 'page-1', type: 'aboutme', title: 'About me', notebookId: 'nb1' } as Page;

  beforeEach(() => {
    vi.clearAllMocks();
    state.set(profile);
    service.shared.set(false);
    TestBed.configureTestingModule({
      imports: [AboutMeViewComponent],
      providers: [
        { provide: AboutMeService, useValue: service },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: DialogService, useValue: { confirm: vi.fn().mockResolvedValue(true) } },
        {
          provide: PageService,
          useValue: { pages: signal([page]), moveToTrash: vi.fn(() => of(undefined)) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'page-1' })),
            snapshot: { paramMap: convertToParamMap({ id: 'page-1' }) },
          },
        },
      ],
    });
  });

  const render = () => {
    const fixture = TestBed.createComponent(AboutMeViewComponent);
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
    return fixture;
  };
  const rowsText = (fixture: ReturnType<typeof render>) =>
    [...fixture.nativeElement.querySelectorAll('tbody tr')].map((tr: HTMLElement) =>
      [...tr.querySelectorAll('td')]
        .map((td) => td.textContent!.replace(/\s+/g, ' ').trim())
        .join(' '),
    );

  it("loads the notebook's About me as one table, suggestions pinned on top", () => {
    const fixture = render();
    expect(service.load).toHaveBeenCalledWith('nb1');
    const headers = [...fixture.nativeElement.querySelectorAll('th')].map((th: HTMLElement) =>
      th.textContent!.trim(),
    );
    expect(headers.slice(0, 5)).toEqual(['Who', 'What', 'Value', 'Until', 'Source']);
    const rows = rowsText(fixture);
    expect(rows[0]).toContain('Waiting one');
    expect(rows[0]).toContain('Approve');
    expect(rows).toContainEqual(expect.stringContaining('You Home address 1 Example Rd'));
    expect(rows).toContainEqual(expect.stringContaining('Oct 30, 2026'));
    expect(rows).toContainEqual(expect.stringContaining('Sam Relationship Sibling'));
    expect(rows).toContainEqual(expect.stringContaining('Sam Team Blue'));
  });

  it('searches every column and filters by who and source', () => {
    const fixture = render();
    const view = fixture.componentInstance;
    view.search.set('contacts');
    expect(view.filtered().map((row) => row.id)).toEqual(['f1', 'r1']);
    view.search.set('');
    view.whoFilter.set('Sam');
    expect(view.filtered().map((row) => row.id)).toEqual(['r1', 'f3']);
    view.whoFilter.set('');
    view.sourceFilter.set('Helper');
    expect(view.filtered().map((row) => row.id)).toEqual(['p1', 'f2', 'f3']);
  });

  it('approves, edits, and undoes what a bot learned, with an undo for the removal', async () => {
    const fixture = render();
    const view = fixture.componentInstance;
    const row = (id: string) => view.rows().find((r) => r.id === id)!;
    await view.approve(row('p1'));
    expect(service.approve).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));

    view.startEdit(row('f2'));
    view.editValue.set('Away until Friday');
    view.editUntil.set('');
    await view.saveEdit(row('f2'));
    expect(service.updateFact).toHaveBeenCalledWith('f2', {
      value: 'Away until Friday',
      validUntil: null,
    });

    fixture.detectChanges();
    const undo = [...fixture.nativeElement.querySelectorAll('tr')]
      .find((tr: HTMLElement) => tr.textContent!.includes('Blue'))!
      .querySelectorAll('button')[1] as HTMLButtonElement;
    expect(undo.textContent!.trim()).toBe('Undo');
    await view.remove(row('f3'));
    expect(service.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'f3' }));
    await view.undoRemove();
    expect(service.restore).toHaveBeenCalledWith(expect.objectContaining({ id: 'f3' }));

    view.startEdit(row('r1'));
    view.editValue.set('brother');
    await view.saveEdit(row('r1'));
    expect(service.updateRelation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      'brother',
    );
  });

  it('says plainly when there is nothing yet, and when the notebook is shared', () => {
    state.set({ ...profile, me: null, entities: [], relations: [], facts: [], pending: [] });
    service.shared.set(true);
    const fixture = render();
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Nothing here yet.');
    expect(text).toContain("Only you see yours. Bots here read every member's.");
  });
});
