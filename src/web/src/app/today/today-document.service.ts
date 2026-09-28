import { Injectable, inject, signal } from "@angular/core";
import { NativeBridge } from "../core/native-bridge.service";
import { localDay } from "../daily-note/daily-note.models";
export interface DocumentSuggestions {
  tasks: {
    taskID: string;
    title: string;
    version: number;
    evidenceIDs: string[];
  }[];
  carryForward: {
    documentID: string;
    day: string;
    revision: string;
    blockID: string;
    label: string;
    version: number;
  }[];
  hasMore: boolean;
}
export interface DocumentBlock {
  blockID: string;
  documentID: string;
  version: number;
  kind: string;
  eventID?: string;
  taskID?: string;
  taskVersion?: number;
  taskStatus?: string;
  content: string;
  state: "active" | "cleared" | "removed";
}
export interface DocumentOperation {
  input: { commandID: string; kind: string; blockID: string };
  files: DocumentHistory[];
  taskID?: string;
  state: string;
}
export interface DocumentHistory {
  commandID: string;
  documentID: string;
  expectedRevision?: string;
  targetRevision: string;
  before?: string;
  after: string;
  state: string;
  createdAt: number;
}
export interface TodayDocument {
  schemaVersion: number;
  documentID: string;
  notebookID: string;
  path: string;
  day: string;
  timeZone: string;
  content: string;
  revision: string;
  draft?: { content: string; revision: string };
  readOnly: boolean;
  warning?: string;
  indexingPending: boolean;
  legacyMigrationAvailable: boolean;
  blocks?: DocumentBlock[];
  cleared?: DocumentBlock[];
  capabilities: { taskActions: boolean; sourceReferences: boolean };
}
export interface MapleAttempt {
  attemptID: string;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string;
  input: string;
  response?: string;
  status: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
  validationOutcome: string;
}
export interface MapleRun {
  request?: { text: string };
  runID: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "configuration_required"
    | "canceled"
    | "unapplied";
  requestBlockID: string;
  text?: string;
  eventIDs?: string[];
  error?: string;
  appliedRevision?: string;
  content?: string;
  coverage?: string;
  total?: number;
  hasMore?: boolean;
}
export function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}
@Injectable({ providedIn: "root" })
export class TodayDocumentService {
  readonly bridge = inject(NativeBridge);
  readonly document = signal<TodayDocument | null>(null);
  readonly content = signal("");
  readonly initial = signal("");
  readonly generation = signal(0);
  readonly day = signal(localDay());
  readonly selectedNotebook = signal("");
  readonly loading = signal(false);
  readonly dirty = signal(false);
  readonly conflictedDraft = signal(false);
  private draftRevision = "";
  readonly saving = signal(false);
  readonly actionBusy = signal(false);
  readonly history = signal<DocumentHistory[]>([]);
  readonly operations = signal<DocumentOperation[]>([]);
  readonly suggestions = signal<DocumentSuggestions>({
    tasks: [],
    carryForward: [],
    hasMore: false,
  });
  readonly suggestionError = signal("");
  readonly status = signal("");
  readonly error = signal("");
  readonly pendingSource = signal<string | null>(null);
  readonly run = signal<MapleRun | null>(null);
  readonly runs = signal<MapleRun[]>([]);
  readonly attempts = signal<MapleAttempt[]>([]);
  private timer?: ReturnType<typeof setTimeout>;
  private saveWork: Promise<boolean> | null = null;
  private draftWork: Promise<void> = Promise.resolve();
  private openGeneration = 0;
  private saveCommand?: { id: string; content: string; revision: string };
  private submissions = new Map<string, string>();
  private actions = new Map<string, string>();
  async open(
    day = localDay(),
    ignoreDraft = false,
  ): Promise<boolean> {
    if (this.actionBusy()) return false;
    if (!validDay(day)) {
      this.error.set("Choose a valid calendar date.");
      return false;
    }
    if (!(await this.flush())) return false;
    const generation = ++this.openGeneration;
    this.loading.set(true);
    this.error.set("");
    try {
      const doc = await this.bridge.notebook<TodayDocument>("todayOpen", {
        day,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ignoreDraft,
      });
      if (generation !== this.openGeneration) return false;
      this.document.set(doc);
      this.selectedNotebook.set(doc.notebookID);
      this.day.set(doc.day);
      const text = ignoreDraft
        ? doc.content
        : (doc.draft?.content ?? doc.content);
      this.content.set(text);
      this.initial.set(text);
      this.dirty.set(!ignoreDraft && !!doc.draft && text !== doc.content);
      this.conflictedDraft.set(
        !ignoreDraft &&
          !!doc.draft &&
          text !== doc.content &&
          doc.draft.revision !== doc.revision,
      );
      this.draftRevision =
        !ignoreDraft && doc.draft ? doc.draft.revision : doc.revision;
      this.generation.update((v) => v + 1);
      this.status.set(
        doc.draft && !ignoreDraft
          ? "Recovered local draft. Review it before saving."
          : doc.readOnly
            ? "Read only"
            : "Saved",
      );
      this.run.set(null);
      this.runs.set([]);
      this.attempts.set([]);
      this.saveCommand = undefined;
      if (doc.documentID) void this.loadRuns(doc.documentID, generation);
      if (doc.documentID) void this.loadSuggestions();
      if (!ignoreDraft && doc.draft && doc.draft.revision !== doc.revision)
        this.error.set(
          "The file changed after this draft was written. Your recovered draft is preserved. Save a recovery copy or reopen the current file.",
        );
      return true;
    } catch (e) {
      if (generation === this.openGeneration) this.error.set(this.message(e));
      return false;
    } finally {
      if (generation === this.openGeneration) this.loading.set(false);
    }
  }
  async openDocument(documentID: string): Promise<boolean> {
    if (this.actionBusy()) return false;
    if (!(await this.flush())) return false;
    const generation = ++this.openGeneration;
    this.loading.set(true);
    try {
      const doc = await this.bridge.notebook<TodayDocument>("documentOpen", {
        documentID,
      });
      if (generation !== this.openGeneration) return false;
      this.adopt(doc);
      if (doc.draft && doc.draft.content !== doc.content) {
        this.content.set(doc.draft.content);
        this.initial.set(doc.draft.content);
        this.dirty.set(true);
        this.draftRevision = doc.draft.revision;
        this.conflictedDraft.set(doc.draft.revision !== doc.revision);
        this.status.set("Recovered local draft");
        if (doc.draft.revision !== doc.revision)
          this.error.set(
            "The file changed after this draft. Save a recovery copy to preserve both versions.",
          );
      } else this.status.set(doc.readOnly ? "Read only" : "Saved");
      this.run.set(null);
      this.runs.set([]);
      void this.loadRuns(documentID, generation);
      return true;
    } catch (e) {
      this.error.set(this.message(e));
      return false;
    } finally {
      if (generation === this.openGeneration) this.loading.set(false);
    }
  }
  change(content: string) {
    const doc = this.document();
    if (!doc || doc.readOnly || this.actionBusy()) return;
    this.content.set(content);
    this.dirty.set(true);
    this.status.set("Saving local draft…");
    clearTimeout(this.timer);
    const draft = {
      documentID: doc.documentID,
      revision: this.draftRevision || doc.revision,
      content,
    };
    this.draftWork = this.draftWork
      .catch(() => undefined)
      .then(async () => {
        await this.bridge.notebook("documentDraft", draft);
      });
    this.draftWork.catch(() => {
      this.error.set(
        "The draft could not be written. Keep this window open and copy your Markdown before closing.",
      );
    });
    this.timer = setTimeout(() => void this.flush(), 700);
  }
  async flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.actionBusy()) return false;
    if (this.saveWork) return this.saveWork;
    if (!this.dirty()) return true;
    this.saveWork = this.saveLoop();
    try {
      return await this.saveWork;
    } finally {
      this.saveWork = null;
    }
  }
  private async saveLoop(): Promise<boolean> {
    this.saving.set(true);
    try {
      await this.draftWork;
      if (this.conflictedDraft()) {
        this.status.set("Draft conflict · saved file unchanged");
        return false;
      }
      while (this.dirty()) {
        await this.draftWork;
        const doc = this.document();
        if (!doc || doc.readOnly) return false;
        const content = this.content();
        if (
          this.saveCommand?.content !== content ||
          this.saveCommand?.revision !== doc.revision
        )
          this.saveCommand = {
            id: crypto.randomUUID(),
            content,
            revision: doc.revision,
          };
        const result = await this.bridge.notebook<
          TodayDocument & { state: string }
        >("documentCommit", {
          commandID: this.saveCommand.id,
          documentID: doc.documentID,
          expectedRevision: doc.revision,
          content,
        });
        if (result.state !== "committed")
          throw new Error("The Mac has not acknowledged this document change.");
        this.document.set(result);
        this.draftRevision = result.revision;
        this.dirty.set(this.content() !== content);
        this.saveCommand = undefined;
        this.error.set("");
        this.status.set(
          result.indexingPending ? "Saved · indexing pending" : "Saved",
        );
      }
      return true;
    } catch (e) {
      this.error.set(this.message(e));
      this.status.set("Not saved · draft retained");
      return false;
    } finally {
      this.saving.set(false);
    }
  }
  async recoveryCopy(content = this.content()) {
    const doc = this.document();
    if (!doc) return;
    try {
      const result = await this.bridge.notebook<{ path: string }>(
        "documentRecoveryCopy",
        { documentID: doc.documentID, content },
      );
      this.status.set(`Recovery copy saved: ${result.path}`);
    } catch (e) {
      this.error.set(this.message(e));
    }
  }
  async reopen() {
    const doc = this.document();
    if (!doc?.documentID || this.actionBusy()) return;
    const generation = this.openGeneration;
    const content = this.content();
    this.actionBusy.set(true);
    try {
      await this.draftWork;
      const current = await this.bridge.notebook<TodayDocument>(
        "documentOpen",
        { documentID: doc.documentID },
      );
      if (
        generation !== this.openGeneration ||
        this.document()?.documentID !== doc.documentID ||
        this.content() !== content
      )
        return;
      this.adopt(current);
      this.status.set("Opened current file · previous draft retained");
    } catch (e) {
      if (generation === this.openGeneration) this.error.set(this.message(e));
    } finally {
      this.actionBusy.set(false);
    }
  }
  async resolveOperation(commandID: string, resolution: "retry" | "abandon") {
    const doc = this.document();
    if (!doc) return;
    if (this.dirty()) {
      this.error.set(
        "Save a recovery copy and reopen the current file before resolving a pending operation. Your draft is retained.",
      );
      return;
    }
    const generation = this.openGeneration;
    const content = this.content();
    this.actionBusy.set(true);
    try {
      const result = await this.bridge.notebook<TodayDocument>(
        "documentOperationResolve",
        { documentID: doc.documentID, commandID, resolution },
      );
      if (
        generation !== this.openGeneration ||
        this.document()?.documentID !== doc.documentID ||
        this.content() !== content
      )
        return;
      this.adopt(result);
      await this.loadHistory();
    } catch (e) {
      if (generation === this.openGeneration) this.error.set(this.message(e));
    } finally {
      this.actionBusy.set(false);
    }
  }
  async loadSuggestions() {
    const doc = this.document();
    if (!doc?.documentID) return;
    try {
      const value = await this.bridge.notebook<DocumentSuggestions>(
        "documentSuggestions",
        { documentID: doc.documentID },
      );
      if (this.document()?.documentID === doc.documentID) {
        this.suggestions.set(value);
        this.suggestionError.set("");
      }
    } catch (e) {
      this.suggestionError.set(this.message(e));
    }
  }
  async insertTask(taskID: string) {
    if (this.actionBusy() || !(await this.flush())) return;
    const doc = this.document();
    if (!doc || doc.readOnly) return;
    const data = {
      documentID: doc.documentID,
      expectedRevision: doc.revision,
      taskID,
    };
    const key = JSON.stringify(data),
      commandID = this.actions.get(key) ?? crypto.randomUUID();
    this.actions.set(key, commandID);
    const before = this.content();
    this.actionBusy.set(true);
    try {
      const result = await this.bridge.notebook<TodayDocument>("taskInsert", {
        ...data,
        commandID,
      });
      if (this.content() !== before) {
        this.error.set(
          "The linked task was inserted on the Mac while you edited. Your draft is retained; reopen the current file.",
        );
        return;
      }
      this.adopt(result);
      await this.loadSuggestions();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.actionBusy.set(false);
    }
  }
  async carryForward(offer: DocumentSuggestions["carryForward"][number]) {
    if (this.actionBusy() || !(await this.flush())) return;
    const doc = this.document();
    if (!doc || doc.readOnly) return;
    const data = {
      documentID: offer.documentID,
      expectedRevision: offer.revision,
      blockID: offer.blockID,
      expectedBlockVersion: offer.version,
      kind: "move",
      targetDay: doc.day,
    };
    const key = JSON.stringify(data),
      commandID = this.actions.get(key) ?? crypto.randomUUID();
    this.actions.set(key, commandID);
    this.actionBusy.set(true);
    const before = this.content();
    try {
      await this.bridge.notebook("documentBlockMutate", { ...data, commandID });
      if (this.content() !== before) {
        this.error.set(
          "The block moved on the Mac while you edited. Your draft is retained; reopen the current file.",
        );
        return;
      }
      const refreshed = await this.bridge.notebook<TodayDocument>(
        "documentOpen",
        { documentID: doc.documentID },
      );
      if (
        this.document()?.documentID !== doc.documentID ||
        this.content() !== before
      )
        return;
      this.adopt(refreshed);
      await this.loadSuggestions();
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.actionBusy.set(false);
    }
  }
  async loadHistory() {
    const doc = this.document();
    const generation = this.openGeneration;
    if (!doc?.documentID) return;
    try {
      const [history, operations] = await Promise.all([
        this.bridge.notebook<DocumentHistory[]>("documentHistory", {
          documentID: doc.documentID,
        }),
        this.bridge.notebook<DocumentOperation[]>("documentOperationHistory", {
          documentID: doc.documentID,
        }),
      ]);
      if (
        generation === this.openGeneration &&
        this.document()?.documentID === doc.documentID
      ) {
        this.history.set(history);
        this.operations.set(operations);
      }
    } catch (e) {
      if (generation === this.openGeneration) this.error.set(this.message(e));
    }
  }
  async blockAction(
    blockID: string,
    kind: "clear" | "restore" | "move" | "copy" | "complete" | "reopen",
    targetDay?: string,
  ) {
    if (this.actionBusy() || !(await this.flush())) return;
    const doc = this.document();
    if (!doc || doc.readOnly) return;
    const block = [...(doc.blocks ?? []), ...(doc.cleared ?? [])].find(
      (block) => block.blockID === blockID,
    );
    if (!block) return;
    const data = {
      documentID: doc.documentID,
      expectedRevision: doc.revision,
      blockID,
      expectedBlockVersion: block.version,
      kind,
      targetDay,
      expectedTaskVersion: block.taskVersion,
    };
    const key = JSON.stringify(data);
    const commandID = this.actions.get(key) ?? crypto.randomUUID();
    this.actions.set(key, commandID);
    const before = this.content();
    this.actionBusy.set(true);
    try {
      const result = await this.bridge.notebook<TodayDocument>(
        "documentBlockMutate",
        { ...data, commandID },
      );
      if (this.content() !== before) {
        this.error.set(
          "The block action was acknowledged, but you typed while it was saving. Your draft is preserved; reopen the current file or save a recovery copy.",
        );
        return;
      }
      this.adopt(result);
      this.status.set(
        kind === "complete"
          ? "Task completed on the Mac"
          : kind === "clear"
            ? "Block cleared · linked task unchanged"
            : kind === "move"
              ? "Block moved"
              : "Block restored",
      );
    } catch (e) {
      this.error.set(this.message(e));
    } finally {
      this.actionBusy.set(false);
    }
  }
  private adopt(doc: TodayDocument) {
    this.document.set(doc);
    this.selectedNotebook.set(doc.notebookID);
    this.day.set(doc.day);
    this.content.set(doc.content);
    this.initial.set(doc.content);
    this.dirty.set(false);
    this.conflictedDraft.set(false);
    this.draftRevision = doc.revision;
    this.generation.update((v) => v + 1);
    this.error.set("");
    this.saveCommand = undefined;
  }
  async migrate(recoveryCopy = false) {
    if (this.actionBusy()) return;
    const generation = this.openGeneration;
    const content = this.content();
    this.actionBusy.set(true);
    try {
      const doc = await this.bridge.notebook<TodayDocument>("todayMigrate", {
        day: this.day(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recoveryCopy,
      });
      if (generation !== this.openGeneration || this.content() !== content)
        return;
      this.adopt(doc);
      void this.loadSuggestions();
    } catch (e) {
      if (generation === this.openGeneration) this.error.set(this.message(e));
    } finally {
      this.actionBusy.set(false);
    }
  }
  async submit(requestBlockID: string, text: string, forceNew = false) {
    if (!text.trim() || !(await this.flush())) return;
    const doc = this.document();
    if (!doc || doc.readOnly) return;
    const key = `${doc.documentID}:${requestBlockID}:${doc.revision}:${text}`;
    const commandID =
      (!forceNew && this.submissions.get(key)) || crypto.randomUUID();
    this.submissions.set(key, commandID);
    try {
      const result = await this.bridge.notebook<MapleRun>("mapleSubmit", {
        commandID,
        documentID: doc.documentID,
        requestBlockID,
        expectedRevision: doc.revision,
        text,
      });
      this.run.set(result);
      this.runs.update((runs) => [
        result,
        ...runs.filter((run) => run.runID !== result.runID),
      ]);
    } catch (e) {
      this.error.set(this.message(e));
    }
  }
  async loadRuns(
    documentID = this.document()?.documentID,
    generation = this.openGeneration,
  ) {
    if (!documentID) return;
    try {
      const runs = await this.bridge.notebook<MapleRun[]>("mapleRuns", {
        documentID,
      });
      if (generation !== this.openGeneration) return;
      this.runs.set(runs);
      if (!this.run() && runs.length) this.run.set(runs[0]);
    } catch (e) {
      if (generation === this.openGeneration) this.error.set(this.message(e));
    }
  }
  async selectRun(run: MapleRun) {
    this.run.set(run);
    this.attempts.set([]);
    await this.loadAttempts();
  }
  async loadAttempts() {
    const run = this.run();
    if (!run) return;
    try {
      const attempts = await this.bridge.notebook<MapleAttempt[]>(
        "mapleAttempts",
        { runID: run.runID },
      );
      if (this.run()?.runID === run.runID) this.attempts.set(attempts);
    } catch (e) {
      this.error.set(this.message(e));
    }
  }
  async retryRun() {
    const run = this.run();
    if (run?.request?.text)
      await this.submit(run.requestBlockID, run.request.text, true);
  }
  async cancelRun() {
    const run = this.run();
    if (!run) return;
    try {
      const result = await this.bridge.notebook<MapleRun>("mapleCancel", {
        runID: run.runID,
        commandID: crypto.randomUUID(),
      });
      if (this.run()?.runID === run.runID) this.run.set(result);
    } catch (e) {
      this.error.set(this.message(e));
    }
  }
  async insertReply() {
    if (!(await this.flush())) return;
    const run = this.run();
    if (!run) return;
    try {
      const result = await this.bridge.notebook<MapleRun>(
        "mapleInsertResponse",
        { runID: run.runID },
      );
      this.run.set({
        ...result,
        status: result.status === "succeeded" ? "running" : result.status,
      });
      await this.pollRun();
    } catch (e) {
      this.error.set(this.message(e));
    }
  }
  async pollRun() {
    const previous = this.run();
    if (!previous || !["queued", "running"].includes(previous.status)) return;
    try {
      const result = await this.bridge.notebook<MapleRun>("mapleRun", {
        runID: previous.runID,
      });
      if (this.run()?.runID !== previous.runID) return;
      this.run.set(result);
      if (
        result.status === "succeeded" &&
        result.content &&
        result.appliedRevision &&
        !this.dirty() &&
        !this.saving()
      ) {
        const documentID = this.document()?.documentID;
        if (!documentID) return;
        const refreshed = await this.bridge.notebook<TodayDocument>(
          "documentOpen",
          { documentID },
        );
        if (
          this.document()?.documentID !== documentID ||
          this.dirty() ||
          this.saving() ||
          this.actionBusy()
        )
          return;
        this.adopt(refreshed);
        this.status.set("Saved · Maple replied");
      }
    } catch (e) {
      this.error.set(this.message(e));
    }
  }
  private message(error: unknown) {
    return error instanceof Error
      ? error.message
      : "The Mac could not complete this request. Your draft is retained.";
  }
}
