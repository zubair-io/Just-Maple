import { Editor, Node } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import {
  ATTACHMENT_BYTE_LIMIT,
  AttachmentAttrs,
  AttachmentService,
  isAttachmentReference,
} from "./attachment.service";

type Upload = {
  file: File;
  documentID: string;
  loading: boolean;
  error: string;
};
export interface AttachmentSupport {
  node: Node;
  handlePaste(view: EditorView, event: ClipboardEvent): boolean;
  handleDrop(
    view: EditorView,
    event: DragEvent,
    slice: unknown,
    moved: boolean,
  ): boolean;
  addFiles(files: readonly File[], position?: number): void;
  destroy(): void;
}
/** Each editor owns its in-memory uploads. File bytes never enter the document or Markdown. */
export function createAttachmentSupport(
  service: AttachmentService,
  getEditor: () => Editor | undefined,
  getDocumentID: () => string,
  reportError: (message: string) => void,
): AttachmentSupport {
  const uploads = new Map<string, Upload>();
  const listeners = new Set<() => void>();
  let destroyed = false;
  const notify = () => listeners.forEach((listener) => listener());
  async function upload(id: string): Promise<void> {
    const item = uploads.get(id);
    if (!item || item.loading || destroyed) return;
    const editor = getEditor();
    item.loading = true;
    item.error = "";
    notify();
    try {
      const result = await service.importFile(item.documentID, item.file);
      if (
        destroyed ||
        !editor ||
        editor.isDestroyed ||
        getEditor() !== editor ||
        getDocumentID() !== item.documentID
      ) {
        uploads.delete(id);
        return;
      }
      if (!editor.isEditable) {
        item.error =
          "Attachment copied. Return to editing and retry to insert it.";
        return;
      }
      let position: number | undefined;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "attachment" && node.attrs["uploadID"] === id)
          position = pos;
      });
      if (position !== undefined) {
        const previous = editor.state.doc.nodeAt(position);
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(position, undefined, {
            ...previous?.attrs,
            ...result,
            uploadID: null,
          }),
        );
      }
      uploads.delete(id);
    } catch (error) {
      item.error =
        error instanceof Error
          ? error.message
          : "Attachment import failed. Try again.";
    } finally {
      item.loading = false;
      notify();
    }
  }
  function addFiles(files: readonly File[], position?: number): void {
    const editor = getEditor(),
      documentID = getDocumentID();
    if (destroyed || !editor || !editor.isEditable || !documentID) {
      reportError("Open an editable document before adding attachments.");
      return;
    }
    const currentUploads = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.type.name === "attachment" && node.attrs["uploadID"])
        currentUploads.add(node.attrs["uploadID"]);
    });
    for (const id of uploads.keys())
      if (!currentUploads.has(id)) uploads.delete(id);
    const accepted: File[] = [];
    let retained = Array.from(uploads.values()).reduce(
      (size, upload) => size + upload.file.size,
      0,
    );
    for (const file of files) {
      if (!file.size || file.size > ATTACHMENT_BYTE_LIMIT) {
        reportError(`${file.name}: choose a nonempty file up to 12 MiB.`);
        continue;
      }
      if (
        retained + file.size > ATTACHMENT_BYTE_LIMIT * 3 ||
        uploads.size + accepted.length >= 10
      ) {
        reportError(
          "Finish or remove pending attachments before adding more files.",
        );
        break;
      }
      retained += file.size;
      accepted.push(file);
    }
    const ids: string[] = [];
    const nodes = accepted.map((file) => {
      const id = crypto.randomUUID();
      ids.push(id);
      uploads.set(id, { file, documentID, loading: false, error: "" });
      return {
        type: "attachment",
        attrs: {
          ref: null,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          byteCount: file.size,
          kind: file.type.startsWith("image/") ? "image" : "file",
          uploadID: id,
          maple: { v: 1, id: crypto.randomUUID() },
        },
      };
    });
    if (!nodes.length) return;
    const inserted =
      position === undefined
        ? editor.commands.insertContent(nodes)
        : editor.commands.insertContentAt(position, nodes);
    if (!inserted) {
      ids.forEach((id) => uploads.delete(id));
      reportError("Could not insert the attachment here.");
      return;
    }
    ids.forEach((id) => void upload(id));
  }
  const node = Node.create({
    name: "attachment",
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes: () => ({
      ref: { default: null },
      name: { default: "Attachment" },
      mimeType: { default: "application/octet-stream" },
      byteCount: { default: 0 },
      kind: { default: "file" },
      uploadID: { default: null },
    }),
    // Clipboard HTML cannot grant native file authority; imports only come from File objects.
    parseHTML: () => [],
    renderHTML: ({ node }) => [
      "div",
      { "data-maple-attachment": "true" },
      String(node.attrs["name"]),
    ],
    addNodeView:
      () =>
      ({ node: initial }) => {
        const host = document.createElement("figure");
        host.contentEditable = "false";
        host.className = "maple-attachment";
        host.style.cssText =
          "margin:1rem 0;padding:1rem;border:1px solid var(--color-border);border-radius:10px;background:var(--color-bg-secondary);font-family:var(--font-sans);color:var(--color-text-main)";
        const image = document.createElement("img");
        image.style.cssText =
          "display:none;max-width:100%;max-height:560px;object-fit:contain;border-radius:6px";
        const caption = document.createElement("figcaption"),
          status = document.createElement("span"),
          button = document.createElement("button");
        caption.style.cssText = "margin-top:0.5rem;overflow-wrap:anywhere";
        status.setAttribute("role", "status");
        status.style.cssText =
          "display:block;font-size:0.8rem;color:var(--color-text-muted);margin-top:0.35rem";
        button.type = "button";
        button.style.cssText =
          "margin-top:0.6rem;padding:0.35rem 0.65rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg);color:var(--color-text-main);cursor:pointer";
        host.append(image, caption, status, button);
        let attrs = initial.attrs as AttachmentAttrs,
          disposed = false,
          generation = 0,
          loadedRef = "",
          failure = "",
          loading = false,
          missing = false;
        let documentID = getDocumentID();
        async function load(): Promise<void> {
          if (!attrs.ref || !isAttachmentReference(attrs.ref) || disposed)
            return;
          const current = ++generation;
          loading = true;
          failure = "";
          missing = false;
          render();
          try {
            const result = await service.read(documentID, attrs.ref);
            if (disposed || current !== generation) return;
            missing = result.status === "missing";
            loadedRef = attrs.ref;
            if (attrs.kind === "image" && result.status === "ready") {
              if (
                !result.dataURL ||
                !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(
                  result.dataURL,
                )
              )
                throw new Error("This file is not a supported image.");
              image.alt = attrs.name;
              image.src = result.dataURL;
              image.style.display = "block";
            }
          } catch (error) {
            if (!disposed && current === generation)
              failure =
                error instanceof Error
                  ? error.message
                  : "Could not load attachment.";
          } finally {
            if (!disposed && current === generation) {
              loading = false;
              render();
            }
          }
        }
        image.onerror = () => {
          failure = "The image could not be displayed. Try loading it again.";
          image.style.display = "none";
          render();
        };
        function render(): void {
          if (disposed) return;
          const pending = attrs.uploadID
            ? uploads.get(attrs.uploadID)
            : undefined;
          caption.textContent = attrs.name;
          status.textContent = pending?.loading
            ? "Copying attachment…"
            : pending?.error ||
              failure ||
              (loading
                ? "Loading from your notebook…"
                : !attrs.ref
                  ? "Import interrupted. Choose this file again."
                  : missing
                    ? "Attachment missing. Restore it in your notebook, then retry."
                    : `${Math.ceil(attrs.byteCount / 1024)} KB · ${attrs.mimeType}`);
          button.hidden =
            !!pending?.loading || loading || (!attrs.ref && !pending);
          button.disabled = !!pending && !getEditor()?.isEditable;
          button.textContent = pending
            ? "Retry import"
            : missing || failure
              ? "Retry loading"
              : "Save a copy";
        }
        button.onclick = () => {
          if (attrs.uploadID && uploads.has(attrs.uploadID)) {
            void upload(attrs.uploadID);
            return;
          }
          if (missing || failure) {
            void load();
            return;
          }
          button.disabled = true;
          void service
            .saveCopy(documentID, attrs)
            .catch((error) => {
              failure =
                error instanceof Error
                  ? error.message
                  : "Could not save attachment.";
              render();
            })
            .finally(() => {
              button.disabled = false;
            });
        };
        listeners.add(render);
        render();
        if (attrs.ref) void load();
        return {
          dom: host,
          stopEvent: (event) =>
            event.target instanceof HTMLElement &&
            !!event.target.closest("button"),
          ignoreMutation: () => true,
          update(updated) {
            if (updated.type.name !== "attachment") return false;
            const oldRef = attrs.ref,
              nextDocumentID = getDocumentID();
            if (
              nextDocumentID !== documentID ||
              oldRef !== updated.attrs["ref"]
            ) {
              documentID = nextDocumentID;
              generation++;
              loading = false;
              loadedRef = "";
              failure = "";
              missing = false;
              image.removeAttribute("src");
              image.style.display = "none";
            }
            attrs = updated.attrs as AttachmentAttrs;
            render();
            if (
              attrs.ref &&
              (oldRef !== attrs.ref || loadedRef !== attrs.ref) &&
              !loading
            )
              void load();
            return true;
          },
          destroy() {
            disposed = true;
            generation++;
            listeners.delete(render);
            image.removeAttribute("src");
          },
        };
      },
  });
  return {
    node,
    addFiles,
    handlePaste(_view, event) {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return false;
      event.preventDefault();
      addFiles(files);
      return true;
    },
    handleDrop(view, event, _slice, moved) {
      if (moved) return false;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return false;
      event.preventDefault();
      const position = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      })?.pos;
      addFiles(files, position);
      return true;
    },
    destroy() {
      destroyed = true;
      uploads.clear();
      listeners.clear();
    },
  };
}
