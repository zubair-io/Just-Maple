import * as d3 from 'd3';
import type { DataGraphLink, DataGraphNode } from '@maple/shared';

/** A node as the simulation moves it. */
export interface CanvasNode extends d3.SimulationNodeDatum {
  id: string;
  node: DataGraphNode;
  degree: number;
}

export interface CanvasLink extends d3.SimulationLinkDatum<CanvasNode> {
  id: string;
  link: DataGraphLink;
}

/** The color key of a node: its source for items, otherwise its kind. */
export function colorKey(node: DataGraphNode): string {
  return node.kind === 'item' ? (node.source ?? 'item') : node.kind;
}

const COLOR_KEYS = [
  'mail',
  'imessage',
  'calendar',
  'location',
  'contacts',
  'health',
  'item',
  'person',
  'place',
  'topic',
];

/**
 * Draws the graph on a canvas with a d3 force layout: pan and zoom with the mouse,
 * wheel or touch, hover and click report nodes back. Canvas (not SVG) so ~2,000 nodes
 * stay smooth. Colors come from CSS variables on the canvas (`--graph-<kind>`), so dark
 * mode follows the theme.
 */
export class GraphCanvas {
  private nodes: CanvasNode[] = [];
  private links: CanvasLink[] = [];
  private byId = new Map<string, CanvasNode>();
  private simulation: d3.Simulation<CanvasNode, CanvasLink> | null = null;
  private transform = d3.zoomIdentity;
  private zoom: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  private readonly context: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private frame = 0;
  private hovered: string | null = null;
  private selected: string | null = null;
  /** The focused node and its neighbors; everything else is dimmed. */
  private lit: Set<string> | null = null;
  private fitted = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: {
      hover: (id: string | null) => void;
      click: (id: string | null) => void;
    },
  ) {
    this.context = canvas.getContext?.('2d') ?? null;
    this.zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        this.transform = event.transform;
        // Once someone pans or zooms, the view is theirs: no automatic fit later.
        if (event.sourceEvent) this.fitted = true;
        this.requestDraw();
      });
    d3.select(canvas).call(this.zoom).on('dblclick.zoom', null);
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('mouseleave', this.onLeave);
    canvas.addEventListener('click', this.onClick);
  }

  /** New nodes and links; nodes already on screen keep their place. */
  setData(nodes: DataGraphNode[], links: DataGraphLink[]): void {
    const degree = new Map<string, number>();
    for (const link of links) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }
    const previous = this.byId;
    this.nodes = nodes.map((node) => {
      const old = previous.get(node.id);
      return {
        id: node.id,
        node,
        degree: degree.get(node.id) ?? 0,
        ...(old ? { x: old.x, y: old.y, vx: old.vx, vy: old.vy } : {}),
      };
    });
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    this.links = links
      .filter((link) => this.byId.has(link.source) && this.byId.has(link.target))
      .map((link) => ({ id: link.id, link, source: link.source, target: link.target }));

    this.simulation?.stop();
    const big = this.nodes.length > 800;
    this.simulation = d3
      .forceSimulation<CanvasNode, CanvasLink>(this.nodes)
      .force(
        'link',
        d3
          .forceLink<CanvasNode, CanvasLink>(this.links)
          .id((node) => node.id)
          .distance((link) => (link.link.kind === 'topic' || link.link.kind === 'person' ? 50 : 32))
          .strength(0.6),
      )
      .force(
        'charge',
        d3
          .forceManyBody<CanvasNode>()
          .strength(big ? -18 : -40)
          .theta(0.9)
          .distanceMax(big ? 250 : 400),
      )
      .force('x', d3.forceX(0).strength(0.04))
      .force('y', d3.forceY(0).strength(0.04))
      .force('collide', d3.forceCollide<CanvasNode>((node) => this.radius(node) + 1).iterations(1))
      .alphaDecay(big ? 0.05 : 0.03)
      .on('tick', () => {
        // Frame the graph once it has mostly settled, rather than after the last tick.
        if (!this.fitted && this.simulation!.alpha() < 0.1) this.fit();
        this.requestDraw();
      })
      .on('end', () => {
        if (!this.fitted) this.fit();
      });
    if (previous.size && nodes.every((node) => previous.has(node.id))) {
      // Only filtered: settle quickly instead of starting over.
      this.simulation.alpha(0.2);
    }
    this.requestDraw();
  }

  /** What's hovered and selected; their neighbors stay lit, the rest dims. */
  setFocus(hovered: string | null, selected: string | null): void {
    this.hovered = hovered;
    this.selected = selected;
    const focus = hovered ?? selected;
    if (!focus) {
      this.lit = null;
    } else {
      this.lit = new Set([focus]);
      for (const link of this.links) {
        const a = (link.source as CanvasNode).id ?? link.source;
        const b = (link.target as CanvasNode).id ?? link.target;
        if (a === focus) this.lit.add(b as string);
        if (b === focus) this.lit.add(a as string);
      }
    }
    this.requestDraw();
  }

  resize(width: number, height: number): void {
    const ratio = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // The layout grows around (0, 0): keep that in the middle until the first fit.
    if (!this.fitted) {
      d3.select(this.canvas).call(
        this.zoom.transform,
        d3.zoomIdentity.translate(width / 2, height / 2),
      );
    }
    this.requestDraw();
  }

  zoomBy(factor: number): void {
    d3.select(this.canvas).call(this.zoom.scaleBy, factor);
  }

  /** Frames every node. */
  fit(): void {
    if (!this.nodes.length || !this.width) return;
    this.fitted = true;
    const xs = this.nodes.map((node) => node.x ?? 0);
    const ys = this.nodes.map((node) => node.y ?? 0);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const scale = Math.min(
      4,
      0.9 / Math.max((maxX - minX + 40) / this.width, (maxY - minY + 40) / this.height),
    );
    const transform = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(scale)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    d3.select(this.canvas).call(this.zoom.transform, transform);
  }

  /** The node under a point in the canvas, if any. */
  nodeAt(offsetX: number, offsetY: number): string | null {
    const [x, y] = this.transform.invert([offsetX, offsetY]);
    let best: { id: string; distance: number } | null = null;
    for (const node of this.nodes) {
      const distance = Math.hypot((node.x ?? 0) - x, (node.y ?? 0) - y);
      const reach = this.radius(node) + 4 / this.transform.k;
      if (distance <= reach && (!best || distance < best.distance))
        best = { id: node.id, distance };
    }
    return best?.id ?? null;
  }

  /** Centers a node (after a click in the details panel). */
  centerOn(id: string): void {
    const node = this.byId.get(id);
    if (!node || !this.width) return;
    const k = Math.max(this.transform.k, 1.2);
    d3.select(this.canvas)
      .transition()
      .duration(300)
      .call(
        this.zoom.transform,
        d3.zoomIdentity
          .translate(this.width / 2, this.height / 2)
          .scale(k)
          .translate(-(node.x ?? 0), -(node.y ?? 0)),
      );
  }

  destroy(): void {
    this.simulation?.stop();
    cancelAnimationFrame(this.frame);
    d3.select(this.canvas).on('.zoom', null);
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('mouseleave', this.onLeave);
    this.canvas.removeEventListener('click', this.onClick);
  }

  private readonly onMove = (event: MouseEvent) => {
    const id = this.nodeAt(event.offsetX, event.offsetY);
    this.canvas.style.cursor = id ? 'pointer' : 'grab';
    if (id !== this.hovered) this.events.hover(id);
  };

  private readonly onLeave = () => this.events.hover(null);

  private readonly onClick = (event: MouseEvent) => {
    this.events.click(this.nodeAt(event.offsetX, event.offsetY));
  };

  private radius(node: CanvasNode): number {
    if (node.node.kind === 'item') return 4 + Math.min(node.degree, 6) * 0.4;
    return 6 + Math.min(Math.sqrt(node.degree) * 1.6, 12);
  }

  private requestDraw(): void {
    if (this.frame || !this.context) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private palette(): Record<string, string> {
    const style = getComputedStyle(this.canvas);
    const read = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    const colors: Record<string, string> = {
      edge: read('--graph-edge', '#a8a29e'),
      edgeLit: read('--graph-edge-lit', '#57534e'),
      label: read('--graph-label', '#292524'),
      halo: read('--graph-halo', '#fdfbf7'),
      ring: read('--graph-ring', '#d94e3b'),
    };
    for (const key of COLOR_KEYS) colors[key] = read(`--graph-${key}`, '#78716c');
    return colors;
  }

  private draw(): void {
    const ctx = this.context;
    if (!ctx) return;
    const colors = this.palette();
    const ratio = this.canvas.width / Math.max(this.width, 1);
    const { k, x, y } = this.transform;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(ratio * k, 0, 0, ratio * k, ratio * x, ratio * y);

    const lit = this.lit;
    const focus = this.hovered ?? this.selected;
    // Links: dimmed unless they touch the focus; the model's are dashed.
    ctx.lineWidth = 1 / k;
    for (const link of this.links) {
      const a = link.source as CanvasNode;
      const b = link.target as CanvasNode;
      const on = !lit || a.id === focus || b.id === focus;
      ctx.globalAlpha = on ? (lit ? 0.9 : 0.45) : 0.08;
      ctx.strokeStyle = lit && on ? colors['edgeLit']! : colors['edge']!;
      ctx.setLineDash(link.link.madeBy === 'model' ? [3 / k, 3 / k] : []);
      ctx.beginPath();
      ctx.moveTo(a.x ?? 0, a.y ?? 0);
      ctx.lineTo(b.x ?? 0, b.y ?? 0);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const node of this.nodes) {
      const on = !lit || lit.has(node.id);
      ctx.globalAlpha = on ? 1 : 0.15;
      ctx.fillStyle = colors[colorKey(node.node)] ?? colors['item']!;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, this.radius(node), 0, Math.PI * 2);
      ctx.fill();
      if (node.id === this.selected) {
        ctx.strokeStyle = colors['ring']!;
        ctx.lineWidth = 2.5 / k;
        ctx.stroke();
      }
    }

    // Labels: hubs once zoomed in a little, items once zoomed in more, and the focus always.
    ctx.globalAlpha = 1;
    ctx.font = `${12 / k}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = colors['halo']!;
    ctx.fillStyle = colors['label']!;
    for (const node of this.nodes) {
      const hub = node.node.kind !== 'item';
      const show = lit ? lit.has(node.id) : hub ? k >= 0.7 : k >= 1.8;
      if (!show) continue;
      const text =
        node.node.label.length > 32 ? `${node.node.label.slice(0, 31)}…` : node.node.label;
      const top = (node.y ?? 0) + this.radius(node) + 2 / k;
      ctx.strokeText(text, node.x ?? 0, top);
      ctx.fillText(text, node.x ?? 0, top);
    }
  }
}
