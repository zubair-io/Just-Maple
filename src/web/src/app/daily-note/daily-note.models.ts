export type DailyBlockKind = 'text' | 'heading' | 'task' | 'email' | 'message' | 'code';
export interface DailyBlock {
  id: string; day: string; kind: DailyBlockKind; content: string; version: number; position: number;
  createdAt: number; updatedAt: number; actor: 'user' | 'bot'; userEdited: boolean;
  clearedAt?: number; completedAt?: number;
  source?: { key: string; eventID: string; connector: string; title?: string; sender?: string };
  taskNodeID?: string; taskVersion?: number;
}
export interface DailyNoteSnapshot {
  day: string; timeZone: string; blocks: DailyBlock[]; cleared: DailyBlock[]; revision: number;
  readOnly?: boolean;
  projection?: { remainingTasks: number };
  sync?: { readOnly?: boolean; status: 'cached' | 'pending' | 'conflict'; pending: string[]; conflicts: string[]; asOf: number; partial?: boolean };
}
export interface DailyBlockMutation {
  kind: 'create' | 'edit' | 'clear' | 'restore' | 'move' | 'complete';
  blockID: string; expectedVersion: number; requestID: string; day: string; timeZone: string;
  content?: string; blockKind?: DailyBlockKind; targetDay?: string; position?: number;
}
export interface DailyHistory { id: string; sequence: number; type: string; actor: string; recordedAt: number; before?: string; after?: string }
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function offsetDay(day: string, amount: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + amount, 12));
}
