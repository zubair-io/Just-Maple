import { SourceEvidence } from '../sources/source.models';
import type {
  WorldSnapshot,
  Activity,
  LifeTask,
  StateClaim,
  Series,
  History,
} from "../world/world.models";
import { Injectable, OnDestroy, signal } from "@angular/core";

export interface Fact {
  id: string;
  subject: string;
  predicate: string;
  value: string;
  sourceQuote: string;
  provider: string;
  eventID: string;
}
export interface Claim {
  id: string;
  subject: string;
  predicate: string;
  value: string;
  origin: string;
}
export interface Person {
  id: string;
  name: string;
  relationship: string;
  source: string;
  reason: string;
  pinned: boolean;
  lastInteraction?: number;
}
export interface SourceEvent {
  id: string;
  content: string;
  type: string;
  source: { connector: string };
}
export interface CalendarEvent {
  id: string;
  name: string;
  content: string;
  start: number;
  end: number;
  scopeID?: string;
}
export interface Choice {
  id: string;
  name: string;
  account?: string;
  timeZone?: string;
}
export interface Decision {
  eventID: string;
  route: string;
  policyVersion: string;
  explanation: string[];
  createdAt: number;
  context: { event: SourceEvent };
}
export interface Work {
  id: string;
  eventID: string;
  kind: string;
  status: string;
}
export interface Job {
  eventID: string;
  status: string;
  attempts: number;
  error?: string;
}
export interface Snapshot {
  companionCloudEnabled: boolean;
  companionStatus: string;
  companionPaired: boolean;
  extractionProvider?:string;
  providerStatus?:Record<string,string>;
  providerTesting?:boolean;
  testedProviders?:string[];
  localIndex?: {indexed:number;pending:number;failed:number;chunks:number;statePending:number;stateFailed:number;stateCompleted:number;model:string};
  localIntelligenceStatus?:string;
  auditRunning?:boolean; auditStatus?:string;
  world?: WorldSnapshot | null;
  taskExtractionQueue?: Job[];
  loaded: boolean;
  step: number;
  name: string;
  connected: boolean;
  running: boolean;
  busy: boolean;
  message: string;
  error: string;
  count: number;
  importantPeople: Person[];
  claims: Claim[];
  facts: Fact[];
  prompts: Record<string, string>;
  decisions: Decision[];
  work: Work[];
  queue: Job[];
  factQueue: Job[];
  calendarChoices: Choice[];
  selectedCalendarIDs: string[];
  appleCalendar: CalendarEvent[];
  googleConfigured: boolean;
  googleAccount: string;
  googleConnected: boolean;
  googleBusy: boolean;
  googleStatus: string;
  googleMailEnabled: boolean;
  googleCalendarEnabled: boolean;
  googleContactsEnabled: boolean;
  googleContactsGranted: boolean;
  googleContactsStatus: string;
  googleMailStatus: string;
  googleCalendarStatus: string;
  googleCalendars: Choice[];
  selectedGoogleCalendarIDs: string[];
  googleCalendar: CalendarEvent[];
  homeURL: string;
  homeEnabled: boolean;
  homeHasToken: boolean;
  homeExposedOnly: boolean;
  homeStatus: string;
  homeImporting: boolean;
  homeEntities: Choice[];
  selectedHomeEntities: string[];
  contactsEnabled: boolean;
  calendarEnabled: boolean;
  appleImporting: boolean;
  contactsStatus: string;
  calendarStatus: string;
  resume: string;
  messagesEnabled: boolean;
  messagesStatus: string;
  messagesError: string;
  extractor: string;
}
export type SimpleAction =
  | "snapshot"
  | "disconnect"
  | "unlockKey"
  | "loop"
  | "resume"
  | "importNote"
  | "googleConfigure"
  | "googleConnect"
  | "googleCancel"
  | "googleUnlock"
  | "googleDisconnect"
  | "googlePoll"
  | "googleCalendarList"
  | "googleContactsPause"
  | "googleContactsResume"
  | "googleMailPause"
  | "googleMailResume"
  | "googleCalendarPause"
  | "googleCalendarResume"
  | "calendarList"
  | "homeUnlock"
  | "homePoll"
  | "homePause"
  | "homeResume"
  | "contacts"
  | "calendar"
  | "pauseContacts"
  | "pauseCalendar"
  | "pollContacts"
  | "pollCalendar"
  | "contactsSettings"
  | "calendarSettings"
  | "messages"
  | "pauseMessages"
  | "poll"
  | "retry"
  | "retryFacts"
  | "clearError"
  | "diskAccess"
  | "showApp";
export type Command =
  | { action: "applyTaskAction"; id:string; change:{kind:string;issuedAt:number;resurfaceAt?:number;reviewAt?:number;waitingOn?:string;targetMutationID?:string}; expectedVersion:number; requestID:string }
  | { action: "correctTaskInference"; id: string; status?: import("../world/world.models").TaskStatus; separate?: boolean; expectedVersion: number; requestID: string }
  | { action: "regroupActivity"; id: string; record: Activity; ids: string[]; merge: boolean; expectedVersion: number; requestID: string }
  | { action: "removeActivity"; id: string; expectedVersion: number; requestID: string }
  | {
      action: "saveActivity";
      record: Activity;
      expectedVersion: number;
      requestID: string;
    }
  | {
      action: "saveTask";
      record: LifeTask;
      expectedVersion: number;
      requestID: string;
    }
  | {
      action: "saveSeries";
      record: Series;
      expectedVersion: number;
      requestID: string;
    }
  | {
      action: "correctState";
      record: StateClaim;
      expectedVersion: number;
      requestID: string;
    }
  | {
      action: "reviewSuggestion";
      id: string;
      decision: string;
      record?: LifeTask;
      expectedVersion: number;
      expectedTaskVersion?: number;
      requestID: string;
    }
  | {
      action: "acknowledgeAttention";
      id: string;
      until?: number;
      expectedVersion: number;
      requestID: string;
    }
  | { action: "extractTasks"; id: string }
  | { action: "providerTest" | "providerSelect"; provider: string }
  | { action: SimpleAction }
  | { action: "step"; value: number }
  | { action: "introduce"; name: string }
  | { action: "connect"; key: string }
  | { action: "capture"; text: string }
  | {
      action: "calendarSelection" | "googleCalendarSelection" | "homeSelection";
      ids: string[];
    }
  | { action: "homeConnect"; url: string; token: string }
  | { action: "homeExposure"; enabled: boolean }
  | { action: "pinPerson"; id: string; pinned: boolean }
  | { action: "checkFacts" | "dismiss"; id: string }
  | { action: "answer"; id: string; text: string }
  | { action: "person"; id?: string; name: string; relationship: string }
  | { action: "correct"; id: string; value: string };
export const emptySnapshot: Snapshot = {
  companionCloudEnabled: true,
  companionStatus: "Checking iCloud…",
  companionPaired: false,
  loaded: false,
  step: 0,
  name: "",
  connected: false,
  running: false,
  busy: false,
  message: "",
  error: "",
  count: 0,
  importantPeople: [],
  claims: [],
  facts: [],
  prompts: {},
  decisions: [],
  work: [],
  queue: [],
  factQueue: [],
  calendarChoices: [],
  selectedCalendarIDs: [],
  appleCalendar: [],
  googleConfigured: false,
  googleAccount: "",
  googleConnected: false,
  googleBusy: false,
  googleStatus: "",
  googleMailEnabled: false,
  googleCalendarEnabled: false,
  googleContactsEnabled: false,
  googleContactsGranted: false,
  googleContactsStatus: "",
  googleMailStatus: "",
  googleCalendarStatus: "",
  googleCalendars: [],
  selectedGoogleCalendarIDs: [],
  googleCalendar: [],
  homeURL: "",
  homeEnabled: false,
  homeHasToken: false,
  homeExposedOnly: true,
  homeStatus: "",
  homeImporting: false,
  homeEntities: [],
  selectedHomeEntities: [],
  contactsEnabled: false,
  calendarEnabled: false,
  appleImporting: false,
  contactsStatus: "",
  calendarStatus: "",
  resume: "",
  messagesEnabled: false,
  messagesStatus: "",
  messagesError: "",
  extractor: "",
};
interface NativeWindow extends Window {
  webkit?: {
    messageHandlers?: {
      maple?: { postMessage(body: unknown): Promise<unknown> };
    };
  };
}
@Injectable({ providedIn: "root" })
export class NativeBridge implements OnDestroy {
  readonly state = signal<Snapshot>(emptySnapshot);
  readonly error = signal("");
  readonly pending = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  // One queue for reads and writes prevents an older poll overwriting a command result.
  private tail: Promise<unknown> = Promise.resolve();
  private started = false;
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.poll();
  }
  private async poll(): Promise<void> {
    try {
      await this.command({ action: "snapshot" });
    } catch {}
    if (!this.destroyed) this.timer = setTimeout(() => void this.poll(), 2000);
  }
  private request<T>(body: unknown): Promise<T> {
    const run = this.tail.then(async () => {
      const handler = (window as NativeWindow).webkit?.messageHandlers?.maple;
      if (!handler)
        throw new Error(
          "Open Just Maple from Xcode to connect this UI to your local workspace.",
        );
      return (await handler.postMessage(body)) as T;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
  async command(command: Command): Promise<Snapshot> {
    try {
      const next = await this.request<Snapshot>(command);
      if (!next || typeof next.loaded !== "boolean")
        throw new Error("Invalid native snapshot.");
      this.state.set(next);
      this.error.set("");
      return next;
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }
  async act(command: Command): Promise<boolean> {
    this.pending.set(true);
    try {
      const next = await this.command(command);
      return !next.error;
    } catch {
      return false;
    } finally {
      this.pending.set(false);
    }
  }
  async history(before?: number, subjects: string[] = []): Promise<History[]> {
    return this.query({ action: "worldHistory", before, subjects });
  }
  async search(query: string): Promise<SourceEvent[]> {
    return this.query({ action: "search", query });
  }
  async people(query: string): Promise<Person[]> {
    return this.query({ action: "peopleSearch", query });
  }
  async inspectSource(id:string):Promise<SourceEvidence> { return this.query({action:'sourceInspect',id}); }
  async copySource(text:string):Promise<{copied:boolean}> { return this.query({action:'copySource',text}); }
  async evidence(id: string): Promise<SourceEvent | null> {
    return this.query({ action: "evidence", id });
  }
  async group<T>(body: Record<string, unknown>): Promise<T> { return this.query<T>(body); }
  async notebook<T>(action: string, data: Record<string, unknown> = {}): Promise<T> { return this.query({action, ...data}); }
  private async query<T>(body: unknown): Promise<T> {
    try {
      return await this.request<T>(body);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.timer);
  }
}
