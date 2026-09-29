import { Injectable, inject } from "@angular/core";
import { NativeBridge } from "../core/native-bridge.service";

export const ATTACHMENT_BYTE_LIMIT = 12 * 1024 * 1024;
export interface AttachmentAttrs {
  ref: string | null;
  name: string;
  mimeType: string;
  byteCount: number;
  kind: "image" | "file";
  uploadID?: string | null;
}
export interface AttachmentRead {
  status: "ready" | "missing";
  dataURL?: string;
  byteCount?: number;
}
export function isAttachmentReference(ref: unknown): ref is string {
  return (
    typeof ref === "string" &&
    /^Attachments\/[a-f0-9]{64}\.(png|jpg|gif|webp|pdf|txt|m4a|mp3|wav|bin)$/.test(
      ref,
    )
  );
}
@Injectable({ providedIn: "root" })
export class AttachmentService {
  private readonly bridge = inject(NativeBridge);
  async importFile(documentID: string, file: File): Promise<AttachmentAttrs> {
    if (!documentID)
      throw new Error("Open a document before adding an attachment.");
    if (!file.size || file.size > ATTACHMENT_BYTE_LIMIT)
      throw new Error("Choose a nonempty attachment up to 12 MiB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const result = await this.bridge.notebook<AttachmentAttrs>(
      "attachmentImport",
      {
        documentID,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: btoa(binary),
      },
    );
    if (
      !isAttachmentReference(result.ref) ||
      !["image", "file"].includes(result.kind)
    )
      throw new Error("Invalid attachment response.");
    return { ...result, uploadID: null };
  }
  read(documentID: string, ref: string): Promise<AttachmentRead> {
    if (!isAttachmentReference(ref))
      return Promise.reject(new Error("Invalid attachment reference."));
    return this.bridge.notebook("attachmentRead", { documentID, ref });
  }
  saveCopy(
    documentID: string,
    attachment: AttachmentAttrs,
  ): Promise<{ saved: boolean }> {
    if (!isAttachmentReference(attachment.ref))
      return Promise.reject(new Error("This attachment is not available yet."));
    return this.bridge.notebook("attachmentExport", {
      documentID,
      ref: attachment.ref,
      name: attachment.name,
    });
  }
}
