import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import type { DataGraph, DataGraphLink, DataGraphReason, Page } from '@maple/shared';
import { GraphViewComponent } from './graph-view.component';
import { GraphCanvas, isGuess, lineWidth, type CanvasNode } from './graph-canvas';
import { DataGraphService } from '../../services/data-graph.service';
import { PageService } from '../../services/page.service';
import { DialogService } from '../../components';

const day = 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);

/** One line with its reasons; the strongest (first) one sums it up. */
function line(
  id: string,
  source: string,
  target: string,
  reasons: Array<Omit<DataGraphReason, 'id'> & { id?: string }>,
): DataGraphLink {
  const full = reasons.map((reason) => ({ id: `${id}|${reason.kind}`, ...reason }));
  const top = full[0]!;
  return {
    id,
    source,
    target,
    reasons: full,
    weight: full.reduce((sum, reason) => sum + reason.confidence + (reason.count ? 1 : 0), 0),
    kind: top.kind,
    confidence: top.confidence,
    evidence: top.evidence,
    madeBy: top.madeBy,
  };
}

const graph: DataGraph = {
  nodes: [
    {
      id: 'item:u1:calendar:dentist',
      kind: 'item',
      source: 'calendar',
      label: 'Dentist follow-up',
      itemId: 'calendar:dentist',
      pageId: 'cal-page',
      at: now + 14 * day,
      location: 'Bright Smiles Dental, 12 Main St',
    },
    {
      id: 'item:u1:location:visit',
      kind: 'item',
      source: 'location',
      label: 'Bright Smiles Dental',
      pageId: 'places-page',
      at: now - 2 * day,
    },
    {
      id: 'item:u1:mail:party',
      kind: 'item',
      source: 'mail',
      label: 'Pizza party',
      pageId: 'mail-page',
      at: now - 40 * day,
      ownerName: 'Sam',
    },
    { id: 'place:office', kind: 'place', label: 'Bright Smiles Dental' },
    { id: 'topic:soccer', kind: 'topic', label: 'Soccer season' },
  ],
  links: [
    line('nb1|a|b', 'item:u1:calendar:dentist', 'item:u1:location:visit', [
      {
        kind: 'created_at',
        confidence: 1,
        evidence: 'Created while at Bright Smiles Dental',
        madeBy: 'rule',
      },
    ]),
    line('nb1|c|d', 'item:u1:calendar:dentist', 'place:office', [
      {
        kind: 'at_place',
        confidence: 0.95,
        evidence: 'Event at Bright Smiles Dental',
        madeBy: 'rule',
      },
    ]),
    line('nb1|e|f', 'item:u1:mail:party', 'topic:soccer', [
      { kind: 'topic', confidence: 0.9, evidence: 'Part of Soccer season', madeBy: 'model' },
    ]),
  ],
  status: { backfilledAt: '2026-10-27T00:00:00Z', modelLinks: true },
};

// Alex and Jen: one line with a relationship, their messages and events together.
const people: DataGraph = {
  nodes: [
    { id: 'person:alex', kind: 'person', label: 'Alex Lawrence', isOwner: true },
    {
      id: 'person:jen',
      kind: 'person',
      label: 'Jen Lawrence',
      itemId: 'contacts:jen',
      pageId: 'contacts-page',
      birthday: '1986-02-03',
      organization: 'Albany Med',
      jobTitle: 'Nurse',
      handles: ['(518) 555-0123', 'jen@example.com'],
      relations: [{ label: 'husband', name: 'Alex' }],
    },
    {
      id: 'item:u1:calendar:dinner',
      kind: 'item',
      source: 'calendar',
      label: 'Dinner',
      pageId: 'cal-page',
      at: now - day,
    },
  ],
  links: [
    line('nb1|alex|jen', 'person:alex', 'person:jen', [
      {
        id: 'r-wife',
        kind: 'relationship',
        type: 'wife',
        from: 'person:alex',
        to: 'person:jen',
        confidence: 0.95,
        evidence: "Jen Lawrence is Alex Lawrence's wife",
        madeBy: 'rule',
      },
      {
        id: 'r-texts',
        kind: 'messages_with',
        confidence: 1,
        count: 214,
        firstAt: now - 20 * day,
        lastAt: now - 3600,
        evidence: '214 messages',
        madeBy: 'rule',
        examples: [
          {
            id: 'item:u1:imessage:t1',
            label: 'See you soon',
            source: 'imessage',
            pageId: 'messages-page',
            at: now - 3600,
          },
        ],
      },
      {
        id: 'r-met',
        kind: 'met_with',
        confidence: 1,
        count: 3,
        firstAt: now - 9 * day,
        lastAt: now - day,
        evidence: '3 events together',
        madeBy: 'rule',
      },
    ]),
    line('nb1|dinner|jen', 'item:u1:calendar:dinner', 'person:jen', [
      { kind: 'attendee', confidence: 1, evidence: 'Jen Lawrence is invited', madeBy: 'rule' },
    ]),
  ],
  status: { backfilledAt: '2026-10-27T00:00:00Z', modelLinks: true },
};

describe('GraphViewComponent', () => {
  const state = signal<DataGraph | null>(graph);
  const service = {
    graph: state.asReadonly(),
    error: signal<string | null>(null),
    loading: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
    removeLink: vi.fn().mockResolvedValue(undefined),
    removeReason: vi.fn().mockResolvedValue(undefined),
  };
  const router = { navigate: vi.fn().mockResolvedValue(true) };
  const dialog = { confirm: vi.fn().mockResolvedValue(true) };
  const page = { id: 'graph-nb1', type: 'graph', title: 'Graph', notebookId: 'nb1' } as Page;

  beforeEach(() => {
    vi.clearAllMocks();
    state.set(graph);
    TestBed.configureTestingModule({
      imports: [GraphViewComponent],
      providers: [
        { provide: DataGraphService, useValue: service },
        { provide: Router, useValue: router },
        { provide: DialogService, useValue: dialog },
        { provide: PageService, useValue: { pages: signal([page]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'graph-nb1' })),
            snapshot: { paramMap: convertToParamMap({ id: 'graph-nb1' }) },
          },
        },
      ],
    });
  });

  const render = () => {
    const fixture = TestBed.createComponent(GraphViewComponent);
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
    return fixture;
  };
  const text = (fixture: ReturnType<typeof render>) =>
    (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');

  it("loads the notebook's graph once, with a legend of the kinds in it", () => {
    const fixture = render();
    TestBed.flushEffects();
    expect(service.load).toHaveBeenCalledTimes(1);
    expect(service.load).toHaveBeenCalledWith('nb1');
    expect(text(fixture)).toContain('3 items · 3 links');
    const legend = [...fixture.nativeElement.querySelectorAll('[data-kind]')].map(
      (chip: HTMLElement) => chip.textContent!.trim(),
    );
    expect(legend).toEqual(['Email', 'Events', 'Visits', 'Places', 'Topics']);
  });

  it('filters by kind: hidden items drop out, and hubs left without links go too', () => {
    const fixture = render();
    const chip = fixture.nativeElement.querySelector('[data-kind="mail"]') as HTMLButtonElement;
    chip.click();
    fixture.detectChanges();
    const view = fixture.componentInstance.view();
    expect(view.nodes.map((n) => n.id)).not.toContain('item:u1:mail:party');
    expect(view.nodes.map((n) => n.id)).not.toContain('topic:soccer');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(text(fixture)).toContain('2 items · 2 links');

    chip.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.view().nodes).toHaveLength(5);
  });

  it('hides only the selected topic in this view and can restore it without removing data', () => {
    const fixture = render();
    const component = fixture.componentInstance;
    component.select('topic:soccer');
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[aria-label="Hide topic from this view"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.view().nodes.some((node) => node.id === 'topic:soccer')).toBe(false);
    expect(component.view().nodes.some((node) => node.id === 'item:u1:mail:party')).toBe(true);
    expect(component.view().links.some((link) => link.id === 'nb1|e|f')).toBe(false);
    expect(component.selected()).toBeNull();
    expect(state()?.nodes).toHaveLength(5);
    expect(state()?.links).toHaveLength(3);
    expect(service.removeReason).not.toHaveBeenCalled();
    expect(service.removeLink).not.toHaveBeenCalled();
    (
      fixture.nativeElement.querySelector('[aria-label="Show hidden topics"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.view().nodes).toHaveLength(5);
    expect(component.view().links).toHaveLength(3);
    component.hideTopic('place:office');
    expect(component.hiddenTopicIds().size).toBe(0);
  });

  it('opens the matched person from a message’s From name', () => {
    state.set({
      ...people,
      nodes: [
        ...people.nodes,
        {
          id: 'item:u1:imessage:message',
          kind: 'item',
          source: 'imessage',
          label: 'Jen Lawrence',
          senderName: 'Jen Lawrence',
          senderHandle: '+15185550123',
          senderPersonId: 'person:jen',
        },
      ],
    });
    const fixture = render();
    fixture.componentInstance.select('item:u1:imessage:message');
    fixture.detectChanges();
    const sender = fixture.nativeElement.querySelector('[data-testid="sender"]') as HTMLElement;
    expect(sender.textContent).toContain('Jen Lawrence');
    expect(sender.textContent).toContain('+15185550123');
    sender.querySelector('button')!.click();
    expect(fixture.componentInstance.selected()?.id).toBe('person:jen');
  });

  it('filters by date range', () => {
    const fixture = render();
    const view = fixture.componentInstance;
    view.setRange(30);
    expect(view.view().nodes.map((n) => n.id)).toEqual([
      'item:u1:calendar:dentist',
      'item:u1:location:visit',
      'place:office',
    ]);
    const to = new Date((now + day) * 1000);
    view.toDate.set(
      `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`,
    );
    expect(view.view().nodes.map((n) => n.id)).toEqual(['item:u1:location:visit']);
    view.setRange(null);
    expect(view.view().nodes).toHaveLength(5);
  });

  it('lights up the hovered node and its neighbors', () => {
    const fixture = render();
    fixture.componentInstance.hoveredId.set('item:u1:calendar:dentist');
    expect([...fixture.componentInstance.neighbors()].sort()).toEqual([
      'item:u1:calendar:dentist',
      'item:u1:location:visit',
      'place:office',
    ]);
  });

  it('shows details on click, opens the item, and walks to a linked node', async () => {
    const fixture = render();
    fixture.componentInstance.select('item:u1:calendar:dentist');
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('[data-testid="details"]') as HTMLElement;
    const content = details.textContent!.replace(/\s+/g, ' ');
    expect(content).toContain('Events');
    expect(content).toContain('Dentist follow-up');
    expect(content).toContain('Bright Smiles Dental, 12 Main St');
    expect(content).toContain('Created while at Bright Smiles Dental · certain');
    expect(content).toContain('Linked (2)');

    const open = [...details.querySelectorAll('button')].find(
      (b) => b.textContent!.trim() === 'Open',
    )!;
    open.click();
    await fixture.whenStable();
    expect(router.navigate).toHaveBeenCalledWith(['/', 'nb1', 'cal-page']);

    const link = details.querySelector('[data-testid="links"] li button') as HTMLButtonElement;
    link.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedId()).toBe('item:u1:location:visit');
  });

  it('says whose an item is and how sure the model was', () => {
    const fixture = render();
    fixture.componentInstance.select('item:u1:mail:party');
    fixture.detectChanges();
    const content = (
      fixture.nativeElement.querySelector('[data-testid="details"]') as HTMLElement
    ).textContent!.replace(/\s+/g, ' ');
    expect(content).toContain("Email · Sam's");
    expect(content).toContain('Part of Soccer season · model, 90%');
  });

  it('removes a reason after confirming', async () => {
    const fixture = render();
    fixture.componentInstance.select('item:u1:calendar:dentist');
    fixture.detectChanges();
    const remove = fixture.nativeElement.querySelector(
      '[aria-label="Remove “Event at Bright Smiles Dental”"]',
    ) as HTMLButtonElement;
    remove.click();
    await fixture.whenStable();
    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Remove this reason?', confirmLabel: 'Remove' }),
    );
    expect(service.removeReason).toHaveBeenCalledWith('nb1|c|d', 'nb1|c|d|at_place');

    dialog.confirm.mockResolvedValueOnce(false);
    const entry = fixture.componentInstance.selectedLinks()[0]!;
    await fixture.componentInstance.removeReason(entry.link, entry.link.reasons[0]!);
    expect(service.removeReason).toHaveBeenCalledTimes(1);
  });

  it('opens every reason on a line, with its evidence, and removes one on its own', async () => {
    state.set(people);
    const fixture = render();
    // A click on a line (not a node) opens its reasons.
    fixture.componentInstance.selectLink('nb1|alex|jen');
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('[data-testid="reasons"]') as HTMLElement;
    expect(fixture.nativeElement.querySelector('[data-testid="details"]')).toBeNull();
    const content = panel.textContent!.replace(/\s+/g, ' ');
    expect(content).toContain('Linked by 3 reasons');
    expect(content).toContain('Alex Lawrence');
    expect(content).toContain('Jen Lawrence');
    const reasons = [...panel.querySelectorAll('[data-testid="reason"]')].map((li) =>
      li.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain('Wife');
    expect(reasons[0]).toContain("Jen Lawrence is Alex Lawrence's wife");
    expect(reasons[0]).toContain('certain');
    expect(reasons[1]).toContain('Messages');
    expect(reasons[1]).toContain('214 messages');
    expect(reasons[1]).toContain('last ');
    expect(reasons[1]).toContain('See you soon');
    expect(reasons[2]).toContain('3 events together');

    // The evidence opens its data page.
    const example = [...panel.querySelectorAll('button')].find((b) =>
      b.textContent!.includes('See you soon'),
    )!;
    example.click();
    await fixture.whenStable();
    expect(router.navigate).toHaveBeenCalledWith(['/', 'nb1', 'messages-page']);

    (panel.querySelector('[aria-label="Remove “214 messages”"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(service.removeReason).toHaveBeenCalledWith('nb1|alex|jen', 'r-texts');

    // An end of the line opens that node.
    const jen = [...panel.querySelectorAll('h2 button')].find((b) =>
      b.textContent!.includes('Jen Lawrence'),
    ) as HTMLButtonElement;
    jen.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedId()).toBe('person:jen');
    expect(fixture.componentInstance.selectedLinkId()).toBeNull();
  });

  it("shows a person's contact card details and opens the contact", async () => {
    state.set(people);
    const fixture = render();
    fixture.componentInstance.select('person:jen');
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('[data-testid="details"]') as HTMLElement;
    const content = details.textContent!.replace(/\s+/g, ' ');
    expect(content).toContain('Nurse, Albany Med');
    expect(content).toMatch(/Birthday ?1986-02-03/);
    expect(content).toContain('Phone (518) 555-0123');
    expect(content).toContain('Email jen@example.com');
    expect(content).toContain('husband Alex');
    // Each line lists all its reasons, each removable.
    expect(content).toContain('214 messages · certain');
    expect(details.querySelectorAll('[aria-label^="Remove “"]')).toHaveLength(4);
    const open = [...details.querySelectorAll('button')].find(
      (b) => b.textContent!.trim() === 'Open contact',
    )!;
    open.click();
    await fixture.whenStable();
    expect(router.navigate).toHaveBeenCalledWith(['/', 'nb1', 'contacts-page']);
    (
      details.querySelector('[aria-label="Why linked to Alex Lawrence"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedLinkId()).toBe('nb1|alex|jen');
  });

  it('explains an empty graph', () => {
    state.set({ ...graph, nodes: [], links: [], status: { modelLinks: true } });
    const fixture = render();
    expect(text(fixture)).toContain('Nothing linked yet.');
    expect(text(fixture)).toContain('Linking the last 30 days');
  });
});

describe('GraphCanvas', () => {
  it('draws one line per pair, thicker with more reasons, and finds a line by position', () => {
    expect(lineWidth(people.links[0]!)).toBeGreaterThan(lineWidth(people.links[1]!));
    expect(lineWidth({ weight: 100 })).toBe(lineWidth({ weight: 6 }));
    expect(isGuess(graph.links[2]!)).toBe(true);
    expect(isGuess(people.links[0]!)).toBe(false);

    const element = document.createElement('canvas');
    const canvas = new GraphCanvas(element, { hover: vi.fn(), click: vi.fn(), clickLink: vi.fn() });
    canvas.resize(400, 300);
    canvas.setData(people.nodes, people.links);
    const internal = canvas as unknown as {
      nodes: CanvasNode[];
      links: unknown[];
      simulation: { stop(): void; tick(n: number): void };
      transform: { apply(point: [number, number]): [number, number] };
    };
    internal.simulation.stop();
    internal.simulation.tick(200);
    // Three reasons, one line.
    expect(internal.links).toHaveLength(2);
    const alex = internal.nodes.find((n) => n.id === 'person:alex')!;
    const jen = internal.nodes.find((n) => n.id === 'person:jen')!;
    const [x, y] = internal.transform.apply([(alex.x! + jen.x!) / 2, (alex.y! + jen.y!) / 2]);
    expect(canvas.linkAt(x, y)).toBe('nb1|alex|jen');
    canvas.destroy();
  });

  it('lays out nodes and reports the one under the pointer on click and hover', () => {
    const element = document.createElement('canvas');
    const hover = vi.fn();
    const click = vi.fn();
    const canvas = new GraphCanvas(element, { hover, click });
    canvas.resize(400, 300);
    canvas.setData(graph.nodes, graph.links);
    const internal = canvas as unknown as {
      nodes: CanvasNode[];
      simulation: { stop(): void; tick(n: number): void };
      transform: { apply(point: [number, number]): [number, number] };
    };
    internal.simulation.stop();
    internal.simulation.tick(200);
    const node = internal.nodes.find((n) => n.id === 'place:office')!;
    // The layout starts centered in the canvas.
    const [x, y] = internal.transform.apply([node.x!, node.y!]);

    expect(canvas.nodeAt(x, y)).toBe('place:office');
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(click).toHaveBeenCalled();
    canvas.destroy();
  });

  it('keeps positions when filtering, and handles 2,000 nodes', () => {
    const element = document.createElement('canvas');
    const canvas = new GraphCanvas(element, { hover: vi.fn(), click: vi.fn() });
    canvas.resize(800, 600);
    const many = Array.from({ length: 2000 }, (_, i) => ({
      id: `item:u:${i}`,
      kind: 'item' as const,
      source: 'mail' as const,
      label: `Item ${i}`,
    }));
    const links = many
      .slice(1)
      .map((node, i) =>
        line(`l${i}`, many[i % 50]!.id, node.id, [
          { kind: 'related', confidence: 0.8, evidence: 'Related', madeBy: 'model' },
        ]),
      );
    const start = performance.now();
    canvas.setData(many, links);
    const internal = canvas as unknown as {
      nodes: CanvasNode[];
      simulation: { stop(): void; tick(n: number): void };
    };
    internal.simulation.stop();
    internal.simulation.tick(30);
    expect(performance.now() - start).toBeLessThan(5000);
    const before = internal.nodes.find((n) => n.id === 'item:u:7')!;
    const [x, y] = [before.x, before.y];
    canvas.setData(many.slice(0, 100), links.slice(0, 50));
    const after = internal.nodes.find((n) => n.id === 'item:u:7')!;
    expect([after.x, after.y]).toEqual([x, y]);
    canvas.destroy();
  });
});
