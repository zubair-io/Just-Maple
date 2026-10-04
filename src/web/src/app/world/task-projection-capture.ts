import { rankTasks, RankedTask } from './task-ranking';
import { LifeTask, taskInFilter, WorldSnapshot } from './world.models';

export interface CurrentTaskProjectionInput {
  /** The exact currently accepted WorldService.data() value, not a reconstructed historical world. */
  world: WorldSnapshot;
  expectedWorldRevision: number;
  /** Caller-supplied SHA-256 of its world artifact. This helper does not verify that external artifact. */
  worldHash: string;
  /** Explicit collection time with UTC offset. Filtering still uses world.asOf, exactly as the UI does. */
  capturedAt: string;
  loaded: boolean;
  /** A pending local UI mutation blocks capture. Pending pipeline work is not hidden or claimed complete. */
  pending: boolean;
  scope: 'unfiltered-task-tabs';
}
export interface CapturedTaskRow {
  readonly rankedNode: { readonly id: string; readonly version: number };
  /** Matches RankedTaskRowsComponent's data-task-id/data-suggestion-id and detail target. */
  readonly renderedRow: { readonly id: string; readonly version: number };
  readonly sourceEventIDs: readonly string[];
}
export interface CurrentTaskProjection {
  readonly schemaVersion: 1;
  readonly kind: 'current-ui-task-projection';
  readonly currentOnly: true;
  readonly scope: 'unfiltered-task-tabs';
  readonly visibility: 'tab-membership-not-viewport';
  readonly capturedAt: string;
  readonly world: {
    readonly revision: number;
    readonly asOf: string;
    readonly hash: { readonly algorithm: 'SHA-256'; readonly value: string; readonly verified: false; readonly source: 'caller-supplied' };
  };
  readonly surfaces: {
    readonly needsYou: readonly CapturedTaskRow[];
    readonly waiting: readonly CapturedTaskRow[];
    readonly later: readonly CapturedTaskRow[];
  };
  readonly topTenNeedsYou: readonly CapturedTaskRow[];
}
export interface DigestedTaskProjection {
  readonly projection: CurrentTaskProjection;
  /** SHA-256 of canonicalTaskProjectionJSON(projection), not a claim about the external world hash. */
  readonly integrity: { readonly algorithm: 'SHA-256'; readonly canonicalization: 'sorted-object-keys-v1'; readonly digest: string };
}
export class TaskProjectionCaptureError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskProjectionCaptureError'; }
}
const invalid = (reason: string): never => { throw new TaskProjectionCaptureError(reason); };
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
const identity = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const statuses = new Set(['open', 'in_progress', 'waiting', 'completed', 'cancelled']);
function uniqueIDs(values: readonly { id: string }[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (!identity(value.id) || seen.has(value.id)) invalid(`Invalid or duplicate ${label} identity.`);
    seen.add(value.id);
  }
}
function validateTask(task: LifeTask) {
  if (!task || !identity(task.id) || !integer(task.version) || !statuses.has(task.status) ||
      !Number.isFinite(task.createdAt) || !Number.isFinite(task.priority) ||
      !Array.isArray(task.conditions) || !Array.isArray(task.activityIDs) ||
      !Array.isArray(task.evidenceIDs) || task.evidenceIDs.some(id => !identity(id)) ||
      (task.actionState?.resurfaceAt !== undefined && !Number.isFinite(task.actionState.resurfaceAt)))
    invalid('Task data is incomplete or invalid; do not treat it as an empty projection.');
  for (const due of [task.due, task.scheduled]) {
    if (!due) continue;
    if (!['date', 'instant'].includes(due.kind) || !identity(due.timeZone) ||
        (due.kind === 'instant' && !Number.isFinite(due.instant))) invalid('Invalid task timing.');
    if (due.kind === 'date') {
      const timestamp = Date.parse(due.date + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due.date) || !Number.isFinite(timestamp) ||
          new Date(timestamp).toISOString().slice(0, 10) !== due.date) invalid('Invalid task date.');
    }
    try { new Intl.DateTimeFormat('en-US', { timeZone: due.timeZone }); }
    catch { invalid('Invalid task time zone.'); }
  }
}
function row(item: RankedTask): CapturedTaskRow {
  const version = item.id.startsWith('source:') ? item.suggestion?.version : item.task.version;
  if (version === undefined || !integer(version)) return invalid('A projected task has no valid version.');
  return {
    rankedNode: { id: item.id, version },
    renderedRow: item.suggestion ? { id: 'source:' + item.suggestion.id, version: item.suggestion.version } : { id: 'task:' + item.task.id, version: item.task.version },
    sourceEventIDs: [...item.task.evidenceIDs],
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/**
 * Side-effect-free current projection capture. Reuses the exact TasksComponent ranking/filter helpers.
 * It captures all members of the three unfiltered tabs; it does not claim they are simultaneously
 * visible, recreate historical UI, capture Today block order, or certify whole-pipeline coverage.
 * Reviewed groups collapse only All open, which is deliberately outside this capture scope.
 *
 * Integration: an explicit local collector must read bridge.loaded/pending and WorldService.data()
 * together, retain that exact world artifact, and pass its revision/hash and collection time here.
 * Persist this result privately alongside the source/attempt/completion collector, then independently
 * map sampled identities to the evaluation manifest. The explicit Processing quality-capture
 * workflow wires this helper to a native local save; this helper itself performs no export.
 */
export function captureCurrentTaskProjection(input: CurrentTaskProjectionInput): CurrentTaskProjection {
  if (input.loaded !== true || input.pending !== false) invalid('Wait for a loaded UI with no pending local mutation.');
  if (input.scope !== 'unfiltered-task-tabs') invalid('Only the unfiltered task tabs are supported.');
  const timestamp = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(input.capturedAt);
  if (!timestamp) invalid('Capture time needs an explicit UTC offset.');
  const parts = timestamp!;
  const day = Date.parse(parts[1] + 'T00:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== parts[1] ||
      Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59 ||
      (parts[5] !== 'Z' && (Number(parts[6]) > 23 || Number(parts[7]) > 59)))
    invalid('Capture time has an invalid calendar day, time or UTC offset.');
  const at = Date.parse(input.capturedAt), world = input.world;
  if (!Number.isFinite(at) || !world || !integer(world.revision) || !integer(input.expectedWorldRevision) ||
      world.revision !== input.expectedWorldRevision) invalid('The current world revision does not match the capture.');
  if (!Number.isFinite(world.asOf) || !Number.isFinite(new Date(world.asOf * 1000).getTime()) || world.asOf * 1000 > at)
    invalid('World time is invalid or later than collection time.');
  if (!/^[a-fA-F0-9]{64}$/.test(input.worldHash)) invalid('Provide the external world artifact SHA-256.');
  for (const field of ['tasks', 'suggestions', 'states'] as const) {
    if (!Array.isArray(world[field])) invalid('The current world is incomplete.');
  }
  uniqueIDs(world.tasks, 'task'); uniqueIDs(world.suggestions, 'suggestion');
  world.tasks.forEach(validateTask);
  for (const suggestion of world.suggestions) {
    if (!integer(suggestion.version) || !identity(suggestion.eventID)) invalid('Invalid suggestion version or evidence identity.');
    validateTask(suggestion.candidate);
  }
  if (world.taskRelations) {
    const destinations = new Map<string, string>();
    for (const relation of world.taskRelations) {
      if (!identity(relation.duplicateID) || !identity(relation.primaryID) || destinations.has(relation.duplicateID)) invalid('Duplicate or conflicting reconciliation identity.');
      destinations.set(relation.duplicateID, relation.primaryID);
    }
    for (const start of destinations.keys()) {
      const seen = new Set<string>(); let next: string | undefined = start;
      while (next && destinations.has(next)) {
        if (seen.has(next)) invalid('Cyclic reconciliation identities cannot be captured.');
        seen.add(next); next = destinations.get(next);
      }
    }
  }
  let ranked: RankedTask[];
  try { ranked = rankTasks(world); }
  catch { return invalid('The current task projection could not be evaluated.'); }
  uniqueIDs(ranked, 'projected task');
  const rows = new Map(ranked.map(item => [item.id, row(item)]));
  uniqueIDs([...rows.values()].map(item => item.renderedRow), 'rendered row');
  const surface = (filter: string) => ranked.filter(item => taskInFilter(item.task, filter, world.asOf)).map(item => rows.get(item.id)!);
  const needsYou = surface('Needs you'), waiting = surface('Waiting'), later = surface('Later');
  // Preserve actual UI overlap (e.g. Waiting with resurfaceAt also appears in Later).
  return freeze({ schemaVersion: 1, kind: 'current-ui-task-projection', currentOnly: true,
    scope: 'unfiltered-task-tabs', visibility: 'tab-membership-not-viewport', capturedAt: new Date(at).toISOString(),
    world: { revision: world.revision, asOf: new Date(world.asOf * 1000).toISOString(),
      hash: { algorithm: 'SHA-256', value: input.worldHash.toLowerCase(), verified: false, source: 'caller-supplied' } },
    surfaces: { needsYou, waiting, later }, topTenNeedsYou: needsYou.slice(0, 10),
  });
}
/** Deterministic UTF-8 body for integrity checks; array order is the UI order. */
export function canonicalTaskProjectionJSON(projection: CurrentTaskProjection): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)])) : value;
  return JSON.stringify(canonical(projection));
}
/** Optional local integrity envelope. No network, storage, bridge, provider or clock calls. */
export async function captureDigestedCurrentTaskProjection(input: CurrentTaskProjectionInput): Promise<DigestedTaskProjection> {
  // Freeze before the await so a subsequent UI snapshot cannot change this capture.
  const projection = captureCurrentTaskProjection(input);
  const bytes = new TextEncoder().encode(canonicalTaskProjectionJSON(projection));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return freeze({ projection, integrity: { algorithm: 'SHA-256', canonicalization: 'sorted-object-keys-v1',
    digest: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') } });
}
