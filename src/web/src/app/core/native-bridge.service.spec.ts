import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi, afterEach } from "vitest";
import { NativeBridge, emptySnapshot } from "./native-bridge.service";
afterEach(() => vi.unstubAllGlobals());
describe("WKWebView bridge ordering", () => {
  it("serializes a poll and a mutation, leaving the command snapshot current", async () => {
    let resolve!: (v: unknown) => void;
    const first = new Promise((r) => (resolve = r));
    const postMessage = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        ...emptySnapshot,
        loaded: true,
        name: "New name",
      });
    vi.stubGlobal("webkit", { messageHandlers: { maple: { postMessage } } });
    const bridge = TestBed.inject(NativeBridge);
    const poll = bridge.command({ action: "snapshot" });
    const edit = bridge.command({ action: "introduce", name: "New name" });
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledTimes(1);
    resolve({ ...emptySnapshot, loaded: true, name: "Old name" });
    await poll;
    await edit;
    expect(bridge.state().name).toBe("New name");
    expect(postMessage).toHaveBeenLastCalledWith({
      action: "introduce",
      name: "New name",
    });
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
