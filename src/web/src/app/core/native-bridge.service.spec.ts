import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi, afterEach } from "vitest";
import { NativeBridge, emptySnapshot } from "./native-bridge.service";
afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});
function host(postMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("webkit", { messageHandlers: { maple: { postMessage } } });
  return TestBed.inject(NativeBridge);
}
describe("WKWebView bridge ordering", () => {
  it("delivers a cached loaded snapshot while a notebook read is still waiting", async () => {
    let finish!: (v: unknown) => void;
    const postMessage = vi.fn((body: any) =>
      body.action === "notebookCatalog"
        ? new Promise((resolve) => (finish = resolve))
        : Promise.resolve({ ...emptySnapshot, loaded: true }),
    );
    const bridge = host(postMessage);
    const reading = bridge.notebook("notebookCatalog");
    await vi.waitFor(() => expect(finish).toBeDefined());
    await bridge.command({ action: "snapshot" });
    expect(bridge.state().loaded).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(2);
    finish({ notebooks: [] });
    await reading;
  });
  it("does not let an older poll overwrite a completed command snapshot", async () => {
    let finish!: (v: unknown) => void;
    const bridge = host(
      vi.fn((body: any) =>
        body.action === "snapshot"
          ? new Promise((resolve) => (finish = resolve))
          : Promise.resolve({
              ...emptySnapshot,
              loaded: true,
              name: "New name",
            }),
      ),
    );
    const poll = bridge.command({ action: "snapshot" });
    await bridge.command({ action: "introduce", name: "New name" });
    finish({ ...emptySnapshot, loaded: true, name: "Old name" });
    await poll;
    expect(bridge.state().name).toBe("New name");
  });
  it("ignores a poll begun during a mutation even if it arrives after the command", async () => {
    let finishCommand!: (v: unknown) => void;
    let finishPoll!: (v: unknown) => void;
    const bridge = host(
      vi.fn(
        (body: any) =>
          new Promise((resolve) => {
            if (body.action === "snapshot") finishPoll = resolve;
            else finishCommand = resolve;
          }),
      ),
    );
    const command = bridge.command({ action: "introduce", name: "New name" });
    await vi.waitFor(() => expect(finishCommand).toBeDefined());
    const poll = bridge.command({ action: "snapshot" });
    finishCommand({ ...emptySnapshot, loaded: true, name: "New name" });
    await command;
    finishPoll({ ...emptySnapshot, loaded: true, name: "Old name" });
    await poll;
    expect(bridge.state().name).toBe("New name");
  });
  it("retains the newest snapshot when independent polls return out of order", async () => {
    const replies: ((v: unknown) => void)[] = [];
    const bridge = host(
      vi.fn(() => new Promise((resolve) => replies.push(resolve))),
    );
    const oldPoll = bridge.command({ action: "snapshot" });
    const newPoll = bridge.command({ action: "snapshot" });
    replies[1]({ ...emptySnapshot, loaded: true, name: "Newest" });
    await newPoll;
    replies[0]({ ...emptySnapshot, loaded: false });
    await oldPoll;
    expect(bridge.state().name).toBe("Newest");
    expect(bridge.state().loaded).toBe(true);
  });
  it("still serializes mutations", async () => {
    let finish!: (v: unknown) => void;
    const postMessage = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      )
      .mockResolvedValue({ ...emptySnapshot, loaded: true, name: "Second" });
    const bridge = host(postMessage);
    const first = bridge.command({ action: "introduce", name: "First" });
    const second = bridge.command({ action: "introduce", name: "Second" });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(postMessage).toHaveBeenCalledTimes(1);
    finish({ ...emptySnapshot, loaded: true, name: "First" });
    await Promise.all([first, second]);
    expect(bridge.state().name).toBe("Second");
  });
  it("reports an unavailable native host without inventing a successful connection", async () => {
    vi.stubGlobal("webkit", undefined);
    const bridge = TestBed.inject(NativeBridge);
    expect(await bridge.act({ action: "connect", key: "test-only" })).toBe(
      false,
    );
    expect(bridge.state().connected).toBe(false);
    expect(bridge.error()).toContain("Xcode");
  });
});
