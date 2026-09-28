import { TestBed } from "@angular/core/testing";
import { describe, it, expect, vi } from "vitest";
import {
  AttachmentService,
  ATTACHMENT_BYTE_LIMIT,
  isAttachmentReference,
} from "./attachment.service";
import { NativeBridge } from "../core/native-bridge.service";
const ref = "Attachments/" + "a".repeat(64) + ".png";
describe("Local attachments", () => {
  it("rejects untrusted references before native access", async () => {
    const notebook = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: NativeBridge, useValue: { notebook } }],
    });
    const service = TestBed.inject(AttachmentService);
    for (const path of [
      "../private",
      "file:///private",
      "https://example.com/a.png",
      "Attachments/a.png",
    ]) {
      expect(isAttachmentReference(path)).toBe(false);
      await expect(service.read("doc", path)).rejects.toThrow(
        "Invalid attachment",
      );
    }
    expect(notebook).not.toHaveBeenCalled();
  });
  it("bounds import and sends only bytes plus managed document identity", async () => {
    const notebook = vi
      .fn()
      .mockResolvedValue({
        ref,
        name: "Synthetic.png",
        mimeType: "image/png",
        byteCount: 3,
        kind: "image",
      });
    TestBed.configureTestingModule({
      providers: [{ provide: NativeBridge, useValue: { notebook } }],
    });
    const service = TestBed.inject(AttachmentService);
    await expect(
      service.importFile("doc", { size: ATTACHMENT_BYTE_LIMIT + 1 } as File),
    ).rejects.toThrow("12 MiB");
    const file = {
      name: "Synthetic.png",
      type: "image/png",
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    expect((await service.importFile("doc", file)).ref).toBe(ref);
    expect(notebook).toHaveBeenCalledWith("attachmentImport", {
      documentID: "doc",
      name: "Synthetic.png",
      mimeType: "image/png",
      base64: "AQID",
    });
  });
});
