import { describe, expect, it } from "vitest";
import { NoteSessionState } from "./note-session-state";
import type { TodayDocument } from "../today/today-document.service";

const doc: TodayDocument = {
  schemaVersion: 1, documentID: "doc", notebookID: "book", path: "note.md",
  day: "2026-09-30", timeZone: "America/New_York", content: "saved", revision: "r1",
  readOnly: false, indexingPending: false, legacyMigrationAvailable: false,
  capabilities: { taskActions: true, sourceReferences: true },
};

describe("local note session", () => {
  it("adopts a recovered conflict as one snapshot without claiming it is saved", () => {
    const state = new NoteSessionState();
    state.adopt({ ...doc, draft: { content: "recovery", revision: "older" } }, true);
    expect(state.snapshot()).toMatchObject({
      document: doc, content: "recovery", initial: "recovery", generation: 1,
      dirty: true, conflictedDraft: true,
    });
    expect(state.snapshot().status).toContain("Recovered");
    expect(state.snapshot().error).toContain("file changed");
  });

  it("save acknowledgments advance disk metadata but preserve newer local writing and mounted editor", () => {
    const state = new NoteSessionState();
    state.adopt(doc);
    state.edit("submitted");
    state.edit("newer typing");
    state.acknowledge({ ...doc, content: "submitted", revision: "r2" }, "submitted", false);
    expect(state.snapshot()).toMatchObject({ content: "newer typing", initial: "saved", generation: 1, dirty: true });
    expect(state.snapshot().status).toBe("Saving newer changes…");
    expect(state.snapshot().document?.revision).toBe("r2");
    state.acknowledge({ ...doc, content: "newer typing", revision: "r3" }, "newer typing", false);
    expect(state.snapshot().dirty).toBe(false);
  });

  it("receipt-only drafts and newer receipts remain dirty even when prose matches", () => {
    const state = new NoteSessionState();
    state.adopt({ ...doc, draft: { content: doc.content, revision: "r1", acceptedReplyRunIDs: ["run"] } }, true);
    expect(state.snapshot().dirty).toBe(true);
    state.acknowledge(doc, doc.content, true);
    expect(state.snapshot().dirty).toBe(true);
  });

  it("rejects an acknowledgment from a different document without changing the open state", () => {
    const state = new NoteSessionState();
    state.adopt(doc);
    state.edit("keep");
    const before = state.snapshot();
    expect(() => state.acknowledge({ ...doc, documentID: "other" }, "keep", false)).toThrow("different note");
    expect(state.snapshot()).toBe(before);
    expect((state.select("content") as any).set).toBeUndefined();
  });
});
