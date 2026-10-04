import { describe, expect, it, vi } from "vitest";
import { LocalDraftQueue } from "./local-draft-queue";

describe("local draft outbox", () => {
  it("bounds a slow writer to the in-flight and latest snapshots without losing the flush barrier", async () => {
    let finish!: () => void;
    const written: string[] = [];
    const queue = new LocalDraftQueue<string>(async text => {
      written.push(text);
      if (text === "first") await new Promise<void>(resolve => finish = resolve);
    }, vi.fn());
    queue.enqueue("note", "first");
    await vi.waitFor(() => expect(finish).toBeDefined());
    for (let i = 0; i < 1000; i++) queue.enqueue("note", `typing ${i}`);
    expect(queue.state()).toEqual({ writing: true, pending: 1 });
    let flushed = false;
    const flushing = queue.flush().then(() => flushed = true);
    await Promise.resolve();
    expect(flushed).toBe(false);
    finish();
    await flushing;
    expect(written).toEqual(["first", "typing 999"]);
    expect(queue.busy()).toBe(false);
  });

  it("retains failed drafts, retries the newest version and does not acknowledge failure", async () => {
    let reject!: (e: Error) => void;
    const written: string[] = [];
    const failure = vi.fn();
    const queue = new LocalDraftQueue<string>(async text => {
      written.push(text);
      if (written.length === 1) await new Promise<void>((_, no) => reject = no);
    }, failure);
    queue.enqueue("note", "old");
    await vi.waitFor(() => expect(reject).toBeDefined());
    queue.enqueue("note", "newest");
    const flushing = queue.flush();
    reject(Error("Disk unavailable"));
    await expect(flushing).rejects.toThrow("Disk unavailable");
    expect(failure).toHaveBeenCalledOnce();
    expect(queue.state()).toEqual({ writing: false, pending: 1 });
    await queue.flush();
    expect(written).toEqual(["old", "newest"]);
    expect(queue.busy()).toBe(false);
  });

  it("does not coalesce separate documents and retains a failed snapshot without a later edit", async () => {
    const written: string[] = [];
    let fail = true;
    const queue = new LocalDraftQueue<string>(async text => {
      if (fail) throw Error("Unavailable");
      written.push(text);
    }, vi.fn());
    queue.enqueue("a", "A");
    await expect(queue.flush()).rejects.toThrow();
    fail = false;
    queue.enqueue("b", "B");
    await queue.flush();
    expect(written).toEqual(["A", "B"]);
  });
});
