import {
  AfterViewInit,
  ApplicationRef,
  Component,
  ChangeDetectorRef,
  ElementRef,
  EnvironmentInjector,
  Injector,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
  createComponent,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { syncCollapsedDOMSelection } from "./selection-sync";
import { normalizeLegacySections } from "./legacy-sections";
import { HeadingSections } from "./heading-sections";
import { docToMarkdown } from "../notebooks/sugar-editor/document-to-markdown";
import { FormsModule } from "@angular/forms";
import { Editor, Extension, Node, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import Document from "@tiptap/extension-document";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Plugin } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import { computePosition, shift } from "@floating-ui/dom";
import { CodeBlockWithLanguage } from "../notebooks/sugar-editor/code-block-with-language";
import { getTableExtensions } from "../notebooks/sugar-editor/table-extension";
import { MarkdownPaste } from "../notebooks/sugar-editor/markdown-paste";
import {
  MapleCallout,
  MapleDetails,
  SingleTildeStrike,
} from "./structured-content";
import {
  createDailyInteractionExtensions,
  convertBlock,
  selectedBlockID,
  openBlockActions,
} from "./interactions/daily-interactions";
import { AttachmentService } from "./attachment.service";
import { createAttachmentSupport, AttachmentSupport } from "./attachment-node";
import {
  decodeDaily,
  encodeDaily,
  BlockMetadata,
  SourceReference,
} from "./daily-markdown-codec";
import { LinkedTaskComponent } from "./linked-task.component";
import { SourceReferenceComponent } from "./source-reference.component";
const identityTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "table",
  "sourceReference",
  "linkedTask",
  "callout",
  "details",
  "attachment",
];
export const StableBlockIdentity = Extension.create({
  name: "stableBlockIdentity",
  addGlobalAttributes() {
    return [
      {
        types: identityTypes,
        attributes: {
          maple: {
            default: null,
            renderHTML: () => ({}),
            parseHTML: () => null,
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = newState.tr;
          const seen = new Set<string>();
          newState.doc.descendants((node, pos, parent) => {
            if (
              parent !== newState.doc &&
              !["listItem", "taskItem"].includes(node.type.name)
            )
              return;
            const meta = node.attrs["maple"] as BlockMetadata | null;
            if (!meta?.id || seen.has(meta.id)) {
              // Enter after an inline request starts ordinary writing. Do not
              // inherit the request's execution identity on the split paragraph.
              const inherited = { ...(meta ?? {}) };
              if (
                inherited.kind === "maple-request" &&
                (node.type.name !== "paragraph" ||
                  !/^@maple\b/i.test(node.textContent))
              ) {
                delete inherited.kind;
                delete inherited.requestID;
                delete inherited.runID;
              }
              const identity = {
                ...inherited,
                v: 1,
                id: crypto.randomUUID(),
                ...(inherited.requestID
                  ? { requestID: crypto.randomUUID(), runID: undefined }
                  : {}),
                ...(node.type.name === "linkedTask"
                  ? { taskID: node.attrs["taskID"] }
                  : {}),
              };
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                maple: identity,
              });
              seen.add(identity.id);
            } else seen.add(meta.id);
          });
          return tr.docChanged ? tr : null;
        },
        props: {
          transformPasted(slice) {
            const remap = (fragment: Fragment): Fragment =>
              Fragment.fromArray(
                fragment.content.map((node) => {
                  const attrs = { ...node.attrs };
                  if (attrs["maple"])
                    attrs["maple"] = {
                      ...attrs["maple"],
                      id: crypto.randomUUID(),
                      requestID: attrs["maple"].requestID
                        ? crypto.randomUUID()
                        : undefined,
                      runID: undefined,
                      taskCommandID: undefined,
                    };
                  return node.isText
                    ? node
                    : node.type.create(
                        attrs,
                        node.content.size ? remap(node.content) : undefined,
                        node.marks,
                      );
                }),
              );
            return new Slice(
              remap(slice.content),
              slice.openStart,
              slice.openEnd,
            );
          },
        },
      }),
    ];
  },
});
@Component({
  selector: "maple-editor",
  standalone: true,
  imports: [FormsModule],
  encapsulation: ViewEncapsulation.None,
  templateUrl: "./maple-editor.component.html",
  styleUrls: ["./maple-editor.component.css", "./structured-content.css"],
})
export class MapleEditorComponent implements AfterViewInit, OnDestroy {
  readonly initial = input.required<string>();
  readonly documentID = input("");
  readonly storageMode = input<"managed" | "markdown">("managed");
  readonly editorLabel = input("Daily note editor");
  readonly readOnly = input(false);
  readonly showToolbar = input(true);
  readonly documentToolsAvailable = input(false);
  readonly dayTransfersAvailable = input(false);
  readonly changed = output<string>();
  readonly editingChanged = output<boolean>();
  readonly inspected = output<string>();
  readonly submitted = output<{ blockID: string; text: string }>();
  readonly sourceRequested = output<void>();
  readonly clearRequested = output<string>();
  readonly documentToolsRequested = output<void>();
  readonly blockTransferRequested = output<{
    blockID: string;
    kind: "move" | "copy";
  }>();
  readonly palette = signal(false);
  readonly toolbarPosition = signal({ x: -1000, y: -1000 });
  private readonly selectionRevision = signal(0);
  readonly formatTools = [
    { id: "paragraph", label: "Paragraph", icon: "¶" },
    { id: "h1", label: "Heading 1", icon: "H1" },
    { id: "h2", label: "Heading 2", icon: "H2" },
    { id: "h3", label: "Heading 3", icon: "H3" },
    { id: "bold", label: "Bold · ⌘B", icon: "B" },
    { id: "italic", label: "Italic · ⌘I", icon: "I" },
    { id: "underline", label: "Underline · ⌘U", icon: "U" },
    { id: "strike", label: "Strikethrough", icon: "S" },
    { id: "code", label: "Inline code", icon: "</>" },
  ];
  readonly insertTools = [
    { id: "bullet", label: "Bullet list" },
    { id: "ordered", label: "Numbered list" },
    { id: "task", label: "Checklist" },
    { id: "quote", label: "Quote" },
    { id: "codeBlock", label: "Code block" },
    { id: "table", label: "Table · 3 × 3" },
    { id: "source", label: "Source reference" },
    { id: "maple", label: "Ask @maple" },
    { id: "info", label: "Info callout" },
    { id: "tip", label: "Tip callout" },
    { id: "warning", label: "Warning callout" },
    { id: "danger", label: "Danger callout" },
    { id: "attachment", label: "Image or file" },
    { id: "divider", label: "Divider" },
    { id: "markdown", label: "View Markdown" },
    { id: "block", label: "Block actions" },
  ];
  readonly source = signal(false);
  readonly notice = signal("");
  @ViewChild("surface", { static: true }) surface!: ElementRef<HTMLElement>;
  @ViewChild("filePicker", { static: true })
  filePicker!: ElementRef<HTMLInputElement>;
  private attachmentSupport?: AttachmentSupport;
  private attachments = inject(AttachmentService);
  private changeDetector = inject(ChangeDetectorRef);
  private toolbarElement?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private positionFrame?: number;
  @ViewChild("toolbar") set toolbar(
    value: ElementRef<HTMLElement> | undefined,
  ) {
    this.toolbarElement = value?.nativeElement;
    this.positionToolbar();
  }
  editor?: Editor;
  raw = "";
  private prefix = "";
  private app = inject(ApplicationRef);
  private injector = inject(EnvironmentInjector);
  private elementInjector = inject(Injector);
  constructor() {
    effect(() => {
      const editable = !this.readOnly();
      this.editor?.setEditable(editable);
    });
  }
  ngAfterViewInit() {
    this.raw = this.initial();
    const parsed = decodeDaily(this.raw);
    this.prefix = parsed.prefix;
    this.source.set(
      parsed.sourceOnly ||
        (this.storageMode() === "markdown" &&
          containsManagedContent(parsed.doc)),
    );
    this.notice.set(
      parsed.reason ||
        (this.source()
          ? "This note contains managed content. Markdown mode preserves it exactly."
          : ""),
    );
    this.mount(normalizeLegacySections(parsed.doc));
    this.changeDetector.detectChanges();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.positionToolbar());
      this.resizeObserver.observe(this.surface.nativeElement);
    }
    window.addEventListener("resize", this.positionToolbar);
    window.visualViewport?.addEventListener("resize", this.positionToolbar);
  }
  positionToolbar = () => {
    if (this.positionFrame) cancelAnimationFrame(this.positionFrame);
    this.positionFrame = requestAnimationFrame(() => {
      const floating = this.toolbarElement;
      if (!floating) return;
      const rect = this.surface.nativeElement.getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom =
        (viewport?.height ?? window.innerHeight) +
        (viewport?.offsetTop ?? 0) -
        20;
      const x = rect.left + rect.width / 2;
      void computePosition(
        {
          getBoundingClientRect: () => ({
            x,
            y: bottom,
            top: bottom,
            bottom,
            left: x,
            right: x,
            width: 0,
            height: 0,
          }),
        },
        floating,
        {
          strategy: "fixed",
          placement: "top",
          middleware: [shift({ padding: 12 })],
        },
      ).then(({ x, y }) => {
        if (this.toolbarElement === floating)
          this.toolbarPosition.set({ x, y });
      });
    });
  };
  preserveSelection(event: PointerEvent) {
    if (event.target instanceof HTMLElement && event.target.closest("button"))
      event.preventDefault();
  }
  toolbarKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      this.palette.set(false);
      this.editor?.commands.focus();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      this.toolbarElement?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) %
            buttons.length;
    buttons[next]?.focus();
  }
  active(id: string): boolean {
    this.selectionRevision();
    return id.startsWith("h") && /^h[123]$/.test(id)
      ? !!this.editor?.isActive("heading", { level: Number(id[1]) })
      : !!this.editor?.isActive(id);
  }
  canUndo() {
    this.selectionRevision();
    return !!this.editor?.can().undo();
  }
  canRedo() {
    this.selectionRevision();
    return !!this.editor?.can().redo();
  }
  inTable() {
    this.selectionRevision();
    return !!this.editor?.isActive("table");
  }
  format(id: string) {
    if (!this.editor || this.readOnly()) return;
    const chain = this.editor.chain().focus();
    switch (id) {
      case "paragraph":
        chain.setParagraph().run();
        break;
      case "h1":
      case "h2":
      case "h3":
        chain.toggleHeading({ level: Number(id[1]) as 1 | 2 | 3 }).run();
        break;
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "underline":
        chain.toggleUnderline().run();
        break;
      case "strike":
        chain.toggleStrike().run();
        break;
      case "code":
        chain.toggleCode().run();
        break;
    }
  }
  insert(id: string) {
    if (!this.editor || this.readOnly()) return;
    if (
      this.storageMode() === "markdown" &&
      ["source", "maple", "attachment"].includes(id)
    )
      return;
    this.palette.set(false);
    const chain = this.editor.chain().focus();
    switch (id) {
      case "bullet":
        convertBlock(this.editor, selectedBlockID(this.editor), "bulletList");
        break;
      case "ordered":
        convertBlock(this.editor, selectedBlockID(this.editor), "orderedList");
        break;
      case "task":
        convertBlock(this.editor, selectedBlockID(this.editor), "taskList");
        break;
      case "quote":
        convertBlock(this.editor, selectedBlockID(this.editor), "blockquote");
        break;
      case "codeBlock":
        chain.toggleCodeBlock().run();
        break;
      case "table":
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
      case "source":
        this.sourceRequested.emit();
        break;
      case "maple":
        this.addRequest();
        break;
      case "info":
      case "tip":
      case "warning":
      case "danger":
        chain
          .insertContent({
            type: "callout",
            attrs: { kind: id },
            content: [{ type: "paragraph" }],
          })
          .run();
        break;
      case "divider":
        chain.setHorizontalRule().run();
        break;
      case "markdown":
        this.toggleSource();
        break;
      case "block":
        openBlockActions(this.editor);
        break;
      case "attachment":
        this.filePicker.nativeElement.click();
        break;
    }
    this.positionToolbar();
  }
  tableAction(action: string) {
    if (!this.editor || this.readOnly()) return;
    const chain = this.editor.chain().focus();
    switch (action) {
      case "rowBefore":
        chain.addRowBefore().run();
        break;
      case "rowAfter":
        chain.addRowAfter().run();
        break;
      case "columnBefore":
        chain.addColumnBefore().run();
        break;
      case "columnAfter":
        chain.addColumnAfter().run();
        break;
      case "deleteRow":
        chain.deleteRow().run();
        break;
      case "deleteColumn":
        chain.deleteColumn().run();
        break;
    }
  }
  private mount(doc: JSONContent) {
    this.attachmentSupport?.destroy();
    this.editor?.destroy();
    this.attachmentSupport = createAttachmentSupport(
      this.attachments,
      () => this.editor,
      () => this.documentID(),
      (message) => this.notice.set(message),
    );
    const owner = this;
    const Reference = Node.create({
      name: "sourceReference",
      group: "managedBlock",
      atom: true,
      draggable: true,
      addAttributes() {
        return {
          reference: {
            default: null,
            parseHTML: (element) => {
              try {
                const value = JSON.parse(
                  element.getAttribute("data-maple-reference") ?? "null",
                );
                return value?.v === 1 &&
                  typeof value.eventID === "string" &&
                  typeof value.kind === "string"
                  ? value
                  : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attrs) => ({
              "data-maple-reference": JSON.stringify(attrs["reference"]),
            }),
          },
        };
      },
      parseHTML() {
        return [
          {
            tag: "maple-source-ref",
            getAttrs: (element) => {
              try {
                const value = JSON.parse(
                  element.getAttribute("data-maple-reference") ?? "null",
                );
                return value?.v === 1 &&
                  typeof value.eventID === "string" &&
                  typeof value.kind === "string"
                  ? null
                  : false;
              } catch {
                return false;
              }
            },
          },
        ];
      },
      renderHTML({ node, HTMLAttributes }) {
        return [
          "maple-source-ref",
          HTMLAttributes,
          (node.attrs["reference"] as SourceReference)?.label ??
            "Source reference",
        ];
      },
      addNodeView() {
        return ({ node }) => {
          const host = document.createElement("div");
          host.contentEditable = "false";
          const component = createComponent(SourceReferenceComponent, {
            environmentInjector: owner.injector,
            elementInjector: owner.elementInjector,
            hostElement: host,
          });
          component.setInput("reference", node.attrs["reference"]);
          owner.app.attachView(component.hostView);
          const subscription = component.instance.inspected.subscribe((id) =>
            owner.inspected.emit(id),
          );
          component.changeDetectorRef.detectChanges();
          return {
            dom: host,
            update(updated) {
              if (updated.type.name !== "sourceReference") return false;
              component.setInput("reference", updated.attrs["reference"]);
              return true;
            },
            stopEvent: (event) =>
              event.target instanceof HTMLElement &&
              !!event.target.closest("button"),
            ignoreMutation: () => true,
            destroy() {
              subscription.unsubscribe();
              owner.app.detachView(component.hostView);
              component.destroy();
            },
          };
        };
      },
    });
    const LinkedTask = Node.create({
      name: "linkedTask",
      group: "managedBlock",
      atom: true,
      draggable: true,
      addAttributes() {
        return {
          taskID: {
            default: "",
            parseHTML: (element) => element.getAttribute("data-task-id"),
            renderHTML: (attrs) => ({ "data-task-id": attrs["taskID"] }),
          },
          markdown: {
            default: "",
            parseHTML: (element) => element.getAttribute("data-task-markdown"),
            renderHTML: (attrs) => ({
              "data-task-markdown": attrs["markdown"],
            }),
          },
          label: {
            default: "",
            parseHTML: (element) => element.textContent,
            renderHTML: () => ({}),
          },
        };
      },
      parseHTML() {
        return [
          {
            tag: "maple-linked-task",
            getAttrs: (element) => {
              const id = element.getAttribute("data-task-id"),
                markdown = element.getAttribute("data-task-markdown");
              return id &&
                id.length <= 128 &&
                markdown &&
                markdown.length <= 8000 &&
                /^- \[[ xX]\] [^\n]+$/.test(markdown)
                ? null
                : false;
            },
          },
        ];
      },
      renderHTML({ node, HTMLAttributes }) {
        return ["maple-linked-task", HTMLAttributes, node.attrs["label"]];
      },
      addNodeView() {
        return ({ node }) => {
          const host = document.createElement("div");
          host.contentEditable = "false";
          const component = createComponent(LinkedTaskComponent, {
            environmentInjector: owner.injector,
            elementInjector: owner.elementInjector,
            hostElement: host,
          });
          component.setInput("blockID", node.attrs["maple"]?.id);
          component.setInput("label", node.attrs["label"]);
          owner.app.attachView(component.hostView);
          component.changeDetectorRef.detectChanges();
          return {
            dom: host,
            update(updated) {
              if (updated.type.name !== "linkedTask") return false;
              component.setInput("blockID", updated.attrs["maple"]?.id);
              component.setInput("label", updated.attrs["label"]);
              return true;
            },
            stopEvent: (event) =>
              event.target instanceof HTMLElement &&
              !!event.target.closest("button"),
            ignoreMutation: () => true,
            destroy() {
              owner.app.detachView(component.hostView);
              component.destroy();
            },
          };
        };
      },
    });
    const MapleParagraph = Paragraph.extend({
      addNodeView() {
        return ({ node, getPos, editor }) => {
          let current = node;
          const dom = document.createElement("div"),
            contentDOM = document.createElement("p"),
            button = document.createElement("button");
          dom.className = "maple-paragraph";
          button.type = "button";
          button.className = "maple-run-button";
          button.contentEditable = "false";
          button.textContent = "Ask Maple ↵";
          dom.append(contentDOM, button);
          const refresh = () => {
            const meta = current.attrs["maple"] as BlockMetadata | undefined;
            const request = /^@maple\b/i.test(current.textContent);
            const pos = getPos();
            const nested =
              typeof pos === "number" &&
              editor.state.doc.resolve(pos).depth > 0;
            button.hidden =
              !request ||
              owner.readOnly() ||
              nested ||
              owner.storageMode() === "markdown";
            dom.classList.toggle(
              "maple-request",
              request || meta?.kind === "maple-request",
            );
            dom.classList.toggle("maple-reply", meta?.kind === "maple-reply");
          };
          refresh();
          button.addEventListener("click", () => {
            const pos = getPos();
            if (pos === undefined) return;
            const text = current.textContent.replace(/^@maple\s*/i, "").trim();
            if (!text) return;
            const meta = {
              ...(current.attrs["maple"] ?? {}),
              v: 1,
              id: current.attrs["maple"]?.id ?? crypto.randomUUID(),
              kind: "maple-request",
              requestID:
                current.attrs["maple"]?.requestID ?? crypto.randomUUID(),
            };
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, {
                ...current.attrs,
                maple: meta,
              }),
            );
            owner.submitted.emit({ blockID: meta.id, text });
          });
          return {
            dom,
            contentDOM,
            update(updated) {
              if (updated.type.name !== "paragraph") return false;
              current = updated;
              refresh();
              return true;
            },
            stopEvent: (event) => event.target === button,
            ignoreMutation: (mutation) =>
              mutation.type !== "selection" &&
              !contentDOM.contains(mutation.target) &&
              mutation.target !== contentDOM,
          };
        };
      },
    });
    this.editor = new Editor({
      element: this.surface.nativeElement,
      editable: !this.readOnly(),
      extensions: [
        StarterKit.configure({
          document: false,
          paragraph: false,
          codeBlock: false,
          link: { openOnClick: false, protocols: ["https", "http", "mailto"] },
        }),
        Document.extend({ content: "(block | managedBlock)+" }),
        MapleParagraph,
        Placeholder.configure({
          placeholder:
            "A place to think, collect what matters, and keep things moving.",
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockWithLanguage,
        ...getTableExtensions(),
        StableBlockIdentity,
        HeadingSections,
        MarkdownPaste.configure({
          parseMarkdown: (text: string) => {
            const decoded = decodeDaily(text);
            if (decoded.sourceOnly) throw new Error(decoded.reason);
            if (
              this.storageMode() === "markdown" &&
              containsManagedContent(decoded.doc)
            )
              throw new Error(
                "Enable source blocks before pasting managed content.",
              );
            return normalizeLegacySections(decoded.doc).content ?? [];
          },
        }),
        MapleCallout,
        MapleDetails,
        SingleTildeStrike,
        this.attachmentSupport.node,
        ...createDailyInteractionExtensions({
          managed: this.storageMode() === "managed",
          onSource: () => this.sourceRequested.emit(),
          onMaple: () => this.addRequest(),
          ...(this.storageMode() === "managed"
            ? {
                onAttachment: () => this.filePicker.nativeElement.click(),
                onClear: (id: string) => this.clearRequested.emit(id),
              }
            : {}),
          ...(this.dayTransfersAvailable()
            ? {
                onMoveToNextDay: (blockID: string) =>
                  this.blockTransferRequested.emit({ blockID, kind: "move" }),
                onCopyToNextDay: (blockID: string) =>
                  this.blockTransferRequested.emit({ blockID, kind: "copy" }),
              }
            : {}),
          onError: (message) => this.notice.set(message),
        }),
        Reference,
        LinkedTask,
      ],
      content: this.source()
        ? { type: "doc", content: [{ type: "paragraph" }] }
        : doc,
      editorProps: {
        handlePaste: (view, event, slice) => {
          if (this.storageMode() === "managed")
            return this.attachmentSupport?.handlePaste(view, event) ?? false;
          if (
            event.clipboardData?.files.length ||
            slice.content.content.some((node) =>
              containsManagedContent(node.toJSON()),
            )
          ) {
            this.notice.set(
              "Enable source blocks in Document tools to add files or source cards.",
            );
            return true;
          }
          return false;
        },
        handleDrop: (view, event, slice, moved) => {
          if (this.storageMode() === "managed")
            return (
              this.attachmentSupport?.handleDrop(view, event, slice, moved) ??
              false
            );
          if (
            event.dataTransfer?.files.length ||
            slice.content.content.some((node) =>
              containsManagedContent(node.toJSON()),
            )
          ) {
            this.notice.set(
              "Enable source blocks in Document tools to add files or source cards.",
            );
            return true;
          }
          return false;
        },
        attributes: {
          role: "textbox",
          "aria-label": this.editorLabel(),
          spellcheck: "true",
          autocapitalize: "sentences",
          "aria-multiline": "true",
        },
        handleKeyDown: (view, event) => {
          syncCollapsedDOMSelection(view, event);
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            const selected = this.editor?.state.selection.$from;
            if (selected) {
              for (let depth = selected.depth; depth > 0; depth--) {
                const node = selected.node(depth);
                if (
                  node.type.name === "paragraph" &&
                  /^@maple\b/i.test(node.textContent)
                ) {
                  event.preventDefault();
                  this.submitAt(selected.before(depth));
                  return true;
                }
              }
            }
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
      onFocus: () => this.editingChanged.emit(true),
      onBlur: () => this.editingChanged.emit(false),
      onUpdate: () => {
        this.raw =
          this.storageMode() === "managed"
            ? encodeDaily(this.prefix, this.editor!.getJSON())
            : this.prefix + docToMarkdown(this.editor!.getJSON());
        this.changed.emit(this.raw);
      },
      onTransaction: () => {
        this.selectionRevision.update((value) => value + 1);
        this.positionToolbar();
      },
    });
  }
  submitAt(pos: number) {
    const editor = this.editor;
    if (!editor || this.readOnly() || this.storageMode() === "markdown") return;
    if (editor.state.doc.resolve(pos).depth > 0) {
      this.notice.set(
        "Move this Maple request outside its container to ask it inline.",
      );
      return;
    }
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const text = node.textContent.replace(/^@maple\s*/i, "").trim();
    if (!text) return;
    const meta = {
      ...(node.attrs["maple"] ?? {}),
      v: 1,
      id: node.attrs["maple"]?.id ?? crypto.randomUUID(),
      kind: "maple-request",
      requestID: node.attrs["maple"]?.requestID ?? crypto.randomUUID(),
    };
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        maple: meta,
      }),
    );
    this.submitted.emit({ blockID: meta.id, text });
  }
  sourceChanged(raw: string) {
    this.raw = raw;
    this.changed.emit(raw);
  }
  filesSelected(event: Event) {
    if (this.storageMode() === "markdown") return;
    const input = event.target as HTMLInputElement;
    this.attachmentSupport?.addFiles(Array.from(input.files ?? []));
    input.value = "";
  }
  toggleSource() {
    if (this.source()) {
      const parsed = decodeDaily(this.raw);
      if (
        parsed.sourceOnly ||
        (this.storageMode() === "markdown" &&
          containsManagedContent(parsed.doc))
      ) {
        this.notice.set(
          (parsed.reason ||
            "Enable source blocks to edit this managed content.") +
            " Nothing has been removed.",
        );
        return;
      }
      this.prefix = parsed.prefix;
      this.source.set(false);
      this.notice.set("");
      this.mount(normalizeLegacySections(parsed.doc));
    } else this.source.set(true);
  }
  addRequest() {
    this.insertManagedBlock(
      { type: "paragraph", content: [{ type: "text", text: "@maple " }] },
      false,
    );
  }
  private insertManagedBlock(node: JSONContent, trailing = true) {
    const editor = this.editor;
    if (
      !editor ||
      this.readOnly() ||
      this.source() ||
      this.storageMode() === "markdown"
    )
      return false;
    const selected = editor.state.selection.$from;
    const chain = editor.chain().focus();
    const content = trailing ? [node, { type: "paragraph" }] : [node];
    // Canonical source/request identities are indexed as top-level blocks.
    // Keep them outside list/callout/details containers until nested indexing exists.
    return selected.depth > 1
      ? chain.insertContentAt(selected.after(1), content).run()
      : chain.insertContent(content).run();
  }
  insertReference(reference: SourceReference) {
    if (this.source() || this.readOnly()) return false;
    return this.insertManagedBlock({
      type: "sourceReference",
      attrs: { reference },
    });
  }
  ngOnDestroy() {
    this.editingChanged.emit(false);
    this.attachmentSupport?.destroy();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.positionToolbar);
    window.visualViewport?.removeEventListener("resize", this.positionToolbar);
    if (this.positionFrame) cancelAnimationFrame(this.positionFrame);
    this.editor?.destroy();
  }
}

function containsManagedContent(node: JSONContent): boolean {
  return (
    ["sourceReference", "linkedTask", "attachment"].includes(node.type ?? "") ||
    !!node.content?.some(containsManagedContent)
  );
}
