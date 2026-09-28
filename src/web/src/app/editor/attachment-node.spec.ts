import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createAttachmentSupport } from "./attachment-node";
import { AttachmentService } from "./attachment.service";
const file = { name: "Synthetic.txt", size: 3, type: "text/plain" } as File;
const ready = {
  ref: "Attachments/" + "a".repeat(64) + ".txt",
  name: file.name,
  mimeType: file.type,
  byteCount: 3,
  kind: "file" as const,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("Attachment editor lifecycle", () => {
  it("replaces the stable placeholder after import without persisting file bytes", async () => {
    const service = {
      importFile: vi.fn().mockResolvedValue(ready),
      read: vi.fn().mockResolvedValue({ status: "ready" }),
      saveCopy: vi.fn(),
    } as unknown as AttachmentService;
    let editor: Editor | undefined;
    const support = createAttachmentSupport(
      service,
      () => editor,
      () => "doc",
      vi.fn(),
    );
    editor = new Editor({
      extensions: [StarterKit, support.node],
      content: "<p>Before</p>",
    });
    support.addFiles([file]);
    await flush();
    const attachment = editor
      .getJSON()
      .content?.find((n) => n.type === "attachment");
    expect(attachment?.attrs?.["ref"]).toBe(ready.ref);
    expect(attachment?.attrs?.["uploadID"]).toBeNull();
    expect(JSON.stringify(editor.getJSON())).not.toContain("base64");
    support.destroy();
    editor.destroy();
  });
  it("does not apply a late upload to another document", async () => {
    let resolve!: (value: typeof ready) => void;
    const pending = new Promise<typeof ready>((done) => (resolve = done));
    const service = {
      importFile: vi.fn().mockReturnValue(pending),
      read: vi.fn(),
      saveCopy: vi.fn(),
    } as unknown as AttachmentService;
    let editor: Editor | undefined,
      documentID = "first";
    const support = createAttachmentSupport(
      service,
      () => editor,
      () => documentID,
      vi.fn(),
    );
    editor = new Editor({
      extensions: [StarterKit, support.node],
      content: "<p>Before</p>",
    });
    support.addFiles([file]);
    documentID = "second";
    editor.commands.setContent("<p>Second document</p>");
    resolve(ready);
    await flush();
    expect(editor.getText()).toBe("Second document");
    expect(editor.getJSON().content?.some((n) => n.type === "attachment")).toBe(
      false,
    );
    support.destroy();
    editor.destroy();
  });
  it("does not insert or complete imports into a readonly editor", async () => {
    let resolve!: (value: typeof ready) => void;
    const pending = new Promise<typeof ready>((done) => (resolve = done));
    const importFile = vi.fn().mockReturnValue(pending),
      error = vi.fn();
    const service = {
      importFile,
      read: vi.fn(),
      saveCopy: vi.fn(),
    } as unknown as AttachmentService;
    let editor: Editor | undefined;
    const support = createAttachmentSupport(
      service,
      () => editor,
      () => "doc",
      error,
    );
    editor = new Editor({
      extensions: [StarterKit, support.node],
      content: "<p>Before</p>",
      editable: false,
    });
    support.addFiles([file]);
    expect(importFile).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    editor.setEditable(true);
    support.addFiles([file]);
    editor.setEditable(false);
    resolve(ready);
    await flush();
    expect(
      editor.getJSON().content?.find((n) => n.type === "attachment")?.attrs?.[
        "ref"
      ],
    ).toBeNull();
    support.destroy();
    editor.destroy();
  });
  it("renders missing media and reloads only through the bounded service", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: "missing" })
      .mockResolvedValueOnce({ status: "ready" });
    const service = {
      importFile: vi.fn(),
      read,
      saveCopy: vi.fn(),
    } as unknown as AttachmentService;
    let editor: Editor | undefined;
    const support = createAttachmentSupport(
      service,
      () => editor,
      () => "doc",
      vi.fn(),
    );
    editor = new Editor({
      extensions: [StarterKit, support.node],
      content: { type: "doc", content: [{ type: "attachment", attrs: ready }] },
    });
    await flush();
    expect(editor.view.dom.textContent).toContain("Attachment missing");
    (editor.view.dom.querySelector("button") as HTMLButtonElement).click();
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(editor.view.dom.textContent).not.toContain("Attachment missing");
    support.destroy();
    editor.destroy();
  });
  it("rebinds reused attachment views when changing documents", async () => {
    const read = vi.fn().mockResolvedValue({ status: "ready" });
    const service = {
      importFile: vi.fn(),
      read,
      saveCopy: vi.fn(),
    } as unknown as AttachmentService;
    let editor: Editor | undefined,
      documentID = "first";
    const support = createAttachmentSupport(
      service,
      () => editor,
      () => documentID,
      vi.fn(),
    );
    editor = new Editor({
      extensions: [StarterKit, support.node],
      content: { type: "doc", content: [{ type: "attachment", attrs: ready }] },
    });
    await flush();
    documentID = "second";
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "attachment", attrs: { ...ready, name: "Second attachment" } },
      ],
    });
    await flush();
    expect(read).toHaveBeenLastCalledWith("second", ready.ref);
    support.destroy();
    editor.destroy();
  });
  it("leaves failed import visibly pending and retry reuses its identity", async () => {
    const importFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(ready);
    const service = {
      importFile,
      read: vi.fn().mockResolvedValue({ status: "ready" }),
      saveCopy: vi.fn(),
    } as unknown as AttachmentService;
    let editor: Editor | undefined;
    const support = createAttachmentSupport(
      service,
      () => editor,
      () => "doc",
      vi.fn(),
    );
    editor = new Editor({
      extensions: [StarterKit, support.node],
      content: "<p>Before</p>",
    });
    support.addFiles([file]);
    await flush();
    expect(
      editor.getJSON().content?.find((n) => n.type === "attachment")?.attrs?.[
        "ref"
      ],
    ).toBeNull();
    expect(editor.view.dom.textContent).toContain("Offline");
    (editor.view.dom.querySelector("button") as HTMLButtonElement).click();
    await flush();
    expect(importFile).toHaveBeenCalledTimes(2);
    expect(
      editor.getJSON().content?.find((n) => n.type === "attachment")?.attrs?.[
        "ref"
      ],
    ).toBe(ready.ref);
    support.destroy();
    editor.destroy();
  });
});
