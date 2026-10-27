import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import type { DataGraph, Page } from '@maple/shared';
import { GraphViewComponent } from './graph-view.component';
import { GraphCanvas, type CanvasNode } from './graph-canvas';
import { DataGraphService } from '../../services/data-graph.service';
import { PageService } from '../../services/page.service';
import { DialogService } from '../../components';

const day = 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);

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
    {
      id: 'nb1|a|b',
      source: 'item:u1:calendar:dentist',
      target: 'item:u1:location:visit',
      kind: 'created_at',
      confidence: 1,
      evidence: 'Created while at Bright Smiles Dental',
      madeBy: 'rule',
    },
    {
      id: 'nb1|c|d',
      source: 'item:u1:calendar:dentist',
      target: 'place:office',
      kind: 'at_place',
      confidence: 0.95,
      evidence: 'Event at Bright Smiles Dental',
      madeBy: 'rule',
    },
    {
      id: 'nb1|e|f',
      source: 'item:u1:mail:party',
      target: 'topic:soccer',
      kind: 'topic',
      confidence: 0.9,
      evidence: 'Part of Soccer season',
      madeBy: 'model',
    },
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

  it('removes a link after confirming', async () => {
    const fixture = render();
    fixture.componentInstance.select('item:u1:calendar:dentist');
    fixture.detectChanges();
    const remove = fixture.nativeElement.querySelector(
      '[aria-label="Remove link to Bright Smiles Dental"]',
    ) as HTMLButtonElement;
    remove.click();
    await fixture.whenStable();
    expect(dialog.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Remove this link?', confirmLabel: 'Remove' }),
    );
    expect(service.removeLink).toHaveBeenCalledWith('nb1|a|b');

    dialog.confirm.mockResolvedValueOnce(false);
    await fixture.componentInstance.removeLink(fixture.componentInstance.selectedLinks()[0]!);
    expect(service.removeLink).toHaveBeenCalledTimes(1);
  });

  it('explains an empty graph', () => {
    state.set({ ...graph, nodes: [], links: [], status: { modelLinks: true } });
    const fixture = render();
    expect(text(fixture)).toContain('Nothing linked yet.');
    expect(text(fixture)).toContain('Linking the last 30 days');
  });
});

describe('GraphCanvas', () => {
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
    const links = many.slice(1).map((node, i) => ({
      id: `l${i}`,
      source: many[i % 50]!.id,
      target: node.id,
      kind: 'related' as const,
      confidence: 0.8,
      evidence: 'Related',
      madeBy: 'model' as const,
    }));
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
