import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import type { DataGraphLink, DataGraphNode } from '@maple/shared';
import { DataGraphService } from '../../services/data-graph.service';
import { PageService } from '../../services/page.service';
import { DialogService } from '../../components';
import { GraphCanvas, colorKey } from './graph-canvas';

/** One entry of the legend, which is also the kind filter. */
export interface GraphKind {
  key: string;
  label: string;
}

export const GRAPH_KINDS: GraphKind[] = [
  { key: 'mail', label: 'Email' },
  { key: 'imessage', label: 'Messages' },
  { key: 'calendar', label: 'Events' },
  { key: 'location', label: 'Visits' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'health', label: 'Health' },
  { key: 'person', label: 'People' },
  { key: 'place', label: 'Places' },
  { key: 'topic', label: 'Topics' },
];

/** A link from the selected node, with the node at its other end. */
export interface NodeLink {
  link: DataGraphLink;
  other: DataGraphNode;
}

const DAY = 24 * 60 * 60;

/**
 * The Graph page: everything this notebook's data pages share, linked. Items, people,
 * places and topics are nodes, colored by kind; links come from rules (same place and
 * time, one person) and the model (same plan, same topic). Pan and zoom, hover to light
 * up a node's neighbors, click for details, open the item or remove a link.
 */
@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  templateUrl: './graph-view.component.html',
  styleUrl: './graph-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphViewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);
  private readonly dialog = inject(DialogService);
  readonly service = inject(DataGraphService);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stageRef = viewChild<ElementRef<HTMLDivElement>>('stage');
  private canvas: GraphCanvas | null = null;

  private readonly pageId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });
  readonly page = computed(
    () => this.pageService.pages().find((page) => page.id === this.pageId()) ?? null,
  );
  private readonly notebookId = computed(() => this.page()?.notebookId ?? null);

  readonly kinds = GRAPH_KINDS;
  readonly hiddenKinds = signal<ReadonlySet<string>>(new Set());
  /** yyyy-mm-dd, or empty for no bound. */
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly hoveredId = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);

  /** Kinds present in the graph, for the legend. */
  readonly presentKinds = computed(() => {
    const present = new Set((this.service.graph()?.nodes ?? []).map(colorKey));
    return this.kinds.filter((kind) => present.has(kind.key));
  });

  /** The graph after the kind and date filters. Hubs stay only while linked to a shown item. */
  readonly view = computed(() => {
    const graph = this.service.graph();
    if (!graph) return { nodes: [] as DataGraphNode[], links: [] as DataGraphLink[] };
    const hidden = this.hiddenKinds();
    const from = this.fromDate() ? Date.parse(`${this.fromDate()}T00:00:00`) / 1000 : null;
    const to = this.toDate() ? Date.parse(`${this.toDate()}T00:00:00`) / 1000 + DAY : null;
    const items = new Set(
      graph.nodes
        .filter((node) => node.kind === 'item' && !hidden.has(colorKey(node)))
        .filter((node) => {
          if (node.at === undefined) return true;
          if (from !== null && (node.endAt ?? node.at) < from) return false;
          return to === null || node.at < to;
        })
        .map((node) => node.id),
    );
    const hubs = new Map(
      graph.nodes
        .filter((node) => node.kind !== 'item' && !hidden.has(node.kind))
        .map((node) => [node.id, node]),
    );
    const shown = (id: string) => items.has(id) || hubs.has(id);
    const links = graph.links.filter(
      (link) =>
        shown(link.source) &&
        shown(link.target) &&
        (items.has(link.source) || items.has(link.target)),
    );
    const linked = new Set(links.flatMap((link) => [link.source, link.target]));
    const nodes = graph.nodes.filter(
      (node) => items.has(node.id) || (hubs.has(node.id) && linked.has(node.id)),
    );
    return { nodes, links };
  });

  readonly nodesById = computed(
    () => new Map((this.service.graph()?.nodes ?? []).map((node) => [node.id, node])),
  );
  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? (this.nodesById().get(id) ?? null) : null;
  });
  /** The selected node's links, strongest first. */
  readonly selectedLinks = computed<NodeLink[]>(() => {
    const id = this.selectedId();
    if (!id) return [];
    const byId = this.nodesById();
    return this.view()
      .links.filter((link) => link.source === id || link.target === id)
      .map((link) => ({ link, other: byId.get(link.source === id ? link.target : link.source)! }))
      .filter((entry) => !!entry.other)
      .sort((a, b) => b.link.confidence - a.link.confidence);
  });
  /** The hovered node and its neighbors (the canvas lights them up). */
  readonly neighbors = computed(() => {
    const id = this.hoveredId() ?? this.selectedId();
    if (!id) return new Set<string>();
    const lit = new Set([id]);
    for (const link of this.view().links) {
      if (link.source === id) lit.add(link.target);
      if (link.target === id) lit.add(link.source);
    }
    return lit;
  });

  readonly summary = computed(() => {
    const { nodes, links } = this.view();
    const items = nodes.filter((node) => node.kind === 'item').length;
    return `${items} ${items === 1 ? 'item' : 'items'} · ${links.length} ${links.length === 1 ? 'link' : 'links'}`;
  });

  constructor() {
    // Load when the page's notebook is known; the load writes signals this doesn't read.
    effect(() => {
      const notebookId = this.notebookId();
      if (notebookId) untracked(() => void this.service.load(notebookId));
    });
    // Hand the filtered graph to the canvas; the canvas holds no signals.
    effect(() => {
      const { nodes, links } = this.view();
      untracked(() => this.canvas?.setData(nodes, links));
    });
    effect(() => {
      const hovered = this.hoveredId();
      const selected = this.selectedId();
      untracked(() => this.canvas?.setFocus(hovered, selected));
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.canvasRef()?.nativeElement;
      const stage = this.stageRef()?.nativeElement;
      if (!element || !stage) return;
      this.canvas = new GraphCanvas(element, {
        hover: (id) => this.hoveredId.set(id),
        click: (id) => this.selectedId.set(id),
      });
      const size = () => this.canvas?.resize(stage.clientWidth, stage.clientHeight);
      size();
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(size) : null;
      observer?.observe(stage);
      const { nodes, links } = untracked(() => this.view());
      this.canvas.setData(nodes, links);
      destroyRef.onDestroy(() => {
        observer?.disconnect();
        this.canvas?.destroy();
        this.canvas = null;
      });
    });
  }

  toggleKind(key: string): void {
    this.hiddenKinds.update((hidden) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** The last `days` days (and what's coming up), or everything. */
  setRange(days: number | null): void {
    if (days === null) {
      this.fromDate.set('');
      this.toDate.set('');
      return;
    }
    const from = new Date(Date.now() - days * DAY * 1000);
    this.fromDate.set(localDay(from));
    this.toDate.set('');
  }

  /** The colored dot for a kind (colors are CSS variables, so dark mode follows). */
  dotClass(key: string): string {
    return `graph-dot graph-dot-${key}`;
  }

  readonly colorKey = colorKey;

  kindLabel(node: DataGraphNode): string {
    return this.kinds.find((kind) => kind.key === colorKey(node))?.label ?? node.kind;
  }

  select(id: string | null, center = false): void {
    this.selectedId.set(id);
    if (id && center) this.canvas?.centerOn(id);
  }

  zoom(factor: number): void {
    this.canvas?.zoomBy(factor);
  }

  fit(): void {
    this.canvas?.fit();
  }

  /** Opens the data page that shows the item. */
  async open(node: DataGraphNode): Promise<void> {
    const notebookId = this.notebookId();
    if (!notebookId || !node.pageId) return;
    await this.router.navigate(['/', notebookId, node.pageId]);
  }

  async removeLink(entry: NodeLink): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Remove this link?',
      message: `“${entry.link.evidence}” won’t be linked again in this notebook.`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.service.removeLink(entry.link.id);
    } catch {
      this.actionError.set('Could not remove the link. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
