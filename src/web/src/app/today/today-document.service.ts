import { Injectable, inject, signal } from "@angular/core";
import { NotebookService } from "../notebooks/notebook.service";
import { mergeRecoveredWriting } from "../notes/draft-recovery";
import { NoteSessionState } from "../notes/note-session-state";
import { LocalDraftQueue } from "../notes/local-draft-queue";
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
  draft?: { content: string; revision: string; acceptedAutomaticBlockIDs?: string[]; acceptedReplyRunIDs?: string[] };
  readOnly: boolean;
  warning?: string;
  indexingPending: boolean;
  legacyMigrationAvailable: boolean;
  blocks?: DocumentBlock[];
  cleared?: DocumentBlock[];
  capabilities: { taskActions: boolean; sourceReferences: boolean };
}
export interface AutomaticDocumentProposal {
  documentID: string;
  revision: string;
  groups: { headingID: string; title: string; createHeading: boolean; blocks: { blockID: string; markdown: string }[] }[];
  removals: { blockID: string; markdown: string }[];
}
export interface MapleResponseProposal {
  runID: string;
  documentID: string;
  revision: string;
  requestBlockID: string;
  requestText?: string;
  blocks: { blockID: string; markdown: string }[];
}
export interface CollaborativeNoteEditor {
  applyAutomaticProposal(proposal: AutomaticDocumentProposal): boolean;
  applyMapleResponse(proposal: MapleResponseProposal): boolean;
  getAcceptedAutomaticBlockIDs?(): string[];
  restoreAutomaticBlockIDs?(ids: string[]): void;
  getAcceptedReplyRunIDs?(): string[];
  restoreReplyRunIDs?(ids: string[]): void;
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
  private readonly notebooks = inject(NotebookService);
  readonly bridge = inject(NativeBridge);
  private readonly session = new NoteSessionState();
  readonly state = this.session.snapshot;
  readonly document = this.session.select("document");
  readonly content = this.session.select("content");
  readonly initial = this.session.select("initial");
  readonly generation = this.session.select("generation");
  readonly day = this.session.select("day");
  readonly selectedNotebook = this.session.select("selectedNotebook");
  readonly loading = this.session.select("loading");
  readonly openError = this.session.select("openError");
  private lastOpen?: { action: "todayOpen" | "documentOpen"; data: Record<string, unknown> };
  private readonly openReads = new Map<string, Promise<TodayDocument>>();
  readonly dirty = this.session.select("dirty");
  readonly conflictedDraft = this.session.select("conflictedDraft");
  private draftRevision = "";
  readonly saving = this.session.select("saving");
  readonly actionBusy = signal(false);
  readonly history = signal<DocumentHistory[]>([]);
  readonly operations = signal<DocumentOperation[]>([]);
  readonly suggestions = signal<DocumentSuggestions>({
    tasks: [],
    carryForward: [],
    hasMore: false,
  });
  readonly suggestionError = signal("");
  readonly status = this.session.select("status");
  readonly error = this.session.select("error");
  readonly pendingSource = signal<string | null>(null);
  readonly run = signal<MapleRun | null>(null);
  readonly runs = signal<MapleRun[]>([]);
  readonly attempts = signal<MapleAttempt[]>([]);
  readonly attemptsError = signal("");
  private attemptReadSequence = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private saveWork: Promise<boolean> | null = null;
  private readonly drafts = new LocalDraftQueue<{
    documentID: string; revision: string; content: string;
    acceptedAutomaticBlockIDs: string[]; acceptedReplyRunIDs: string[];
  }>(async draft => {
    await this.bridge.notebook("documentDraft", {
      ...draft,
      revision: this.document()?.documentID === draft.documentID
        ? this.draftRevision || draft.revision : draft.revision,
    });
  }, draft => {
    if (this.document()?.documentID === draft.documentID) this.session.patch({
      error: "The draft could not be written. Keep this window open and copy your Markdown before closing.",
    });
  });
  readonly draftQueue = this.drafts.state;
  private openGeneration = 0;
  private automaticBusy = false;
  private runBusy = false;
  private activeDocumentID?: string;
  private routeActive = false;
  private editorSessionID = crypto.randomUUID();
  private collaborativeEditor?: CollaborativeNoteEditor;
  private acceptedAutomaticBlockIDs = new Set<string>();
  private acceptedReplyRunIDs = new Set<string>();
  setCollaborativeEditor(editor: CollaborativeNoteEditor | undefined) {
    this.collaborativeEditor = editor;
    editor?.restoreAutomaticBlockIDs?.([...this.acceptedAutomaticBlockIDs]);
    editor?.restoreReplyRunIDs?.([...this.acceptedReplyRunIDs]);
  }
  private automaticReceipts(): string[] {
    for (const id of this.collaborativeEditor?.getAcceptedAutomaticBlockIDs?.() ?? [])
      this.acceptedAutomaticBlockIDs.add(id);
    return [...this.acceptedAutomaticBlockIDs].sort();
  }
  private replyReceipts(): string[] {
    for (const id of this.collaborativeEditor?.getAcceptedReplyRunIDs?.() ?? [])
      this.acceptedReplyRunIDs.add(id);
    return [...this.acceptedReplyRunIDs].sort();
  }
  readonly editing = signal(false);
  readonly automaticStatus = signal("");
  private saveCommand?: { id: string; content: string; revision: string; receipts: string };
  private submissions = new Map<string, string>();
  private actions = new Map<string, string>();
  open(day = localDay(), ignoreDraft = false): Promise<boolean> {
    if (!validDay(day)) {
      this.session.patch({ openError: "Choose a valid calendar date." });
      return Promise.resolve(false);
    }
    return this.openTarget("todayOpen", {
      day, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ignoreDraft,
    });
  }
  openDocument(documentID: string): Promise<boolean> {
    return this.openTarget("documentOpen", { documentID });
  }
  retryOpen(): Promise<boolean> {
    return this.lastOpen
      ? this.openTarget(this.lastOpen.action, this.lastOpen.data)
      : Promise.resolve(false);
  }
  private async openTarget(
    action: "todayOpen" | "documentOpen", data: Record<string, unknown>,
  ): Promise<boolean> {
    if (this.actionBusy()) return false;
    if (!this.routeActive) this.editorSessionID = crypto.randomUUID();
    this.routeActive = true;
    const editorSessionID = this.editorSessionID;
    const generation = ++this.openGeneration;
    this.lastOpen = { action, data };
    this.session.patch({ loading: true });
    this.session.patch({ openError: "" });
    try {
      if (!(await this.flush()) || generation !== this.openGeneration) return false;
      const previous = this.document();
      const previousContent = this.content();
      const previousEditVersion = this.state().editVersion;
      const key = JSON.stringify([action, data, editorSessionID]);
      let reading = this.openReads.get(key);
      if (!reading) {
        reading = this.bridge.notebook<TodayDocument>(action, { ...data, collaborative: true, editorSessionID });
        this.openReads.set(key, reading);
        const clear = () => {
          if (this.openReads.get(key) === reading) this.openReads.delete(key);
        };
        void reading.then(clear, clear);
      }
      let doc = await reading;
      if (generation !== this.openGeneration) {
        this.releaseUnadopted(doc, key, editorSessionID);
        return false;
      }
      // A queued editor event must never be replaced by a late open response.
      if (this.dirty() || this.saving() || this.state().editVersion !== previousEditVersion || this.content() !== previousContent ||
          this.document()?.documentID !== previous?.documentID ||
          this.document()?.revision !== previous?.revision) {
        this.releaseUnadopted(doc, undefined, editorSessionID);
        this.session.patch({ openError: "Opening paused because your writing changed. Retry opening after it saves." });
        return false;
      }
      const recoveredReceipts = !data["ignoreDraft"] ? doc.draft : undefined;
      if (!data["ignoreDraft"]) {
        doc = await this.recoverOpeningDraft(doc, () => generation === this.openGeneration &&
          this.state().editVersion === previousEditVersion && this.content() === previousContent &&
          this.document()?.documentID === previous?.documentID && this.document()?.revision === previous?.revision);
        if (generation !== this.openGeneration || this.state().editVersion !== previousEditVersion || this.content() !== previousContent) {
          this.releaseUnadopted(doc, undefined, editorSessionID);
          return false;
        }
      }
      this.adopt(doc, !data["ignoreDraft"]);
      for (const id of recoveredReceipts?.acceptedAutomaticBlockIDs ?? []) this.acceptedAutomaticBlockIDs.add(id);
      for (const id of recoveredReceipts?.acceptedReplyRunIDs ?? []) this.acceptedReplyRunIDs.add(id);
      this.run.set(null);
      this.runs.set([]);
      this.attempts.set([]);
      this.attemptsError.set("");
      if (doc.documentID) void this.loadRuns(doc.documentID, generation);
      return true;
    } catch (e) {
      if (generation === this.openGeneration) this.session.patch({ openError: this.message(e) });
      return false;
    } finally {
      if (generation === this.openGeneration) this.session.patch({ loading: false });
    }
  }
  // Invalidate read continuations when the editor leaves the route; saves and drafts keep running.
  cancelPendingReads() {
    const departingDocumentID = this.activeDocumentID;
    const departingSessionID = this.editorSessionID;
    const saving = this.dirty() || this.saving() ? this.flush() : undefined;
    this.routeActive = false;
    this.collaborativeEditor = undefined;
    this.editing.set(false);
    // Keep the native writer out until the departing editor's final draft/save
    // reaches the Mac, including when a slow bridge mutation is ahead of it.
    if (saving) void saving.finally(() => {
      if (!this.routeActive || this.activeDocumentID !== departingDocumentID)
        this.releasePresence(departingDocumentID, departingSessionID);
    });
    else this.releasePresence(departingDocumentID, departingSessionID);
    this.activeDocumentID = undefined;
    this.openGeneration++;
    this.session.patch({ loading: false });
    this.session.patch({ openError: "" });
    this.lastOpen = undefined;
  }
  private releasePresence(documentID: string | undefined, editorSessionID = this.editorSessionID) {
    if (documentID) void this.bridge.notebook("documentPresence", {
      documentID, active: false, editing: false, editorSessionID,
    }).catch(() => undefined);
  }
  private releaseUnadopted(doc: TodayDocument, openKey?: string, editorSessionID = this.editorSessionID) {
    // A coalesced open shares its native claim with the newer continuation.
    const currentKey = this.lastOpen && JSON.stringify([this.lastOpen.action, this.lastOpen.data, this.editorSessionID]);
    if (this.routeActive && editorSessionID === this.editorSessionID && openKey && currentKey === openKey) return;
    if (!this.routeActive || this.activeDocumentID !== doc.documentID || editorSessionID !== this.editorSessionID) this.releasePresence(doc.documentID, editorSessionID);
  }
  setEditing(editing: boolean) {
    this.editing.set(editing);
    this.renewPresence();
  }
  private renewPresence() {
    const documentID = this.activeDocumentID;
    if (this.routeActive && documentID) void this.bridge.notebook("documentPresence", {
      documentID, active: true, editing: this.editing(), editorSessionID: this.editorSessionID,
    }).catch(() => undefined);
  }
  async pollAutomatic() {
    this.renewPresence();
    const doc = this.document();
    if (!this.routeActive || !doc?.documentID || doc.day !== localDay() || doc.readOnly ||
        this.loading() || this.automaticBusy || this.actionBusy() || this.conflictedDraft() || !this.collaborativeEditor) return;
    const generation = this.openGeneration;
    const editorSessionID = this.editorSessionID;
    this.automaticBusy = true;
    try {
      const proposal = await this.bridge.notebook<AutomaticDocumentProposal>("documentAutomaticProposal", { documentID: doc.documentID, editorSessionID });
      if (generation !== this.openGeneration || !this.routeActive || this.document()?.documentID !== doc.documentID) {
        this.releaseUnadopted(doc, undefined, editorSessionID);
        return;
      }
      if (this.loading() || this.actionBusy() || this.conflictedDraft()) return;
      if (!proposal || proposal.documentID !== doc.documentID) return;
      // Never rebase a draft onto an independently changed saved file. A save in
      // flight can also cause this mismatch; the next proposal poll retries it.
      if (proposal.revision !== this.document()?.revision) {
        this.automaticStatus.set("New note context is waiting for the saved revision to match. Your writing is preserved.");
        return;
      }
      if (this.collaborativeEditor?.applyAutomaticProposal(proposal)) this.automaticStatus.set("");
    } catch {
      if (generation === this.openGeneration) this.automaticStatus.set("New note context is pending. Maple will retry.");
    } finally { this.automaticBusy = false; }
  }
  change(content: string) {
    const doc = this.document();
    if (!doc || doc.readOnly || this.actionBusy()) return;
    this.session.edit(content);
    clearTimeout(this.timer);
    const draft = {
      documentID: doc.documentID,
      revision: this.draftRevision || doc.revision,
      content,
      acceptedAutomaticBlockIDs: this.automaticReceipts(),
      acceptedReplyRunIDs: this.replyReceipts(),
    };
    this.drafts.enqueue(doc.documentID, draft);
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
    this.session.patch({ saving: true });
    try {
      await this.drafts.flush();
      if (this.conflictedDraft()) {
        this.session.patch({ status: "Draft conflict · saved file unchanged" });
        return false;
      }
      while (this.dirty()) {
        await this.drafts.flush();
        const doc = this.document();
        if (!doc || doc.readOnly) return false;
        const content = this.content();
        const acceptedAutomaticBlockIDs = this.automaticReceipts();
        const acceptedReplyRunIDs = this.replyReceipts();
        const receipts = JSON.stringify([acceptedAutomaticBlockIDs, acceptedReplyRunIDs]);
        if (
          this.saveCommand?.content !== content ||
          this.saveCommand?.revision !== doc.revision || this.saveCommand?.receipts !== receipts
        )
          this.saveCommand = {
            id: crypto.randomUUID(),
            content,
            revision: doc.revision,
            receipts,
          };
        const result = await this.bridge.notebook<
          TodayDocument & { state: string }
        >("documentCommit", {
          commandID: this.saveCommand.id,
          documentID: doc.documentID,
          expectedRevision: doc.revision,
          content,
          acceptedAutomaticBlockIDs,
          acceptedReplyRunIDs,
        });
        if (result.state !== "committed")
          throw new Error("The Mac has not acknowledged this document change.");
        const newerReceipts = JSON.stringify([this.automaticReceipts(), this.replyReceipts()]) !== receipts;
        this.session.acknowledge(result, content, newerReceipts);
        this.draftRevision = result.revision;
        this.saveCommand = undefined;
      }
      return true;
    } catch (e) {
      this.session.patch({ error: this.message(e), status: this.drafts.busy()
        ? "Not saved · draft storage needs attention" : "Not saved · draft retained" });
      return false;
    } finally {
      this.session.patch({ saving: false });
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
      this.session.patch({ status: `Recovery copy saved: ${result.path}` });
    } catch (e) {
      this.session.patch({ error: this.message(e) });
    }
  }
  async reopen() {
    const doc = this.document();
    if (!doc?.documentID || this.actionBusy() || this.loading()) return;
    const generation = this.openGeneration;
    const content = this.content();
    const editorSessionID = this.editorSessionID;
    this.actionBusy.set(true);
    try {
      // A save acknowledgment must finish before a read can replace its state.
      if (this.saveWork) await this.saveWork;
      await this.drafts.flush();
      if (generation !== this.openGeneration || !this.routeActive) return;
      const current = await this.bridge.notebook<TodayDocument>(
        "documentOpen",
        { documentID: doc.documentID, collaborative: true, editorSessionID },
      );
      if (
        generation !== this.openGeneration ||
        this.document()?.documentID !== doc.documentID ||
        this.content() !== content
      ) {
        this.releaseUnadopted(current, undefined, editorSessionID);
        return;
      }
      this.adopt(current);
      this.session.patch({ status: "Opened current file · previous draft retained" });
    } catch (e) {
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
    } finally {
      this.actionBusy.set(false);
    }
  }
  async resolveOperation(commandID: string, resolution: "retry" | "abandon") {
    const doc = this.document();
    if (!doc) return;
    if (this.dirty()) {
      this.session.patch({ error: "Save a recovery copy and reopen the current file before resolving a pending operation. Your draft is retained." });
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
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
    } finally {
      this.actionBusy.set(false);
    }
  }
  async loadSuggestions() {
    const doc = this.document();
    const generation = this.openGeneration;
    if (!doc?.documentID) return;
    try {
      const value = await this.bridge.notebook<DocumentSuggestions>(
        "documentSuggestions",
        { documentID: doc.documentID, collaborative: true, editorSessionID: this.editorSessionID },
      );
      if (
        generation === this.openGeneration &&
        this.document()?.documentID === doc.documentID
      ) {
        this.suggestions.set(value);
        this.suggestionError.set("");
      }
    } catch (e) {
      if (generation === this.openGeneration)
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
        this.session.patch({ error: "The linked task was inserted on the Mac while you edited. Your draft is retained; reopen the current file." });
        return;
      }
      this.adopt(result);
      await this.loadSuggestions();
    } catch (e) {
      this.session.patch({ error: this.message(e) });
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
        this.session.patch({ error: "The block moved on the Mac while you edited. Your draft is retained; reopen the current file." });
        return;
      }
      const refreshed = await this.bridge.notebook<TodayDocument>(
        "documentOpen",
        { documentID: doc.documentID, collaborative: true, editorSessionID: this.editorSessionID },
      );
      if (
        this.document()?.documentID !== doc.documentID ||
        this.content() !== before
      )
        return;
      this.adopt(refreshed);
      await this.loadSuggestions();
    } catch (e) {
      this.session.patch({ error: this.message(e) });
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
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
    }
  }
  async boardAction(action:{blockID:string;kind:'done'|'hide'|'exclude';eventID?:string;scope?:string}) {
    if(this.actionBusy() || !(await this.flush()))return;
    const id=this.document()?.documentID;
    if(!id || this.document()?.readOnly)return;
    if(action.kind==='exclude') {
      const block=this.document()?.blocks?.find(block=>block.blockID===action.blockID);
      if(!action.eventID || block?.eventID!==action.eventID)return;
      try {await this.bridge.notebook('boardExcludeSource',{eventID:action.eventID,scope:action.scope});}
      catch(error){this.session.patch({error:this.message(error)});return;}
      if(this.document()?.documentID!==id)return;
    }
    if(action.kind==='done') {
      // Each task transition is acknowledged before clearing its block. A failed
      // completion remains visible; hiding alone never completes canonical work.
      for(let count=0;count<256;count++) {
        const block=this.document()?.blocks?.find(block=>block.blockID===action.blockID);
        if(!block)return;
        if(!/^(\s*[-*+] \[) (\])/m.test(block.content))break;
        const revision=this.document()?.revision;
        await this.blockAction(action.blockID,'complete');
        if(this.error() || this.document()?.documentID!==id || this.document()?.revision===revision)return;
        if(count===255)return;
      }
    }
    if(this.document()?.documentID===id)await this.blockAction(action.blockID,'clear');
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
        this.session.patch({ error: "The block action was acknowledged, but you typed while it was saving. Your draft is preserved; reopen the current file or save a recovery copy." });
        return;
      }
      this.adopt(result);
      this.session.patch({ status: kind === "complete"
          ? "Task completed on the Mac"
          : kind === "reopen"
            ? "Task reopened on the Mac"
          : kind === "clear"
            ? "Block cleared · linked task unchanged"
            : kind === "move"
              ? "Block moved"
              : "Block restored" });
    } catch (e) {
      this.session.patch({ error: this.message(e) });
    } finally {
      this.actionBusy.set(false);
    }
  }
  private async recoverOpeningDraft(doc: TodayDocument, current: () => boolean): Promise<TodayDocument> {
    const draft = doc.draft;
    if (!draft || (draft.content === doc.content && !draft.acceptedAutomaticBlockIDs?.length && !draft.acceptedReplyRunIDs?.length)) return doc;
    const guardCurrent = () => { if (!current()) throw new Error("Recovery paused because the open note changed."); };
    let recovered: string | null = draft.content === doc.content || draft.revision === doc.revision ? draft.content : null;
    if (draft.revision !== doc.revision && draft.content !== doc.content) {
      const history = await this.bridge.notebook<{ state: string; targetRevision: string; expectedRevision?: string; before?: string; after: string }[]>("documentHistory", { documentID: doc.documentID });
      guardCurrent();
      const saved = history.find(entry => entry.state === "committed" && entry.targetRevision === draft.revision);
      const next = history.find(entry => entry.state === "committed" && entry.expectedRevision === draft.revision && entry.before !== undefined);
      const base = saved?.after ?? next?.before;
      if (base !== undefined) recovered = mergeRecoveredWriting(base, doc.content, draft.content);
    }
    // An exact, durable copy precedes any change to the retained conflict draft.
    // The native key makes reopen/retry create one copy per recovered version.
    if (recovered === null || doc.readOnly) {
      const copy = await this.bridge.notebook<{ path: string; content: string }>("documentRecoveryCopy", { documentID: doc.documentID, content: draft.content, recoveryKey: draft.revision });
      if (!copy.path || copy.content !== draft.content) throw new Error("The Mac has not acknowledged the recovered writing copy. Your draft is retained.");
      guardCurrent();
      void this.notebooks.refresh();
      recovered = doc.content;
    }
    if (doc.readOnly) return { ...doc, draft: undefined };
    guardCurrent();
    const result = await this.bridge.notebook<TodayDocument & { state: string }>("documentCommit", {
      documentID: doc.documentID, expectedRevision: doc.revision, commandID: crypto.randomUUID(), content: recovered,
      acceptedAutomaticBlockIDs: draft.acceptedAutomaticBlockIDs ?? [], acceptedReplyRunIDs: draft.acceptedReplyRunIDs ?? [],
    });
    if (result.state !== "committed" || result.documentID !== doc.documentID)
      throw new Error("The Mac has not acknowledged automatic draft recovery. Your draft is retained.");
    return { ...result, draft: undefined };
  }

  private adopt(doc: TodayDocument, recoverDraft = false) {
    if (this.activeDocumentID !== doc.documentID) this.releasePresence(this.activeDocumentID);
    this.activeDocumentID = this.routeActive ? doc.documentID : undefined;
    this.acceptedAutomaticBlockIDs = new Set(doc.draft?.acceptedAutomaticBlockIDs ?? []);
    this.acceptedReplyRunIDs = new Set(doc.draft?.acceptedReplyRunIDs ?? []);
    this.session.adopt(doc, recoverDraft);
    this.draftRevision = this.dirty() && doc.draft ? doc.draft.revision : doc.revision;
    this.renewPresence();
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
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
    } finally {
      this.actionBusy.set(false);
    }
  }
  async submit(requestBlockID: string, text: string, forceNew = false) {
    const target = this.document(), generation = this.openGeneration;
    if (!this.routeActive || !target || target.readOnly) return;
    if (!text.trim() || !(await this.flush())) return;
    const doc = this.document();
    if (!doc || doc.readOnly || !this.routeActive || generation !== this.openGeneration || doc.documentID !== target.documentID) return;
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
      if (generation !== this.openGeneration || this.document()?.documentID !== doc.documentID) return;
      this.run.set(result);
      this.runs.update((runs) => [
        result,
        ...runs.filter((run) => run.runID !== result.runID),
      ]);
    } catch (e) {
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
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
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
    }
  }
  async selectRun(run: MapleRun) {
    this.run.set(run);
    this.attempts.set([]);
    this.attemptsError.set("");
    await this.loadAttempts();
  }
  async loadAttempts() {
    const run = this.run();
    if (!run || !this.routeActive) return;
    const generation = this.openGeneration, sequence = ++this.attemptReadSequence;
    const current = () => this.routeActive && generation === this.openGeneration && sequence === this.attemptReadSequence && this.run()?.runID === run.runID;
    this.attemptsError.set("");
    try {
      const attempts = await this.bridge.notebook<MapleAttempt[]>(
        "mapleAttempts",
        { runID: run.runID },
      );
      if (current()) this.attempts.set(attempts);
    } catch (e) {
      if (current()) this.attemptsError.set(this.message(e));
    }
  }
  async retryRun() {
    const run = this.run();
    if (run?.request?.text)
      await this.submit(run.requestBlockID, run.request.text, true);
  }
  async cancelRun() {
    const run = this.run();
    if (!run || !this.routeActive) return;
    const generation = this.openGeneration;
    const current = () => this.routeActive && generation === this.openGeneration && this.run()?.runID === run.runID;
    try {
      const result = await this.bridge.notebook<MapleRun>("mapleCancel", {
        runID: run.runID,
        commandID: crypto.randomUUID(),
      });
      if (current()) {
        this.run.set(result);
        this.runs.update(runs => runs.map(item => item.runID === result.runID ? result : item));
      }
    } catch (e) {
      if (current()) this.session.patch({ error: this.message(e) });
    }
  }
  async insertReply() {
    const run = this.run();
    if (!run || this.runBusy) return;
    const generation = this.openGeneration;
    this.runBusy = true;
    try {
      await this.applyReply(run, generation);
    } catch (e) {
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
    } finally { this.runBusy = false; }
  }
  private async applyReply(run: MapleRun, generation: number) {
    const doc = this.document();
    if (!doc || !this.routeActive || doc.readOnly || !this.collaborativeEditor ||
        this.loading() || this.actionBusy() || this.conflictedDraft() || run.appliedRevision) return;
    const proposal = await this.bridge.notebook<MapleResponseProposal>("mapleResponseProposal", { runID: run.runID, editorSessionID: this.editorSessionID });
    if (generation !== this.openGeneration || !this.routeActive || this.document()?.documentID !== doc.documentID ||
        this.run()?.runID !== run.runID || this.loading() || this.actionBusy() || this.conflictedDraft()) return;
    if (!proposal || proposal.documentID !== doc.documentID || proposal.runID !== run.runID ||
        proposal.revision !== this.document()?.revision) return;
    this.collaborativeEditor?.applyMapleResponse({ ...proposal, requestText: run.request?.text });
    // The normal draft/commit path persists the merged editor and acknowledges
    // the native run only once its reply blocks are durable on disk.
  }
  async pollRun() {
    const previous = this.run();
    const generation = this.openGeneration;
    if (!this.routeActive || !previous || this.runBusy ||
        !["queued", "running", "unapplied", "succeeded"].includes(previous.status) || previous.appliedRevision) return;
    this.runBusy = true;
    try {
      const result = await this.bridge.notebook<MapleRun>("mapleRun", { runID: previous.runID });
      if (generation !== this.openGeneration || this.run()?.runID !== previous.runID) return;
      this.run.set(result);
      this.runs.update(runs => runs.map(run => run.runID === result.runID ? result : run));
      if (["succeeded", "unapplied"].includes(result.status) && !result.appliedRevision) await this.applyReply(result, generation);
    } catch (e) {
      if (generation === this.openGeneration) this.session.patch({ error: this.message(e) });
    } finally { this.runBusy = false; }
  }
  private message(error: unknown) {
    return error instanceof Error
      ? error.message
      : "The Mac could not complete this request. Your draft is retained.";
  }
}
