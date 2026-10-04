import { localDay } from "../daily-note/daily-note.models";
import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi, afterEach } from "vitest";
import { NativeBridge } from "../core/native-bridge.service";
import {
  TodayDocumentService,
  TodayDocument,
  validDay,
} from "./today-document.service";
const document: TodayDocument = {
  schemaVersion: 1,
  documentID: "doc",
  notebookID: "book",
  path: "2026/09/2026-09-27.md",
  day: "2026-09-27",
  timeZone: "America/New_York",
  content: "Original",
  revision: "r1",
  readOnly: false,
  indexingPending: false,
  legacyMigrationAvailable: false,
  capabilities: { taskActions: false, sourceReferences: true },
};
function setup(handler: (action: string, data: any) => Promise<any>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: NativeBridge, useValue: { notebook: vi.fn(handler) } },
    ],
  });
  return TestBed.inject(TodayDocumentService);
}
afterEach(() => TestBed.resetTestingModule());
describe("Today document coordination", () => {
  it("acknowledges completion before hiding a board task and hides without completion when requested",async()=>{
    const calls:any[]=[];
    let current={...document,blocks:[{blockID:'action',documentID:'doc',version:1,kind:'linkedTask',content:'- [ ] Do this',state:'active',taskID:'task:canonical',taskVersion:2}],cleared:[]} as any;
    const service=setup(async(action,data)=>{
      if(action==='todayOpen')return current;
      if(action==='documentBlockMutate'){
        calls.push(data);
        current=data.kind==='complete' ? {...current,revision:'r2',blocks:[{...current.blocks[0],version:2,content:'- [x] Do this',taskStatus:'completed',taskVersion:3}]} : {...current,revision:'r3',blocks:[],cleared:current.blocks};
        return current;
      }return [];
    });
    await service.open(document.day);await service.boardAction({blockID:'action',kind:'done'});
    expect(calls.map(c=>c.kind)).toEqual(['complete','clear']);expect(calls[1].expectedRevision).toBe('r2');expect(calls[1].expectedBlockVersion).toBe(2);
  });
  it("leaves a task visible when completion is not acknowledged",async()=>{
    const calls:string[]=[];
    const service=setup(async(action,data)=>{
      if(action==='todayOpen')return {...document,blocks:[{blockID:'action',version:1,content:'- [ ] Do this',state:'active'}]};
      if(action==='documentBlockMutate'){calls.push(data.kind);throw Error('Task version changed');}return [];
    });
    await service.open(document.day);await service.boardAction({blockID:'action',kind:'done'});expect(calls).toEqual(['complete']);expect(service.document()?.blocks?.length).toBe(1);
  });
  it("hides a source without completing a task and persists its exclusion first",async()=>{
    const calls:string[]=[];
    const service=setup(async(action,data)=>{
      if(action==='todayOpen')return {...document,blocks:[{blockID:'source',eventID:'event',version:1,content:'Source text',state:'active'}]};
      if(action==='boardExcludeSource'){calls.push(action);return {id:'rule'};}
      if(action==='documentBlockMutate'){calls.push(data.kind);return {...document,revision:'r2',blocks:[]};}return [];
    });
    await service.open(document.day);await service.boardAction({blockID:'source',eventID:'event',kind:'exclude',scope:'github'});expect(calls).toEqual(['boardExcludeSource','clear']);
  });

  it("keeps request-inspection failures separate from saving and ignores superseded reads", async () => {
    const reads: {resolve: (value: any) => void; reject: (error: Error) => void}[] = [];
    const service = setup(async action => {
      if (action === 'todayOpen') return document;
      if (action === 'mapleAttempts') return new Promise((resolve, reject) => reads.push({resolve, reject}));
      return [];
    });
    await service.open(document.day);
    service.run.set({runID:'synthetic-run',status:'failed',requestBlockID:'request',eventIDs:[],text:''} as any);
    const older = service.loadAttempts(), newest = service.loadAttempts();
    reads[1].resolve([{attemptID:'newest'}]); await newest;
    reads[0].reject(Error('Obsolete inspection failure')); await older;
    expect(service.attempts()).toEqual([{attemptID:'newest'}]);
    expect(service.attemptsError()).toBe(''); expect(service.error()).toBe('');
    const failed = service.loadAttempts(); reads[2].reject(Error('Fixture history unavailable')); await failed;
    expect(service.attemptsError()).toBe('Fixture history unavailable'); expect(service.error()).toBe('');
    expect(service.content()).toBe(document.content); expect(service.dirty()).toBe(false);
    const retry = service.loadAttempts(); reads[3].resolve([{attemptID:'recovered'}]); await retry;
    expect(service.attemptsError()).toBe(''); expect(service.attempts()).toEqual([{attemptID:'recovered'}]);
  });
  it("does not apply old inspection or cancellation errors after reopening the same run", async () => {
    const failures: ((error: Error) => void)[] = [];
    const service=setup(async action=>{
      if(action==='todayOpen')return document;
      if(action==='mapleAttempts'||action==='mapleCancel')return new Promise((_,reject)=>failures.push(reject));
      return [];
    });
    const run={runID:'same-run',status:'running',requestBlockID:'request',eventIDs:[],text:''} as any;
    await service.open(document.day);service.run.set(run);
    const inspect=service.loadAttempts(),cancel=service.cancelRun();
    service.cancelPendingReads();await service.open(document.day);service.run.set(run);
    failures.forEach(reject=>reject(Error('Previous editor request failed')));await Promise.all([inspect,cancel]);
    expect(service.attemptsError()).toBe('');expect(service.error()).toBe('');expect(service.run()).toEqual(run);
  });
  it("does not submit a previous note's prompt after an awaited flush and route handoff",async()=>{
    const calls:string[]=[];
    const service=setup(async(action,data)=>{
      calls.push(action);
      if(action==='todayOpen')return {...document,documentID:data.day,day:data.day};
      return [];
    });
    await service.open(document.day);
    let finish!:(value:boolean)=>void;
    vi.spyOn(service,'flush').mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
    const submitting=service.submit('old-request','Old note prompt');
    service.cancelPendingReads();await service.open('2026-09-28');
    finish(true);await submitting;
    expect(calls).not.toContain('mapleSubmit');expect(service.document()?.day).toBe('2026-09-28');
  });
  it("keeps the request history selection in sync with acknowledged cancellation",async()=>{
    const run={runID:'cancel-current',status:'running',requestBlockID:'request',eventIDs:[],text:''} as any;
    const cancelled={...run,status:'canceled'};
    const service=setup(async action=>{
      if(action==='todayOpen')return document;
      if(action==='mapleCancel')return cancelled;
      return [];
    });
    await service.open(document.day);service.run.set(run);service.runs.set([run]);
    await service.cancelRun();
    expect(service.run()).toEqual(cancelled);expect(service.runs()).toEqual([cancelled]);
  });
  it("coalesces slow draft storage to the newest full text and delivery receipts before commit", async () => {
    let finish!: () => void;
    const drafts: any[] = [], commits: any[] = [];
    let accepted: string[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "documentDraft") {
        drafts.push(data);
        if (drafts.length === 1) await new Promise<void>(resolve => finish = resolve);
      }
      if (action === "documentCommit") {
        commits.push(data);
        return { ...document, content: data.content, revision: "r2", state: "committed" };
      }
      return [];
    });
    await service.open(document.day);
    service.setCollaborativeEditor({ applyAutomaticProposal: () => true, applyMapleResponse: () => true,
      getAcceptedReplyRunIDs: () => accepted });
    service.change("first");
    await vi.waitFor(() => expect(finish).toBeDefined());
    for (let i = 0; i < 1000; i++) service.change(`typing ${i}`);
    accepted = ["accepted-reply"];
    service.change("newest with reply");
    const flush = service.flush();
    expect(commits).toHaveLength(0);
    expect(service.draftQueue()).toEqual({ writing: true, pending: 1 });
    finish();
    expect(await flush).toBe(true);
    expect(drafts.map(d => d.content)).toEqual(["first", "newest with reply"]);
    expect(drafts[1].acceptedReplyRunIDs).toEqual(accepted);
    expect(commits).toHaveLength(1);
    expect(commits[0].acceptedReplyRunIDs).toEqual(accepted);
    expect(service.dirty()).toBe(false);
  });

  it("does not share an old route's open claim or release token with its replacement", async () => {
    const openings: { token: string; finish: (doc: TodayDocument) => void }[] = [];
    const releases: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return new Promise<TodayDocument>(finish => openings.push({ token: data.editorSessionID, finish }));
      if (action === "documentPresence" && !data.active) releases.push(data);
      return [];
    });
    const old = service.open(document.day);
    await vi.waitFor(() => expect(openings).toHaveLength(1));
    service.cancelPendingReads();
    const current = service.open(document.day);
    await vi.waitFor(() => expect(openings).toHaveLength(2));
    expect(openings[1].token).not.toBe(openings[0].token);
    openings[1].finish(document);
    expect(await current).toBe(true);
    openings[0].finish(document);
    expect(await old).toBe(false);
    expect(releases).toEqual([{ documentID: "doc", active: false, editing: false, editorSessionID: openings[0].token }]);
    expect(service.document()?.documentID).toBe("doc");
  });

  it("coalesces concurrent opens and retries opening errors without presenting a save failure", async () => {
    let finish!: (value: TodayDocument) => void;
    let fail = false;
    const service = setup(async action => {
      if (action === "todayOpen") {
        if (fail) throw Error("iCloud temporarily unavailable");
        return new Promise<TodayDocument>(resolve => finish = resolve);
      }
      return [];
    });
    const first = service.open(document.day);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const second = service.open(document.day);
    await Promise.resolve();
    expect(vi.mocked(service.bridge.notebook).mock.calls.filter(([action]) => action === "todayOpen")).toHaveLength(1);
    finish(document);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(service.generation()).toBe(1);
    fail = true;
    expect(await service.open("2026-09-28")).toBe(false);
    expect(service.openError()).toBe("iCloud temporarily unavailable");
    expect(service.error()).toBe("");
    expect(service.content()).toBe("Original");
    fail = false;
    const retry = service.retryOpen();
    await vi.waitFor(() => expect(vi.mocked(service.bridge.notebook).mock.calls.filter(([action]) => action === "todayOpen")).toHaveLength(3));
    finish({ ...document, documentID: "next", day: "2026-09-28" });
    expect(await retry).toBe(true);
    expect(service.day()).toBe("2026-09-28");
    expect(service.openError()).toBe("");
    expect(service.loading()).toBe(false);
  });
  it("retains writing arriving while a different document is opening", async () => {
    let finish!: (value: TodayDocument) => void;
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return data.day === document.day ? document : new Promise(resolve => finish = resolve);
      return [];
    });
    await service.open(document.day);
    const next = service.open("2026-09-28");
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.change("Late editor input");
    finish({ ...document, day: "2026-09-28", content: "Next note" });
    expect(await next).toBe(false);
    expect(service.content()).toBe("Late editor input");
    expect(service.dirty()).toBe(true);
    expect(service.openError()).toContain("writing changed");
    expect(service.loading()).toBe(false);
    // Complete the pending timer without committing fixture data.
    await service.flush();
  });
  it("retries a failed durable draft write before committing the latest writing", async () => {
    let writable = false;
    const drafts: string[] = [];
    const commits: string[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "documentDraft") {
        drafts.push(data.content);
        if (!writable) throw Error("Draft storage unavailable");
      }
      if (action === "documentCommit") {
        commits.push(data.content);
        return { ...document, content: data.content, revision: "r2", state: "committed" };
      }
      return [];
    });
    await service.open(document.day);
    service.change("Keep this draft");
    expect(await service.flush()).toBe(false);
    expect(commits).toHaveLength(0);
    expect(service.dirty()).toBe(true);
    writable = true;
    expect(await service.flush()).toBe(true);
    expect(drafts.at(-1)).toBe("Keep this draft");
    expect(commits).toEqual(["Keep this draft"]);
    expect(service.error()).toBe("");
  });
  it("finishes an in-flight save before reopening the current file", async () => {
    let finish!: (value: any) => void;
    let reads = 0;
    const service = setup(async action => {
      if (action === "todayOpen") return document;
      if (action === "documentCommit") return new Promise(resolve => finish = resolve);
      if (action === "documentOpen") {
        reads++;
        return { ...document, content: "External after save", revision: "r3" };
      }
      return [];
    });
    await service.open(document.day);
    service.change("User save");
    const saving = service.flush();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const reopening = service.reopen();
    await Promise.resolve();
    expect(reads).toBe(0);
    finish({ ...document, content: "User save", revision: "r2", state: "committed" });
    await saving;
    await reopening;
    expect(reads).toBe(1);
    expect(service.content()).toBe("External after save");
    expect(service.document()?.revision).toBe("r3");
  });
  it("does not apply a late reply proposal from an earlier saved revision", async () => {
    let finish!: (value: any) => void;
    const applyReply = vi.fn(() => true);
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "mapleRun") return { runID: "run", status: "unapplied", requestBlockID: "request", request: { text: "Find sources" } };
      if (action === "mapleResponseProposal") return new Promise(resolve => finish = resolve);
      if (action === "documentCommit") return { ...document, content: data.content, revision: "r3", state: "committed" };
      return [];
    });
    await service.open(document.day);
    service.setCollaborativeEditor({ applyAutomaticProposal: () => true, applyMapleResponse: applyReply });
    service.run.set({ runID: "run", status: "running", requestBlockID: "request" });
    const refresh = service.pollRun();
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.change("Newly saved writing");
    expect(await service.flush()).toBe(true);
    finish({ runID: "run", documentID: "doc", revision: "r1", requestBlockID: "request", blocks: [] });
    await refresh;
    expect(applyReply).not.toHaveBeenCalled();
    expect(service.content()).toBe("Newly saved writing");
    expect(service.document()?.revision).toBe("r3");
  });
  it("clears loading after a navigation save fails", async () => {
    const service = setup(async action => {
      if (action === "todayOpen") return document;
      if (action === "documentCommit") throw Error("Actual revision conflict");
      return [];
    });
    await service.open(document.day);
    service.change("Unsaved");
    expect(await service.open("2026-09-28")).toBe(false);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBe("Actual revision conflict");
    expect(service.content()).toBe("Unsaved");
  });

  it("ignores a slow Today response after its editor route has closed", async () => {
    let finish!: (value: TodayDocument) => void;
    const service = setup(async (action) =>
      action === "todayOpen"
        ? new Promise<TodayDocument>((resolve) => (finish = resolve))
        : [],
    );
    const opening = service.open(document.day);
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.cancelPendingReads();
    finish(document);
    expect(await opening).toBe(false);
    expect(service.document()).toBeNull();
    expect(service.loading()).toBe(false);
  });
  it("does not begin a queued open after route destruction while preserving a dirty save", async () => {
    let finish!: (value: any) => void;
    let opens = 0;
    const service = setup(async (action) => {
      if (action === "todayOpen") {
        opens++;
        return document;
      }
      if (action === "documentCommit")
        return new Promise((resolve) => (finish = resolve));
      return [];
    });
    await service.open(document.day);
    service.change("Keep this writing");
    const opening = service.open("2026-09-28");
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.cancelPendingReads();
    finish({
      ...document,
      content: "Keep this writing",
      revision: "r2",
      state: "committed",
    });
    expect(await opening).toBe(false);
    expect(opens).toBe(1);
    expect(service.content()).toBe("Keep this writing");
    expect(service.document()?.revision).toBe("r2");
    expect(service.dirty()).toBe(false);
  });
  it("ignores an error from a closed document read", async () => {
    let fail!: (error: Error) => void;
    const service = setup(async (action) =>
      action === "documentOpen"
        ? new Promise((_, reject) => (fail = reject))
        : [],
    );
    const opening = service.openDocument("old-doc");
    await vi.waitFor(() => expect(fail).toBeDefined());
    service.cancelPendingReads();
    fail(new Error("Old request failed"));
    expect(await opening).toBe(false);
    expect(service.error()).toBe("");
  });
  it("lets the Mac choose app iCloud storage rather than reusing an open notebook", async () => {
    const requests: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "documentOpen") return { ...document, notebookID: "previous-user-notebook" };
      if (action === "todayOpen" || action === "todayMigrate") {
        requests.push(data);
        return document;
      }
      return [];
    });

    await service.openDocument(document.documentID);
    expect(service.selectedNotebook()).toBe("previous-user-notebook");
    await service.open(document.day);
    await service.migrate();
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => !("notebookID" in request))).toBe(true);
  });
  it("validates calendar dates without converting the local day to UTC", () => {
    expect(validDay("2026-02-29")).toBe(false);
    expect(validDay("2028-02-29")).toBe(true);
    expect(validDay("2026-13-01")).toBe(false);
  });
  it("retains edits made while a save is in flight and serializes the second revision", async () => {
    let finish!: (value: any) => void;
    const commands: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "documentDraft") return {};
      if (action === "documentCommit") {
        commands.push(data);
        if (commands.length === 1)
          return new Promise((resolve) => (finish = resolve));
        return {
          ...document,
          content: data.content,
          revision: "r3",
          state: "committed",
        };
      }
      return [];
    });
    await service.open(document.day);
    service.change("First");
    const saving = service.flush();
    await vi.waitFor(() => expect(commands.length).toBe(1));
    service.change("Second");
    finish({
      ...document,
      content: "First",
      revision: "r2",
      state: "committed",
    });
    expect(await saving).toBe(true);
    expect(commands[1].expectedRevision).toBe("r2");
    expect(commands[1].content).toBe("Second");
    expect(service.content()).toBe("Second");
    expect(service.dirty()).toBe(false);
  });
  it("reuses the command identity on uncertain retry and keeps a conflicting draft", async () => {
    const commands: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "documentDraft") return {};
      if (action === "documentCommit") {
        commands.push(data);
        throw Error("Revision conflict");
      }
      return [];
    });
    await service.open(document.day);
    service.change("My writing");
    expect(await service.flush()).toBe(false);
    expect(await service.flush()).toBe(false);
    expect(commands[0].commandID).toBe(commands[1].commandID);
    expect(service.dirty()).toBe(true);
    expect(service.content()).toBe("My writing");
  });
  it("flushes the durable request before submitting and never submits on opening", async () => {
    const actions: string[] = [];
    const service = setup(async (action, data) => {
      actions.push(action);
      if (action === "todayOpen") return document;
      if (action === "documentCommit")
        return { ...document, revision: "r2", state: "committed" };
      if (action === "mapleSubmit") {
        expect(data.expectedRevision).toBe("r2");
        return { runID: "run", requestBlockID: "request", status: "queued" };
      }
      return [];
    });
    await service.open(document.day);
    expect(actions).not.toContain("mapleSubmit");
    service.change("@maple Find sources");
    await service.submit("request", "Find sources");
    expect(actions.indexOf("documentCommit")).toBeLessThan(
      actions.indexOf("mapleSubmit"),
    );
    expect(service.run()?.status).toBe("queued");
  });
  it("does not replace dirty writing when Maple finishes", async () => {
    const service = setup(async (action) => {
      if (action === "todayOpen") return document;
      if (action === "mapleRun")
        return {
          runID: "run",
          status: "succeeded",
          requestBlockID: "request",
          content: "Agent reply",
          appliedRevision: "r2",
        };
      if (action === "documentCommit") throw Error("Conflict");
      return [];
    });
    await service.open(document.day);
    service.run.set({
      runID: "run",
      status: "running",
      requestBlockID: "request",
    });
    service.change("User writing");
    await service.pollRun();
    expect(service.content()).toBe("User writing");
    expect(service.dirty()).toBe(true);
    await service.flush();
  });
  it("archives an ambiguous recovered draft and opens the external file without a conflict banner", async () => {
    const calls: {action:string;data:any}[]=[];
    const service=setup(async (action,data)=>{
      calls.push({action,data});
      if(action==='todayOpen')return {...document,revision:'external-r2',content:'External writing',draft:{revision:'r1',content:'Recovered draft'}};
      if(action==='documentRecoveryCopy')return {path:'recovery.md',content:data.content};
      if(action==='documentCommit')return {...document,revision:'external-r2',content:data.content,state:'committed'};
      return [];
    });
    expect(await service.open(document.day)).toBe(true);
    expect(service.content()).toBe('External writing');expect(service.error()).toBe('');expect(service.conflictedDraft()).toBe(false);expect(service.dirty()).toBe(false);
    expect(calls.find(c=>c.action==='documentRecoveryCopy')?.data).toMatchObject({content:'Recovered draft',recoveryKey:'r1'});
    expect(calls.find(c=>c.action==='documentCommit')?.data).toMatchObject({content:'External writing',expectedRevision:'external-r2'});
    expect(calls.findIndex(c=>c.action==='documentRecoveryCopy')).toBeLessThan(calls.findIndex(c=>c.action==='documentCommit'));
  });
  it("automatically merges separate changes using committed history and the current expected revision",async()=>{
    const base='first\n\nlast\n',saved:any[]=[];
    const service=setup(async(action,data)=>{
      if(action==='todayOpen')return {...document,content:'FIRST\n\nlast\n',revision:'r2',draft:{content:'first\n\nLAST\n',revision:'r1'}};
      if(action==='documentHistory')return [{state:'committed',targetRevision:'r1',after:base}];
      if(action==='documentCommit'){saved.push(data);return {...document,content:data.content,revision:'r3',state:'committed'};}
      if(action==='documentRecoveryCopy')throw Error('A safe merge should not need a copy');
      return [];
    });
    expect(await service.open(document.day)).toBe(true);expect(service.content()).toBe('FIRST\n\nLAST\n');expect(service.dirty()).toBe(false);expect(service.error()).toBe('');expect(saved[0].expectedRevision).toBe('r2');
  });
  it("does not replace the retained draft when its automatic recovery copy fails",async()=>{
    const commit=vi.fn();
    const service=setup(async(action)=>{
      if(action==='todayOpen')return {...document,revision:'r2',draft:{revision:'r1',content:'Recovered draft'}};
      if(action==='documentHistory')return [];
      if(action==='documentRecoveryCopy')throw Error('Recovery disk unavailable');
      if(action==='documentCommit')commit();return [];
    });
    expect(await service.open(document.day)).toBe(false);expect(commit).not.toHaveBeenCalled();expect(service.openError()).toContain('Recovery disk unavailable');
  });
  it("does not commit a superseded recovery after its history read finishes",async()=>{
    let release!:(value:any)=>void;const commit=vi.fn();
    const service=setup(async(action,data)=>{
      if(action==='todayOpen')return data.day===document.day ? {...document,revision:'r2',draft:{revision:'r1',content:'old draft'}} : {...document,day:data.day};
      if(action==='documentHistory')return new Promise(resolve=>release=resolve);
      if(action==='documentCommit')commit();return [];
    });
    const old=service.open(document.day);await vi.waitFor(()=>expect(release).toBeDefined());await service.open('2026-09-28');release([]);expect(await old).toBe(false);expect(service.day()).toBe('2026-09-28');expect(commit).not.toHaveBeenCalled();
  });
  it("reopens a generic managed document without silently losing a draft on failed read", async () => {
    let fail = false;
    const service = setup(async (action,data) => {
      if (action === "documentCommit") return {...document,content:data.content,state:"committed"};
      if (action === "documentOpen") {
        if (fail) throw Error("Disk unavailable");
        return {
          ...document,
          day: "",
          draft: { revision: "r1", content: "Recovered" },
        };
      }
      return [];
    });
    await service.openDocument("doc");
    fail = true;
    await service.reopen();
    expect(service.dirty()).toBe(false);
    expect(service.content()).toBe("Recovered");
    fail = false;
    await service.reopen();
    expect(service.content()).toBe("Original");
    expect(service.dirty()).toBe(false);
  });
  it("does not hydrate a stale agent revision over a newer acknowledged user save", async () => {
    const service = setup(async (action) => {
      if (action === "todayOpen") return document;
      if (action === "mapleRun")
        return {
          runID: "run",
          requestBlockID: "request",
          status: "succeeded",
          content: "Stale reply version",
          appliedRevision: "r2",
        };
      if (action === "documentOpen")
        return {
          ...document,
          content: "User changes after reply",
          revision: "r3",
        };
      return [];
    });
    await service.open(document.day);
    service.run.set({
      runID: "run",
      status: "running",
      requestBlockID: "request",
    });
    await service.pollRun();
    expect(service.content()).toBe("Original");
    expect(service.document()?.revision).toBe("r1");
    expect(vi.mocked(service.bridge.notebook).mock.calls.some(([action]) => action === "documentOpen")).toBe(false);
  });
  it("uses a new submission identity when the committed revision changes", async () => {
    const commands: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "documentOpen") return { ...document, revision: "r2" };
      if (action === "mapleSubmit") {
        commands.push(data);
        return { runID: "run", requestBlockID: "request", status: "queued" };
      }
      return [];
    });
    await service.open(document.day);
    await service.submit("request", "Find sources");
    await service.submit("request", "Find sources");
    expect(commands[0].commandID).toBe(commands[1].commandID);
    await service.openDocument(document.documentID);
    await service.submit("request", "Find sources");
    expect(commands[2].commandID).not.toBe(commands[0].commandID);
  });
});

describe("automatic daily context", () => {
  it("persists accepted automatic identities even when deleted before the first save", async () => {
    const id = "auto-source:" + "a".repeat(64);
    const saved: any[] = [];
    const drafts: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "documentDraft") drafts.push(data);
      if (action === "documentCommit") {
        saved.push(data);
        return { ...document, content: data.content, revision: "r2", state: "committed" };
      }
      return [];
    });
    await service.open(document.day);
    service.setCollaborativeEditor({ applyAutomaticProposal: () => true, applyMapleResponse: () => true,
      getAcceptedAutomaticBlockIDs: () => [id] });
    service.change("Original plus arrived block");
    service.change("Original");
    expect(await service.flush()).toBe(true);
    expect(saved[0]).toMatchObject({ content: "Original", acceptedAutomaticBlockIDs: [id] });
    expect(drafts.every(value => value.acceptedAutomaticBlockIDs.includes(id))).toBe(true);
  });
  it("automatically commits receipt-only drafts and prevents reinsertion", async () => {
    const id = "auto-source:" + "b".repeat(64);
    const runID = "da94ed3d-ddb7-45b6-b36e-b65a7fe29b77";
    const saved: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return { ...document, draft: { content: document.content, revision: document.revision, acceptedAutomaticBlockIDs: [id], acceptedReplyRunIDs: [runID] } };
      if (action === "documentCommit") {
        saved.push(data);
        return { ...document, state: "committed" };
      }
      return [];
    });
    await service.open(document.day);
    expect(service.dirty()).toBe(false);
    const restore = vi.fn();
    const restoreReplies = vi.fn();
    service.setCollaborativeEditor({ applyAutomaticProposal: () => true, applyMapleResponse: () => true, restoreAutomaticBlockIDs: restore, restoreReplyRunIDs: restoreReplies });
    expect(restore).toHaveBeenCalledWith([id]);
    expect(restoreReplies).toHaveBeenCalledWith([runID]);
    expect(await service.flush()).toBe(true);
    expect(saved[0].acceptedAutomaticBlockIDs).toEqual([id]);
    expect(saved[0].acceptedReplyRunIDs).toEqual([runID]);
  });
  it("keeps the departing editor's lease until its final save reaches the Mac", async () => {
    let finish!: (value: any) => void;
    const service = setup(async (action) => {
      if (action === "todayOpen") return document;
      if (action === "documentCommit") return new Promise(resolve => finish = resolve);
      return [];
    });
    await service.open(document.day);
    service.change("Last typing");
    service.cancelPendingReads();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const calls = vi.mocked(service.bridge.notebook).mock.calls;
    expect(calls.some(([action, data]) => action === "documentPresence" && data?.["active"] === false)).toBe(false);
    finish({ ...document, content: "Last typing", revision: "r2", state: "committed" });
    await vi.waitFor(() => expect(calls.some(([action, data]) => action === "documentPresence" && data?.["active"] === false)).toBe(true));
    expect(service.dirty()).toBe(false);
  });
  const proposal = {
    documentID: "doc", revision: "r1",
    groups: [{ headingID: "fyi", title: "FYI", createHeading: true, blocks: [{ blockID: "source", markdown: "New source" }] }],
    removals: [],
  };
  it("merges incoming blocks while typing without replacing or remounting the document", async () => {
    const today = { ...document, day: localDay() };
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return today;
      if (action === "documentAutomaticProposal") return proposal;
      if (action === "documentCommit") return { ...today, content: data.content, revision: "r2", state: "committed" };
      return [];
    });
    await service.open();
    const generation = service.generation();
    const merge = vi.fn(() => { service.change(service.content() + "\nNew source"); return true; });
    service.setCollaborativeEditor({ applyAutomaticProposal: merge, applyMapleResponse: () => true });
    service.setEditing(true);
    service.change("My writing");
    await service.pollAutomatic();
    expect(merge).toHaveBeenCalledWith(proposal);
    expect(service.content()).toBe("My writing\nNew source");
    expect(service.initial()).toBe("Original");
    expect(service.generation()).toBe(generation);
    expect(await service.flush()).toBe(true);
    expect(service.document()?.content).toBe("My writing\nNew source");
  });
  it("commits another merged revision when a proposal arrives during an in-flight save", async () => {
    const today = { ...document, day: localDay() };
    let finish!: (value: any) => void;
    const commits: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return today;
      if (action === "documentAutomaticProposal") return proposal;
      if (action === "documentCommit") {
        commits.push(data);
        if (commits.length === 1) return new Promise(resolve => finish = resolve);
        return { ...today, content: data.content, revision: "r3", state: "committed" };
      }
      return [];
    });
    await service.open();
    service.setCollaborativeEditor({ applyAutomaticProposal: () => { service.change(service.content() + "\nIncoming"); return true; }, applyMapleResponse: () => true });
    service.change("Typing");
    const saving = service.flush();
    await vi.waitFor(() => expect(finish).toBeDefined());
    await service.pollAutomatic();
    finish({ ...today, content: "Typing", revision: "r2", state: "committed" });
    expect(await saving).toBe(true);
    expect(commits.map(value => [value.content, value.expectedRevision])).toEqual([["Typing", "r1"], ["Typing\nIncoming", "r2"]]);
    expect(service.content()).toBe("Typing\nIncoming");
    expect(service.dirty()).toBe(false);
  });
  it("claims ownership on open, renews while dirty and releases on route departure", async () => {
    const service = setup(async action => action === "todayOpen" ? { ...document, day: localDay() } : []);
    await service.open();
    service.setEditing(true);
    service.change("Draft");
    await service.pollAutomatic();
    const calls = vi.mocked(service.bridge.notebook).mock.calls;
    expect(calls.find(([action]) => action === "todayOpen")?.[1]).toMatchObject({ collaborative: true });
    expect(calls.filter(([action]) => action === "documentPresence").at(-1)?.[1]).toEqual({ documentID: "doc", active: true, editing: true, editorSessionID: expect.any(String) });
    service.cancelPendingReads();
    await service.flush();
    await Promise.resolve();
    expect(calls.filter(([action]) => action === "documentPresence").at(-1)?.[1]).toEqual({ documentID: "doc", active: false, editing: false, editorSessionID: expect.any(String) });
  });
  it("ignores proposals after route destruction", async () => {
    let finish!: (value: any) => void;
    const service = setup(async action => action === "todayOpen" ? { ...document, day: localDay() } : action === "documentAutomaticProposal" ? new Promise(resolve => finish = resolve) : []);
    const merge = vi.fn(() => true);
    await service.open();
    service.setCollaborativeEditor({ applyAutomaticProposal: merge, applyMapleResponse: () => true });
    const pending = service.pollAutomatic();
    service.cancelPendingReads();
    finish(proposal);
    await pending;
    expect(merge).not.toHaveBeenCalled();
    expect(service.content()).toBe("Original");
  });
  it("releases an atomic open claim if its route closes before the native response arrives", async () => {
    let finish!: (value: any) => void;
    const service = setup(async action => action === "todayOpen" ? new Promise(resolve => finish = resolve) : []);
    const opening = service.open(document.day);
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.cancelPendingReads();
    finish(document);
    expect(await opening).toBe(false);
    expect(vi.mocked(service.bridge.notebook).mock.calls.filter(([action]) => action === "documentPresence").at(-1)?.[1])
      .toEqual({ documentID: "doc", active: false, editing: false, editorSessionID: expect.any(String) });
    expect(service.document()).toBeNull();
  });
  it("preserves unsaved writing when the disk revision has independently changed", async () => {
    const service = setup(async action => action === "todayOpen" ? { ...document, day: localDay() } : action === "documentAutomaticProposal" ? { ...proposal, revision: "external-r2" } : []);
    const merge = vi.fn(() => true);
    await service.open();
    service.setCollaborativeEditor({ applyAutomaticProposal: merge, applyMapleResponse: () => true });
    service.change("Draft");
    await service.pollAutomatic();
    expect(merge).not.toHaveBeenCalled();
    expect(service.content()).toBe("Draft");
    expect(service.document()?.revision).toBe("r1");
    expect(service.automaticStatus()).toContain("saved revision");
    await service.flush();
  });
  it("retries a deferred reply and saves it together with concurrent user writing", async () => {
    const reply = { runID: "run", documentID: "doc", revision: "r1", requestBlockID: "request", blocks: [{ blockID: "reply", markdown: "Maple reply" }] };
    let ready = false;
    let acknowledged = false;
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "mapleRun") return { runID: "run", status: acknowledged ? "succeeded" : "unapplied", requestBlockID: "request", request: { text: "Find sources" }, ...(acknowledged ? { appliedRevision: "r2" } : {}) };
      if (action === "mapleResponseProposal") return reply;
      if (action === "documentCommit") { acknowledged = true; return { ...document, content: data.content, revision: "r2", state: "committed" }; }
      return [];
    });
    await service.open(document.day);
    const apply = vi.fn(() => { if (!ready) return false; service.change(service.content() + "\nMaple reply"); return true; });
    service.setCollaborativeEditor({ applyAutomaticProposal: () => true, applyMapleResponse: apply });
    service.run.set({ runID: "run", status: "running", requestBlockID: "request" });
    service.change("Typing alongside request");
    await service.pollRun();
    expect(service.content()).toBe("Typing alongside request");
    ready = true;
    await service.pollRun();
    expect(apply).toHaveBeenLastCalledWith({ ...reply, requestText: "Find sources" });
    expect(service.content()).toBe("Typing alongside request\nMaple reply");
    expect(service.run()?.appliedRevision).toBeUndefined();
    await service.flush();
    await service.pollRun();
    expect(service.run()?.appliedRevision).toBe("r2");
    expect(service.generation()).toBe(1);
  });
});
