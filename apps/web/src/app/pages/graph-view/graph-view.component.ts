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
import type { DataGraphLink, DataGraphNode, DataGraphReason } from '@maple/shared';
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
  { key: 'health', label: 'Health' },
  { key: 'person', label: 'People' },
  { key: 'place', label: 'Places' },
  { key: 'topic', label: 'Topics' },
  { key: 'event', label: 'Happenings' },
];

/** What each kind of reason is called in the reasons panel. */
const REASON_KINDS: Record<DataGraphReason['kind'], string> = {
  relationship: 'Relationship',
  messages_with: 'Messages',
  emails_with: 'Email',
  met_with: 'Events together',
  created_at: 'Booked there',
  attended: 'Was there',
  at_place: 'Place',
  travel: 'Drive',
  attendee: 'Was there',
  related: 'Same thing',
  topic: 'Topic',
  part_of: 'About it',
  person: 'Person',
};

/** A line from the selected node, with the node at its other end. */
export interface NodeLink {
  link: DataGraphLink;
  other: DataGraphNode;
}

const DAY = 24 * 60 * 60;

/**
 * The Graph page: everything this notebook's data pages share, connected. Items, people,
 * places, topics and happenings are nodes, colored by kind. Two nodes are joined by one
 * line, thicker with more or stronger reasons (she's your wife, 214 messages, three
 * events together). Pan and zoom, hover to light up a node's neighbors, click a node for
 * its details or a line for every reason with its evidence, open an item or a contact,
 * and remove a reason on its own.
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
  /** Only this open view: hiding never changes graph data or shared links. */
  readonly hiddenTopicIds = signal<ReadonlySet<string>>(new Set());
  /** yyyy-mm-dd, or empty for no bound. */
  readonly fromDate = signal(localDay(new Date(Date.now() - 7 * DAY * 1000)));
  readonly toDate = signal('');
  readonly hoveredId = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  /** The line whose reasons are open (a node and a line aren't open at once). */
  readonly selectedLinkId = signal<string | null>(null);
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
    const hiddenTopics = this.hiddenTopicIds();
    const from = this.fromDate() ? Date.parse(`${this.fromDate()}T00:00:00`) / 1000 : null;
    const to = this.toDate() ? endOfLocalDay(this.toDate()) : null;
    const items = new Set(
      graph.nodes
        .filter((node) => node.kind === 'item' && !hidden.has(colorKey(node)))
        .filter((node) => {
          if (node.at === undefined) return true;
          if (from !== null && (node.endAt ?? node.at) < from) return false;
          return to === null || node.at <= to;
        })
        .map((node) => node.id),
    );
    const hubs = new Map(
      graph.nodes
        .filter(
          (node) => node.kind !== 'item' && !hidden.has(node.kind) && !hiddenTopics.has(node.id),
        )
        .map((node) => [node.id, node]),
    );
    const shown = (id: string) => items.has(id) || hubs.has(id);
    // Lines between two hubs (Jen and you) stay while some reason falls in the date range;
    // lasting ones (relationships) have no time and always stay.
    const inRange = (link: DataGraphLink) =>
      link.reasons.some(
        (reason) =>
          reason.lastAt === undefined ||
          ((from === null || reason.lastAt >= from) &&
            (to === null || (reason.firstAt ?? reason.lastAt) < to)),
      );
    const links = graph.links.filter(
      (link) =>
        shown(link.source) &&
        shown(link.target) &&
        (items.has(link.source) || items.has(link.target) || inRange(link)),
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
  /** The selected node's lines, strongest first. */
  readonly selectedLinks = computed<NodeLink[]>(() => {
    const id = this.selectedId();
    if (!id) return [];
    const byId = this.nodesById();
    return this.view()
      .links.filter((link) => link.source === id || link.target === id)
      .map((link) => ({ link, other: byId.get(link.source === id ? link.target : link.source)! }))
      .filter((entry) => !!entry.other)
      .sort((a, b) => b.link.weight - a.link.weight);
  });
  /** The open line, with its two ends. */
  readonly selectedLink = computed(() => {
    const id = this.selectedLinkId();
    if (!id) return null;
    const link = this.view().links.find((l) => l.id === id);
    const byId = this.nodesById();
    const source = link && byId.get(link.source);
    const target = link && byId.get(link.target);
    return link && source && target ? { link, source, target } : null;
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
    // A date change loads that window from the server, rather than downloading all history.
    effect(() => {
      const notebookId = this.notebookId();
      const from = this.fromDate() || localDay(new Date(Date.now() - 7 * DAY * 1000));
      const to = this.toDate();
      untracked(() => {
        if (notebookId)
          void this.service.load(notebookId, {
            from: Date.parse(`${from}T00:00:00`) / 1000,
            // Use the next local midnight, including across daylight-saving changes.
            ...(to ? { to: endOfLocalDay(to) } : {}),
          });
      });
    });
    effect(() => {
      this.notebookId();
      untracked(() => this.hiddenTopicIds.set(new Set()));
    });
    // Hand the filtered graph to the canvas; the canvas holds no signals.
    effect(() => {
      const { nodes, links } = this.view();
      untracked(() => this.canvas?.setData(nodes, links));
    });
    effect(() => {
      const hovered = this.hoveredId();
      const selected = this.selectedId();
      const link = this.selectedLinkId();
      untracked(() => this.canvas?.setFocus(hovered, selected, link));
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.canvasRef()?.nativeElement;
      const stage = this.stageRef()?.nativeElement;
      if (!element || !stage) return;
      this.canvas = new GraphCanvas(element, {
        hover: (id) => this.hoveredId.set(id),
        click: (id) => this.select(id),
        clickLink: (id) => this.selectLink(id),
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

  hideTopic(id: string): void {
    if (this.nodesById().get(id)?.kind !== 'topic') return;
    this.hiddenTopicIds.update((ids) => new Set([...ids, id]));
    if (this.hoveredId() === id) this.hoveredId.set(null);
    this.select(null);
  }

  showHiddenTopics(): void {
    this.hiddenTopicIds.set(new Set());
  }

  toggleKind(key: string): void {
    this.hiddenKinds.update((hidden) => {
      const next = new Set(hidden);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** The last `days` days, including upcoming events. */
  setRange(days: number): void {
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
    this.selectedLinkId.set(null);
    this.selectedId.set(id);
    if (id && center) this.canvas?.centerOn(id);
  }

  /** Opens a line's reasons. */
  selectLink(id: string | null): void {
    this.selectedId.set(null);
    this.selectedLinkId.set(id);
  }

  /** "Nurse, Albany Med". */
  workLine(node: DataGraphNode): string {
    return [node.jobTitle, node.organization].filter((part) => !!part).join(', ');
  }

  reasonKind(reason: DataGraphReason): string {
    if (reason.kind === 'relationship' && reason.type) {
      const type = reason.type.replace(/_/g, ' ');
      return type.charAt(0).toUpperCase() + type.slice(1);
    }
    return REASON_KINDS[reason.kind] ?? reason.kind;
  }

  /** How sure: certain (rules), "you said so" (About me), or the model's confidence. */
  reasonSource(reason: DataGraphReason): string {
    if (reason.madeBy === 'rule') return 'certain';
    if (reason.madeBy === 'user') return 'from About me';
    return `model, ${Math.round(reason.confidence * 100)}%`;
  }

  zoom(factor: number): void {
    this.canvas?.zoomBy(factor);
  }

  fit(): void {
    this.canvas?.fit();
  }

  /** Opens the data page that shows the item (or a person's contact card). */
  async open(node: Pick<DataGraphNode, 'pageId'>): Promise<void> {
    const notebookId = this.notebookId();
    if (!notebookId || !node.pageId) return;
    await this.router.navigate(['/', notebookId, node.pageId]);
  }

  /** Removes one reason a pair is connected; the line stays while it has others. */
  async removeReason(link: DataGraphLink, reason: DataGraphReason): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Remove this reason?',
      message: `“${reason.evidence}” won’t be linked again in this notebook.`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.service.removeReason(link.id, reason.id);
      if (!this.view().links.some((l) => l.id === link.id)) this.selectedLinkId.set(null);
    } catch {
      this.actionError.set('Could not remove it. Try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function endOfLocalDay(day: string): number {
  const next = new Date(`${day}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.getTime() / 1000 - 0.001;
}
