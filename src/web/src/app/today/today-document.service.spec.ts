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
  it("does not replace an acknowledged save with a late reply refresh", async () => {
    let finish!: (value: TodayDocument) => void;
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
      if (action === "mapleRun") return { runID: "run", status: "succeeded", requestBlockID: "request", content: "Reply", appliedRevision: "r2" };
      if (action === "documentOpen") return new Promise(resolve => finish = resolve);
      if (action === "documentCommit") return { ...document, content: data.content, revision: "r3", state: "committed" };
      return [];
    });
    await service.open(document.day);
    service.run.set({ runID: "run", status: "running", requestBlockID: "request" });
    const refresh = service.pollRun();
    await vi.waitFor(() => expect(finish).toBeDefined());
    service.change("Newly saved writing");
    expect(await service.flush()).toBe(true);
    finish({ ...document, content: "Old reply snapshot", revision: "r2" });
    await refresh;
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
      if (action === "todayOpen" || action === "todayMigrate") {
        requests.push(data);
        return document;
      }
      return [];
    });
    service.selectedNotebook.set("previous-user-notebook");
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
  it("never overwrites a newer external revision with a recovered draft, including after more typing", async () => {
    const calls: { action: string; data: any }[] = [];
    const service = setup(async (action, data) => {
      calls.push({ action, data });
      if (action === "todayOpen")
        return {
          ...document,
          revision: "external-r2",
          content: "External writing",
          draft: { revision: "r1", content: "Recovered draft" },
        };
      if (action === "documentDraft") return {};
      return [];
    });
    await service.open(document.day);
    expect(service.conflictedDraft()).toBe(true);
    service.change("Recovered draft with newer typing");
    expect(await service.flush()).toBe(false);
    expect(
      calls.filter((call) => call.action === "documentCommit"),
    ).toHaveLength(0);
    expect(
      calls.find((call) => call.action === "documentDraft")?.data.revision,
    ).toBe("r1");
    expect(service.content()).toBe("Recovered draft with newer typing");
  });
  it("reopens a generic managed document without silently losing a draft on failed read", async () => {
    let fail = false;
    const service = setup(async (action) => {
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
    expect(service.dirty()).toBe(true);
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
    expect(service.content()).toBe("User changes after reply");
    expect(service.document()?.revision).toBe("r3");
  });
  it("uses a new submission identity when the committed revision changes", async () => {
    const commands: any[] = [];
    const service = setup(async (action, data) => {
      if (action === "todayOpen") return document;
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
    service.document.update((doc) => ({ ...doc!, revision: "r2" }));
    await service.submit("request", "Find sources");
    expect(commands[2].commandID).not.toBe(commands[0].commandID);
  });
});

describe("automatic daily context", () => {
  it("adopts new persisted blocks only when the note is idle", async () => {
    const today={...document,day:localDay()};
    const updated={...today,revision:"r2",content:"Original\n\n## FYI\nNew source"};
    const service=setup(async action=>action==="todayOpen" ? today : action==="documentAutoRefresh" ? {document:updated} : []);
    await service.open();
    await service.pollAutomatic();
    expect(service.content()).toBe(updated.content);
    expect(service.dirty()).toBe(false);
  });
  it("does not remount an unchanged document or replace typing begun during a refresh", async () => {
    const today={...document,day:localDay()};
    let finish!: (value:any)=>void;
    const service=setup(async action=>action==="todayOpen" ? today : action==="documentAutoRefresh" ? new Promise(resolve=>finish=resolve) : []);
    await service.open();
    const generation=service.generation();
    const first=service.pollAutomatic();finish({document:today});await first;
    expect(service.generation()).toBe(generation);
    const pending=service.pollAutomatic();
    service.setEditing(true);
    service.change("My new writing");
    finish({document:{...today,revision:"r2",content:"Automatic block"}});
    await pending;
    expect(service.content()).toBe("My new writing");
    expect(service.dirty()).toBe(true);
    service.cancelPendingReads();
  });
  it("refreshes presence while focused and ignores replies after route destruction", async () => {
    const today={...document,day:localDay()};let finish!: (value:any)=>void;
    const calls:string[]=[];
    const service=setup(async action=>{calls.push(action);return action==="todayOpen" ? today : action==="documentAutoRefresh" ? new Promise(resolve=>finish=resolve) : [];});
    await service.open();service.setEditing(true);await service.pollAutomatic();
    expect(calls.filter(x=>x==="documentPresence").length).toBe(2);
    expect(calls).not.toContain("documentAutoRefresh");
    service.setEditing(false);const pending=service.pollAutomatic();service.cancelPendingReads();
    finish({document:{...today,revision:"r2",content:"New"}});await pending;
    expect(service.content()).toBe("Original");
  });
});
