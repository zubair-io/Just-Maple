import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  input,
  effect,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  linkCount: number;
  tags?: string[];
  isCenter?: boolean;
  // D3 simulation properties
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: 'inline' | 'block' | 'tag' | 'hashtag' | 'mention';
  label?: string;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  linkEdges: number;
  hashtagEdges: number;
}

@Component({
  selector: 'app-connection-graph',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './connection-graph.component.html',
  styleUrl: './connection-graph.component.scss',
})
export class ConnectionGraphComponent implements AfterViewInit, OnDestroy {
  @ViewChild('graphContainer') graphContainer!: ElementRef<HTMLDivElement>;

  readonly nodes = input<GraphNode[]>([]);
  readonly edges = input<GraphEdge[]>([]);
  readonly stats = input<GraphStats | null>(null);

  readonly nodeClicked = output<string>();

  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private simulation: d3.Simulation<GraphNode, GraphEdge> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    // React to input changes
    effect(() => {
      const nodesData = this.nodes();
      const edgesData = this.edges();
      if (nodesData.length > 0 && this.graphContainer) {
        this.renderGraph(nodesData, edgesData);
      }
    });
  }

  ngAfterViewInit(): void {
    // Set up resize observer
    this.resizeObserver = new ResizeObserver(() => {
      if (this.nodes().length > 0) {
        this.renderGraph(this.nodes(), this.edges());
      }
    });
    this.resizeObserver.observe(this.graphContainer.nativeElement);
  }

  ngOnDestroy(): void {
    if (this.simulation) {
      this.simulation.stop();
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  private renderGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    const container = this.graphContainer.nativeElement;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 300;

    // Clear previous SVG
    d3.select(container).select('svg').remove();

    // Stop previous simulation
    if (this.simulation) {
      this.simulation.stop();
    }

    // Create deep copies to avoid mutating input data
    const nodesCopy: GraphNode[] = nodes.map((n) => ({ ...n }));
    const edgesCopy: GraphEdge[] = edges.map((e) => ({
      ...e,
      source: typeof e.source === 'string' ? e.source : e.source.id,
      target: typeof e.target === 'string' ? e.target : e.target.id,
    }));

    // Create SVG
    this.svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Add zoom behavior
    const g = this.svg.append('g');
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    this.svg.call(zoom);

    // Define arrow markers for directed edges
    const defs = this.svg.append('defs');
    defs
      .append('marker')
      .attr('id', 'arrowhead-link')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', 'var(--color-primary)');

    defs
      .append('marker')
      .attr('id', 'arrowhead-hashtag')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', 'var(--color-text-muted)');

    // Create force simulation
    this.simulation = d3
      .forceSimulation<GraphNode>(nodesCopy)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphEdge>(edgesCopy)
          .id((d) => d.id)
          .distance(80),
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Draw edges
    const link = g
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(edgesCopy)
      .join('line')
      .attr('class', (d) => `edge edge-${d.type}`)
      .attr('stroke', (d) => this.getEdgeColor(d.type))
      .attr('stroke-width', (d) => (d.type === 'inline' || d.type === 'block' ? 2 : 1))
      .attr('stroke-dasharray', (d) => (d.type === 'hashtag' ? '4,2' : 'none'))
      .attr('marker-end', (d) =>
        d.type === 'hashtag' ? 'url(#arrowhead-hashtag)' : 'url(#arrowhead-link)',
      );

    // Draw edge labels for hashtag connections
    const edgeLabels = g
      .append('g')
      .attr('class', 'edge-labels')
      .selectAll('text')
      .data(edgesCopy.filter((e) => e.label))
      .join('text')
      .attr('class', 'edge-label')
      .attr('font-size', '10px')
      .attr('fill', 'var(--color-text-muted)')
      .text((d) => d.label || '');

    // Draw nodes
    const node = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodesCopy)
      .join('g')
      .attr('class', (d) => `node node-${d.type}`)
      .style('cursor', 'pointer')
      .call(this.createDragBehavior() as any);

    // Node circles
    node
      .append('circle')
      .attr('r', (d) => this.getNodeRadius(d))
      .attr('fill', (d) => this.getNodeColor(d.type))
      .attr('stroke', 'var(--color-bg)')
      .attr('stroke-width', 2);

    // Node labels
    node
      .append('text')
      .text((d) => this.truncateLabel(d.label, 15))
      .attr('x', 0)
      .attr('y', (d) => this.getNodeRadius(d) + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'var(--color-text-main)');

    // Add tooltips
    node
      .append('title')
      .text(
        (d) =>
          `${d.label}\nType: ${d.type}\nConnections: ${d.linkCount}${d.tags?.length ? `\nTags: ${d.tags.join(', ')}` : ''}`,
      );

    // Handle click events
    node.on('click', (event, d) => {
      event.stopPropagation();
      this.nodeClicked.emit(d.id);
    });

    // Update positions on tick
    this.simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as GraphNode).x || 0)
        .attr('y1', (d) => (d.source as GraphNode).y || 0)
        .attr('x2', (d) => (d.target as GraphNode).x || 0)
        .attr('y2', (d) => (d.target as GraphNode).y || 0);

      edgeLabels
        .attr('x', (d) => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          return ((source.x || 0) + (target.x || 0)) / 2;
        })
        .attr('y', (d) => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          return ((source.y || 0) + (target.y || 0)) / 2 - 5;
        });

      node.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);
    });
  }

  private createDragBehavior(): d3.DragBehavior<
    Element,
    GraphNode,
    GraphNode | d3.SubjectPosition
  > {
    return d3
      .drag<Element, GraphNode>()
      .on('start', (event, d) => {
        if (!event.active) this.simulation?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) this.simulation?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  private getNodeRadius(node: GraphNode): number {
    // Base radius plus bonus for more connections
    const baseRadius = 8;
    const connectionBonus = Math.min(node.linkCount * 2, 10);
    return baseRadius + connectionBonus;
  }

  private getNodeColor(type: string): string {
    const colors: Record<string, string> = {
      memo: 'var(--color-primary)',
      whiteboard: '#10b981', // green
      message: '#3b82f6', // blue
      kanban: '#f59e0b', // amber
      collectable: '#8b5cf6', // purple
      recording: '#ef4444', // red
    };
    return colors[type] || 'var(--color-text-muted)';
  }

  private getEdgeColor(type: string): string {
    if (type === 'inline' || type === 'block') {
      return 'var(--color-primary)';
    }
    if (type === 'hashtag') {
      return 'var(--color-text-muted)';
    }
    return 'var(--color-border)';
  }

  private truncateLabel(label: string, maxLength: number): string {
    if (label.length <= maxLength) return label;
    return label.slice(0, maxLength - 1) + '...';
  }
}
