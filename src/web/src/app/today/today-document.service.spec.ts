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
  path: "Daily/2026-09-27.md",
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
