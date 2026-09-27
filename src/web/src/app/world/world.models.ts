export interface Activity {
  id: string;
  ownerID: string;
  name: string;
  purpose: string;
  kind: "area" | "pursuit";
  lifecycle: "active" | "paused" | "completed" | "archived";
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface Due {
  kind: "date" | "instant";
  date: string;
  instant?: number;
  timeZone: string;
}
export interface Condition {
  subject: string;
  property: string;
  value: string;
}
export type TaskStatus =
  "open" | "in_progress" | "waiting" | "completed" | "cancelled";
export interface TaskActionState {resurfaceAt?:number;reviewAt?:number;waitingOn?:string;lastMutationID:string;lastAction:string;lastMutationScope?:string}
export interface LifeTask {
  actionState?:TaskActionState;
  id: string;
  ownerID: string;
  title: string;
  description: string;
  status: TaskStatus;
  waitingReason: string;
  assignee: string;
  due?: Due;
  scheduled?: Due;
  place: string;
  people: string[];
  priority: number;
  conditions: Condition[];
  evidenceIDs: string[];
  activityIDs: string[];
  seriesID?: string;
  occurrenceKey?: string;
  completedAt?: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}
export interface StateClaim {
  id: string;
  subject: string;
  property: string;
  value: string;
  origin: string;
  confidence?: number;
  evidenceIDs: string[];
  observedAt: number;
  ingestedAt: number;
  validFrom: number;
  validUntil?: number;
  retracted: boolean;
  sourceAvailable: boolean;
  sourceQuote?: string;
  provider?: string;
  supersedes?: string;
  version: number;
}
export interface Projection {
  subject: string;
  property: string;
  status: "known" | "unknown" | "stale" | "conflicting";
  value?: string;
  candidates: StateClaim[];
  reason: string;
  revision: number;
  asOf: number;
}
export interface Property {
  key: string;
  label: string;
  lens: string;
  ttl?: number;
  durable: boolean;
  valueType: string;
}
export interface History {
  id: string;
  sequence: number;
  subjects: string[];
  type: string;
  effectiveAt: number;
  recordedAt: number;
  actor: string;
  before?: string;
  after?: string;
  correlationID: string;
}
export interface Suggestion {
  sourceSubject?: string;
  sourceSender?: string;
  id: string;
  candidate: LifeTask;
  eventID: string;
  fingerprint: string;
  sourceKey: string;
  quote: string;
  provider: string;
  confidence?: number;
  deadlineExplanation: string;
  reviewStatus: string;
  acceptedTaskID?: string;
  linkedTaskID?: string;
  possibleDuplicateIDs: string[];
  version: number;
  createdAt: number;
}
export interface Series {
  id: string;
  template: LifeTask;
  frequency: "daily" | "weekly";
  timeZone: string;
  startDate: string;
  endDate?: string;
  localTime: string;
  paused: boolean;
  version: number;
}
export interface Attention {
  id: string;
  taskID: string;
  taskVersion: number;
  category: string;
  reasonCodes: string[];
  explanation: string;
  rank: number;
  relevantAt?: number;
  stateIDs: string[];
}
export interface TaskRelation { duplicateID: string; primaryID: string; reason: string; evidenceIDs: string[] }
export interface TaskProgress { nodeID: string; status: TaskStatus; eventID: string; quote: string; reason: string; observedAt: number }
export interface WorldSnapshot {
  taskRelations?: TaskRelation[];
  taskProgress?: TaskProgress[];
  reconciliationFailures?: number;
  activityEvidence?: { activityID: string; suggestionID: string; eventID: string; reason: string; quote?: string; sourceKey?: string }[];
  discoveryFailures?: number;
  revision: number;
  asOf: number;
  activities: Activity[];
  tasks: LifeTask[];
  states: Projection[];
  suggestions: Suggestion[];
  series: Series[];
  attention: Attention[];
  history: History[];
  properties: Property[];
}
export const emptyWorld: WorldSnapshot = {
  revision: 0,
  asOf: 0,
  activities: [],
  tasks: [],
  states: [],
  suggestions: [],
  series: [],
  attention: [],
  history: [],
  properties: [],
};
export function newTask(): LifeTask {
  const now = Date.now() / 1000;
  return {
    id: crypto.randomUUID(),
    ownerID: "local",
    title: "",
    description: "",
    status: "open",
    waitingReason: "",
    assignee: "",
    place: "",
    people: [],
    priority: 0,
    conditions: [],
    evidenceIDs: [],
    activityIDs: [],
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}
export function newActivity(): Activity {
  const now = Date.now() / 1000;
  return {
    id: crypto.randomUUID(),
    ownerID: "local",
    name: "",
    purpose: "",
    kind: "area",
    lifecycle: "active",
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}
export const isOpen = (task: LifeTask) =>
  !["completed", "cancelled"].includes(task.status);
export function localDate(instant: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant * 1000));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function dateKey(due: Due): string {
  return due.kind === "date" ? due.date : localDate(due.instant!, due.timeZone);
}
export function dueLabel(due?: Due): string {
  if (!due) return "No date";
  if (due.kind === "date") return due.date;
  return new Intl.DateTimeFormat(undefined, {
    timeZone: due.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(due.instant! * 1000));
}
export function taskInFilter(
  task: LifeTask,
  filter: string,
  now: number,
): boolean {
  if (filter === "Completed") return task.status === "completed";
  if (filter === "Cancelled") return task.status === "cancelled";
  if (!isOpen(task)) return false;
  if (filter === "All open") return true;
  if (filter === "Waiting") return task.status === "waiting";
  const deferred=(task.actionState?.resurfaceAt ?? 0)>now;
  if (filter === "Later") return deferred;
  if (filter === "Needs you") return task.status !== "waiting" && !deferred;
  const due = task.due,
    scheduled = task.scheduled;
  if (filter === "Today")
    return !!(
      (due && dateKey(due) <= localDate(now, due.timeZone)) ||
      (scheduled && dateKey(scheduled) === localDate(now, scheduled.timeZone))
    );
  return !!(
    (due && dateKey(due) > localDate(now, due.timeZone)) ||
    (!due &&
      scheduled &&
      dateKey(scheduled) > localDate(now, scheduled.timeZone))
  );
}
