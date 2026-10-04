import { parseDocument } from 'yaml';
import type { Node as PMNode } from '@tiptap/pm/model';

export type CanvasColor = 'paper' | 'yellow' | 'green' | 'rose';
export interface CanvasPlacement { id: string; x: number; y: number; width: number; height: number; color: CanvasColor; group?: string; }
export interface CanvasGroup { id: string; title: string; x: number; y: number; width: number; height: number; folded: boolean; }
export interface CanvasConnection { id: string; from: string; to: string; label: string; }
export interface CanvasLayout { v: 1; cards: CanvasPlacement[]; groups: CanvasGroup[]; connections?: CanvasConnection[]; }
export interface CanvasCard extends CanvasPlacement { pos: number; size: number; label: string; type: string; eventID?: string; taskID?: string; }
export const emptyCanvas = (): CanvasLayout => ({ v: 1, cards: [], groups: [] });
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const coordinate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000;
const dimension = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 160 && value <= 4000;
const colors = new Set(['paper', 'yellow', 'green', 'rose']);
/** Layout contains identities and presentation only; writing stays in document blocks. */
export function validateCanvas(value: unknown): CanvasLayout {
  const data = value as CanvasLayout;
  const fail = () => { throw Error('Unsupported canvas layout. Its complete Markdown is preserved in source mode.'); };
  if (!data || data.v !== 1 || !Array.isArray(data.cards) || !Array.isArray(data.groups) || data.cards.length > 1024 || data.groups.length > 128 ||
      Object.keys(data).some(k => !['v', 'cards', 'groups', 'connections'].includes(k))) return fail();
  const ids = new Set<string>();
  for (const group of data.groups) {
    if (!group || !identity(group.id) || ids.has(group.id) || typeof group.title !== 'string' || group.title.length > 120 ||
        !coordinate(group.x) || !coordinate(group.y) || !dimension(group.width) || !dimension(group.height) || typeof group.folded !== 'boolean' ||
        Object.keys(group).some(k => !['id','title','x','y','width','height','folded'].includes(k))) return fail();
    ids.add(group.id);
  }
  const cardIDs = new Set<string>();
  for (const card of data.cards) {
    if (!card || !identity(card.id) || cardIDs.has(card.id) || !coordinate(card.x) || !coordinate(card.y) || !dimension(card.width) || !dimension(card.height) ||
        !colors.has(card.color) || (card.group !== undefined && !ids.has(card.group)) ||
        Object.keys(card).some(k => !['id','x','y','width','height','color','group'].includes(k))) return fail();
    cardIDs.add(card.id);
  }
  if (data.connections !== undefined) {
    if (!Array.isArray(data.connections) || data.connections.length > 2048) return fail();
    const links = new Set<string>(), pairs = new Set<string>();
    for (const link of data.connections) {
      if (!link || !identity(link.id) || links.has(link.id) || !cardIDs.has(link.from) || !cardIDs.has(link.to) || link.from === link.to ||
          typeof link.label !== 'string' || link.label.length > 120 || Object.keys(link).some(k => !['id','from','to','label'].includes(k))) return fail();
      const pair = JSON.stringify([link.from,link.to]);
      if (pairs.has(pair)) return fail();
      pairs.add(pair); links.add(link.id);
    }
  }
  return structuredClone(data);
}
export function readCanvas(prefix: string): CanvasLayout {
  if (!prefix) return emptyCanvas();
  const yaml = parseDocument(prefix.replace(/^(?:\uFEFF)?---\r?\n/, '').replace(/(?:---|\.\.\.)\r?\n$/, ''));
  if (yaml.errors.length) throw Error('Ambiguous frontmatter is preserved in Markdown mode.');
  const value = yaml.get('mapleCanvas', true);
  if (value === undefined) return emptyCanvas();
  // The v1 presentation field is one JSON line. Preserve unfamiliar representations.
  if (!/^mapleCanvas: \{[^\n]+\}\r?$/m.test(prefix)) throw Error('Unsupported canvas metadata representation. Review the original Markdown.');
  return validateCanvas(yaml.toJS().mapleCanvas);
}
export function writeCanvas(prefix: string, layout: CanvasLayout): string {
  readCanvas(prefix);
  const eol = prefix.includes('\r\n') ? '\r\n' : '\n';
  const line = 'mapleCanvas: ' + JSON.stringify(validateCanvas(layout)).replace(/</g, '\\u003c');
  if (!prefix) return `---\n${line}\n---\n`;
  if (/^mapleCanvas:/m.test(prefix)) return prefix.replace(/^mapleCanvas:[^\r\n]*/m, line);
  return prefix.replace(/(?:---|\.\.\.)\r?\n$/, `${line}${eol}$&`);
}
export const snap = (value: number) => Math.max(0, Math.min(100000, Math.round(value / 16) * 16));
export function canvasCards(doc: PMNode, layout: CanvasLayout): CanvasCard[] {
  const cards: CanvasCard[] = [];
  const saved = new Map(layout.cards.map(c => [c.id, c]));
  // New arrivals get their own shelf below existing placements; refresh never moves user work.
  const shelf = Math.max(32, ...layout.cards.map(c => c.y + c.height + 64), ...layout.groups.map(g => g.y + g.height + 64));
  let fresh = 0;
  doc.forEach((node, pos) => {
    const id = node.attrs['maple']?.id;
    if (typeof id !== 'string') return;
    const type = node.attrs['maple']?.kind ?? (node.type.name === 'paragraph' && /^@maple\b/i.test(node.textContent) ? 'maple-request' : node.type.name);
    const placement = saved.get(id) ?? { id, x: 32 + (fresh % 3) * 352, y: shelf + Math.floor(fresh / 3) * 336, width: 320, height: 272, color: type === 'paragraph' ? 'yellow' as const : 'paper' as const };
    if (!saved.has(id)) fresh++;
    cards.push({ ...placement, eventID: node.attrs['reference']?.eventID ?? node.attrs['maple']?.eventID, taskID: node.attrs['taskID'] ?? node.attrs['maple']?.taskID, pos, size: node.nodeSize, type, label: (node.textContent.trim() || node.attrs['reference']?.label || node.attrs['label'] || (type === 'sourceReference' ? 'Source ' + node.attrs['reference']?.eventID : type === 'blockquote' ? 'Writing note' : 'New sticky')).slice(0, 70) });
  });
  return cards;
}
export function rememberPlacements(layout: CanvasLayout, cards: CanvasCard[]): CanvasLayout {
  const saved = new Map(layout.cards.map(c => [c.id, c]));
  for (const { pos, size, label, type, eventID, taskID, ...placement } of cards) saved.set(placement.id, placement);
  return validateCanvas({ ...layout, cards: [...saved.values()] });
}
