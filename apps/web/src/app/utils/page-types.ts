/**
 * Shared utilities for page type styling and labeling.
 * Used across connection graph, chat view, and other components.
 */

export type PageType = 'memo' | 'whiteboard' | 'message' | 'kanban' | 'collectable' | 'recording';

/**
 * Display labels for page types
 */
export const PAGE_TYPE_LABELS: Record<string, string> = {
  memo: 'Memos',
  message: 'Messages',
  whiteboard: 'Whiteboards',
  collectable: 'Collectables',
  kanban: 'Kanban Boards',
  recording: 'Recordings',
};

/**
 * Material icons for page types
 */
export const PAGE_TYPE_ICONS: Record<string, string> = {
  memo: 'edit_note',
  message: 'chat',
  whiteboard: 'draw',
  collectable: 'grid_view',
  kanban: 'view_kanban',
  recording: 'mic',
};

/**
 * Colors for page types (used in graphs and visualizations)
 */
export const PAGE_TYPE_COLORS: Record<string, string> = {
  memo: 'var(--color-primary)',
  whiteboard: '#10b981', // green
  message: '#3b82f6', // blue
  kanban: '#f59e0b', // amber
  collectable: '#8b5cf6', // purple
  recording: '#ef4444', // red
};

/**
 * Get display label for a page type
 */
export function getPageTypeLabel(type: string): string {
  return PAGE_TYPE_LABELS[type] || type;
}

/**
 * Get Material icon name for a page type
 */
export function getPageTypeIcon(type: string): string {
  return PAGE_TYPE_ICONS[type] || 'description';
}

/**
 * Get color for a page type (for graphs and visualizations)
 */
export function getPageTypeColor(type: string): string {
  return PAGE_TYPE_COLORS[type] || 'var(--color-text-muted)';
}

/**
 * Connection edge types
 */
export type ConnectionEdgeType = 'inline' | 'block' | 'tag' | 'hashtag' | 'mention';

/**
 * Get color for a connection edge type
 */
export function getEdgeColor(type: ConnectionEdgeType | string): string {
  if (type === 'inline' || type === 'block') {
    return 'var(--color-primary)';
  }
  if (type === 'hashtag') {
    return 'var(--color-text-muted)';
  }
  return 'var(--color-border)';
}

/**
 * Graph visualization constants
 */
export const GRAPH_CONSTANTS = {
  NODE_BASE_RADIUS: 8,
  NODE_MAX_CONNECTION_BONUS: 10,
  NODE_CONNECTION_BONUS_MULTIPLIER: 2,
  LABEL_MAX_LENGTH: 15,
  FORCE_LINK_DISTANCE: 80,
  FORCE_CHARGE_STRENGTH: -200,
  FORCE_COLLISION_RADIUS: 30,
  ZOOM_EXTENT: [0.1, 4] as [number, number],
};

/**
 * Calculate node radius based on connection count
 */
export function getNodeRadius(linkCount: number): number {
  const connectionBonus = Math.min(
    linkCount * GRAPH_CONSTANTS.NODE_CONNECTION_BONUS_MULTIPLIER,
    GRAPH_CONSTANTS.NODE_MAX_CONNECTION_BONUS,
  );
  return GRAPH_CONSTANTS.NODE_BASE_RADIUS + connectionBonus;
}

/**
 * Truncate a label to max length with ellipsis
 */
export function truncateLabel(
  label: string,
  maxLength: number = GRAPH_CONSTANTS.LABEL_MAX_LENGTH,
): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 1) + '...';
}
